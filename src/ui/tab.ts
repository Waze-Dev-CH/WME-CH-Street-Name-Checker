import type { WmeSDK } from "wme-sdk-typings";
import { fixGroup, fixSegment, GROUP_FIX_CAP, GROUP_FIX_CONFIRM_THRESHOLD } from "../fix";
import { STATUS_STYLES } from "../map-layer";
import type { Issue, IssueStatus } from "../matching/evaluate";
import type { ScanSnapshot, Scanner } from "../scan";
import { ROAD_TYPE_OPTIONS, type CityScoping, type Settings, type SettingsStore } from "../settings";
import { injectStyles } from "./styles";

const ROAD_TYPE_LABELS = new Map(ROAD_TYPE_OPTIONS.map((r) => [r.id, r.label]));

const STATUS_LEGEND: Record<IssueStatus, string> = {
  COSMETIC: "typography only (case, apostrophe, spacing) — dashed line",
  VARIANT: "abbreviation or missing accent; official spelling suggested",
  NEAR: "probable typo; one close official name found",
  WRONG_CITY: "name exists, but in another locality (city scoping)",
  NOT_FOUND: "not found in the official register",
  UNNAMED: "checked road type without a street name — dashed line",
};

const STATE_TEXT: Record<ScanSnapshot["state"], string> = {
  idle: "Idle",
  "zoom-gated": "Zoom in to scan",
  "area-gated": "View too large to scan",
  fetching: "Fetching official register…",
  evaluating: "Comparing names…",
  done: "Scan done",
  paused: "Paused (layer unchecked)",
  error: "Scan failed",
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

interface IssueGroup {
  key: string;
  status: IssueStatus;
  currentName: string | null;
  suggestion: string | null;
  suggestionNote: string | null;
  fixable: boolean;
  issues: Issue[];
}

function groupIssues(issues: Iterable<Issue>): IssueGroup[] {
  const groups = new Map<string, IssueGroup>();
  for (const issue of issues) {
    const key = `${issue.status}|${issue.currentName ?? ""}|${issue.suggestion ?? ""}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        status: issue.status,
        currentName: issue.currentName,
        suggestion: issue.suggestion,
        suggestionNote: issue.suggestionNote,
        fixable: issue.fixable,
        issues: [],
      };
      groups.set(key, group);
    }
    group.issues.push(issue);
  }
  return [...groups.values()].sort((a, b) => b.issues.length - a.issues.length);
}

export class TabUI {
  private pane!: HTMLElement;
  private statusLine!: HTMLElement;
  private unsavedBadge!: HTMLElement;
  private chipsBox!: HTMLElement;
  private groupsBox!: HTMLElement;
  private activeFilters = new Set<IssueStatus>();
  private expandedGroups = new Set<string>();
  private selectedSegmentIds = new Set<number>();
  private orderedIssueIds: number[] = [];
  private nextIssuePointer = -1;

  constructor(
    private sdk: WmeSDK,
    private scanner: Scanner,
    private settings: SettingsStore,
  ) {}

  async init(): Promise<void> {
    injectStyles();
    const { tabLabel, tabPane } = await this.sdk.Sidebar.registerScriptTab();
    tabLabel.textContent = "CH Names";
    this.pane = tabPane;
    this.buildSkeleton();
    this.scanner.onUpdate((snapshot) => this.render(snapshot));
    this.sdk.Events.on({
      eventName: "wme-selection-changed",
      eventHandler: () => this.syncSelection(),
    });
    this.render(this.scanner.getSnapshot());
  }

  private buildSkeleton(): void {
    this.pane.classList.add("chk-pane");

    const header = el("div", "chk-header");
    this.statusLine = el("span", "chk-status-line", "Idle");
    this.unsavedBadge = el("span", "chk-unsaved", "");
    const rescanBtn = el("button", "", "Rescan");
    rescanBtn.title = "Clear the cache and fetch the official register again";
    rescanBtn.addEventListener("click", () => this.scanner.rescan());
    const nextBtn = el("button", "", "Next issue");
    nextBtn.title = "Select the next mismatching segment";
    nextBtn.addEventListener("click", () => this.selectNextIssue());
    header.append(this.statusLine, this.unsavedBadge, rescanBtn, nextBtn);

    this.chipsBox = el("div", "chk-chips");
    this.groupsBox = el("div", "chk-groups");

    this.pane.append(header, this.chipsBox, this.groupsBox, this.buildLegend(), this.buildSettings());
  }

  private buildLegend(): HTMLElement {
    const details = el("details", "chk-settings");
    details.appendChild(el("summary", "", "Legend"));
    for (const status of Object.keys(STATUS_STYLES) as IssueStatus[]) {
      const row = el("div", "chk-settings-row");
      const dot = el("span", "chk-dot");
      dot.style.background = STATUS_STYLES[status].strokeColor;
      row.append(dot, el("span", "", `${status}: ${STATUS_LEGEND[status]}`));
      details.appendChild(row);
    }
    return details;
  }

  private render(snapshot: ScanSnapshot): void {
    const { state, issues, stats, officialStreetCount, progress, error } = snapshot;

    let statusText = STATE_TEXT[state];
    if (state === "fetching" && progress) statusText += ` ${progress.done}/${progress.total}`;
    if (state === "done") {
      statusText = `${issues.size} issue${issues.size === 1 ? "" : "s"} · ${stats.ok + stats.okAlt} OK · ${officialStreetCount} official streets`;
    }
    if (state === "error" && error) statusText += `: ${error}`;
    this.statusLine.textContent = statusText;
    this.statusLine.classList.toggle("chk-error", state === "error");

    this.unsavedBadge.textContent =
      snapshot.unsavedCount > 0 ? `${snapshot.unsavedCount} unsaved` : "";

    const visible = this.visibleIssues(issues);
    this.orderedIssueIds = visible.map((i) => i.segmentId);
    this.renderChips(issues);
    this.renderGroups(visible, state);
  }

  private visibleIssues(issues: ReadonlyMap<number, Issue>): Issue[] {
    const settings = this.settings.get();
    return [...issues.values()].filter((issue) => {
      if (!settings.showCosmetic && issue.status === "COSMETIC") return false;
      return this.activeFilters.size === 0 || this.activeFilters.has(issue.status);
    });
  }

  private renderChips(issues: ReadonlyMap<number, Issue>): void {
    this.chipsBox.replaceChildren();
    const counts = new Map<IssueStatus, number>();
    for (const issue of issues.values()) {
      counts.set(issue.status, (counts.get(issue.status) ?? 0) + 1);
    }
    for (const status of Object.keys(STATUS_STYLES) as IssueStatus[]) {
      const count = counts.get(status) ?? 0;
      if (count === 0) continue;
      const chip = el("button", "chk-chip");
      chip.classList.toggle("chk-chip-active", this.activeFilters.has(status));
      const dot = el("span", "chk-dot");
      dot.style.background = STATUS_STYLES[status].strokeColor;
      chip.append(dot, `${status} ${count}`);
      chip.title = "Filter the list by this status";
      chip.addEventListener("click", () => {
        if (this.activeFilters.has(status)) this.activeFilters.delete(status);
        else this.activeFilters.add(status);
        this.render(this.scanner.getSnapshot());
      });
      this.chipsBox.appendChild(chip);
    }
  }

  private renderGroups(visible: Issue[], state: ScanSnapshot["state"]): void {
    this.groupsBox.replaceChildren();
    if (visible.length === 0) {
      if (state === "done") {
        this.groupsBox.appendChild(el("div", "chk-empty", "All street names match ✓"));
      } else if (state === "zoom-gated" || state === "area-gated") {
        this.groupsBox.appendChild(el("div", "chk-muted", STATE_TEXT[state]));
      }
      return;
    }
    for (const group of groupIssues(visible)) {
      this.groupsBox.appendChild(this.renderGroup(group));
    }
  }

  private renderGroup(group: IssueGroup): HTMLElement {
    const box = el("div", "chk-group");
    const header = el("div", "chk-group-header");
    const badge = el("span", `chk-badge chk-badge-${group.status}`);
    badge.title = group.status;

    const names = el("span", "chk-group-names");
    names.appendChild(el("span", "", group.currentName ?? "(unnamed)"));
    if (group.suggestion && group.suggestion !== group.currentName) {
      names.appendChild(el("span", "chk-arrow", "  →  "));
      names.appendChild(el("span", "chk-suggestion", group.suggestion));
    }
    if (group.suggestionNote) {
      names.appendChild(el("span", "chk-note", ` (${group.suggestionNote})`));
    }
    names.title = `${group.status}${group.suggestionNote ? ` — ${group.suggestionNote}` : ""}`;

    const count = el("span", "chk-count", `×${group.issues.length}`);
    header.append(badge, names, count);

    if (group.fixable && group.issues.length > 1) {
      const fixAllBtn = el(
        "button",
        "chk-fix-all",
        `Fix all (${Math.min(group.issues.length, GROUP_FIX_CAP)})`,
      );
      fixAllBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        this.onFixGroup(group);
      });
      header.appendChild(fixAllBtn);
    }

    header.addEventListener("click", () => {
      if (this.expandedGroups.has(group.key)) this.expandedGroups.delete(group.key);
      else this.expandedGroups.add(group.key);
      this.render(this.scanner.getSnapshot());
    });
    box.appendChild(header);

    if (this.expandedGroups.has(group.key) || group.issues.length === 1) {
      const rows = el("div", "chk-rows");
      for (const issue of group.issues) {
        rows.appendChild(this.renderRow(issue));
      }
      box.appendChild(rows);
    }
    return box;
  }

  private renderRow(issue: Issue): HTMLElement {
    const row = el("div", "chk-row");
    row.dataset["segmentId"] = String(issue.segmentId);
    row.classList.toggle("chk-selected", this.selectedSegmentIds.has(issue.segmentId));
    const meta = el(
      "span",
      "chk-row-meta",
      `${ROAD_TYPE_LABELS.get(issue.roadType) ?? `type ${issue.roadType}`} · ${Math.round(issue.length)} m${issue.cityName ? ` · ${issue.cityName}` : ""}`,
    );
    row.appendChild(meta);
    if (issue.fixable) {
      const fixBtn = el("button", "chk-fix-all", "Fix");
      fixBtn.title = `Apply "${issue.suggestion}"`;
      fixBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        this.onFixOne(issue);
      });
      row.appendChild(fixBtn);
    }
    row.addEventListener("click", () => this.selectSegment(issue.segmentId));
    return row;
  }

  private selectSegment(segmentId: number): void {
    try {
      this.sdk.Editing.setSelection({
        selection: { ids: [segmentId], objectType: "segment" },
      });
    } catch {
      // segment may have been unloaded since the scan; next scan will refresh the list
    }
  }

  private selectNextIssue(): void {
    if (this.orderedIssueIds.length === 0) return;
    this.nextIssuePointer = (this.nextIssuePointer + 1) % this.orderedIssueIds.length;
    const segmentId = this.orderedIssueIds[this.nextIssuePointer];
    if (segmentId !== undefined) this.selectSegment(segmentId);
  }

  private syncSelection(): void {
    this.selectedSegmentIds.clear();
    const selection = this.sdk.Editing.getSelection();
    if (selection?.objectType === "segment") {
      for (const id of selection.ids) this.selectedSegmentIds.add(id as number);
    }
    let first: HTMLElement | null = null;
    this.groupsBox.querySelectorAll<HTMLElement>(".chk-row").forEach((row) => {
      const id = Number(row.dataset["segmentId"]);
      const selected = this.selectedSegmentIds.has(id);
      row.classList.toggle("chk-selected", selected);
      if (selected && !first) first = row;
    });
    (first as HTMLElement | null)?.scrollIntoView({ block: "nearest" });
  }

  private onFixOne(issue: Issue): void {
    const outcome = fixSegment(this.sdk, issue, this.settings.get());
    if (!outcome.ok) {
      alert(`Fix failed: ${outcome.error}`);
      return;
    }
    this.scanner.reevaluate();
  }

  private onFixGroup(group: IssueGroup): void {
    const n = Math.min(group.issues.length, GROUP_FIX_CAP);
    if (
      n > GROUP_FIX_CONFIRM_THRESHOLD &&
      !confirm(
        `Apply "${group.suggestion}" to ${n} segments?\nNothing is saved automatically; review and save in WME.`,
      )
    ) {
      return;
    }
    const outcomes = fixGroup(this.sdk, group.issues, this.settings.get());
    const failed = outcomes.find((o) => !o.ok);
    if (failed) {
      alert(
        `Fixed ${outcomes.filter((o) => o.ok).length}/${n}, then stopped: ${failed.error} (segment ${failed.segmentId})`,
      );
    }
    this.scanner.reevaluate();
  }

  private buildSettings(): HTMLElement {
    const details = el("details", "chk-settings");
    details.appendChild(el("summary", "", "Settings"));
    const settings = this.settings.get();

    const apply = (partial: Partial<Settings>, rescan = false): void => {
      this.settings.update(partial);
      if (rescan) this.scanner.requestScan();
      else this.scanner.reevaluate();
    };

    const grid = el("div", "chk-settings-grid");
    for (const option of ROAD_TYPE_OPTIONS) {
      const label = el("label");
      const cb = el("input") as HTMLInputElement;
      cb.type = "checkbox";
      cb.checked = settings.checkedRoadTypes.includes(option.id);
      cb.addEventListener("change", () => {
        const current = new Set(this.settings.get().checkedRoadTypes);
        if (cb.checked) current.add(option.id);
        else current.delete(option.id);
        apply({ checkedRoadTypes: [...current] });
      });
      label.append(cb, option.label);
      grid.appendChild(label);
    }
    details.appendChild(el("div", "", "Checked road types:"));
    details.appendChild(grid);

    const toggle = (
      text: string,
      key: keyof Pick<
        Settings,
        "altNameCountsAsOk" | "showCosmetic" | "showMapLabels" | "keepOldNameAsAlt"
      >,
      title?: string,
    ): HTMLElement => {
      const label = el("label");
      if (title) label.title = title;
      const cb = el("input") as HTMLInputElement;
      cb.type = "checkbox";
      cb.checked = settings[key];
      cb.addEventListener("change", () => apply({ [key]: cb.checked }));
      label.append(cb, text);
      const row = el("div", "chk-settings-row");
      row.appendChild(label);
      return row;
    };

    details.appendChild(
      toggle(
        "Alternate name match counts as OK",
        "altNameCountsAsOk",
        "Useful in bilingual communes where the second language is an alternate name",
      ),
    );
    details.appendChild(toggle("Show cosmetic differences", "showCosmetic"));
    details.appendChild(toggle("Show expected name on the map (zoom ≥ 17)", "showMapLabels"));
    details.appendChild(
      toggle(
        "Keep old name as alternate when fixing",
        "keepOldNameAsAlt",
        "Never applied to typo (NEAR) fixes",
      ),
    );

    const scopingRow = el("div", "chk-settings-row");
    scopingRow.appendChild(el("span", "", "City scoping:"));
    const select = el("select") as HTMLSelectElement;
    for (const value of ["off", "warn", "strict"] as CityScoping[]) {
      const opt = el("option", "", value) as HTMLOptionElement;
      opt.value = value;
      select.appendChild(opt);
    }
    select.value = settings.cityScoping;
    select.title = "Compare the segment's city with the official locality (zip_label)";
    select.addEventListener("change", () =>
      apply({ cityScoping: select.value as CityScoping }),
    );
    scopingRow.appendChild(select);
    details.appendChild(scopingRow);

    const zoomRow = el("div", "chk-settings-row");
    zoomRow.appendChild(el("span", "", "Min zoom to scan:"));
    const zoomInput = el("input") as HTMLInputElement;
    zoomInput.type = "number";
    zoomInput.min = "12";
    zoomInput.max = "22";
    zoomInput.value = String(settings.minZoom);
    zoomInput.addEventListener("change", () => {
      const v = Number(zoomInput.value);
      if (Number.isFinite(v) && v >= 12 && v <= 22) apply({ minZoom: v }, true);
    });
    zoomRow.appendChild(zoomInput);
    details.appendChild(zoomRow);

    return details;
  }
}
