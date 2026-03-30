# README Restructure Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Restructure the ShelfLife README to serve both Claude users and CLI users, document missing features, add sample output, and wire up a `branches` CLI command.

**Architecture:** Two changes: (1) rewrite README.md with new structure from design doc, (2) add ~40-line `branches` command to cli.ts using existing `fetchBranches()` infrastructure. No new dependencies.

**Tech Stack:** TypeScript, Commander.js, BiblioCommons API (existing)

---

### Task 1: Wire up `branches` CLI command

This must happen first so the README can document it accurately.

**Files:**
- Modify: `src/cli.ts` (add new command after the `libraries` command, around line 184)

**Step 1: Add the `branches` command to cli.ts**

Add this after the `libraries` command block (after line 184, before the `shelves` command):

```typescript
program
  .command("branches")
  .description("List branches for a library")
  .argument("[library]", "BiblioCommons library subdomain")
  .option("-n, --near <location>", "Find branches near a zip code or address")
  .action(async (library, opts) => {
    const config = loadConfig();
    const lib = library || config?.library;

    if (!lib) {
      console.log(`\n  Missing library. Pass a subdomain or run ${cyan("shelflife setup")}.\n`);
      process.exit(1);
    }

    const libInfo = findLibrary(lib);
    const label = libInfo ? libInfo.name : lib;
    console.log(`\n${bold("shelflife")} ${dim("— branches")}\n`);
    process.stdout.write(dim("  Loading branches... "));

    const { fetchBranches, geocode, findNearestBranches } = await import("./branches.js");
    const branches = await fetchBranches(lib);

    if (branches.length === 0) {
      console.log(dim("none found.\n"));
      return;
    }

    console.log(dim(`${branches.length} at ${label}\n`));

    if (opts.near) {
      const coords = await geocode(opts.near);
      if (coords) {
        const nearest = findNearestBranches(branches, coords.lat, coords.lng, 10);
        for (const b of nearest) {
          const addr = b.address ? dim(` — ${b.address}`) : "";
          console.log(`  ${b.name}${addr}  ${dim(`${b.distance.toFixed(1)} mi`)}`);
        }
      } else {
        console.log(dim(`  Couldn't locate "${opts.near}". Showing all branches:\n`));
        for (const b of branches) {
          const addr = b.address ? dim(` — ${b.address}`) : "";
          console.log(`  ${b.name}${addr}`);
        }
      }
    } else {
      for (const b of branches) {
        const addr = b.address ? dim(` — ${b.address}`) : "";
        console.log(`  ${b.name}${addr}`);
      }
    }
    console.log();
  });
```

You'll also need to add the import for `fetchBranches`, `geocode`, and `findNearestBranches` — but since the command uses dynamic `import()`, no new top-level imports are needed. The `findLibrary` import already exists at line 8.

**Step 2: Build and verify**

Run: `npm run build`
Expected: Clean compile, exit 0

**Step 3: Test the command manually**

Run: `node dist/cli.js branches chipublib`
Expected: A list of Chicago Public Library branches with addresses

Run: `node dist/cli.js branches chipublib --near "60640"`
Expected: Branches sorted by distance from that zip code, with distances in miles

**Step 4: Commit**

```bash
git add src/cli.ts
git commit -m "add branches command to CLI"
```

---

### Task 2: Capture real sample output

**Step 1: Run the tool and capture output**

Run: `node dist/cli.js check --user 184356502 --library chipublib --branch "Uptown" 2>&1 | head -30`

Copy the actual output. If the output is very long, trim to show ~5 books covering all 3 groupings (at branch, requestable, not found) plus the summary line. Strip ANSI codes for the README version.

Save the captured output — you'll paste it into the README in Task 3.

**Step 2: Also capture branches output**

Run: `node dist/cli.js branches chipublib --near "60640" 2>&1 | head -15`

Save this too for the commands section.

---

### Task 3: Rewrite README.md

**Files:**
- Modify: `README.md` (full rewrite)

**Step 1: Write the new README**

Replace the entire contents of README.md with the following structure. Use the real sample output from Task 2 where indicated.

```markdown
# shelflife

Check if books on your Goodreads shelf are available at your local library.

