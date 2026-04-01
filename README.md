# shelflife

Check if books on your Goodreads shelf are available at your local library.

Works with 116 public libraries across the US, Canada, and New Zealand that use [BiblioCommons](https://www.bibliocommons.com/) for their catalog — including Chicago, San Francisco, Boston, Seattle, Toronto, Austin, and many more. Run `shelflife libraries` to see the full list.

## Two ways to use it

### With an AI assistant (MCP)

ShelfLife works as an [MCP server](https://modelcontextprotocol.io/) — any MCP-compatible client (Claude, Codex, Cursor, etc.) can check your library for you directly in conversation.

Add to your MCP client config (e.g. Claude Desktop, Claude Code, Cursor, or any MCP host):

```json
{
  "mcpServers": {
    "shelflife": {
      "command": "node",
      "args": ["/Users/you/library_goodreads_claude/dist/mcp.js"]
    }
  }
}
```

Replace the path with the full absolute path to `dist/mcp.js` in your clone. `~` doesn't work in most MCP configs — use the expanded path (e.g. `/Users/yourname/...`).

You must run `shelflife setup` first — the MCP server reads the same config file.

Then just ask:

> "What books on my to-read list are at the Chicago Public Library?"

Your assistant can also check single books, list your shelves, and — with your library card — manage holds and check due dates. See [library account features](#library-account-features) below.

**Note:** The MCP server reads your config at startup. If you re-run `shelflife setup`, restart your MCP client for changes to take effect.

### Standalone CLI

Run it yourself from the terminal. See [getting started](#getting-started) and [commands](#commands) below.

## What it looks like

```
shelflife

  Chicago Public Library, Uptown

  On the shelf at Uptown

    Abundance — Ezra Klein
    HC106.84.K65 2025  ·  chipublib/2624109126_abundance
    Blockchain Chicken Farm — Xiaowei Wang
    T55.77.C6W36 2020  ·  chipublib/2266911126_blockchain_chicken_farm

  Available — request to Uptown

    The Count of Monte Cristo — Alexandre Dumas
    FIC DUMAS  ·  chipublib/1898939126_the_count_of_monte_cristo
    Everyone Who Is Gone Is Here — Jonathan Blitzer
    JV6483.B58 2024  ·  chipublib/2561424126_everyone_who_is_gone_is_here
    Purple Hibiscus — Chimamanda Ngozi Adichie
    FIC ADICHIE  ·  chipublib/1511733126_purple_hibiscus
    ...

  Not in catalog

    Higher Love: Skiing the Seven Summits — Kit DesLauriers

  ─────────────────────────────────

  26 books  ·  2 ready  ·  23 requestable  ·  1 not found
```

## Getting started

Clone, build, and link:

```bash
git clone https://github.com/sophiealula/shelflife-goodreads.git
cd shelflife-goodreads
npm install
npm run build
npm link
```

Then run the interactive setup:

```bash
shelflife setup
```

> **Note:** `npm link` makes the `shelflife` command available globally. If you skip it, use `npx shelflife` instead.

This walks you through connecting your Goodreads account and finding your library:

1. **Goodreads** — paste your profile URL or user ID (must be [public](https://www.goodreads.com/user/edit))
2. **Library** — enter your zip code to find the nearest supported library and branch

Config is saved to `~/.shelfliferc.json` so you don't need to pass flags every time.

After setup:

```bash
shelflife check
```

That's it — checks your to-read shelf at your configured library.

## Commands

### `setup` — Interactive configuration

```bash
shelflife setup
```

### `check` — Check book availability

```bash
shelflife check
```

Uses your saved config. Override any value with flags:

```bash
shelflife check --user <id> --library <subdomain> --branch "<name>" --shelf <shelf>
```

- `-u, --user` — Goodreads user ID
- `-l, --library` — BiblioCommons library subdomain
- `-b, --branch` — Specific branch (optional — omit to check all branches)
- `-s, --shelf` — Goodreads shelf (default: `to-read`)

### `shelves` — List your Goodreads shelves

```bash
shelflife shelves
```

Shows book counts for your `to-read`, `currently-reading`, and `read` shelves. Custom shelves can be checked with `shelflife check --shelf <name>`.

### `libraries` — Search supported libraries

```bash
shelflife libraries            # list all supported libraries
shelflife libraries chicago    # search by city
```

### `branches` — List branches for a library

```bash
shelflife branches                        # uses configured library
shelflife branches chipublib              # specify a library
shelflife branches chipublib --near 60640 # find nearest by zip/address
```

## MCP tools

The MCP server provides 9 tools. The first 3 work with just `shelflife setup`:

| Tool | Description |
|------|-------------|
| `check_shelf` | Check all books from a Goodreads shelf against a library — grouped by availability |
| `check_book` | Check a single book by title, author, or ISBN |
| `list_shelves` | List book counts for your Goodreads shelves |

### Library account features

With your library card number and PIN, your assistant can also manage your library account:

Add them to your MCP client config:

```json
{
  "mcpServers": {
    "shelflife": {
      "command": "node",
      "args": ["/Users/you/library_goodreads_claude/dist/mcp.js"],
      "env": {
        "LIBRARY_CARD_NUMBER": "your-card-number",
        "LIBRARY_PIN": "your-pin"
      }
    }
  }
}
```

Or set them in your shell for CLI use:

```bash
export LIBRARY_CARD_NUMBER="your-card-number"
export LIBRARY_PIN="your-pin"
```

You must also have run `shelflife setup` first.

| Tool | Description |
|------|-------------|
| `check_due_dates` | See active checkouts sorted by urgency — overdue, due soon, and others |
| `list_holds` | View your holds with queue position, pickup location, and IDs for cancellation |
| `place_hold` | Place a hold on a book by bib ID — picks up at your configured branch |
| `cancel_hold` | Cancel a hold by hold ID and bib ID (from `list_holds`) |
| `create_stagger_queue` | Queue multiple books to arrive one at a time — places the first hold immediately |
| `check_stagger_status` | Check your queue and detect new checkouts — suggests placing the next hold |

The stagger queue is not a background process — your assistant checks it when you ask and suggests the next action.

**Note:** These features use unofficial BiblioCommons APIs and may vary by library system.

## How it works

1. Fetches your Goodreads shelf via their public RSS feed
2. Searches your library's BiblioCommons catalog for each book
3. Groups results by availability: at your branch, in the system, or not found
4. Provides catalog links so you can place holds or request transfers

## Requirements

- Node.js 18+
- A public Goodreads profile
- A library that uses BiblioCommons (run `shelflife libraries` to check)
- (Optional) Library card number + PIN for account features
