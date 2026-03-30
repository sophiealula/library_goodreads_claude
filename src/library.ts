import { XMLParser } from "fast-xml-parser";
import type {
  GoodreadsBook,
  AvailabilityResult,
  LibrarySearchResult,
} from "./types.js";

const CONCURRENCY = 3;
const DELAY_MS = 400;

export async function checkAvailability(
  books: GoodreadsBook[],
  library: string,
  branch?: string
): Promise<AvailabilityResult[]> {
  const results: AvailabilityResult[] = [];

  for (let i = 0; i < books.length; i += CONCURRENCY) {
    const batch = books.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map((book) => checkSingleBook(book, library, branch))
    );
    results.push(...batchResults);

    if (i + CONCURRENCY < books.length) {
      await sleep(DELAY_MS);
    }
  }

  return results;
}

async function checkSingleBook(
  book: GoodreadsBook,
  library: string,
  branch?: string
): Promise<AvailabilityResult> {
  // Strategy: try RSS identifier search first (fast), then HTML page fallback (reliable)
  if (book.isbn) {
    // Step 1: Try RSS search with ISBN-10 only (ISBN-13 doesn't work on RSS endpoint)
    const rssResult = await tryRssSearch(book, library, branch);
    if (rssResult && rssResult.status !== "not-found") {
      return rssResult;
    }
  }

  // Step 2: Fall back to HTML page search (works with ISBN-10, ISBN-13, title, etc.)
  return await checkViaHtmlPage(book, library, branch);
}

async function tryRssSearch(
  book: GoodreadsBook,
  library: string,
  branch?: string
): Promise<AvailabilityResult | null> {
  const query = `identifier:(${book.isbn})`;

  try {
    if (branch) {
      const [branchResults, systemResults] = await Promise.all([
        searchRss(library, `${query} available:"${branch}"`),
        searchRss(library, query),
      ]);

      if (branchResults.length > 0) {
        return {
          book,
          status: "at-branch",
          catalogUrl: branchResults[0].link,
          callNumber: branchResults[0].callNumber,
          bibId: extractBibId(branchResults[0].link),
        };
      }
      if (systemResults.length > 0) {
        return {
          book,
          status: "in-system",
          catalogUrl: systemResults[0].link,
          callNumber: systemResults[0].callNumber,
          bibId: extractBibId(systemResults[0].link),
        };
      }
    } else {
      const results = await searchRss(library, query);
      if (results.length > 0) {
        return {
          book,
          status: "in-system",
          catalogUrl: results[0].link,
          callNumber: results[0].callNumber,
          bibId: extractBibId(results[0].link),
        };
      }
    }
  } catch {
    // RSS failed, will fall through to HTML fallback
  }

  return null;
}

async function searchRss(
  library: string,
  query: string
): Promise<LibrarySearchResult[]> {
  const url = `https://${library}.bibliocommons.com/search/rss?custom_query=${encodeURIComponent(query)}`;

  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "shelflife/0.1.0 (book availability checker; github.com/shelflife)",
    },
  });

  if (!res.ok) {
    throw new Error(`BiblioCommons RSS search failed: ${res.status}`);
  }

  const xml = await res.text();
  const parser = new XMLParser();
  const parsed = parser.parse(xml);
  const items = parsed?.rss?.channel?.item;

  if (!items) return [];

  const results = Array.isArray(items) ? items : [items];

  return results.map((item: Record<string, unknown>) => ({
    title: String(item.title ?? ""),
    link: String(item.link ?? ""),
    callNumber: extractCallNumber(String(item.description ?? "")),
  }));
}

