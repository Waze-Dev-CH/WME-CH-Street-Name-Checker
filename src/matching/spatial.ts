import type { LineString } from "geojson";
import type { IndexedEntry } from "./official-index";

/**
 * Spatial matching between Waze segments and official street axes.
 * Planar approximation in meters (fine at street scale in Switzerland):
 * 1° lat ≈ 110.57 km, 1° lon ≈ 111.32 km × cos(lat).
 */

const M_PER_DEG_LAT = 110_574;
const M_PER_DEG_LON_EQUATOR = 111_320;
/** Grid cell ≈ 110 m × 77 m at Swiss latitudes; a 3×3 search covers maxMeters ≤ ~75 m. */
const GRID_DEG = 0.001;
/** A Waze segment is considered to lie on an official street within this distance. */
export const NEAR_STREET_M = 25;
/** Beyond this distance a street is considered NOT under the segment. */
export const FAR_STREET_M = 40;

export function distancePointToSegmentM(
  p: number[],
  a: number[],
  b: number[],
): number {
  const lonScale = M_PER_DEG_LON_EQUATOR * Math.cos(((p[1] as number) * Math.PI) / 180);
  const px = (p[0] as number) * lonScale;
  const py = (p[1] as number) * M_PER_DEG_LAT;
  const ax = (a[0] as number) * lonScale;
  const ay = (a[1] as number) * M_PER_DEG_LAT;
  const bx = (b[0] as number) * lonScale;
  const by = (b[1] as number) * M_PER_DEG_LAT;
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  let t = 0;
  if (lengthSq > 0) {
    t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
  }
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

export interface NearestResult {
  entry: IndexedEntry;
  distanceM: number;
}

interface GridSegment {
  entry: IndexedEntry;
  a: number[];
  b: number[];
}

/** Grid over official street axis segments; nearest() is O(cells × local segments). */
export class SpatialIndex {
  private grid = new Map<string, GridSegment[]>();
  readonly size: number;

  /** Only full-label entries are indexed (slash parts share the same geometry). */
  constructor(entries: readonly IndexedEntry[]) {
    let count = 0;
    for (const entry of entries) {
      if (entry.isSlashPart) continue;
      const lines = entry.street.lines;
      if (!lines) continue;
      for (const line of lines) {
        for (let i = 0; i + 1 < line.length; i++) {
          const a = line[i] as number[];
          const b = line[i + 1] as number[];
          count++;
          const seg: GridSegment = { entry, a, b };
          // register the segment in every cell its bbox touches
          const x0 = Math.floor(Math.min(a[0] as number, b[0] as number) / GRID_DEG);
          const x1 = Math.floor(Math.max(a[0] as number, b[0] as number) / GRID_DEG);
          const y0 = Math.floor(Math.min(a[1] as number, b[1] as number) / GRID_DEG);
          const y1 = Math.floor(Math.max(a[1] as number, b[1] as number) / GRID_DEG);
          for (let x = x0; x <= x1; x++) {
            for (let y = y0; y <= y1; y++) {
              const key = `${x}:${y}`;
              const cell = this.grid.get(key);
              if (cell) cell.push(seg);
              else this.grid.set(key, [seg]);
            }
          }
        }
      }
    }
    this.size = count;
  }

  /** Closest official street to the point, within maxMeters (3×3 cell search). */
  nearest(point: number[], maxMeters: number): NearestResult | null {
    const cx = Math.floor((point[0] as number) / GRID_DEG);
    const cy = Math.floor((point[1] as number) / GRID_DEG);
    let best: NearestResult | null = null;
    for (let x = cx - 1; x <= cx + 1; x++) {
      for (let y = cy - 1; y <= cy + 1; y++) {
        for (const seg of this.grid.get(`${x}:${y}`) ?? []) {
          const d = distancePointToSegmentM(point, seg.a, seg.b);
          if (d <= maxMeters && (!best || d < best.distanceM)) {
            best = { entry: seg.entry, distanceM: d };
          }
        }
      }
    }
    return best;
  }
}

/** Sample points along the segment's coordinate array (quarter, mid, three-quarter). */
export function samplePoints(geometry: LineString): number[][] {
  const coords = geometry.coordinates;
  if (coords.length === 0) return [];
  if (coords.length <= 2) {
    const a = coords[0] as number[];
    const b = (coords[coords.length - 1] ?? a) as number[];
    return [[((a[0] as number) + (b[0] as number)) / 2, ((a[1] as number) + (b[1] as number)) / 2]];
  }
  const at = (f: number): number[] => coords[Math.floor((coords.length - 1) * f)] as number[];
  return [at(0.25), at(0.5), at(0.75)];
}

/**
 * Official street lying under the Waze segment: nearest street per sample
 * point, then the street seen by the most samples (ties -> smallest distance).
 */
export function nearestOfficial(
  geometry: LineString,
  index: SpatialIndex,
  maxMeters = NEAR_STREET_M,
): NearestResult | null {
  const votes = new Map<number, { entry: IndexedEntry; count: number; minD: number }>();
  for (const point of samplePoints(geometry)) {
    const hit = index.nearest(point, maxMeters);
    if (!hit) continue;
    const esid = hit.entry.street.esid;
    const vote = votes.get(esid);
    if (vote) {
      vote.count++;
      vote.minD = Math.min(vote.minD, hit.distanceM);
    } else {
      votes.set(esid, { entry: hit.entry, count: 1, minD: hit.distanceM });
    }
  }
  let best: { entry: IndexedEntry; count: number; minD: number } | null = null;
  for (const vote of votes.values()) {
    if (!best || vote.count > best.count || (vote.count === best.count && vote.minD < best.minD)) {
      best = vote;
    }
  }
  return best ? { entry: best.entry, distanceM: best.minD } : null;
}

/** Minimal distance from the sample points to one specific official street. */
export function distanceToEntryM(geometry: LineString, entry: IndexedEntry): number {
  const lines = entry.street.lines;
  if (!lines) return Infinity;
  let min = Infinity;
  for (const point of samplePoints(geometry)) {
    for (const line of lines) {
      for (let i = 0; i + 1 < line.length; i++) {
        min = Math.min(min, distancePointToSegmentM(point, line[i] as number[], line[i + 1] as number[]));
      }
    }
  }
  return min;
}
