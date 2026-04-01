import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { searchLibraries } from "./libraries.js";
import { fetchBranches, geocode, findNearestBranches } from "./branches.js";
import { fetchShelf } from "./goodreads.js";
import type { Branch } from "./branches.js";

const CONFIG_PATH = resolve(homedir(), ".shelfliferc.json");

// ANSI — respect NO_COLOR and non-TTY
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const wrap = (code: string) => useColor ? (s: string) => `\x1b[${code}m${s}\x1b[0m` : (s: string) => s;
const bold = wrap("1");
const dim = wrap("2");
const cyan = wrap("36");
const green = wrap("32");
const yellow = wrap("33");

export interface Config {
  goodreadsUserId: string;
  library: string;
  branch?: string;
  shelf: string;
}

export function loadConfig(): Config | null {
  if (!existsSync(CONFIG_PATH)) return null;
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
  } catch {
    return null;
  }
}

export function saveConfig(config: Config): void {
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
}

export async function runSetup(): Promise<Config> {
  const rl = readline.createInterface({ input: stdin, output: stdout });

  console.log(`\n${bold("shelflife")} ${dim("— setup")}\n`);
  console.log(dim("  Connect your reading list to your library.\n"));

  // ── Step 1: Goodreads ─────────────────────────────

  console.log(bold("  1. Goodreads\n"));
  let userId: string | null = null;
  let bookCount = 0;

  while (!userId) {
    const input = await rl.question(
      `  ${dim("Profile URL or user ID")} ${dim("(goodreads.com/user/show/…)")}\n  > `
    );

    userId = extractUserId(input.trim());
    if (!userId) {
      console.log(
        yellow("\n  Couldn't find a user ID in that.")
      );
      console.log(
        dim("  Go to your Goodreads profile and copy the URL.")
      );
      console.log(
        dim("  It looks like: goodreads.com/user/show/12345678\n")
      );
      continue;
    }

    process.stdout.write(dim("  Checking... "));
    try {
      const books = await fetchShelf(userId, "to-read");
      bookCount = books.length;
      if (bookCount === 0) {
        console.log(yellow("found your profile, but to-read shelf is empty."));
        console.log(dim("  Add some books to your to-read shelf on Goodreads, then try again.\n"));
      } else {
        console.log(green(`${bookCount} books on your to-read shelf\n`));
      }
    } catch {
      console.log(yellow("couldn't access that profile."));
      console.log();
      console.log(dim("  Your Goodreads profile needs to be public."));
      console.log(dim("  Go to goodreads.com/user/edit → Settings → Privacy"));
      console.log(dim("  Set \"Who can view my profile\" to \"anyone\"\n"));
      userId = null;
    }
  }

  // ── Step 2: Library & Branch (zip-first) ──────────

  console.log(bold("  2. Your library\n"));

  let selectedLibrary = "";
  let libraryName = "";
  let selectedBranch: string | undefined;

  while (!selectedLibrary) {
    const input = await rl.question(
      `  ${dim("What's your zip code?")}\n  > `
    );
    const trimmed = input.trim();
    if (!trimmed) continue;

    process.stdout.write(dim("\n  Finding your library... "));

    const coords = await geocode(trimmed);
    if (!coords) {
      console.log(yellow("couldn't locate that."));
      console.log(dim("  Try a 5-digit US zip code or Canadian postal code.\n"));
      continue;
    }

    // Search libraries by city name from geocode
    let results: ReturnType<typeof searchLibraries> = [];
    if (coords.city) {
      results = searchLibraries(coords.city);
    }
    // If no city match, try state
    if (results.length === 0 && coords.state) {
      results = searchLibraries(coords.state);
    }

    if (results.length === 0) {
      console.log(yellow("no supported library found near that zip."));
      console.log(dim("  Your library needs to use BiblioCommons for its catalog."));
      console.log(dim("  Run 'shelflife libraries' to see all supported libraries.\n"));

      console.log(dim("  Know your library's subdomain? Enter it directly, or try another zip:\n"));
      const direct = await rl.question("  > ");
      const d = direct.trim().toLowerCase();
      if (d && !d.includes(" ") && !/^\d/.test(d)) {
        selectedLibrary = d;
        libraryName = d;
      }
      continue;
    }

    // Pick library system (auto if only one)
    let lib = results[0];
    if (results.length > 1) {
      console.log(dim(`${results.length} libraries found\n`));
      for (let i = 0; i < results.length; i++) {
        console.log(
          `  ${dim(`${i + 1}.`)} ${results[i].name} ${dim(`— ${results[i].location}`)}`
        );
      }
      console.log();
      const choice = await rl.question(dim("  Which one? ") + "\n  > ");
      const num = parseInt(choice.trim());
      if (num >= 1 && num <= results.length) {
        lib = results[num - 1];
      }
    }

    selectedLibrary = lib.subdomain;
    libraryName = lib.name;
    console.log(`\n  ${green("→")} ${libraryName}\n`);

    // Verify library is reachable
    process.stdout.write(dim("  Checking connection... "));
    const libraryOk = await verifyLibrary(selectedLibrary);
    if (!libraryOk) {
      console.log(yellow("couldn't reach this library's catalog."));
      console.log(dim("  This library may have migrated away from BiblioCommons."));
      console.log(dim("  ShelfLife may not work correctly with this library.\n"));
    } else {
      console.log(green("connected\n"));
    }

    // Find nearest branches using the coordinates we already have
    process.stdout.write(dim("  Loading branches... "));
    const branches = await fetchBranches(selectedLibrary);

    if (branches.length === 0) {
      console.log(dim("couldn't load branches.\n"));
    } else {
      const nearest = findNearestBranches(branches, coords.lat, coords.lng, 5);
      if (nearest.length > 0) {
        console.log(dim("done\n"));
        selectedBranch = await pickBranch(
          nearest.map((b) => ({ ...b, _distance: b.distance })),
          rl
        );
      } else {
        console.log(dim(`found ${branches.length}\n`));
        selectedBranch = await pickBranch(
          branches.slice(0, 10).map((b) => ({ ...b, _distance: undefined })),
          rl
        );
      }

      if (!selectedBranch) {
        console.log(dim("  No branch selected — will check all branches.\n"));
      }
    }
  }

  rl.close();

  const config: Config = {
    goodreadsUserId: userId,
    library: selectedLibrary,
    branch: selectedBranch,
    shelf: "to-read",
  };

  saveConfig(config);

  // ── Done ──────────────────────────────────────────

  console.log(dim("  ─────────────────────────────────\n"));
  console.log(green("  Saved!\n"));
  console.log(`  ${dim("Goodreads")}   ${userId} ${dim(`(${bookCount} books)`)}`);
  console.log(`  ${dim("Library")}     ${libraryName}`);
  if (selectedBranch) {
    console.log(`  ${dim("Branch")}      ${selectedBranch}`);
  }
  console.log(`\n  Run ${cyan("shelflife check")} to check availability.\n`);

  return config;
}

