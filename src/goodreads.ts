import { XMLParser } from "fast-xml-parser";
import type { GoodreadsBook } from "./types.js";

const GOODREADS_RSS_URL = "https://www.goodreads.com/review/list_rss";
const PER_PAGE = 100;

export async function fetchShelf(
  userId: string,
  shelf: string = "to-read"
): Promise<GoodreadsBook[]> {
  const allBooks: GoodreadsBook[] = [];
  let page = 1;

  while (true) {
    const url = `${GOODREADS_RSS_URL}/${userId}?shelf=${encodeURIComponent(shelf)}&per_page=${PER_PAGE}&page=${page}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(
        `Failed to fetch Goodreads shelf (${res.status}). Make sure the profile is public.`
      );
    }

    const xml = await res.text();
    const parser = new XMLParser({
      numberParseOptions: { leadingZeros: false, hex: false },
      parseTagValue: false,
    });
    const parsed = parser.parse(xml);
    const items = parsed?.rss?.channel?.item;

    if (!items) break;

    const bookList = Array.isArray(items) ? items : [items];
    if (bookList.length === 0) break;

    for (const item of bookList) {
      // book_description is HTML — strip tags for plain text
      const rawDesc = clean(item.book_description);
      const description = stripHtml(rawDesc);

      // num_pages is nested inside <book id="..."><num_pages>
      const bookNode = item.book;
      const pages = bookNode?.num_pages ? String(bookNode.num_pages) : "";

      allBooks.push({
        title: clean(item.title),
        author: clean(item.author_name),
        isbn: clean(item.isbn),
        bookId: String(item.book_id ?? ""),
        imageUrl: clean(item.book_large_image_url || item.book_image_url),
        averageRating: String(item.average_rating ?? ""),
        description,
        pages,
        dateAdded: clean(item.user_date_added),
        goodreadsUrl: clean(item.link),
      });
    }

    if (bookList.length < PER_PAGE) break;
    page++;
  }

  return allBooks;
}

function clean(val: unknown): string {
  if (val == null) return "";
  return String(val).trim();
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
