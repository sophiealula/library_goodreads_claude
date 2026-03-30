# Shelflife v2 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add authenticated library account features to shelflife: place holds, check due dates, and stagger holds over time.

**Architecture:** New `src/auth.ts` module handles BiblioCommons gateway API login/session management. New `src/account.ts` module provides authenticated operations (holds, checkouts). New `src/stagger.ts` manages hold queue persistence. All new MCP tools added to existing `src/mcp.ts`.

**Tech Stack:** TypeScript, Node.js, @modelcontextprotocol/sdk, BiblioCommons gateway API (JSON), local file persistence for stagger queue state.

---

## Task 1: Auth Module — Login and Session Management

**Files:**
- Create: `src/auth.ts`
- Modify: `src/types.ts`

**Step 1: Add auth types to `src/types.ts`**

Add to the end of the file:

```typescript
export interface AuthSession {
  accountId: string;
  cookies: string;
  library: string;
  expiresAt?: number;
}

export interface AuthConfig {
  library: string;
  cardNumber: string;
  pin: string;
}
```

**Step 2: Create `src/auth.ts`**

```typescript
import type { AuthSession, AuthConfig } from "./types.js";

const GATEWAY_BASE = "https://gateway.bibliocommons.com/v2/libraries";

let cachedSession: AuthSession | null = null;

export function getAuthConfig(): AuthConfig {
  const cardNumber = process.env.LIBRARY_CARD_NUMBER;
  const pin = process.env.LIBRARY_PIN;

  if (!cardNumber || !pin) {
    throw new Error(
      "Missing LIBRARY_CARD_NUMBER or LIBRARY_PIN environment variables. " +
      "Set them in your shell profile to use authenticated features."
    );
  }

  // Load library from .shelfliferc.json
  const { readFileSync } = await import("node:fs");
  const { resolve } = await import("node:path");
  const configPath = resolve(process.cwd(), ".shelfliferc.json");
  const config = JSON.parse(readFileSync(configPath, "utf-8"));

  return { library: config.library, cardNumber, pin };
}

export async function login(config: AuthConfig): Promise<AuthSession> {
  // Check cache first
  if (cachedSession && cachedSession.library === config.library) {
    // Verify session is still valid
    const valid = await verifySession(cachedSession);
    if (valid) return cachedSession;
  }

  const url = `${GATEWAY_BASE}/${config.library}/sessions`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "shelflife/0.2.0",
    },
    body: JSON.stringify({
      username: config.cardNumber,
      password: config.pin,
    }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as Record<string, unknown>;
    const error = body.error as Record<string, string> | undefined;
    throw new Error(
      `Login failed: ${error?.message || `HTTP ${res.status}`}`
    );
  }

  // Extract cookies from response
  const cookies = extractCookies(res.headers);

  // Get account ID from current session
  const sessionRes = await fetch(
    `${GATEWAY_BASE}/${config.library}/sessions/current`,
    {
      headers: {
        Cookie: cookies,
        "User-Agent": "shelflife/0.2.0",
      },
    }
  );

  if (!sessionRes.ok) {
    throw new Error("Failed to retrieve account ID after login");
  }

  const sessionData = await sessionRes.json() as Record<string, unknown>;
  const auth = sessionData.auth as Record<string, unknown> | undefined;
  const accountId = auth?.currentUserId as string | undefined;

  if (!accountId) {
    throw new Error("Login succeeded but could not extract account ID");
  }

  cachedSession = {
    accountId: String(accountId),
    cookies,
    library: config.library,
  };

  return cachedSession;
}

async function verifySession(session: AuthSession): Promise<boolean> {
  try {
    const res = await fetch(
      `${GATEWAY_BASE}/${session.library}/sessions/current`,
      {
        headers: {
          Cookie: session.cookies,
          "User-Agent": "shelflife/0.2.0",
        },
      }
    );
    if (!res.ok) return false;
    const data = await res.json() as Record<string, unknown>;
    const auth = data.auth as Record<string, unknown> | undefined;
    return !!auth?.currentUserId;
  } catch {
    return false;
  }
}

function extractCookies(headers: Headers): string {
  const setCookies = headers.getSetCookie?.() ?? [];
  return setCookies
    .map((c) => c.split(";")[0])
    .join("; ");
}

export async function getSession(): Promise<AuthSession> {
  const config = await getAuthConfig();
  return login(config);
}
```

