#!/usr/bin/env node

import { program } from "commander";
import { fetchShelf } from "./goodreads.js";
import { checkAvailability } from "./library.js";
import { loadConfig } from "./setup.js";
import { searchLibraries } from "./libraries.js";
import { findLibrary } from "./libraries.js";
import type { AvailabilityResult, GoodreadsBook } from "./types.js";

// ANSI helpers — respect NO_COLOR and non-TTY
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const wrap = (code: string) => useColor ? (s: string) => `\x1b[${code}m${s}\x1b[0m` : (s: string) => s;
const bold = wrap("1");
const dim = wrap("2");
const green = wrap("32");
const yellow = wrap("33");
const red = wrap("31");
const cyan = wrap("36");
const clearLine = () => { if (useColor) process.stdout.write("\x1b[2K\r"); };

program
  .name("shelflife")
  .description("Check if your Goodreads books are at your local library")
  .version("0.2.0");

// Default command: check (run when no subcommand given)
program
  .command("check")
  .description("Check availability of your Goodreads shelf at a library")
  .option("-u, --user <id>", "Goodreads user ID")
  .option(
    "-l, --library <subdomain>",
    "BiblioCommons library subdomain (e.g., chipublib, sfpl, nypl)"
  )
  .option("-b, --branch <name>", "Specific branch to check")
  .option("-s, --shelf <name>", "Goodreads shelf to check", "to-read")
  .action(async (opts) => {
    // Merge with saved config
    const config = loadConfig();
    const userId = opts.user || config?.goodreadsUserId;
    const library = opts.library || config?.library;
    // Don't use saved branch if library was explicitly overridden to a different one
    const branch = opts.branch ?? (opts.library && opts.library !== config?.library ? undefined : config?.branch);
    const shelf = opts.shelf || config?.shelf || "to-read";

    if (!userId || !library) {
      console.log(
        `\n${bold("shelflife")}\n`
      );
      if (!config) {
        console.log(
          `  No config found. Run ${cyan("shelflife setup")} to get started,`
        );
        console.log(
          `  or pass ${dim("--user")} and ${dim("--library")} flags.\n`
        );
      } else {
        console.log(
          `  Missing ${!userId ? dim("--user") : dim("--library")}. Check your .shelfliferc.json.\n`
        );
      }
      process.exit(1);
    }

    const lib = findLibrary(library);
    const libraryLabel = lib ? lib.name : library;
    const branchLabel = branch ? `, ${branch}` : "";

    console.log(
      `\n${bold("shelflife")}\n`
    );
    console.log(
      dim(`  ${libraryLabel}${branchLabel}\n`)
    );

    try {
      // Fetch shelf
      process.stdout.write(dim("  Fetching shelf... "));
      const books = await fetchShelf(userId, shelf);
      clearLine();

      if (books.length === 0) {
        console.log(dim("  No books found on this shelf.\n"));
        return;
      }

      // Check availability with progress
      const results = await checkWithProgress(books, library, branch);

      // Sort results
      const atBranch = results.filter((r) => r.status === "at-branch");
      const inSystem = results.filter((r) => r.status === "in-system");
      const notFound = results.filter((r) => r.status === "not-found");
      const errors = results.filter((r) => r.status === "error");

      // At branch
      if (atBranch.length > 0) {
        console.log(
          green(`  On the shelf${branch ? ` at ${branch}` : ""}\n`)
        );
        for (const r of atBranch) {
          printBook(r);
        }
        console.log();
      }

      // In system
      if (inSystem.length > 0) {
        const label = branch
          ? `Available — request to ${branch}`
          : "In the system";
        console.log(yellow(`  ${label}\n`));
        for (const r of inSystem) {
          printBook(r);
        }
        console.log();
      }

      // Not found
      if (notFound.length > 0) {
        console.log(dim(`  Not in catalog\n`));
        for (const r of notFound) {
          console.log(dim(`    ${r.book.title} — ${r.book.author}`));
        }
        console.log();
      }

      // Errors
      if (errors.length > 0) {
        console.log(red(`  Could not check\n`));
        for (const r of errors) {
          console.log(dim(`    ${r.book.title} — ${r.book.author}`));
        }
        console.log();
      }

      // Summary line
      console.log(dim("  ─────────────────────────────────\n"));
      const parts = [];
      if (atBranch.length)
        parts.push(green(`${atBranch.length} ready`));
      if (inSystem.length)
        parts.push(yellow(`${inSystem.length} requestable`));
      if (notFound.length)
        parts.push(dim(`${notFound.length} not found`));
      if (errors.length)
        parts.push(red(`${errors.length} failed`));

      console.log(`  ${books.length} books  ${dim("·")}  ${parts.join(`  ${dim("·")}  `)}\n`);
    } catch (err) {
      console.error(
        red(`\n  Error: ${err instanceof Error ? err.message : err}\n`)
      );
      process.exit(1);
    }
  });

