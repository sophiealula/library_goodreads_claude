# Shelflife v2 Design

## Overview

Shelflife is an MCP server that connects a user's Goodreads to-read list to their local library (BiblioCommons-based systems). v1 added read-only availability checking. v2 adds authenticated library account features: placing holds, due date monitoring, and smart hold staggering.

**Interface:** MCP server only. Claude is the conversational layer. No standalone UI.

**Audience:** Claude Code users (primary), extendable to any MCP-compatible client (Claude Desktop, Telegram/Discord via channel bridges).

**Library system:** BiblioCommons-based libraries. Developed against Chicago Public Library (chipublib), designed to work with any BiblioCommons library.

**Scope:** Physical books only. No Libby/OverDrive ebook support in this version.

---

## Authentication

### Credentials

- **Library card number + PIN** stored as environment variables:
  - `LIBRARY_CARD_NUMBER`
  - `LIBRARY_PIN`
- Non-secret config remains in `.shelfliferc.json` (Goodreads user ID, library subdomain, branch, shelf)

### Auth Flow (confirmed via reverse-engineering)

BiblioCommons has a JSON gateway API:
1. `POST https://gateway.bibliocommons.com/v2/libraries/{lib}/sessions` with `{"username": "<card>", "password": "<pin>"}`
2. Preserve session cookies from response
3. `GET https://gateway.bibliocommons.com/v2/libraries/{lib}/sessions/current` to get `auth.currentUserId` (the accountId)
4. Use accountId + session cookies for all subsequent authenticated calls

Sessions should be cached and reused until they expire, then re-authenticated automatically.

### Confirmed Endpoints

| Action | Method | Endpoint | Auth |
|---|---|---|---|
| Login | POST | `/v2/libraries/{lib}/sessions` | No |
| Current session | GET | `/v2/libraries/{lib}/sessions/current` | Yes |
| Place hold | POST | `/v2/libraries/{lib}/holds` | Yes |
| List holds | GET | `/v2/libraries/{lib}/holds?accountId=X` | Yes |
| List checkouts | GET | `/v2/libraries/{lib}/checkouts?accountId=X` | Yes |
| Renew checkout | PATCH | `/v2/libraries/{lib}/checkouts` | Yes |
| Catalog search | GET | `/v2/libraries/{lib}/bibs/search?query=X` | No |
| Copy availability | GET | `/v2/libraries/{lib}/bibs/{id}/availability` | No |
| Holdable items | GET | `/v2/libraries/{lib}/bibs/{id}/holdableItems` | No |

### Still to discover (on first real login)

- Exact `materialParams` shape for hold POST body
- Session token format (likely cookies based on existing projects)
- Hold queue position data availability on holds GET

---

## Features

### 1. Availability Check (exists — polish)

**What it does:** Checks which books from a Goodreads shelf are available at the user's library.

**What's changing:**
- **Branch preference as first-class concept.** Results should always be filtered/sorted relative to the user's preferred branch(es). "At your branch" vs "at another branch" vs "in system but not on shelf" are distinct tiers.
- **Format filtering.** Exclude large print, audiobook CDs, and other non-standard formats from results. Only show regular print editions by default.

**MCP tools:** `check_shelf` (existing, update), `check_book` (existing, update)

### 2. Place Holds

**What it does:** Places a hold on a book at CPL via the user's authenticated account.

**Flow:**
1. User asks Claude to place a hold (e.g., "hold that book for me")
2. Tool places the hold with the user's preferred branch as pickup location
3. Returns confirmation with expected queue position

**Design decisions:**
- Always confirm before placing. Claude should present what it's about to do and get a "yes."
- Default pickup branch comes from `.shelfliferc.json` config (`branch` field)
- Tool should return current hold count and warn if approaching CPL's limit

**MCP tool:** `place_hold`

```
Inputs:
  - bib_id: string (BiblioCommons bib ID, obtained from availability check)
  - pickup_branch: string (optional, defaults to config branch)

Output:
  - success: boolean
  - queue_position: number (if available)
  - total_holds_on_title: number
  - current_user_hold_count: number
```

### 3. Due Date Monitoring

**What it does:** Checks the user's active checkouts and due dates.

**Two modes:**

**On-demand:** User asks "what's due soon?" Tool authenticates, scrapes the checkouts page, returns a list of checked-out items with due dates, sorted by urgency.

**Proactive (requires external comms channel):** When connected to Telegram/Discord/etc., the tool can be called on a schedule (cron or similar) to check for books due within 5 days and send a reminder.