**Step 3: Test login manually**

Run: `LIBRARY_CARD_NUMBER=<card> LIBRARY_PIN=<pin> npx tsx -e "import { getSession } from './src/auth.js'; const s = await getSession(); console.log('Account ID:', s.accountId);"`

Expected: Prints account ID if credentials are correct, or a clear error message if not.

**Step 4: Commit**

```bash
git add src/auth.ts src/types.ts
git commit -m "feat: add auth module for BiblioCommons gateway API login"
```

---

## Task 2: Account Module — Check Due Dates

**Files:**
- Create: `src/account.ts`

**Step 1: Create `src/account.ts` with checkout fetching**

```typescript
import { getSession } from "./auth.js";

const GATEWAY_BASE = "https://gateway.bibliocommons.com/v2/libraries";

export interface Checkout {
  id: string;
  title: string;
  author: string;
  dueDate: string;
  daysUntilDue: number;
  renewable: boolean;
  bibId: string;
}

export interface CheckoutsResult {
  checkouts: Checkout[];
  overdue: Checkout[];
  dueSoon: Checkout[];
}

export async function fetchCheckouts(): Promise<CheckoutsResult> {
  const session = await getSession();
  const url = `${GATEWAY_BASE}/${session.library}/checkouts?accountId=${session.accountId}`;

  const res = await fetch(url, {
    headers: {
      Cookie: session.cookies,
      "User-Agent": "shelflife/0.2.0",
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch checkouts: HTTP ${res.status}`);
  }

  const data = await res.json() as Record<string, unknown>;

  // Parse the response — structure: { checkouts: { results: [...] }, entities: { checkouts: { id: {...} }, bibs: { id: {...} } } }
  const entities = data.entities as Record<string, Record<string, Record<string, unknown>>> | undefined;
  const checkoutsMap = entities?.checkouts ?? {};
  const bibsMap = entities?.bibs ?? {};

  const now = new Date();
  const checkouts: Checkout[] = [];

  for (const [id, checkout] of Object.entries(checkoutsMap)) {
    const metadataId = checkout.metadataId as string ?? "";
    const bib = bibsMap[metadataId] ?? {};
    const briefInfo = bib.briefInfo as Record<string, unknown> | undefined;

    const dueDate = checkout.dueDate as string ?? "";
    const due = new Date(dueDate);
    const daysUntilDue = Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    checkouts.push({
      id,
      title: (briefInfo?.title as string) ?? "Unknown",
      author: ((briefInfo?.authors as string[]) ?? [])[0] ?? "Unknown",
      dueDate,
      daysUntilDue,
      renewable: (checkout.canRenew as boolean) ?? false,
      bibId: metadataId,
    });
  }

  checkouts.sort((a, b) => a.daysUntilDue - b.daysUntilDue);

  return {
    checkouts,
    overdue: checkouts.filter((c) => c.daysUntilDue < 0),
    dueSoon: checkouts.filter((c) => c.daysUntilDue >= 0 && c.daysUntilDue <= 5),
  };
}
```

**Step 2: Test checkout fetching manually**

Run: `LIBRARY_CARD_NUMBER=<card> LIBRARY_PIN=<pin> npx tsx -e "import { fetchCheckouts } from './src/account.js'; const r = await fetchCheckouts(); console.log(JSON.stringify(r, null, 2));"`

Expected: JSON output of checkouts with titles, due dates, days until due. If no books checked out, empty arrays.

**Important:** Inspect the actual response shape. The field names (`metadataId`, `dueDate`, `canRenew`, `briefInfo.title`, `briefInfo.authors`) are educated guesses based on BiblioCommons patterns. Adjust the parsing code to match the real response.

**Step 3: Commit**

```bash
git add src/account.ts
git commit -m "feat: add checkout fetching for due date monitoring"
```

---

## Task 3: Account Module — Place Holds

**Files:**
- Modify: `src/account.ts`

**Step 1: Add hold placement to `src/account.ts`**

```typescript
export interface HoldResult {
  success: boolean;
  queuePosition?: number;
  totalHolds?: number;
  userHoldCount?: number;
  message: string;
}