async function checkViaHtmlPage(
  book: GoodreadsBook,
  library: string,
  branch?: string
): Promise<AvailabilityResult> {
  // Clean up Goodreads title quirks (remove series info like "(The Sparrow, #1)")
  const cleanTitle = book.title.replace(/\s*\([^)]*#\d+[^)]*\)\s*$/, "").trim();

  // Try multiple search strategies in order
  const searchTerms = [
    ...(book.isbn ? [book.isbn] : []),
    `${cleanTitle} ${book.author}`,
    cleanTitle,
  ];

  let hadNetworkError = false;

  for (const searchTerm of searchTerms) {
    const result = await tryHtmlSearch(book, library, searchTerm, branch);
    if (result === "network-error") {
      hadNetworkError = true;
      continue;
    }
    if (result) return result;
  }

  if (hadNetworkError) {
    return { book, status: "error" };
  }

  return { book, status: "not-found" };
}

async function tryHtmlSearch(
  book: GoodreadsBook,
  library: string,
  searchTerm: string,
  branch?: string
): Promise<AvailabilityResult | null | "network-error"> {
  const url = `https://${library}.bibliocommons.com/v2/search?query=${encodeURIComponent(searchTerm)}&searchType=keyword`;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        "User-Agent":
          "shelflife/0.2.0 (book availability checker; github.com/shelflife)",
      },
    });
  } catch {
    return "network-error";
  }

  if (!res.ok) {
    return "network-error";
  }

  const html = await res.text();

  // Look for embedded state JSON in the page
  // BiblioCommons embeds the full app state in data-iso-key script tags
  const stateJson = extractPageState(html);

  if (stateJson) {
    const result = parseAvailabilityFromState(book, stateJson, library, branch);
    if (result) return result;
  }

  // Simpler fallback: check if the page has search results at all
  const hasResults = html.includes("/v2/record/S") ||
    html.includes("/item/show/");

  if (hasResults) {
    const linkMatch = html.match(/\/v2\/record\/(S\w+)/) ||
      html.match(/\/item\/show\/(\d+[^"']*)/);
    const catalogUrl = linkMatch
      ? linkMatch[0].startsWith("/v2/")
        ? `https://${library}.bibliocommons.com${linkMatch[0]}`
        : `https://${library}.bibliocommons.com${linkMatch[0]}`
      : undefined;

    const bibId = linkMatch?.[1]?.startsWith("S") ? linkMatch[1] : undefined;
    return { book, status: "in-system", catalogUrl, bibId };
  }

  return null;
}

function extractPageState(html: string): Record<string, unknown> | null {
  // Try data-iso-key script tags (common BiblioCommons pattern)
  const isoMatch = html.match(
    /<script[^>]*data-iso-key="_0"[^>]*>([\s\S]*?)<\/script>/
  );
  if (isoMatch) {
    try {
      return JSON.parse(isoMatch[1]);
    } catch {}
  }

  // Try window.__INITIAL_STATE__
  const stateMatch = html.match(
    /window\.__INITIAL_STATE__\s*=\s*({[\s\S]*?});?\s*<\/script>/
  );
  if (stateMatch) {
    try {
      return JSON.parse(stateMatch[1]);
    } catch {}
  }

  return null;
}

function parseAvailabilityFromState(
  book: GoodreadsBook,
  state: Record<string, unknown>,
  library: string,
  branch?: string
): AvailabilityResult | null {
  try {
    const entities = state.entities as Record<string, unknown> | undefined;
    if (!entities) return null;

    const bibs = entities.bibs as Record<string, Record<string, unknown>> | undefined;
    if (!bibs) return null;

    // Get the first bib entry (best match)
    const bibIds = Object.keys(bibs);
    if (bibIds.length === 0) return null;

    // Find physical book entries first
    let bestBib: Record<string, unknown> | null = null;
    let bestBibId: string | null = null;

    for (const bibId of bibIds) {
      const bib = bibs[bibId];
      const briefInfo = bib.briefInfo as Record<string, unknown> | undefined;
      const availability = bib.availability as Record<string, unknown> | undefined;

      if (!briefInfo) continue;

      const format = briefInfo.format as string;
      // Prefer physical books
      if (format === "BK" || format === "PAPERBACK" || format === "LPRINT") {
        bestBib = bib;
        bestBibId = bibId;
        break;
      }
      if (!bestBib) {
        bestBib = bib;
        bestBibId = bibId;
      }
    }

    if (!bestBib || !bestBibId) return null;

    const availability = bestBib.availability as Record<string, unknown> | undefined;
    const catalogUrl = `https://${library}.bibliocommons.com/v2/record/${bestBibId}`;

    if (availability) {
      const statusType = availability.statusType as string;
      const availableCopies = availability.availableCopies as number;

      // If we have a branch filter and there are available copies,
      // we can't know for sure they're at THIS branch from the search page
      // But if status is AVAILABLE, the book can be grabbed somewhere
      if (statusType === "AVAILABLE" || availableCopies > 0) {
        // We found it, but can't determine branch from HTML search alone
        // Mark as in-system; the RSS branch check already ran and didn't find it at branch
        return { book, status: "in-system", catalogUrl };
      }
    }

    // Book exists but may not be available
    return { book, status: "in-system", catalogUrl, bibId: bestBibId ?? undefined };
  } catch {
    return null;
  }
}

function extractCallNumber(descriptionHtml: string): string | undefined {
  const match = descriptionHtml.match(/Call #:\s*<\/b>\s*([^<]+)/i);
  if (match) return match[1].trim();

  const altMatch = descriptionHtml.match(/Call #[^:]*:\s*([^<\n]+)/i);
  if (altMatch) return altMatch[1].trim();

  return undefined;
}

function extractBibId(url: string): string | undefined {
  // Match /v2/record/S126CXXXXXX or /item/show/S126CXXXXXX
  const match = url.match(/(S\d+C\d+)/);
  if (match) return match[1];
  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