**MCP tool:** `check_due_dates`

```
Inputs:
  (none — uses authenticated session)

Output:
  - checkouts: array of {title, author, due_date, days_until_due, renewable}
  - overdue: array (same shape, for anything past due)
  - due_soon: array (due within 5 days)
```

### 4. Hold Staggering

**What it does:** Lets you queue up multiple books and have them arrive roughly one at a time instead of all at once.

**Flow:**
1. User selects multiple books from availability results (e.g., "I want to read all 5 of these")
2. Claude presents the list and asks: "Want me to stagger these so they arrive one at a time?"
3. If yes, tool analyzes queue depths:
   - Books with very different queue depths get placed simultaneously (they'll naturally stagger)
   - Books with similar queue depths get queued sequentially
4. Tool places the first hold(s) immediately
5. When the user checks out a held book, the tool detects it and prompts for the next hold

**Checkout detection — two modes:**

- **With comms channel (Telegram, Discord, etc.):** Proactive. Polling detects the checkout and sends: "You picked up Book A! Want me to place the hold on Book B now?"
- **Without comms channel:** Reactive. Next time the user interacts with shelflife, it checks account state and catches up: "Since last time, you checked out Book A. Ready to queue Book B?"

Both modes require human confirmation before placing the next hold.

**State management:** The stagger queue needs to persist between interactions. Store in a local file (e.g., `.shelflife-queue.json`):

```json
{
  "queue": [
    {"bib_id": "123", "title": "Book B", "status": "waiting"},
    {"bib_id": "456", "title": "Book C", "status": "waiting"}
  ],
  "trigger_on_checkout_of": "789",
  "created": "2026-03-20"
}
```

**MCP tools:**
- `create_stagger_queue` — set up a sequence of holds
- `check_stagger_status` — detect checkouts and prompt for next hold (called automatically on any interaction, or via scheduled poll)

### 5. Account Polling Infrastructure

Shared infrastructure that powers both due date monitoring and checkout detection.

**How it works:**
- Authenticates and fetches the checkouts page
- Parses the Redux store blob for checkout data
- Diffs against previous known state (stored locally) to detect new checkouts and returns
- Returns changes since last check

This is not a user-facing feature — it's the engine behind features 3 and 4.

**Polling frequency:**
- On-demand: every time the user asks
- Scheduled (if comms channel exists): configurable, default daily

---

## MCP Tool Summary

| Tool | Auth Required | Description |
|---|---|---|
| `check_shelf` | No | Check availability of Goodreads shelf at library (existing) |
| `check_book` | No | Check availability of a specific book (existing) |
| `list_shelves` | No | List Goodreads shelves and book counts (existing) |
| `place_hold` | Yes | Place a hold on a book |
| `check_due_dates` | Yes | Check active checkouts and due dates |
| `create_stagger_queue` | Yes | Set up sequential hold placement |
| `check_stagger_status` | Yes | Check for checkout triggers and prompt next hold |

---

## Technical Risks

### BiblioCommons ToS
BiblioCommons ToS prohibits automated access beyond RSS feeds. Authenticated scraping is technically a violation. Enforcement against a patron automating their own account is extremely unlikely, but worth noting.

### Auth Fragility
All authenticated features depend on BiblioCommons's internal gateway API and login flow, which are undocumented and can change without notice. Mitigation: keep auth in a single module so breakage is isolated and fixable.

### Goodreads Scraping
Goodreads API is dead. Current tool uses RSS feeds (stable) with HTML fallback (moderate fragility). No changes needed for v2 — this risk is inherited from v1.

---

## Implementation Order

1. **Verify existing features work** — run the current tool, fix any issues
2. **DevTools investigation** — confirm auth flow, hold endpoint, checkouts page format
3. **Auth module** — login, session management, cookie handling
4. **Polish availability check** — branch preference, format filtering
5. **Due date check** — on-demand only
6. **Place holds** — single hold placement with confirmation
7. **Account polling** — diff-based checkout/return detection
8. **Hold staggering** — queue management, checkout-triggered prompting
9. **Proactive notifications** — scheduled polling + external channel dispatch (only if comms channel is set up)

---

## Out of Scope

- Ebook/audiobook availability (Libby/OverDrive)
- Goodreads write sync (technically near-impossible without browser automation)
- Multi-library support (easy to architect for later, not needed now)
- Standalone UI or web app
- Auto-renewal of checked-out books