export async function placeHold(
  bibId: string,
  pickupBranch?: string
): Promise<HoldResult> {
  const session = await getSession();

  // First, get holdable items to find the right materialParams
  const holdableUrl = `${GATEWAY_BASE}/${session.library}/bibs/${bibId}/holdableItems`;
  const holdableRes = await fetch(holdableUrl, {
    headers: { "User-Agent": "shelflife/0.2.0" },
  });

  if (!holdableRes.ok) {
    return { success: false, message: `Could not fetch holdable items: HTTP ${holdableRes.status}` };
  }

  const holdableData = await holdableRes.json() as Record<string, unknown>;
  // Extract the first holdable physical item
  // Structure TBD — adjust after seeing real response

  const url = `${GATEWAY_BASE}/${session.library}/holds`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: session.cookies,
      "User-Agent": "shelflife/0.2.0",
    },
    body: JSON.stringify({
      accountId: session.accountId,
      metadataId: bibId,
      materialType: "PHYSICAL",
      // pickupLocation: pickupBranch or default from config
      // materialParams: TBD from holdableItems response
    }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as Record<string, unknown>;
    const error = body.error as Record<string, string> | undefined;
    return {
      success: false,
      message: `Hold failed: ${error?.message || `HTTP ${res.status}`}`,
    };
  }

  const data = await res.json() as Record<string, unknown>;
  // Parse response for queue position, etc.
  // Adjust field names based on actual response

  return {
    success: true,
    message: "Hold placed successfully",
  };
}

