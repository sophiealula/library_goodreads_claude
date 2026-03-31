import type { AuthSession } from "./types.js";

const GATEWAY_BASE = "https://gateway.bibliocommons.com/v2/libraries";

// --- Types ---

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

export interface Hold {
  id: string;
  title: string;
  author: string;
  holdsPosition: number;
  totalHolds: number;
  totalCopies: number;
  status: string;
  bibId: string;
  pickupLocation: string;
}

export interface PlaceHoldResult {
  success: boolean;
  message: string;
  holdsPosition?: number;
  holdId?: string;
  userHoldCount?: number;
}

// --- Helpers ---

async function getAuth(): Promise<{ session: AuthSession; headers: Record<string, string> }> {
  const { getSession, getAuthHeaders } = await import("./auth.js");
  const session = await getSession();
  const headers = getAuthHeaders(session);
  return { session, headers };
}

async function authFetch(url: string, init?: RequestInit): Promise<Response> {
  const { session, headers } = await getAuth();
  const fullUrl = `${GATEWAY_BASE}/${session.library}${url}`;

  const res = await fetch(fullUrl, {
    ...init,
    headers: { ...headers, ...init?.headers },
    signal: AbortSignal.timeout(15000),
  });

  // Retry once with fresh session on 401
  if (res.status === 401) {
    const { clearSession } = await import("./auth.js");
    clearSession();
    const retry = await getAuth();
    return fetch(`${GATEWAY_BASE}/${retry.session.library}${url}`, {
      ...init,
      headers: { ...retry.headers, ...init?.headers },
      signal: AbortSignal.timeout(15000),
    });
  }

  return res;
}

function daysUntil(dateStr: string): number {
  const due = new Date(dateStr);
  const now = new Date();
  // Zero out time portions for clean day diff
  due.setHours(0, 0, 0, 0);
  now.setHours(0, 0, 0, 0);
  return Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function firstAuthor(authors: unknown): string {
  if (Array.isArray(authors) && authors.length > 0) return String(authors[0]);
  if (typeof authors === "string") return authors;
  return "Unknown";
}

async function resolveBranchCode(library: string, branchName?: string): Promise<string | null> {
  // If no branch name given, try the configured branch from setup
  if (!branchName) {
    const { loadConfig } = await import("./setup.js");
    const config = loadConfig();
    branchName = config?.branch;
  }

  if (!branchName) return null;

  const { fetchBranches } = await import("./branches.js");
  const branches = await fetchBranches(library);

  // Try exact match first, then case-insensitive contains
  const exact = branches.find((b) => b.name === branchName);
  if (exact) return exact.code;

  const q = branchName.toLowerCase();
  const fuzzy = branches.find((b) => b.name.toLowerCase().includes(q));
  if (fuzzy) return fuzzy.code;

  return null;
}

// --- Checkouts ---

export async function fetchCheckouts(): Promise<CheckoutsResult> {
  const { session } = await getAuth();

  const res = await authFetch(`/checkouts?accountId=${session.accountId}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch checkouts: HTTP ${res.status}`);
  }

  const data = await res.json() as Record<string, unknown>;
  const entities = data.entities as Record<string, Record<string, Record<string, unknown>>> | undefined;
  const borrowing = data.borrowing as Record<string, Record<string, unknown>> | undefined;

  const checkoutEntities = entities?.checkouts ?? {};
  const bibEntities = entities?.bibs ?? {};
  const itemIds = (borrowing?.checkouts?.items as string[] | undefined) ?? [];

  const checkouts: Checkout[] = itemIds.map((id) => {
    const co = checkoutEntities[id] ?? {};
    const metadataId = String(co.metadataId ?? "");
    const bib = bibEntities[metadataId] as Record<string, unknown> | undefined;
    const briefInfo = bib?.briefInfo as Record<string, unknown> | undefined;

    const dueDate = String(co.dueDate ?? "");
    return {
      id,
      title: briefInfo ? String(briefInfo.title ?? co.bibTitle ?? "") : String(co.bibTitle ?? ""),
      author: briefInfo ? firstAuthor(briefInfo.authors) : "Unknown",
      dueDate,
      daysUntilDue: dueDate ? daysUntil(dueDate) : 0,
      renewable: (co.actions as string[] | undefined)?.includes("renew") ?? false,
      bibId: metadataId,
    };
  });

  // Also handle the case where items array is empty but entities has entries
  if (itemIds.length === 0) {
    for (const [id, co] of Object.entries(checkoutEntities)) {
      const metadataId = String(co.metadataId ?? "");
      const bib = bibEntities[metadataId] as Record<string, unknown> | undefined;
      const briefInfo = bib?.briefInfo as Record<string, unknown> | undefined;
      const dueDate = String(co.dueDate ?? "");

      checkouts.push({
        id,
        title: briefInfo ? String(briefInfo.title ?? co.bibTitle ?? "") : String(co.bibTitle ?? ""),
        author: briefInfo ? firstAuthor(briefInfo.authors) : "Unknown",
        dueDate,
        daysUntilDue: dueDate ? daysUntil(dueDate) : 0,
        renewable: (co.actions as string[] | undefined)?.includes("renew") ?? false,
        bibId: metadataId,
      });
    }
  }

  const DUE_SOON_DAYS = 3;
  const overdue = checkouts.filter((c) => c.daysUntilDue < 0);
  const dueSoon = checkouts.filter((c) => c.daysUntilDue >= 0 && c.daysUntilDue <= DUE_SOON_DAYS);

  return { checkouts, overdue, dueSoon };
}

