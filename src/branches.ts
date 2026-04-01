export interface Branch {
  name: string;
  code: string;
  address?: string;
  lat?: number;
  lng?: number;
}

export async function fetchBranches(library: string): Promise<Branch[]> {
  // Try the gateway API first (has full address + coordinates)
  const gatewayBranches = await fetchFromGateway(library);
  if (gatewayBranches.length > 0) return gatewayBranches;

  // Fallback: extract from search page embedded state
  return await fetchFromSearchPage(library);
}

async function fetchFromGateway(library: string): Promise<Branch[]> {
  const url = `https://gateway.bibliocommons.com/v2/libraries/${library}/locations?limit=200`;

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "shelflife/0.2.0" },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return [];

    const data = await res.json() as Record<string, unknown>;

    // Structure: { locations: { results, pagination }, entities: { locations: { id: {...} } } }
    const entities = data.entities as Record<string, unknown> | undefined;
    if (!entities) return [];

    const locationsMap = entities.locations as Record<string, Record<string, unknown>> | undefined;
    if (!locationsMap) return [];

    return Object.values(locationsMap).map((loc) => {
      const addr = loc.address as Record<string, string> | undefined;
      const map = loc.mapLocation as Record<string, unknown> | undefined;
      const centre = map?.centrePoint as Record<string, number> | undefined;

      const addressParts = [];
      if (addr?.number) addressParts.push(addr.number);
      if (addr?.street) addressParts.push(addr.street);
      const streetAddress = addressParts.join(" ");

      return {
        name: String(loc.name || ""),
        code: String(loc.id || ""),
        address: streetAddress || undefined,
        lat: centre?.lat,
        lng: centre?.lng,
      };
    }).filter((b) => b.name && !b.name.includes("Hidden")).sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

async function fetchFromSearchPage(library: string): Promise<Branch[]> {
  const url = `https://${library}.bibliocommons.com/v2/search?query=test&searchType=keyword`;

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "shelflife/0.2.0" },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return [];

    const html = await res.text();
    const isoMatch = html.match(
      /<script[^>]*data-iso-key="_0"[^>]*>([\s\S]*?)<\/script>/
    );
    if (!isoMatch) return [];

    const state = JSON.parse(isoMatch[1]);
    const libraries = state?.entities?.libraries;
    if (!libraries) return [];

    const lib = Object.values(libraries)[0] as Record<string, unknown>;
    const branches = lib?.branches as Array<Record<string, unknown>> | undefined;
    if (!branches) return [];

    return branches
      .map((b) => ({
        name: String(b.name || ""),
        code: String(b.code || ""),
      }))
      .filter((b) => b.name)
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

export interface GeocodeResult {
  lat: number;
  lng: number;
  city?: string;
  state?: string;
}

export async function geocode(query: string): Promise<GeocodeResult | null> {
  // Add country hint for zip codes and US addresses
  const isZip = /^\d{5}(-\d{4})?$/.test(query.trim());
  const countryParam = isZip ? "&countrycodes=us,ca" : "";
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&addressdetails=1${countryParam}`;

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "shelflife/0.2.0",
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;

    const results = await res.json() as Array<Record<string, unknown>>;
    if (results.length === 0) return null;

    const r = results[0];
    const addr = r.address as Record<string, string> | undefined;

    return {
      lat: parseFloat(String(r.lat)),
      lng: parseFloat(String(r.lon)),
      city: addr?.city || addr?.town || addr?.village,
      state: addr?.state,
    };
  } catch {
    return null;
  }
}

export function findNearestBranches(
  branches: Branch[],
  lat: number,
  lng: number,
  limit: number = 5
): Array<Branch & { distance: number }> {
  return branches
    .filter((b) => b.lat != null && b.lng != null)
    .map((b) => ({
      ...b,
      distance: haversine(lat, lng, b.lat!, b.lng!),
    }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit);
}

// Haversine formula — distance in miles between two lat/lng points
function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3959; // Earth radius in miles
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}
