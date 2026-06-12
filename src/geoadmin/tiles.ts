import { fetchOfficialStreets } from "./client";
import type { Bbox, OfficialStreet } from "./types";

/** ~1.6 x 2.2 km at Swiss latitudes; a viewport at working zoom spans a few tiles. */
export const TILE_SIZE_DEG = 0.02;
// Tiles now carry geometries (~5-10x heavier); cap accordingly (~400 km² coverage).
const CACHE_MAX_TILES = 120;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // register is refreshed daily

export function tileKeysForBbox(bbox: Bbox): string[] {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const x0 = Math.floor(minLon / TILE_SIZE_DEG);
  const x1 = Math.floor(maxLon / TILE_SIZE_DEG);
  const y0 = Math.floor(minLat / TILE_SIZE_DEG);
  const y1 = Math.floor(maxLat / TILE_SIZE_DEG);
  const keys: string[] = [];
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      keys.push(`${x}:${y}`);
    }
  }
  return keys;
}

export function tileKeyForPoint(lon: number, lat: number): string {
  return `${Math.floor(lon / TILE_SIZE_DEG)}:${Math.floor(lat / TILE_SIZE_DEG)}`;
}

export function tileKeyToBbox(key: string): Bbox {
  const [xs, ys] = key.split(":");
  const x = Number(xs);
  const y = Number(ys);
  return [
    x * TILE_SIZE_DEG,
    y * TILE_SIZE_DEG,
    (x + 1) * TILE_SIZE_DEG,
    (y + 1) * TILE_SIZE_DEG,
  ];
}

interface CacheSlot {
  entries: OfficialStreet[];
  fetchedAt: number;
}

export class TileCache {
  private slots = new Map<string, CacheSlot>();

  constructor(
    private maxTiles = CACHE_MAX_TILES,
    private ttlMs = CACHE_TTL_MS,
    private now: () => number = Date.now,
  ) {}

  get(key: string): OfficialStreet[] | null {
    const slot = this.slots.get(key);
    if (!slot) return null;
    if (this.now() - slot.fetchedAt > this.ttlMs) {
      this.slots.delete(key);
      return null;
    }
    // LRU touch: re-insert to move to the end of iteration order
    this.slots.delete(key);
    this.slots.set(key, slot);
    return slot.entries;
  }

  set(key: string, entries: OfficialStreet[]): void {
    this.slots.delete(key);
    this.slots.set(key, { entries, fetchedAt: this.now() });
    while (this.slots.size > this.maxTiles) {
      const oldest = this.slots.keys().next().value;
      if (oldest === undefined) break;
      this.slots.delete(oldest);
    }
  }

  clear(): void {
    this.slots.clear();
  }
}

export type FetchTileFn = (bbox: Bbox, signal?: AbortSignal) => Promise<OfficialStreet[]>;

export class TileFetcher {
  constructor(
    readonly cache = new TileCache(),
    private fetchTile: FetchTileFn = fetchOfficialStreets,
  ) {}

  /**
   * Resolve all official streets covering the bbox, tile by tile (cache first),
   * deduplicated by federal street id.
   */
  async fetchBbox(
    bbox: Bbox,
    signal?: AbortSignal,
    onProgress?: (done: number, total: number) => void,
  ): Promise<OfficialStreet[]> {
    const keys = tileKeysForBbox(bbox);
    let done = 0;
    onProgress?.(0, keys.length);
    const perTile = await Promise.all(
      keys.map(async (key) => {
        const cached = this.cache.get(key);
        const entries = cached ?? (await this.fetchTile(tileKeyToBbox(key), signal));
        if (!cached) this.cache.set(key, entries);
        done++;
        onProgress?.(done, keys.length);
        return entries;
      }),
    );
    const byEsid = new Map<number, OfficialStreet>();
    for (const entries of perTile) {
      for (const e of entries) byEsid.set(e.esid, e);
    }
    return [...byEsid.values()];
  }
}
