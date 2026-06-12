import type { WmeSDK } from "wme-sdk-typings";
import type { TileFetcher } from "./geoadmin/tiles";
import type { Bbox } from "./geoadmin/types";
import { evaluateGuidelines } from "./guidelines";
import { log } from "./log";
import { evaluateSegment, type Issue } from "./matching/evaluate";
import { OfficialIndex } from "./matching/official-index";
import type { SettingsStore } from "./settings";

const DEBOUNCE_MS = 800;
const BBOX_PADDING_RATIO = 0.2; // covers the WME data-model buffer beyond the viewport
const MAX_AREA_KM2 = 6;

export type ScanState =
  | "idle"
  | "zoom-gated"
  | "area-gated"
  | "fetching"
  | "evaluating"
  | "done"
  | "paused"
  | "error";

export interface ScanStats {
  ok: number;
  okAlt: number;
  skipped: number;
  total: number;
}

export interface ScanSnapshot {
  state: ScanState;
  issues: ReadonlyMap<number, Issue>;
  stats: ScanStats;
  officialStreetCount: number;
  progress: { done: number; total: number } | null;
  error: string | null;
  unsavedCount: number;
}

function padBbox(bbox: Bbox): Bbox {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const padLon = (maxLon - minLon) * BBOX_PADDING_RATIO;
  const padLat = (maxLat - minLat) * BBOX_PADDING_RATIO;
  return [minLon - padLon, minLat - padLat, maxLon + padLon, maxLat + padLat];
}

function bboxAreaKm2(bbox: Bbox): number {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const midLat = (minLat + maxLat) / 2;
  const widthKm = (maxLon - minLon) * 111.32 * Math.cos((midLat * Math.PI) / 180);
  const heightKm = (maxLat - minLat) * 110.57;
  return widthKm * heightKm;
}

export class Scanner {
  private generation = 0;
  private controller: AbortController | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private lastIndex: OfficialIndex | null = null;
  private listeners: Array<(snapshot: ScanSnapshot) => void> = [];
  private snapshot: ScanSnapshot = {
    state: "idle",
    issues: new Map(),
    stats: { ok: 0, okAlt: 0, skipped: 0, total: 0 },
    officialStreetCount: 0,
    progress: null,
    error: null,
    unsavedCount: 0,
  };
  paused = false;

  constructor(
    private sdk: WmeSDK,
    private fetcher: TileFetcher,
    private settings: SettingsStore,
  ) {}

  start(): void {
    const onMove = () => this.requestScan();
    this.sdk.Events.on({ eventName: "wme-map-move-end", eventHandler: onMove });
    this.sdk.Events.on({ eventName: "wme-map-data-loaded", eventHandler: onMove });
    this.sdk.Events.on({ eventName: "wme-after-edit", eventHandler: () => this.reevaluate() });
    this.sdk.Events.on({ eventName: "wme-save-finished", eventHandler: () => this.reevaluate() });
    this.requestScan();
  }

  onUpdate(listener: (snapshot: ScanSnapshot) => void): void {
    this.listeners.push(listener);
  }

  getSnapshot(): ScanSnapshot {
    return this.snapshot;
  }

  getOfficialIndex(): OfficialIndex | null {
    return this.lastIndex;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    if (paused) {
      this.controller?.abort();
      this.publish({ state: "paused" });
    } else {
      this.requestScan();
    }
  }

  requestScan(): void {
    if (this.paused) return;
    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      void this.scan();
    }, DEBOUNCE_MS);
  }

  /** Full rescan ignoring the tile cache (e.g. after register daily update). */
  rescan(): void {
    this.fetcher.cache.clear();
    this.lastIndex = null;
    this.requestScan();
  }

  /** Re-run evaluation against the last fetched official index, without refetching. */
  reevaluate(): void {
    if (this.paused || !this.lastIndex) return;
    this.evaluateAll(this.lastIndex);
    this.publish({ state: "done" });
  }

  private async scan(): Promise<void> {
    if (this.paused) return;
    const gen = ++this.generation;
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;

    try {
      const zoom = this.sdk.Map.getZoomLevel();
      if (zoom < this.settings.get().minZoom) {
        this.publish({ state: "zoom-gated", issues: new Map(), progress: null });
        return;
      }
      const bbox = padBbox(this.sdk.Map.getMapExtent() as Bbox);
      if (bboxAreaKm2(bbox) > MAX_AREA_KM2) {
        this.publish({ state: "area-gated", issues: new Map(), progress: null });
        return;
      }

      this.publish({ state: "fetching", error: null });
      const streets = await this.fetcher.fetchBbox(bbox, controller.signal, (done, total) => {
        if (gen === this.generation) this.publish({ progress: { done, total } });
      });
      if (gen !== this.generation) return;

      this.publish({ state: "evaluating", progress: null });
      const index = new OfficialIndex(streets);
      this.lastIndex = index;
      this.evaluateAll(index);
      this.publish({ state: "done", officialStreetCount: index.streetCount });
    } catch (err) {
      if (controller.signal.aborted || gen !== this.generation) return;
      log.error("Scan failed", err);
      this.publish({ state: "error", error: err instanceof Error ? err.message : String(err) });
    }
  }

  private evaluateAll(index: OfficialIndex): void {
    const settings = this.settings.get();
    const issues = new Map<number, Issue>();
    const stats = { ok: 0, okAlt: 0, skipped: 0, total: 0 };
    const segments = this.sdk.DataModel.Segments.getAll();
    for (const segment of segments) {
      stats.total++;
      let verdict;
      try {
        const address = this.sdk.DataModel.Segments.getAddress({ segmentId: segment.id });
        verdict = evaluateSegment(segment, address, index, settings);
      } catch {
        stats.skipped++;
        continue;
      }
      switch (verdict.kind) {
        case "ok":
          stats.ok++;
          break;
        case "okAlt":
          stats.okAlt++;
          break;
        case "skipped":
          stats.skipped++;
          break;
        case "issue":
          issues.set(verdict.issue.segmentId, verdict.issue);
          break;
      }
    }
    if (settings.guidelineChecks) {
      // Name issues keep precedence; guideline issues fill the remaining segments.
      const getAddress = (segmentId: number) => {
        try {
          return this.sdk.DataModel.Segments.getAddress({ segmentId });
        } catch {
          return null;
        }
      };
      for (const issue of evaluateGuidelines(segments, getAddress)) {
        if (!issues.has(issue.segmentId)) issues.set(issue.segmentId, issue);
      }
    }
    this.publish({ issues, stats, unsavedCount: this.safeUnsavedCount() });
  }

  private safeUnsavedCount(): number {
    try {
      return this.sdk.Editing.getUnsavedChangesCount();
    } catch {
      return 0;
    }
  }

  private publish(partial: Partial<ScanSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...partial, unsavedCount: this.safeUnsavedCount() };
    for (const listener of this.listeners) {
      try {
        listener(this.snapshot);
      } catch (err) {
        log.error("Listener failed", err);
      }
    }
  }
}
