import { fetchShelf } from "./goodreads.js";
import { checkAvailability } from "./library.js";
import type { AvailabilityResult, ShelflifeConfig } from "./types.js";

export { fetchShelf } from "./goodreads.js";
export { checkAvailability } from "./library.js";
export type { GoodreadsBook, AvailabilityResult, ShelflifeConfig } from "./types.js";

export interface ShelflifeResult {
  atBranch: AvailabilityResult[];
  inSystem: AvailabilityResult[];
  notFound: AvailabilityResult[];
  errors: AvailabilityResult[];
  totalChecked: number;
}

export async function checkShelf(
  config: ShelflifeConfig,
  onProgress?: (checked: number, total: number, title: string) => void
): Promise<ShelflifeResult> {
  const books = await fetchShelf(config.goodreadsUserId, config.shelf);

  if (books.length === 0) {
    return { atBranch: [], inSystem: [], notFound: [], errors: [], totalChecked: 0 };
  }

  const results = await checkAvailability(
    books,
    config.library,
    config.branch
  );

  const atBranch = results.filter((r) => r.status === "at-branch");
  const inSystem = results.filter((r) => r.status === "in-system");
  const notFound = results.filter((r) => r.status === "not-found");
  const errors = results.filter((r) => r.status === "error");

  return {
    atBranch,
    inSystem,
    notFound,
    errors,
    totalChecked: books.length,
  };
}