program
  .command("setup")
  .description("Set up your Goodreads and library connection")
  .action(async () => {
    const { runSetup } = await import("./setup.js");
    await runSetup();
  });

program
  .command("libraries")
  .description("Search for supported libraries")
  .argument("[query]", "Search by city, name, or subdomain")
  .action(async (query) => {
    console.log(`\n${bold("shelflife")} ${dim("— libraries")}\n`);

    if (!query) {
      const { LIBRARIES } = await import("./libraries.js");
      for (const lib of LIBRARIES) {
        console.log(
          `  ${lib.subdomain.padEnd(22)} ${dim(lib.name)} ${dim("—")} ${dim(lib.location)}`
        );
      }
      console.log(
        dim(`\n  ${LIBRARIES.length} BiblioCommons libraries. Search with: shelflife libraries <city>\n`)
      );
      return;
    }

    const results = searchLibraries(query);
    if (results.length === 0) {
      console.log(dim("  No matches. Your library may not use BiblioCommons.\n"));
      return;
    }

    for (const lib of results) {
      console.log(
        `  ${lib.subdomain.padEnd(22)} ${lib.name} ${dim("—")} ${dim(lib.location)}`
      );
    }
    console.log();
  });

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
        if (nearest.length === 0) {
          console.log(dim("  No branch coordinates available. Showing all branches:\n"));
          for (const b of branches) {
            const addr = b.address ? dim(` — ${b.address}`) : "";
            console.log(`  ${b.name}${addr}`);
          }
        } else {
          for (const b of nearest) {
            const addr = b.address ? dim(` — ${b.address}`) : "";
            console.log(`  ${b.name}${addr}  ${dim(`${b.distance.toFixed(1)} mi`)}`);
          }
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

program
  .command("shelves")
  .description("List available shelves for a Goodreads user")
  .option("-u, --user <id>", "Goodreads user ID")
  .action(async (opts) => {
    const config = loadConfig();
    const userId = opts.user || config?.goodreadsUserId;

    if (!userId) {
      console.log(`\n  Missing user ID. Pass ${dim("--user")} or run ${cyan("shelflife setup")}.\n`);
      process.exit(1);
    }

    console.log(`\n${bold("shelflife")} ${dim("— shelves")}\n`);
    try {
      const defaultShelves = ["to-read", "currently-reading", "read"];
      for (const shelf of defaultShelves) {
        const books = await fetchShelf(userId, shelf);
        console.log(`  ${shelf.padEnd(20)} ${books.length} books`);
      }
      console.log(
        dim("\n  Custom shelves can be checked with --shelf <name>\n")
      );
    } catch (err) {
      console.error(
        red(`\n  Error: ${err instanceof Error ? err.message : err}\n`)
      );
      process.exit(1);
    }
  });

async function checkWithProgress(
  books: GoodreadsBook[],
  library: string,
  branch?: string
): Promise<AvailabilityResult[]> {
  const total = books.length;
  process.stdout.write(`  ${dim(`Checking ${total} books...`)}`);

  const { checkAvailability } = await import("./library.js");
  const results = await checkAvailability(books, library, branch);

  // Clear progress line
  clearLine();
  console.log();

  return results;
}

function printBook(r: AvailabilityResult) {
  console.log(
    `    ${r.book.title} ${dim("—")} ${dim(r.book.author)}`
  );
  const details: string[] = [];
  if (r.callNumber) details.push(r.callNumber);
  if (r.catalogUrl) {
    // Shorten the URL for display
    const short = r.catalogUrl
      .replace("https://", "")
      .replace(".bibliocommons.com/item/show/", "/")
      .replace(".bibliocommons.com/v2/record/", "/");
    details.push(short);
  }
  if (details.length > 0) {
    console.log(`    ${dim(details.join("  ·  "))}`);
  }
}

program.on("command:*", (operands) => {
  console.log(`\n  Unknown command: ${operands[0]}\n`);
  console.log(dim("  Available commands: setup, check, shelves, libraries, branches\n"));
  process.exit(1);
});

// No subcommand → run check
if (process.argv.length <= 2) {
  process.argv.push("check");
}

program.parseAsync().catch((err) => {
  console.error(`\n  Error: ${err instanceof Error ? err.message : err}\n`);
  process.exit(1);
});
