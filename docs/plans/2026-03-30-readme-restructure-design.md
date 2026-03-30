# README Restructure Design

**Date:** 2026-03-30
**Context:** Normies review (6 personas, senior dev to grandparent) found the README assumes developer audience, lacks sample output, buries/omits key features, and has an unexplained MCP section.

## Goals

- Make the README useful for both developers and Claude users
- Show what the tool actually does (sample output)
- Document features that exist but aren't mentioned (setup, libraries, authenticated tools)
- Fix misleading or incomplete information (MCP tool count, install method)

## README Structure

```
# shelflife
One-liner (keep as-is — universally praised by all 6 personas)

## Two ways to use it

### For Claude users
- 2-3 sentences: "If you use Claude Desktop or Claude Code, ShelfLife works as
  an MCP server — Claude can check your library for you."
- Config snippet (specify tsx requirement, use absolute path example)
- Example prompt: "What books on my to-read list are at the Chicago Public Library?"
- Note: requires clone + build first (link to Getting Started)
- Note: restart Claude after config change

### Standalone CLI
- Brief pitch: "Run it yourself from the terminal"
- Link to Getting Started below

## What it looks like
- Real terminal output captured from `shelflife check`
- Trim to ~5 books showing all 3 groupings (at branch / requestable / not found)
- Include the summary line

## Getting started
- Step 1: Clone + npm install + npm run build (explicit: not published to npm)
- Step 2: `shelflife setup` — interactive wizard that saves config to ~/.shelfliferc.json
  - Finds your Goodreads ID
  - Searches for your library
  - Optionally picks a nearby branch (uses geo lookup)
- Step 3: `shelflife check` — works with no flags after setup
  - Defaults to to-read shelf
  - Override with --shelf, --branch, etc.

## Commands
- `setup` — interactive config wizard
- `check` — check book availability (default command)
- `shelves` — list shelf counts (shows to-read, currently-reading, read; custom shelves via --shelf)
- `libraries [query]` — search supported BiblioCommons libraries by city/name
- `branches` — NEW COMMAND to wire up (~40 lines). Lists branches for a library,
  optionally filtered by location. Uses existing fetchBranches() + geocode() +
  findNearestBranches() from branches.ts.

## Library account features
- Framing: "With your library card, Claude can also manage your account"
- Prerequisites: shelflife setup + LIBRARY_CARD_NUMBER and LIBRARY_PIN env vars
- Document 5 MCP tools:
  - check_due_dates — active checkouts sorted by urgency
  - list_holds — holds with queue position and pickup location
  - cancel_hold — cancel a hold by ID
  - create_stagger_queue — queue books to arrive one at a time
  - check_stagger_status — check queue, detect new checkouts, suggest next hold
- OMIT place_hold until branch code bug is fixed (hardcoded Chicago fallback)
- Note: stagger queue requires manual checking, not a background process
- Note: these use unofficial BiblioCommons APIs

## How it works
- Keep the 4-step explanation (universally praised)

## Requirements
- Node.js 18+
- A public Goodreads profile
- A library that uses BiblioCommons
- (Optional) Library card number + PIN for account features
```

## Key Design Decisions

### "For Claude users" not "easy way"
Both paths require clone + build + Node. MCP trades the setup wizard for manual JSON
config editing. Neither is easier — they're different. Labeling MCP "easy" would mislead
non-developers (the normies review showed this clearly).

### Document `setup` prominently
The setup wizard already exists, is interactive, does geo-based branch lookup, and saves
config so `check` works with no flags. It's the best onramp and it's completely absent
from the current README.

### Wire up `branches` command
fetchBranches(), geocode(), and findNearestBranches() all exist in branches.ts. The
`libraries` command in cli.ts is a direct template. ~40 lines to expose existing
functionality. Completes the discovery story flagged by the normies review.

### Fix and document `place_hold`
~~place_hold had a bug: pickup_branch accepted a name string but the API needs a numeric
branch code, and the fallback was hardcoded to Chicago Uptown (code "79").~~
**Fixed:** placeHold() now resolves branch names to codes via fetchBranches(), falls back
to configured branch from .shelfliferc.json, and errors explicitly if unresolvable.
Documented in README alongside the other authenticated MCP tools.

### Sample output must be real
Capture actual terminal output, not fabricated. Trim to ~5 books for readability.

## Implementation Notes

- Capture sample output by running `shelflife check` against a real library
- The `branches` command needs to be wired up before the README references it
- MCP config snippet should note tsx is a dev dependency (installed via npm install)
- The shelves command only shows 3 hardcoded shelves, not custom ones — document this
- MCP server reads ~/.shelfliferc.json at startup — needs restart after config changes

## Out of Scope

- Publishing to npm (separate decision)
- ~~Fixing place_hold branch code bug~~ (completed during implementation)
- Adding a web UI for non-technical users
- npm audit / vulnerability fixes (separate task)
