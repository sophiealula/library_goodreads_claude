import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import type { AuthSession } from "./types.js";

const GATEWAY_BASE = "https://gateway.bibliocommons.com/v2/libraries";

let cachedSession: AuthSession | null = null;

export function getAuthConfig(): { library: string; cardNumber: string; pin: string } {
  const cardNumber = process.env.LIBRARY_CARD_NUMBER;
  const pin = process.env.LIBRARY_PIN;

  if (!cardNumber || !pin) {
    throw new Error(
      "Missing LIBRARY_CARD_NUMBER or LIBRARY_PIN environment variables. " +
      "Set them in your shell profile to use authenticated features."
    );
  }

  const configPath = resolve(homedir(), ".shelfliferc.json");
  if (!existsSync(configPath)) {
    throw new Error(
      "No .shelfliferc.json found in home directory. Run 'shelflife setup' first."
    );
  }
  const config = JSON.parse(readFileSync(configPath, "utf-8"));

  return { library: config.library, cardNumber, pin };
}

export async function login(config: { library: string; cardNumber: string; pin: string }): Promise<AuthSession> {
  if (cachedSession && cachedSession.library === config.library) {
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
    throw new Error(`Login failed: ${error?.message || `HTTP ${res.status}`}`);
  }

  const data = await res.json() as Record<string, unknown>;
  const auth = data.auth as Record<string, unknown>;
  const entities = data.entities as Record<string, Record<string, unknown>>;
  const accounts = entities.accounts as Record<string, Record<string, unknown>>;
  const accountId = Object.keys(accounts)[0];

  if (!auth?.authToken || !auth?.currentUserId || !accountId) {
    throw new Error("Login succeeded but response was missing expected fields");
  }

  const cookies = (res.headers.getSetCookie?.() ?? [])
    .map((c) => c.split(";")[0])
    .join("; ");

  cachedSession = {
    userId: String(auth.currentUserId),
    accountId,
    authToken: String(auth.authToken),
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
          Authorization: `Bearer ${session.authToken}`,
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

export async function getSession(): Promise<AuthSession> {
  const config = getAuthConfig();
  return login(config);
}

export function clearSession(): void {
  cachedSession = null;
}

export function getAuthHeaders(session: AuthSession): Record<string, string> {
  return {
    Cookie: session.cookies,
    Authorization: `Bearer ${session.authToken}`,
    "User-Agent": "shelflife/0.2.0",
  };
}