// --- Holds ---

export async function fetchHolds(): Promise<Hold[]> {
  const { session } = await getAuth();

  const res = await authFetch(`/holds?accountId=${session.accountId}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch holds: HTTP ${res.status}`);
  }

  const data = await res.json() as Record<string, unknown>;
  const entities = data.entities as Record<string, Record<string, Record<string, unknown>>> | undefined;
  const borrowing = data.borrowing as Record<string, Record<string, unknown>> | undefined;

  const holdEntities = entities?.holds ?? {};
  const bibEntities = entities?.bibs ?? {};
  const itemIds = (borrowing?.holds?.items as string[] | undefined) ?? [];

  const holdIds = itemIds.length > 0 ? itemIds : Object.keys(holdEntities);

  return holdIds.map((id) => {
    const hold = holdEntities[id] ?? {};
    const metadataId = String(hold.metadataId ?? "");
    const bib = bibEntities[metadataId] as Record<string, unknown> | undefined;
    const briefInfo = bib?.briefInfo as Record<string, unknown> | undefined;
    const availability = bib?.availability as Record<string, unknown> | undefined;
    const pickupLoc = hold.pickupLocation as Record<string, string> | undefined;

    return {
      id,
      title: briefInfo ? String(briefInfo.title ?? hold.bibTitle ?? "") : String(hold.bibTitle ?? ""),
      author: briefInfo ? firstAuthor(briefInfo.authors) : "Unknown",
      holdsPosition: Number(hold.holdsPosition ?? 0),
      totalHolds: Number(availability?.heldCopies ?? 0),
      totalCopies: Number(availability?.totalCopies ?? 0),
      status: String(hold.status ?? "UNKNOWN"),
      bibId: metadataId,
      pickupLocation: pickupLoc?.name ?? "",
    };
  });
}

// --- Place Hold ---

export async function placeHold(bibId: string, pickupBranch?: string): Promise<PlaceHoldResult> {
  const { session } = await getAuth();

  // Resolve branch name → numeric code
  const branchCode = await resolveBranchCode(session.library, pickupBranch);
  if (!branchCode) {
    const hint = pickupBranch
      ? `Could not find branch "${pickupBranch}".`
      : "No branch configured.";
    return {
      success: false,
      message: `${hint} Run 'shelflife setup' to set a branch, or pass a branch name.`,
    };
  }

  const res = await authFetch(`/holds`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      accountId: parseInt(session.accountId),
      metadataId: bibId,
      materialType: "PHYSICAL",
      enableSingleClickHolds: false,
      materialParams: {
        branchId: branchCode,
        expiryDate: null,
        errorMessageLocale: "en-US",
      },
    }),
  });

  const data = await res.json().catch(() => ({})) as Record<string, unknown>;

  if (!res.ok) {
    const error = data.error as Record<string, string> | undefined;
    return {
      success: false,
      message: error?.message ?? `Hold placement failed: HTTP ${res.status}`,
    };
  }

  // Parse response — the new hold should appear in entities
  const entities = data.entities as Record<string, Record<string, Record<string, unknown>>> | undefined;
  const holdEntities = entities?.holds ?? {};
  const newHoldId = Object.keys(holdEntities)[0];
  const newHold = newHoldId ? holdEntities[newHoldId] : undefined;

  const borrowing = data.borrowing as Record<string, Record<string, unknown>> | undefined;
  const holdsPagination = borrowing?.holds?.pagination as Record<string, number> | undefined;

  return {
    success: true,
    message: "Hold placed successfully",
    holdsPosition: newHold ? Number(newHold.holdsPosition ?? 0) : undefined,
    holdId: newHoldId,
    userHoldCount: holdsPagination?.count,
  };
}

// --- Cancel Hold ---

export async function cancelHold(holdId: string, bibId: string): Promise<{ success: boolean; message: string }> {
  const { session } = await getAuth();

  const res = await authFetch(`/holds`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      accountId: parseInt(session.accountId),
      metadataIds: [bibId],
      holdIds: [holdId],
    }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as Record<string, unknown>;
    const error = data.error as Record<string, string> | undefined;
    return {
      success: false,
      message: error?.message ?? `Cancel failed: HTTP ${res.status}`,
    };
  }

  return { success: true, message: "Hold cancelled successfully" };
}
