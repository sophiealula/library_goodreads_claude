# shelflife

Check if books on your Goodreads shelf are available at your local library.

Connects your Goodreads "to-read" list (or any shelf) to any library that uses [BiblioCommons](https://www.bibliocommons.com/) — which includes most major US and Canadian public library systems.

## Quick start

```bash
npm install
npm run build

# Check your shelf
npx shelflife check --user <GOODREADS_USER_ID> --library <LIBRARY> --branch "<BRANCH>"
```

### Example

```bash
npx shelflife check --user 184356502 --library chipublib --branch "Uptown"
```

### Find your Goodreads user ID

Your user ID is the number in your Goodreads profile URL:
`goodreads.com/user/show/184356502-sophie` → `184356502`

Your Goodreads profile must be **public** for the RSS feed to work.

### Find your library subdomain

Your library subdomain is the part before `.bibliocommons.com` in your library's catalog URL. Some common ones:

| Library | Subdomain |
|---------|-----------|
| Chicago Public Library | `chipublib` |
| New York Public Library | `nypl` |
| San Francisco Public Library | `sfpl` |
| Seattle Public Library | `seattle` |
| Boston Public Library | `bpl` |
| Los Angeles Public Library | `lapl` |
| Denver Public Library | `denverlibrary` |
| Toronto Public Library | `torontopubliclibrary` |
| Vancouver Public Library | `vpl` |

## CLI commands

### `check` — Check book availability

```bash
shelflife check --user <id> --library <subdomain> [--branch "<name>"] [--shelf <shelf>]
```

- `-u, --user` — Goodreads user ID (required)
- `-l, --library` — BiblioCommons library subdomain (required)
- `-b, --branch` — Specific branch to check availability at
- `-s, --shelf` — Goodreads shelf to check (default: `to-read`)

### `shelves` — List your Goodreads shelves

```bash
shelflife shelves --user <id>
```

## MCP server (for Claude)

shelflife includes an MCP server so Claude can check your library for you.

Add to your Claude config (`~/.claude/claude_desktop_config.json` or Claude Code settings):

```json
{
  "mcpServers": {
    "shelflife": {
      "command": "npx",
      "args": ["tsx", "/path/to/shelflife/src/mcp.ts"]
    }
  }
}
```

### MCP tools

- **`check_shelf`** — Check all books from a Goodreads shelf against a library
- **`check_book`** — Check a single book by title, author, or ISBN
- **`list_shelves`** — List available Goodreads shelves for a user

## How it works

1. Fetches your Goodreads shelf via their public RSS feed
2. Searches your library's BiblioCommons catalog for each book
3. Groups results by availability: at your branch, in the system, or not found
4. Provides catalog links so you can place holds or request transfers

## Requirements

- Node.js 18+
- A public Goodreads profile
- A library that uses BiblioCommons for their catalog
