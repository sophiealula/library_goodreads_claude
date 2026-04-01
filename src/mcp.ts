#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { checkShelf, fetchShelf } from "./index.js";

// Load saved config for defaults — validate on load
function loadConfig(): Record<string, string> {
  const configPath = resolve(homedir(), ".shelfliferc.json");
  if (!existsSync(configPath)) return {};
  try {
    const raw = JSON.parse(readFileSync(configPath, "utf-8"));
    const config: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v === "string") config[k] = v;
    }
    return config;
  } catch {
    return {};
  }
}

const savedConfig = loadConfig();

function isValidSubdomain(s: string): boolean {
  return /^[a-z0-9-]+$/.test(s);
}

const server = new McpServer({
  name: "shelflife",
  version: "0.2.0",
});

server.tool(
  "check_shelf",
  "Check which books from a Goodreads shelf are available at a local library. Returns books grouped by availability: at your branch, in the library system, or not found. All parameters are optional if configured via 'shelflife setup'.",
  {
    goodreads_user_id: z
      .string()
      .optional()
      .describe("Goodreads user ID (optional if configured)"),
    library: z
      .string()
      .optional()
      .describe(
        "BiblioCommons library subdomain (optional if configured)"
      ),
    branch: z
      .string()
      .optional()
      .describe(
        "Specific branch name to check (e.g., 'Uptown', 'Main Library')"
      ),
    shelf: z
      .string()
      .optional()
      .describe("Goodreads shelf to check (default: to-read)"),
  },
  async ({ goodreads_user_id, library, branch, shelf }) => {
    try {
      const userId = goodreads_user_id || savedConfig.goodreadsUserId;
      const lib = library || savedConfig.library;
      const br = branch ?? savedConfig.branch;
      const sh = shelf || savedConfig.shelf || "to-read";

      if (!userId || !lib) {
        return {
          content: [{
            type: "text" as const,
            text: "Missing Goodreads user ID or library. Pass them as parameters or run 'shelflife setup' to configure.",
          }],
          isError: true,
        };
      }

      if (!isValidSubdomain(lib)) {
        return {
          content: [{ type: "text" as const, text: "Invalid library subdomain. Use only lowercase letters, numbers, and hyphens." }],
          isError: true,
        };
      }

      const result = await checkShelf({
        goodreadsUserId: userId,
        shelf: sh,
        library: lib,
        branch: br,
      });

      const sections: string[] = [];

      if (result.atBranch.length > 0) {
        sections.push(
          `## On the shelf at ${br || lib} (${result.atBranch.length})\n` +
            result.atBranch
              .map(
                (r) =>
                  `- **${r.book.title}** by ${r.book.author}${r.bibId ? ` [bib: ${r.bibId}]` : ""}${r.callNumber ? ` (Call #: ${r.callNumber})` : ""}${r.catalogUrl ? `\n  ${r.catalogUrl}` : ""}`
              )
              .join("\n")
        );
      }

      if (result.inSystem.length > 0) {
        const label = br
          ? `In the system, not at ${br}`
          : "In the library system";
        sections.push(
          `## ${label} (${result.inSystem.length})\n` +
            result.inSystem
              .map(
                (r) =>
                  `- **${r.book.title}** by ${r.book.author}${r.bibId ? ` [bib: ${r.bibId}]` : ""}${r.catalogUrl ? ` — [Place hold](${r.catalogUrl})` : ""}`
              )
              .join("\n")
        );
      }

      if (result.notFound.length > 0) {
        sections.push(
          `## Not in catalog (${result.notFound.length})\n` +
            result.notFound
              .map(
                (r) => `- ${r.book.title} by ${r.book.author}`
              )
              .join("\n")
        );
      }

      if (result.errors.length > 0) {
        sections.push(
          `## Could not check (${result.errors.length})\n` +
            result.errors
              .map(
                (r) => `- ${r.book.title} by ${r.book.author} — search failed (network error or rate limit)`
              )
              .join("\n")
        );
      }

      const summary = `\n---\n${result.totalChecked} books checked | ${result.atBranch.length} ready to grab | ${result.inSystem.length} requestable | ${result.notFound.length} not found${result.errors.length ? ` | ${result.errors.length} failed` : ""}`;

      return {
        content: [
          {
            type: "text" as const,
            text: sections.join("\n\n") + summary,
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

server.tool(
  "check_book",
  "Check if a specific book is available at a library by title, author, or ISBN. At least one of title, author, or ISBN is required.",
  {
    library: z
      .string()
      .optional()
      .describe("BiblioCommons library subdomain (optional if configured)"),
    title: z.string().optional().describe("Book title"),
    author: z.string().optional().describe("Book author"),
    isbn: z.string().optional().describe("ISBN (10 or 13)"),
    branch: z.string().optional().describe("Specific branch name"),
  },
  async ({ library, title, author, isbn, branch }) => {
    try {
      const lib = library || savedConfig.library;
      const br = branch ?? savedConfig.branch;

      if (!lib) {
        return {
          content: [{ type: "text" as const, text: "Missing library. Pass it as a parameter or run 'shelflife setup'." }],
          isError: true,
        };
      }

      if (!isValidSubdomain(lib)) {
        return {
          content: [{ type: "text" as const, text: "Invalid library subdomain. Use only lowercase letters, numbers, and hyphens." }],
          isError: true,
        };
      }

      if (!title && !author && !isbn) {
        return {
          content: [{ type: "text" as const, text: "At least one of title, author, or ISBN is required." }],
          isError: true,
        };
      }

      const { checkAvailability } = await import("./library.js");

      const fakeBook = {
        title: title || "",
        author: author || "",
        isbn: isbn || "",
        bookId: "",
        imageUrl: "",
        averageRating: "",
        description: "",
        pages: "",
        dateAdded: "",
        goodreadsUrl: "",
      };

      const results = await checkAvailability([fakeBook], lib, br);
      const r = results[0];

      let text: string;
      if (r.status === "at-branch") {
        text = `Found at ${br}!${r.callNumber ? ` Call #: ${r.callNumber}` : ""}${r.bibId ? ` [bib: ${r.bibId}]` : ""}${r.catalogUrl ? `\n${r.catalogUrl}` : ""}`;
      } else if (r.status === "in-system") {
        text = `In the library system${br ? `, but not at ${br}` : ""}.${r.bibId ? ` [bib: ${r.bibId}]` : ""}${r.catalogUrl ? ` Place a hold: ${r.catalogUrl}` : ""}`;
      } else if (r.status === "error") {
        text = "Search failed — network error or rate limit. Try again.";
      } else {
        text = "Not found in this library's catalog.";
      }

      return { content: [{ type: "text" as const, text }] };
    } catch (err) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

server.tool(
  "list_shelves",
  "List available Goodreads shelves and book counts for a user. User ID is optional if configured.",
  {
    goodreads_user_id: z.string().optional().describe("Goodreads user ID (optional if configured)"),
  },
  async ({ goodreads_user_id }) => {
    try {
      const userId = goodreads_user_id || savedConfig.goodreadsUserId;
      if (!userId) {
        return {
          content: [{ type: "text" as const, text: "Missing Goodreads user ID. Pass it as a parameter or run 'shelflife setup'." }],
          isError: true,
        };
      }

      const shelves = ["to-read", "currently-reading", "read"];
      const lines: string[] = [];

      for (const shelf of shelves) {
        const books = await fetchShelf(userId, shelf);
        lines.push(`- **${shelf}**: ${books.length} books`);
      }

      return {
        content: [
          {
            type: "text" as const,
            text: lines.join("\n") +
              "\n\nCustom shelves can also be checked by name.",
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ── Authenticated tools ─────────────────────────────

server.tool(
  "check_due_dates",
  "Check your active library checkouts and due dates. Shows overdue items, items due soon, and all checkouts sorted by urgency. Requires LIBRARY_CARD_NUMBER and LIBRARY_PIN environment variables and a .shelfliferc.json config (run 'shelflife setup').",
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
          `## Due soon (${result.dueSoon.length})\n` +
            result.dueSoon
              .map((c) => `- **${c.title}** by ${c.author} — due ${c.dueDate} (${c.daysUntilDue} days)${c.renewable ? " (renewable)" : ""}`)
              .join("\n")
        );
      }

      const notUrgent = result.checkouts.filter((c) => c.daysUntilDue > 3);
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

server.tool(
  "list_holds",
  "List your current library holds with queue positions, status, and IDs needed for cancel_hold. Requires LIBRARY_CARD_NUMBER and LIBRARY_PIN environment variables and a .shelfliferc.json config (run 'shelflife setup').",
  {},
  async () => {
    try {
      const { fetchHolds } = await import("./account.js");
      const holds = await fetchHolds();

      if (holds.length === 0) {
        return { content: [{ type: "text" as const, text: "No active holds." }] };
      }

      const lines = holds.map((h) => {
        const pos = h.holdsPosition ? `#${h.holdsPosition} of ${h.totalHolds} holds on ${h.totalCopies} copies` : "";
        return `- **${h.title}** by ${h.author} — ${pos} (${h.status}) — pickup: ${h.pickupLocation}\n  Hold ID: ${h.id} | Bib ID: ${h.bibId}`;
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

server.tool(
  "place_hold",
  "Place a real hold on the user's library account. Confirm with the user before calling. Use a bib ID from check_shelf or check_book results. Requires LIBRARY_CARD_NUMBER and LIBRARY_PIN environment variables and a .shelfliferc.json config (run 'shelflife setup').",
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
      if (result.holdsPosition) text += `\nQueue position: #${result.holdsPosition}`;
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

server.tool(
  "cancel_hold",
  "Cancel an active hold on the user's library account. Confirm with the user before calling. Requires the hold ID and bib ID from list_holds. Requires LIBRARY_CARD_NUMBER and LIBRARY_PIN environment variables and a .shelfliferc.json config.",
  {
    hold_id: z.string().describe("Hold ID (from list_holds)"),
    bib_id: z.string().describe("BiblioCommons bib ID (from list_holds)"),
  },
  async ({ hold_id, bib_id }) => {
    try {
      const { cancelHold } = await import("./account.js");
      const result = await cancelHold(hold_id, bib_id);

      return {
        content: [{ type: "text" as const, text: result.message }],
        isError: !result.success,
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  "create_stagger_queue",
  "Set up staggered holds — queue multiple books so they arrive one at a time. Places the first hold immediately, then waits for you to check it out before placing the next.",
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

      const first = queue.queue[0];
      const holdResult = await placeHold(first.bibId);

      if (!holdResult.success) {
        // Don't persist queue with wrong state — hold wasn't actually placed
        return {
          content: [{ type: "text" as const, text: `Failed to place hold on **${first.title}**: ${holdResult.message}\n\nStagger queue was not created.` }],
          isError: true,
        };
      }

      const remaining = queue.queue.slice(1);
      const lines = [
        `Hold placed on **${first.title}** by ${first.author}`,
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

server.tool(
  "check_stagger_status",
  "Check your hold stagger queue. Detects if you've checked out books since last check and suggests placing the next hold. Call with place_next=true to place the next hold and advance the queue.",
  {
    place_next: z.boolean().optional().describe("Set to true to place the next hold and advance the queue"),
  },
  async ({ place_next }) => {
    try {
      const { loadQueue, advanceQueue, saveQueue, getNextWaiting } = await import("./stagger.js");
      const { fetchCheckouts } = await import("./account.js");

      const queue = loadQueue();
      if (!queue) {
        return { content: [{ type: "text" as const, text: "No stagger queue active." }] };
      }

      const checkouts = await fetchCheckouts();
      const checkedOutBibIds = new Set(checkouts.checkouts.map((c) => c.bibId));

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

      // Advance queue state in memory (marks checked-out items)
      let result = { queue, nextHold: null as null | { bibId: string; title: string; author: string } };
      for (const co of newCheckouts) {
        result = advanceQueue(result.queue, co.bibId);
      }

      if (!result.nextHold) {
        // All done — save final state
        saveQueue(result.queue);
        return {
          content: [{
            type: "text" as const,
            text: `You checked out **${newCheckouts.map((c) => c.title).join(", ")}**. That's the last book in your stagger queue — all done!`,
          }],
        };
      }

      if (!place_next) {
        // Report only — don't persist state until hold is placed
        return {
          content: [{
            type: "text" as const,
            text: `You checked out **${newCheckouts.map((c) => c.title).join(", ")}**!\n\nNext in your queue: **${result.nextHold.title}** by ${result.nextHold.author} [bib: ${result.nextHold.bibId}]\n\nWant me to place this hold? Call again with place_next=true.`,
          }],
        };
      }

      // Place the next hold and persist state
      const { placeHold } = await import("./account.js");
      const holdResult = await placeHold(result.nextHold.bibId);

      if (!holdResult.success) {
        return {
          content: [{
            type: "text" as const,
            text: `You checked out **${newCheckouts.map((c) => c.title).join(", ")}**.\n\nFailed to place hold on **${result.nextHold.title}**: ${holdResult.message}\n\nQueue state was not updated — try again later.`,
          }],
          isError: true,
        };
      }

      // Hold succeeded — mark as hold-placed and save
      const nextItem = result.queue.queue.find((q) => q.bibId === result.nextHold!.bibId);
      if (nextItem) nextItem.status = "hold-placed";
      saveQueue(result.queue);

      const remaining = result.queue.queue.filter((q) => q.status === "waiting");
      return {
        content: [{
          type: "text" as const,
          text: `You checked out **${newCheckouts.map((c) => c.title).join(", ")}**.\n\nHold placed on **${result.nextHold.title}** by ${result.nextHold.author}!${remaining.length > 0 ? `\n\n${remaining.length} more book(s) waiting in your queue.` : "\n\nThat's the last hold — queue complete after this one!"}`,
        }],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  }
);

// ── Server startup ──────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