Connects your Goodreads "to-read" list (or any shelf) to any library that uses [BiblioCommons](https://www.bibliocommons.com/) — which includes most major US and Canadian public library systems.

## Two ways to use it

### For Claude users

ShelfLife works as an [MCP server](https://modelcontextprotocol.io/) — Claude can check your library for you directly in conversation.

Add to your Claude config (`~/.claude/settings.json` or Claude Desktop config):

```json
{
  "mcpServers": {
    "shelflife": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/shelflife/src/mcp.ts"]
    }
  }
}
```

Replace `/absolute/path/to/shelflife` with the actual path where you cloned this repo. Requires [getting started](#getting-started) first.

Then just ask Claude:

> "What books on my to-read list are at the Chicago Public Library?"

Claude can also check single books, list your shelves, and — with your library card — manage holds and check due dates. See [library account features](#library-account-features) below.

**Note:** The MCP server reads your config at startup. If you re-run `shelflife setup`, restart Claude for changes to take effect.

### Standalone CLI

Run it yourself from the terminal. See [getting started](#getting-started) and [commands](#commands) below.

## What it looks like

```
[PASTE REAL OUTPUT FROM TASK 2 HERE — with ANSI codes stripped]
```

## Getting started

ShelfLife is not published to npm — clone and build it locally:

```bash
git clone https://github.com/sophiealula/library_goodreads_claude.git
cd library_goodreads_claude
npm install
npm run build
```

Then run the interactive setup:

```bash
shelflife setup
```

This walks you through connecting your Goodreads account and finding your library. It saves your config to `~/.shelfliferc.json` so you don't need to pass flags every time.

After setup:

```bash
shelflife check
```

That's it — checks your to-read shelf at your configured library.

### Override with flags

```bash
shelflife check --user <id> --library <subdomain> --branch "<name>" --shelf <shelf>
```

- `-u, --user` — Goodreads user ID
- `-l, --library` — BiblioCommons library subdomain
- `-b, --branch` — Specific branch (optional — omit to check all branches)
- `-s, --shelf` — Goodreads shelf (default: `to-read`)

## Commands

### `setup` — Interactive configuration

```bash
shelflife setup
```

Walks you through three steps:
1. **Goodreads** — paste your profile URL or user ID (must be [public](https://www.goodreads.com/user/edit))
2. **Library** — search by city name to find your BiblioCommons library
3. **Branch** — enter a zip code or address to find your nearest branch

### `check` — Check book availability

```bash
shelflife check
```

Uses your saved config. Override any value with flags. Groups results by availability: on the shelf at your branch, available elsewhere in the system, or not in the catalog.

### `shelves` — List your Goodreads shelves

```bash
shelflife shelves
```

Shows book counts for your `to-read`, `currently-reading`, and `read` shelves. Custom shelves can be checked with `shelflife check --shelf <name>`.

### `libraries` — Search supported libraries

```bash
shelflife libraries            # list all
shelflife libraries chicago    # search by city
```

### `branches` — List branches for a library

```bash
shelflife branches                        # uses configured library
shelflife branches chipublib              # specify a library
shelflife branches chipublib --near 60640 # find nearest by zip/address
```

## Library account features

With your library card number and PIN, Claude can also manage your library account through the MCP server.

**Setup:** Set these environment variables before starting Claude:

```bash
export LIBRARY_CARD_NUMBER="your-card-number"
export LIBRARY_PIN="your-pin"
```

You must also have run `shelflife setup` first.

**What Claude can do:**

| Tool | Description |
|------|-------------|
| `check_due_dates` | See active checkouts sorted by urgency — overdue, due soon, and others |
| `list_holds` | View your holds with queue position and pickup location |
| `cancel_hold` | Cancel a hold by ID |
| `create_stagger_queue` | Queue multiple books to arrive one at a time — places the first hold immediately |
| `check_stagger_status` | Check your queue and detect new checkouts — suggests placing the next hold |

The stagger queue is not a background process — Claude checks it when you ask and suggests the next action.

**Note:** These features use unofficial BiblioCommons APIs and may vary by library system.

## How it works

1. Fetches your Goodreads shelf via their public RSS feed
2. Searches your library's BiblioCommons catalog for each book
3. Groups results by availability: at your branch, in the system, or not found
4. Provides catalog links so you can place holds or request transfers

## Requirements

- Node.js 18+
- A public Goodreads profile
- A library that uses BiblioCommons for their catalog
- (Optional) Library card number + PIN for account features
```

**Step 2: Verify the README renders correctly**

Skim the markdown for broken links, unclosed code blocks, or formatting issues.

**Step 3: Commit**

```bash
git add README.md
git commit -m "restructure README — two paths, sample output, document all features"
```

---

### Task 4: Verify everything

**Step 1: Build**

Run: `npm run build`
Expected: Clean compile, exit 0

**Step 2: Test all documented commands**

Run each of these and confirm they work:

```bash
node dist/cli.js setup          # interactive — can ctrl-c after verifying it starts
node dist/cli.js check          # uses saved config
node dist/cli.js shelves        # lists shelf counts
node dist/cli.js libraries      # lists all libraries
node dist/cli.js libraries chicago  # searches
node dist/cli.js branches chipublib # lists branches
node dist/cli.js branches chipublib --near 60640  # nearest branches
```

**Step 3: Verify MCP server starts**

Run: `npx tsx src/mcp.ts`
Expected: Process starts and waits for stdio input (ctrl-c to exit)

**Step 4: Final commit if any fixes needed**

If any issues were found and fixed, commit the fixes.
