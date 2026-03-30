import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";

const QUEUE_PATH = resolve(homedir(), ".shelflife-queue.json");

export interface QueuedHold {
  bibId: string;
  title: string;
  author: string;
  status: "waiting" | "hold-placed" | "checked-out" | "done";
}

export interface StaggerQueue {
  queue: QueuedHold[];
  triggerOnCheckoutOf?: string;
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
      status: i === 0 ? "hold-placed" as const : "waiting" as const,
    })),
    triggerOnCheckoutOf: books[0].bibId,
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
  const item = queue.queue.find((q) => q.bibId === checkedOutBibId);
  if (item) {
    item.status = "checked-out";
  }

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
    unlinkSync(QUEUE_PATH);
  }
}
