import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { searchLibraries, LIBRARIES } from "./libraries.js";
import { fetchBranches, geocode, findNearestBranches } from "./branches.js";
import { fetchShelf } from "./goodreads.js";
import type { Branch } from "./branches.js";

const CONFIG_PATH = resolve(homedir(), ".shelfliferc.json");

// ANSI
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;

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
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
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

  // ── Step 2: Library ───────────────────────────────

  console.log(bold("  2. Library\n"));

  let selectedLibrary = "";
  let libraryName = "";

  while (!selectedLibrary) {
    const query = await rl.question(
      `  ${dim("What city is your library in?")}\n  > `
    );

    const results = searchLibraries(query.trim());

    if (results.length === 0) {
      console.log(dim("\n  No matching library found."));
      console.log(dim("  Your library needs to use BiblioCommons for its catalog."));
      console.log(dim("  If you know the subdomain, enter it directly:\n"));

      const direct = await rl.question("  > ");
      const d = direct.trim().toLowerCase();
      if (d && !d.includes(" ")) {
        selectedLibrary = d;
        libraryName = d;
      }
      continue;
    }

    if (results.length === 1) {
      selectedLibrary = results[0].subdomain;
      libraryName = results[0].name;
      console.log(`\n  ${green("→")} ${results[0].name}\n`);
    } else {
      console.log();
      for (let i = 0; i < results.length; i++) {
        console.log(
          `  ${dim(`${i + 1}.`)} ${results[i].name} ${dim(`— ${results[i].location}`)}`
        );
      }
      console.log();

      const choice = await rl.question(dim("  Which one? ") + "\n  > ");
      const num = parseInt(choice.trim());
      if (num >= 1 && num <= results.length) {
        selectedLibrary = results[num - 1].subdomain;
        libraryName = results[num - 1].name;
        console.log(`\n  ${green("→")} ${results[num - 1].name}\n`);
      }
    }
  }

  // ── Step 3: Branch ────────────────────────────────

  console.log(bold("  3. Branch\n"));
  process.stdout.write(dim("  Loading branches... "));

  const branches = await fetchBranches(selectedLibrary);
  let selectedBranch: string | undefined;

  if (branches.length === 0) {
    console.log(dim("couldn't load branches. Skipping.\n"));
  } else {
    console.log(dim(`found ${branches.length}\n`));

    console.log(
      dim("  Enter your zip code, address, or branch name")
    );
    console.log(
      dim("  to find the nearest branch. Or press Enter to skip.\n")
    );

    const input = await rl.question("  > ");
    const trimmed = input.trim();

    if (trimmed) {
      selectedBranch = await resolveBranch(trimmed, branches, rl);
    }

    if (!selectedBranch) {
      console.log(dim("  No branch selected — will check all branches.\n"));
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
  console.log(`\n  Run ${cyan("shelflife")} to check availability.\n`);

  return config;
}

async function resolveBranch(
  input: string,
  branches: Branch[],
  rl: readline.Interface
): Promise<string | undefined> {
  // First try: exact or fuzzy name match
  const q = input.toLowerCase();
  const nameMatches = branches.filter((b) =>
    b.name.toLowerCase().includes(q)
  );

  if (nameMatches.length === 1) {
    const b = nameMatches[0];
    const addr = b.address ? dim(` — ${b.address}`) : "";
    console.log(`\n  ${green("→")} ${b.name}${addr}\n`);
    return b.name;
  }

  if (nameMatches.length > 1 && nameMatches.length <= 10) {
    return await pickBranch(nameMatches, rl);
  }

  // Second try: geocode the input and find nearest branches
  const hasGeo = branches.some((b) => b.lat != null);
  if (hasGeo) {
    process.stdout.write(dim("\n  Finding nearest branches... "));
    const coords = await geocode(input);

    if (coords) {
      const nearest = findNearestBranches(branches, coords.lat, coords.lng, 5);
      console.log(dim("done\n"));
      return await pickBranch(
        nearest.map((b) => ({
          ...b,
          _distance: b.distance,
        })),
        rl
      );
    } else {
      console.log(dim("couldn't locate that address.\n"));
    }
  }

  // Third try: show all matches if there were some
  if (nameMatches.length > 10) {
    console.log(dim(`\n  ${nameMatches.length} branches match. Try being more specific.\n`));
  }

  return undefined;
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
