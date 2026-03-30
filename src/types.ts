export interface GoodreadsBook {
  title: string;
  author: string;
  isbn: string;
  bookId: string;
  imageUrl: string;
  averageRating: string;
  description: string;
  pages: string;
  dateAdded: string;
  goodreadsUrl: string;
}

export interface AvailabilityResult {
  book: GoodreadsBook;
  status: "at-branch" | "in-system" | "not-found" | "error";
  catalogUrl?: string;
  callNumber?: string;
  bibId?: string;
}

export interface ShelflifeConfig {
  goodreadsUserId: string;
  shelf: string;
  library: string;
  branch?: string;
}

export interface LibrarySearchResult {
  title: string;
  link: string;
  callNumber?: string;
}

export interface AuthSession {
  userId: string;
  accountId: string;
  authToken: string;
  cookies: string;
  library: string;
}
