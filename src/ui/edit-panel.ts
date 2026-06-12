import type { WmeSDK } from "wme-sdk-typings";
import { applyStreetName, formatFixError } from "../fix";
import { t } from "../i18n";
import { log } from "../log";
import { STATUS_STYLES } from "../map-layer";
import { foldAccents, k1 } from "../matching/normalize";
import type { IndexedEntry } from "../matching/official-index";
import type { Scanner } from "../scan";
import type { SettingsStore } from "../settings";

const CONTAINER_ID = "chk-edit-helper";
const MAX_RESULTS = 20;
/** The WME edit panel renders asynchronously after a selection; retry injection. */
const INJECT_RETRY_DELAYS_MS = [0, 250, 750];
const OK_COLOR = "#4a8f3c";

/**
 * Case/accent-insensitive substring filter over the official names, deduplicated,
 * entries from the given locality first. Pure function, unit-tested.
 */
export function filterEntries(
  entries: readonly IndexedEntry[],
  query: string,
  locality: string | null,
  limit = MAX_RESULTS,
): IndexedEntry[] {
  const q = foldAccents(k1(query));
  const seen = new Set<string>();
  const inLocality: IndexedEntry[] = [];
  const elsewhere: IndexedEntry[] = [];
  for (const entry of entries) {
    if (q !== "" && !foldAccents(k1(entry.namePart)).includes(q)) continue;
    if (seen.has(entry.namePart)) continue;
    seen.add(entry.namePart);
    (locality !== null && entry.locality === locality ? inLocality : elsewhere).push(entry);
  }
  const byName = (a: IndexedEntry, b: IndexedEntry): number =>
    a.namePart.localeCompare(b.namePart);
  inLocality.sort(byName);
  elsewhere.sort(byName);
  return [...inLocality, ...elsewhere].slice(0, limit);
}

/**
 * Companion box injected at the top of the WME segment edit panel: shows how the
 * selected segment's name compares to the register and lets the editor pick an
 * official name directly (search + click to apply).
 */
export class EditPanelHelper {
  private query = "";
  private retryTimers: ReturnType<typeof setTimeout>[] = [];
  private warnedMissingPanel = false;

  constructor(
    private sdk: WmeSDK,
    private scanner: Scanner,
    private settings: SettingsStore,
  ) {}

  init(): void {
    this.sdk.Events.on({ eventName: "wme-selection-changed", eventHandler: () => this.schedule() });
    this.sdk.Events.on({ eventName: "wme-after-edit", eventHandler: () => this.schedule() });
    this.scanner.onUpdate(() => {
      // Refresh the status line after a scan, but never yank the keyboard away.
      const container = document.getElementById(CONTAINER_ID);
      if (container && !container.contains(document.activeElement)) this.schedule();
    });
  }

  private selectedSegmentId(): number | null {
    try {
      const selection = this.sdk.Editing.getSelection();
      if (selection?.objectType === "segment" && selection.ids.length === 1) {
        return selection.ids[0] as number;
      }
    } catch {
      // no selection
    }
    return null;
  }

  private schedule(): void {
    for (const timer of this.retryTimers) clearTimeout(timer);
    this.retryTimers = [];
    const segmentId = this.selectedSegmentId();
    if (!this.settings.get().editPanelHelper || segmentId === null) {
      document.getElementById(CONTAINER_ID)?.remove();
      return;
    }
    for (const delay of INJECT_RETRY_DELAYS_MS) {
      this.retryTimers.push(setTimeout(() => this.inject(segmentId), delay));
    }
  }

  private inject(segmentId: number): void {
    if (this.selectedSegmentId() !== segmentId) return;
    const panel = document.querySelector("#edit-panel");
    if (!panel) {
      if (!this.warnedMissingPanel) {
        this.warnedMissingPanel = true;
        log.warn("#edit-panel not found; the edit-panel helper is unavailable in this WME version");
      }
      return;
    }
    let container = document.getElementById(CONTAINER_ID);
    if (!container) {
      container = document.createElement("div");
      container.id = CONTAINER_ID;
      container.className = "chk-helper";
      panel.prepend(container);
      this.query = "";
    } else if (container.contains(document.activeElement)) {
      return; // editor is typing in the search box; don't rebuild under their fingers
    }
    this.render(container, segmentId);
  }

  private render(container: HTMLElement, segmentId: number): void {
    container.replaceChildren();

    const segment = this.sdk.DataModel.Segments.getById({ segmentId });
    if (!segment) return;
    let cityLocality: string | null = null;
    let currentName: string | null = null;
    try {
      const address = this.sdk.DataModel.Segments.getAddress({ segmentId });
      cityLocality = address.city?.name ? k1(address.city.name) : null;
      currentName = address.street?.name?.trim() || null;
    } catch {
      return;
    }

    const head = document.createElement("div");
    head.className = "chk-helper-head";
    const title = document.createElement("b");
    title.textContent = "CH Names";
    head.appendChild(title);

    const issue = this.scanner.getSnapshot().issues.get(segmentId);
    const dot = document.createElement("span");
    dot.className = "chk-dot";
    const statusText = document.createElement("span");
    if (issue) {
      dot.style.background = STATUS_STYLES[issue.status].strokeColor;
      statusText.textContent = issue.status;
    } else if (currentName) {
      dot.style.background = OK_COLOR;
      statusText.textContent = t("helperOk");
    } else {
      dot.style.background = STATUS_STYLES.UNNAMED.strokeColor;
      statusText.textContent = "UNNAMED";
    }
    head.append(dot, statusText);
    container.appendChild(head);

    if (issue?.suggestion) {
      const sug = document.createElement("div");
      sug.className = "chk-helper-sug";
      const name = document.createElement("b");
      name.textContent = `→ ${issue.suggestion}`;
      const applyBtn = document.createElement("button");
      applyBtn.textContent = t("helperApply");
      applyBtn.addEventListener("click", () => this.apply(segmentId, issue.suggestion as string));
      sug.append(name, applyBtn);
      container.appendChild(sug);
    }

    const index = this.scanner.getOfficialIndex();
    if (!index) {
      const muted = document.createElement("div");
      muted.className = "chk-muted";
      muted.textContent = t("helperNoIndex");
      container.appendChild(muted);
      return;
    }

    const input = document.createElement("input");
    input.type = "search";
    input.placeholder = t("helperSearchPlaceholder");
    input.value = this.query;
    container.appendChild(input);

    const list = document.createElement("div");
    list.className = "chk-helper-list";
    container.appendChild(list);

    const renderList = (): void => {
      list.replaceChildren();
      for (const entry of filterEntries(index.list, this.query, cityLocality)) {
        const row = document.createElement("div");
        row.className = "chk-helper-row";
        const name = document.createElement("span");
        name.textContent = entry.namePart;
        const where = document.createElement("span");
        where.className = "chk-muted";
        where.textContent = entry.street.zipLabel;
        row.append(name, where);
        row.title = entry.street.label;
        row.addEventListener("click", () => this.apply(segmentId, entry.namePart));
        list.appendChild(row);
      }
    };
    input.addEventListener("input", () => {
      this.query = input.value;
      renderList();
    });
    renderList();
  }

  private apply(segmentId: number, streetName: string): void {
    const outcome = applyStreetName(this.sdk, segmentId, streetName, {
      keepOldAsAlt: this.settings.get().keepOldNameAsAlt,
    });
    if (!outcome.ok) {
      alert(t("fixFailed", { error: formatFixError(outcome) }));
      return;
    }
    this.scanner.reevaluate();
    this.schedule();
  }
}