export async function fetchHolds(): Promise<Array<{
  id: string;
  title: string;
  author: string;
  queuePosition?: number;
  totalHolds?: number;
  status: string;
  bibId: string;
}>> {
  const session = await getSession();
  const url = `${GATEWAY_BASE}/${session.library}/holds?accountId=${session.accountId}`;

  const res = await fetch(url, {
    headers: {
      Cookie: session.cookies,
      "User-Agent": "shelflife/0.2.0",
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch holds: HTTP ${res.status}`);
  }

  const data = await res.json() as Record<string, unknown>;
  const entities = data.entities as Record<string, Record<string, Record<string, unknown>>> | undefined;
  const holdsMap = entities?.holds ?? {};
  const bibsMap = entities?.bibs ?? {};

  return Object.entries(holdsMap).map(([id, hold]) => {
    const metadataId = hold.metadataId as string ?? "";
    const bib = bibsMap[metadataId] ?? {};
    const briefInfo = bib.briefInfo as Record<string, unknown> | undefined;

    return {
      id,
      title: (briefInfo?.title as string) ?? "Unknown",
      author: ((briefInfo?.authors as string[]) ?? [])[0] ?? "Unknown",
      queuePosition: hold.queuePosition as number | undefined,
      totalHolds: hold.totalHolds as number | undefined,
      status: (hold.status as string) ?? "unknown",
      bibId: metadataId,
    };
  });
}
```

**Step 2: Test hold placement manually**

First, test fetching holdable items for a known bib ID (pick one from the availability check output, e.g., a "requestable" book):

Run: `npx tsx -e "const r = await fetch('https://gateway.bibliocommons.com/v2/libraries/chipublib/bibs/S126C1075024/holdableItems'); console.log(JSON.stringify(await r.json(), null, 2));"`

Inspect the response to understand `materialParams` format. Then adjust `placeHold()` accordingly.

**Step 3: Test placing a real hold (with credentials)**

Run: `LIBRARY_CARD_NUMBER=<card> LIBRARY_PIN=<pin> npx tsx -e "import { placeHold } from './src/account.js'; const r = await placeHold('S126C1075024'); console.log(r);"`

Expected: Either success or a descriptive error that helps us adjust the request body.

**Step 4: Commit**

```bash
git add src/account.ts
git commit -m "feat: add hold placement and hold listing"
```

---

## Task 4: MCP Tools — Due Dates and Place Hold

**Files:**
- Modify: `src/mcp.ts`

**Step 1: Add `check_due_dates` tool to `src/mcp.ts`**

After the existing `list_shelves` tool, add:

```typescript
server.tool(
  "check_due_dates",
  "Check your active library checkouts and due dates. Shows overdue items, items due soon (within 5 days), and all checkouts sorted by urgency. Requires LIBRARY_CARD_NUMBER and LIBRARY_PIN environment variables.",
  {},
  async () => {
    try {
      const { fetchCheckouts } = await import("./account.js");
      const result = await fetchCheckouts();

      const sections: string[] = [];

      if (result.overdue.length > 0) {
        sections.push(
          `## OVERDUE (${result.overdue.length})\n` +
            result.overdue
              .map((c) => `- **${c.title}** by ${c.author} — ${Math.abs(c.daysUntilDue)} days overdue${c.renewable ? " (renewable)" : ""}`)
              .join("\n")
        );
      }

      if (result.dueSoon.length > 0) {
        sections.push(
          `## Due within 5 days (${result.dueSoon.length})\n` +
            result.dueSoon
              .map((c) => `- **${c.title}** by ${c.author} — due ${c.dueDate} (${c.daysUntilDue} days)${c.renewable ? " (renewable)" : ""}`)
              .join("\n")
        );
      }

      const notUrgent = result.checkouts.filter((c) => c.daysUntilDue > 5);
      if (notUrgent.length > 0) {
        sections.push(
          `## Other checkouts (${notUrgent.length})\n` +
            notUrgent
              .map((c) => `- **${c.title}** by ${c.author} — due ${c.dueDate} (${c.daysUntilDue} days)${c.renewable ? " (renewable)" : ""}`)
              .join("\n")
        );
      }

      if (sections.length === 0) {
        return { content: [{ type: "text" as const, text: "No books currently checked out." }] };
      }

      const summary = `\n---\n${result.checkouts.length} checked out | ${result.overdue.length} overdue | ${result.dueSoon.length} due soon`;
      return { content: [{ type: "text" as const, text: sections.join("\n\n") + summary }] };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  }
);
```

**Step 2: Add `place_hold` tool to `src/mcp.ts`**

```typescript
server.tool(
  "place_hold",
  "Place a hold on a book at your library. Requires a BiblioCommons bib ID (from check_shelf or check_book results). Requires LIBRARY_CARD_NUMBER and LIBRARY_PIN environment variables.",
  {
    bib_id: z.string().describe("BiblioCommons bib ID (e.g., S126C1075024)"),
    pickup_branch: z.string().optional().describe("Pickup branch name (defaults to configured branch)"),
  },
  async ({ bib_id, pickup_branch }) => {
    try {
      const { placeHold } = await import("./account.js");
      const result = await placeHold(bib_id, pickup_branch);

      if (!result.success) {
        return {
          content: [{ type: "text" as const, text: result.message }],
          isError: true,
        };
      }

      let text = result.message;
      if (result.queuePosition) text += `\nQueue position: ${result.queuePosition}`;
      if (result.userHoldCount) text += `\nYour total holds: ${result.userHoldCount}`;

      return { content: [{ type: "text" as const, text }] };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  }
);
```

**Step 3: Add `list_holds` tool to `src/mcp.ts`**

```typescript
server.tool(
  "list_holds",
  "List your current library holds with queue positions and status. Requires LIBRARY_CARD_NUMBER and LIBRARY_PIN environment variables.",
  {},
  async () => {
    try {
      const { fetchHolds } = await import("./account.js");
      const holds = await fetchHolds();

      if (holds.length === 0) {
        return { content: [{ type: "text" as const, text: "No active holds." }] };
      }

      const lines = holds.map((h) => {
        const pos = h.queuePosition ? ` — #${h.queuePosition} in queue` : "";
        return `- **${h.title}** by ${h.author}${pos} (${h.status})`;
      });

      return {
        content: [{ type: "text" as const, text: `## Your holds (${holds.length})\n${lines.join("\n")}` }],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  }
);
```

**Step 4: Verify MCP server starts**

Run: `npx tsx src/mcp.ts` and verify it doesn't crash on startup. Ctrl+C to exit.

**Step 5: Commit**

```bash
git add src/mcp.ts
git commit -m "feat: add MCP tools for due dates, hold placement, and hold listing"
```

---

## Task 5: Availability Check — Return Bib IDs

**Files:**
- Modify: `src/types.ts`
- Modify: `src/library.ts`
- Modify: `src/mcp.ts`

The current availability check doesn't return bib IDs, which are needed for placing holds. Fix this.

**Step 1: Add `bibId` to `AvailabilityResult` in `src/types.ts`**

```typescript
export interface AvailabilityResult {
  book: GoodreadsBook;
  status: "at-branch" | "in-system" | "not-found";
  catalogUrl?: string;
  callNumber?: string;
  bibId?: string;  // BiblioCommons bib ID for hold placement
}
```

**Step 2: Update `src/library.ts` to capture bib IDs**

In `parseAvailabilityFromState`, add `bibId: bestBibId` to the returned objects (lines ~289 and ~294):

```typescript
return { book, status: "in-system", catalogUrl, bibId: bestBibId };
```

And in `tryHtmlSearch` fallback (line ~203), extract bib ID from the URL match:

```typescript
const bibId = linkMatch?.[1]?.startsWith("S") ? linkMatch[1] : undefined;
return { book, status: "in-system", catalogUrl, bibId };
```

Also in `tryRssSearch`, extract bib ID from the catalog URL:

```typescript
const bibId = branchResults[0].link.match(/\/([^/]+)$/)?.[1];
```

**Step 3: Update MCP tool output to include bib IDs**

In `src/mcp.ts` `check_shelf` tool, update the book display to include bib ID so Claude can use it for holds:

```typescript
`- **${r.book.title}** by ${r.book.author}${r.bibId ? ` [bib: ${r.bibId}]` : ""}${r.callNumber ? ` (Call #: ${r.callNumber})` : ""}${r.catalogUrl ? `\n  ${r.catalogUrl}` : ""}`
```

**Step 4: Verify existing CLI still works**

Run: `npx tsx src/cli.ts`

Expected: Same output as before, with no regressions.

**Step 5: Commit**

```bash
git add src/types.ts src/library.ts src/mcp.ts
git commit -m "feat: include bib IDs in availability results for hold placement"
```

---

## Task 6: Hold Staggering — Queue Management

**Files:**
- Create: `src/stagger.ts`

**Step 1: Create `src/stagger.ts`**

```typescript
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const QUEUE_PATH = resolve(process.cwd(), ".shelflife-queue.json");

export interface QueuedHold {
  bibId: string;
  title: string;
  author: string;
  status: "waiting" | "hold-placed" | "checked-out" | "done";
}

export interface StaggerQueue {
  queue: QueuedHold[];
  triggerOnCheckoutOf?: string; // bibId of the book whose checkout triggers next hold
  created: string;
  lastChecked?: string;
}

export function loadQueue(): StaggerQueue | null {
  if (!existsSync(QUEUE_PATH)) return null;
  try {
    return JSON.parse(readFileSync(QUEUE_PATH, "utf-8"));
  } catch {
    return null;
  }
}

export function saveQueue(queue: StaggerQueue): void {
  writeFileSync(QUEUE_PATH, JSON.stringify(queue, null, 2) + "\n");
}

export function createQueue(books: Array<{ bibId: string; title: string; author: string }>): StaggerQueue {
  if (books.length === 0) throw new Error("No books to queue");

  const queue: StaggerQueue = {
    queue: books.map((b, i) => ({
      ...b,
      status: i === 0 ? "hold-placed" : "waiting",
    })),
    created: new Date().toISOString(),
  };

  saveQueue(queue);
  return queue;
}

export function getNextWaiting(queue: StaggerQueue): QueuedHold | null {
  return queue.queue.find((q) => q.status === "waiting") ?? null;
}

export function advanceQueue(queue: StaggerQueue, checkedOutBibId: string): {
  queue: StaggerQueue;
  nextHold: QueuedHold | null;
} {
  // Mark the checked-out book
  const item = queue.queue.find((q) => q.bibId === checkedOutBibId);
  if (item) {
    item.status = "checked-out";
  }

  // Find next waiting book
  const nextHold = getNextWaiting(queue);
  if (nextHold) {
    nextHold.status = "hold-placed";
    queue.triggerOnCheckoutOf = nextHold.bibId;
  } else {
    queue.triggerOnCheckoutOf = undefined;
  }

  queue.lastChecked = new Date().toISOString();
  saveQueue(queue);

  return { queue, nextHold };
}

export function clearQueue(): void {
  if (existsSync(QUEUE_PATH)) {
    const { unlinkSync } = require("node:fs");
    unlinkSync(QUEUE_PATH);
  }
}
```

**Step 2: Commit**

```bash
git add src/stagger.ts
git commit -m "feat: add hold stagger queue management"
```

---

## Task 7: MCP Tools — Hold Staggering

**Files:**
- Modify: `src/mcp.ts`

**Step 1: Add `create_stagger_queue` tool**

```typescript
server.tool(
  "create_stagger_queue",
  "Set up staggered holds — queue multiple books so they arrive one at a time. Places the first hold immediately, then waits for checkout before placing the next. Pass bib IDs from check_shelf results.",
  {
    books: z.array(z.object({
      bib_id: z.string().describe("BiblioCommons bib ID"),
      title: z.string().describe("Book title"),
      author: z.string().describe("Book author"),
    })).describe("Books to stagger, in desired reading order"),
  },
  async ({ books }) => {
    try {
      const { createQueue } = await import("./stagger.js");
      const { placeHold } = await import("./account.js");

      const queue = createQueue(books.map((b) => ({
        bibId: b.bib_id,
        title: b.title,
        author: b.author,
      })));

      // Place hold on the first book
      const first = queue.queue[0];
      const holdResult = await placeHold(first.bibId);

      const remaining = queue.queue.slice(1);
      const lines = [
        `Hold placed on **${first.title}** by ${first.author}${holdResult.success ? "" : ` (${holdResult.message})`}`,
        "",
        `**Queued for later (${remaining.length}):**`,
        ...remaining.map((b, i) => `${i + 1}. ${b.title} by ${b.author}`),
        "",
        "I'll prompt you to place the next hold when you check out the current book.",
      ];

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  }
);
```

**Step 2: Add `check_stagger_status` tool**

```typescript
server.tool(
  "check_stagger_status",
  "Check your hold stagger queue status. Detects if you've checked out books since last check and suggests placing the next hold. Call this at the start of any library-related conversation.",
  {},
  async () => {
    try {
      const { loadQueue, advanceQueue } = await import("./stagger.js");
      const { fetchCheckouts } = await import("./account.js");

      const queue = loadQueue();
      if (!queue) {
        return { content: [{ type: "text" as const, text: "No stagger queue active." }] };
      }

      // Check current checkouts
      const checkouts = await fetchCheckouts();
      const checkedOutBibIds = new Set(checkouts.checkouts.map((c) => c.bibId));

      // See if any queued books have been checked out
      const newCheckouts = queue.queue.filter(
        (q) => q.status === "hold-placed" && checkedOutBibIds.has(q.bibId)
      );

      if (newCheckouts.length === 0) {
        const waiting = queue.queue.filter((q) => q.status === "waiting");
        const holdPlaced = queue.queue.filter((q) => q.status === "hold-placed");
        return {
          content: [{
            type: "text" as const,
            text: `**Stagger queue:** ${holdPlaced.length} hold(s) active, ${waiting.length} waiting.\nNo new checkouts detected.`,
          }],
        };
      }

      // Advance the queue for each newly checked-out book
      let result = { queue, nextHold: null as null | { bibId: string; title: string; author: string } };
      for (const co of newCheckouts) {
        result = advanceQueue(result.queue, co.bibId);
      }

      if (result.nextHold) {
        return {
          content: [{
            type: "text" as const,
            text: `You checked out **${newCheckouts.map((c) => c.title).join(", ")}**!\n\nNext in your queue: **${result.nextHold.title}** by ${result.nextHold.author}\n\nWant me to place this hold now?`,
          }],
        };
      } else {
        return {
          content: [{
            type: "text" as const,
            text: `You checked out **${newCheckouts.map((c) => c.title).join(", ")}**. That's the last book in your stagger queue — all done!`,
          }],
        };
      }
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  }
);
```

**Step 3: Verify MCP server starts**

Run: `npx tsx src/mcp.ts` — should start without errors.

**Step 4: Commit**

```bash
git add src/mcp.ts
git commit -m "feat: add MCP tools for hold staggering queue"
```

---

## Task 8: Polish — Format Filtering in Availability Check

**Files:**
- Modify: `src/library.ts`

**Step 1: Update `parseAvailabilityFromState` to filter formats**

In the bib iteration loop (around line 264), change the format check to exclude non-print formats:

```typescript
const PHYSICAL_FORMATS = new Set(["BK", "PAPERBACK", "HARDCOVER"]);
const EXCLUDED_FORMATS = new Set(["LPRINT", "AB", "EBOOK", "MUSIC_CD", "DVD", "GRAPHIC_NOVEL"]);

// In the loop:
if (EXCLUDED_FORMATS.has(format)) continue;
if (PHYSICAL_FORMATS.has(format)) {
  bestBib = bib;
  bestBibId = bibId;
  break;
}
```

**Step 2: Verify CLI still works**

Run: `npx tsx src/cli.ts`

Expected: Same or fewer results (large print / audiobook CDs filtered out).

**Step 3: Commit**

```bash
git add src/library.ts
git commit -m "feat: filter non-print formats from availability results"
```

---

## Task 9: Integration Test — Full Flow

**Step 1: Test the complete flow with real credentials**

```bash
export LIBRARY_CARD_NUMBER=<card>
export LIBRARY_PIN=<pin>
```

Test each new feature:

1. **Login:** `npx tsx -e "import { getSession } from './src/auth.js'; const s = await getSession(); console.log('Logged in, account:', s.accountId);"`

2. **Due dates:** `npx tsx -e "import { fetchCheckouts } from './src/account.js'; console.log(JSON.stringify(await fetchCheckouts(), null, 2));"`

3. **List holds:** `npx tsx -e "import { fetchHolds } from './src/account.js'; console.log(JSON.stringify(await fetchHolds(), null, 2));"`

4. **Place a hold** (pick a low-risk book): `npx tsx -e "import { placeHold } from './src/account.js'; console.log(await placeHold('<bib_id>'));"`

5. **Availability with bib IDs:** `npx tsx src/cli.ts` — verify bib IDs appear

**Step 2: Fix any issues found in the real response shapes**

The gateway API response formats are partially guessed. This step will likely require adjusting field names in `src/account.ts` to match reality.

**Step 3: Commit fixes**

```bash
git add -A
git commit -m "fix: adjust API response parsing to match real BiblioCommons responses"
```

---

## Task 10: Update Package Version and MCP Config

**Files:**
- Modify: `package.json`
- Modify: `src/mcp.ts`

**Step 1: Bump version**

In `package.json`, change `"version": "0.1.0"` to `"version": "0.2.0"`.

In `src/mcp.ts`, change `version: "0.1.0"` to `version: "0.2.0"`.

**Step 2: Commit**

```bash
git add package.json src/mcp.ts
git commit -m "chore: bump version to 0.2.0 for authenticated features"
```

---

## Summary

| Task | What | Files |
|---|---|---|
| 1 | Auth module (login, sessions) | `src/auth.ts`, `src/types.ts` |
| 2 | Checkout fetching (due dates) | `src/account.ts` |
| 3 | Hold placement + listing | `src/account.ts` |
| 4 | MCP tools (due dates, holds) | `src/mcp.ts` |
| 5 | Bib IDs in availability results | `src/types.ts`, `src/library.ts`, `src/mcp.ts` |
| 6 | Stagger queue management | `src/stagger.ts` |
| 7 | MCP tools (staggering) | `src/mcp.ts` |
| 8 | Format filtering | `src/library.ts` |
| 9 | Integration test (full flow) | All files |
| 10 | Version bump | `package.json`, `src/mcp.ts` |