async function pickBranch(
  branches: Array<Branch & { _distance?: number }>,
  rl: readline.Interface
): Promise<string | undefined> {
  console.log();
  for (let i = 0; i < branches.length; i++) {
    const b = branches[i];
    const parts = [b.name];
    if (b.address) parts.push(dim(b.address));
    if (b._distance != null) {
      parts.push(dim(`${b._distance.toFixed(1)} mi`));
    }
    console.log(`  ${dim(`${i + 1}.`)} ${parts.join(dim("  ·  "))}`);
  }
  console.log();

  const choice = await rl.question(dim("  Pick one: ") + "\n  > ");
  const num = parseInt(choice.trim());

  if (num >= 1 && num <= branches.length) {
    const picked = branches[num - 1];
    console.log(`\n  ${green("→")} ${picked.name}\n`);
    return picked.name;
  }

  return undefined;
}

async function verifyLibrary(subdomain: string): Promise<boolean> {
  try {
    const res = await fetch(
      `https://${subdomain}.bibliocommons.com/v2/search?query=test&searchType=keyword`,
      {
        headers: { "User-Agent": "shelflife/0.2.0 (setup check)" },
        signal: AbortSignal.timeout(8000),
      }
    );
    return res.ok;
  } catch {
    return false;
  }
}

function extractUserId(input: string): string | null {
  if (/^\d+$/.test(input)) return input;

  // URL patterns: /user/show/12345, /user/show/12345-name
  const match = input.match(/\/user\/show\/(\d+)/);
  if (match) return match[1];

  // Any long number in the string
  const numMatch = input.match(/(\d{6,})/);
  if (numMatch) return numMatch[1];

  return null;
}
