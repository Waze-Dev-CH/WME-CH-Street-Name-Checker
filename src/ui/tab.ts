import type { WmeSDK } from "wme-sdk-typings";
import {
  fixGroup,
  fixSegment,
  formatFixError,
  GROUP_FIX_CAP,
  GROUP_FIX_CONFIRM_THRESHOLD,
  withFixLock,
} from "../fix";
import { LANGUAGE_CHOICES, resolveLocale, setLocale, t, type LanguagePreference, type StringKey } from "../i18n";
import { STATUS_STYLES } from "../map-layer";
import type { Issue, IssueNote, IssueStatus } from "../matching/evaluate";
import type { ScanSnapshot, Scanner } from "../scan";
import { ALL_STATUSES, ROAD_TYPE_OPTIONS, type CityScoping, type Settings, type SettingsStore } from "../settings";
import { injectStyles } from "./styles";

// Road type names stay in English on purpose: they are the WME community's
// shared vocabulary and Waze's own localized terms vary by UI version.
const ROAD_TYPE_LABELS = new Map(ROAD_TYPE_OPTIONS.map((r) => [r.id, r.label]));

export const LEGEND_KEYS: Record<IssueStatus, StringKey> = {
  COSMETIC: "legendCOSMETIC",
  VARIANT: "legendVARIANT",
  NEAR: "legendNEAR",
  WRONG_TYPE: "legendWRONG_TYPE",
  WRONG_STREET: "legendWRONG_STREET",
  WRONG_CITY: "legendWRONG_CITY",
  NOT_FOUND: "legendNOT_FOUND",
  UNNAMED: "legendUNNAMED",
  MICRO_SEGMENT: "legendMICRO_SEGMENT",
  LOOP: "legendLOOP",
  NARROW_MISUSE: "legendNARROW_MISUSE",
};

export const STATE_KEYS: Record<ScanSnapshot["state"], StringKey> = {
  idle: "stateIdle",
  disabled: "stateDisabled",
  "zoom-gated": "stateZoomGated",
  "area-gated": "stateAreaGated",
  fetching: "stateFetching",
  evaluating: "stateEvaluating",
  done: "stateDone",
  paused: "statePaused",
  error: "stateError",
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

export function formatNote(note: IssueNote | null): string {
  if (!note) return "";
  const parts: string[] = [];
  if (note.unofficial) parts.push(t("noteUnofficial"));
  if (note.planned) parts.push(t("notePlanned"));
  if (note.fullLabel) parts.push(t("noteFullLabel", { label: note.fullLabel }));
  if (note.existsIn) parts.push(t("noteExistsIn", { place: note.existsIn }));
  return parts.join(", ");
}

export interface IssueGroup {
  key: string;
  status: IssueStatus;
  currentName: string | null;
  suggestion: string | null;
  note: IssueNote | null;
  fixable: boolean;
  issues: Issue[];
}

/** Display order: safe fixes first, then risky ones, unnamed and guideline checks last. */
const SEVERITY_ORDER: Record<IssueStatus, number> = {
  COSMETIC: 0,
  VARIANT: 1,
  NEAR: 2,
  WRONG_TYPE: 3,
  WRONG_STREET: 4,
  WRONG_CITY: 5,
  NOT_FOUND: 6,
  UNNAMED: 7,
  MICRO_SEGMENT: 8,
  LOOP: 9,
  NARROW_MISUSE: 10,
};

export function groupIssues(issues: Iterable<Issue>): IssueGroup[] {
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
        note: issue.note,
        fixable: issue.fixable,
        issues: [],
      };
      groups.set(key, group);
    }
    group.issues.push(issue);
  }
  return [...groups.values()].sort(
    (a, b) => SEVERITY_ORDER[a.status] - SEVERITY_ORDER[b.status] || b.issues.length - a.issues.length,
  );
}

export class TabUI {
  private pane!: HTMLElement;
  private statusLine!: HTMLElement;
  private unsavedBadge!: HTMLElement;
  private chipsBox!: HTMLElement;
  private groupsBox!: HTMLElement;
  private activeFilters = new Set<IssueStatus>();
  private expandedGroups = new Set<string>();
  /** Last issues map rendered into chips/groups, to skip redundant DOM rebuilds. */
  private lastRenderedIssues: ReadonlyMap<number, Issue> | null = null;
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

  /** Rebuild all static DOM (after a language change). */
  private rebuild(): void {
    this.pane.replaceChildren();
    this.buildSkeleton();
    this.lastRenderedIssues = null;
    this.render(this.scanner.getSnapshot());
  }

  private buildSkeleton(): void {
    this.pane.classList.add("chk-pane");

    const header = el("div", "chk-header");
    this.statusLine = el("span", "chk-status-line", t("stateIdle"));
    this.unsavedBadge = el("span", "chk-unsaved", "");
    const rescanBtn = el("button", "", t("rescan"));
    rescanBtn.title = t("rescanTitle");
    rescanBtn.addEventListener("click", () => this.scanner.rescan());
    const nextBtn = el("button", "", t("nextIssue"));
    nextBtn.title = t("nextIssueTitle");
    nextBtn.addEventListener("click", () => this.selectNextIssue());
    header.append(this.statusLine, this.unsavedBadge, rescanBtn, nextBtn);

    this.chipsBox = el("div", "chk-chips");
    this.groupsBox = el("div", "chk-groups");

    this.pane.append(
      header,
      this.buildMasterToggles(),
      this.chipsBox,
      this.groupsBox,
      this.buildLegend(),
      this.buildSettings(),
      this.buildFooter(),
    );
  }

  private buildMasterToggles(): HTMLElement {
    const row = el("div", "chk-settings chk-master");
    const settings = this.settings.get();

    const enabledLabel = el("label");
    enabledLabel.title = t("toggleEnabledTitle");
    const enabledCb = el("input") as HTMLInputElement;
    enabledCb.type = "checkbox";
    enabledCb.checked = settings.enabled;
    enabledCb.addEventListener("change", () => {
      this.settings.update({ enabled: enabledCb.checked });
      if (enabledCb.checked) this.scanner.requestScan();
      else this.scanner.disable();
    });
    enabledLabel.append(enabledCb, t("toggleEnabled"));

    const autoLabel = el("label");
    autoLabel.title = t("toggleAutoScanTitle");
    const autoCb = el("input") as HTMLInputElement;
    autoCb.type = "checkbox";
    autoCb.checked = settings.autoScan;
    autoCb.addEventListener("change", () => {
      this.settings.update({ autoScan: autoCb.checked });
      if (autoCb.checked && this.settings.get().enabled) this.scanner.requestScan();
    });
    autoLabel.append(autoCb, t("toggleAutoScan"));

    row.append(enabledLabel, autoLabel);
    return row;
  }

  private buildFooter(): HTMLElement {
    const footer = el("div", "chk-footer");
    footer.appendChild(el("span", "chk-muted", `v${__SCRIPT_VERSION__} · `));
    const link = el("a", "", "Changelog");
    link.href = "https://github.com/Neprena/WME-CH-Street-Name-Checker/blob/main/CHANGELOG.md";
    link.target = "_blank";
    link.rel = "noopener";
    footer.appendChild(link);
    return footer;
  }

  private buildLegend(): HTMLElement {
    const details = el("details", "chk-settings");
    details.appendChild(el("summary", "", t("legendTitle")));
    for (const status of Object.keys(STATUS_STYLES) as IssueStatus[]) {
      const row = el("div", "chk-settings-row");
      const dot = el("span", "chk-dot");
      dot.style.background = STATUS_STYLES[status].strokeColor;
      row.append(dot, el("span", "", `${status}: ${t(LEGEND_KEYS[status])}`));
      details.appendChild(row);
    }
    return details;
  }

  private render(snapshot: ScanSnapshot, force = false): void {
    const { state, issues, stats, officialStreetCount, progress, error } = snapshot;

    let statusText = t(STATE_KEYS[state]);
    if (state === "fetching" && progress) statusText += ` ${progress.done}/${progress.total}`;
    if (state === "done") {
      statusText = t("stateDone", {
        issues: issues.size,
        ok: stats.ok + stats.okAlt,
        streets: officialStreetCount,
      });
    }
    if (state === "error" && error) statusText += `: ${error}`;
    this.statusLine.textContent = statusText;
    this.statusLine.classList.toggle("chk-error", state === "error");

    this.unsavedBadge.textContent =
      snapshot.unsavedCount > 0 ? t("unsavedBadge", { n: snapshot.unsavedCount }) : "";

    // Progress ticks reuse the same issues map: only the status line above
    // changes, skip the expensive chips/groups DOM rebuild.
    if (!force && issues === this.lastRenderedIssues) return;
    this.lastRenderedIssues = issues;

    const visible = this.visibleIssues(issues);
    const groups = groupIssues(visible);
    // "next issue" follows the displayed order (severity, then volume)
    this.orderedIssueIds = groups.flatMap((g) => g.issues.map((i) => i.segmentId));
    this.renderChips(issues);
    this.renderGroups(groups, visible.length, state);
  }

  private visibleIssues(issues: ReadonlyMap<number, Issue>): Issue[] {
    return [...issues.values()].filter(
      (issue) => this.activeFilters.size === 0 || this.activeFilters.has(issue.status),
    );
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
      chip.title = t("filterChipTitle");
      chip.addEventListener("click", () => {
        if (this.activeFilters.has(status)) this.activeFilters.delete(status);
        else this.activeFilters.add(status);
        this.render(this.scanner.getSnapshot(), true);
      });
      this.chipsBox.appendChild(chip);
    }
  }

  private renderGroups(
    groups: IssueGroup[],
    visibleCount: number,
    state: ScanSnapshot["state"],
  ): void {
    this.groupsBox.replaceChildren();
    if (visibleCount === 0) {
      if (state === "done") {
        this.groupsBox.appendChild(el("div", "chk-empty", t("allMatch")));
      } else if (state === "zoom-gated" || state === "area-gated") {
        this.groupsBox.appendChild(el("div", "chk-muted", t(STATE_KEYS[state])));
      }
      return;
    }
    for (const group of groups) {
      this.groupsBox.appendChild(this.renderGroup(group));
    }
  }

  private renderGroup(group: IssueGroup): HTMLElement {
    const box = el("div", "chk-group");
    const header = el("div", "chk-group-header");
    const badge = el("span", `chk-badge chk-badge-${group.status}`);
    badge.title = group.status;

    const noteText = formatNote(group.note);
    const names = el("span", "chk-group-names");
    names.appendChild(el("span", "", group.currentName ?? t("unnamed")));
    if (group.suggestion && group.suggestion !== group.currentName) {
      names.appendChild(el("span", "chk-arrow", "  →  "));
      names.appendChild(el("span", "chk-suggestion", group.suggestion));
    }
    if (noteText) {
      names.appendChild(el("span", "chk-note", ` (${noteText})`));
    }
    names.title = `${group.status}${noteText ? ` · ${noteText}` : ""}`;

    const count = el("span", "chk-count", `×${group.issues.length}`);
    header.append(badge, names, count);

    if (group.fixable && group.issues.length > 1) {
      const fixAllBtn = el(
        "button",
        "chk-fix-all",
        t("fixAll", { n: Math.min(group.issues.length, GROUP_FIX_CAP) }),
      );
      fixAllBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        this.onFixGroup(group, fixAllBtn);
      });
      header.appendChild(fixAllBtn);
    }

    header.addEventListener("click", () => {
      const expanding = !this.expandedGroups.has(group.key);
      if (expanding) {
        this.expandedGroups.add(group.key);
        this.zoomToGroup(group);
      } else {
        this.expandedGroups.delete(group.key);
      }
      this.render(this.scanner.getSnapshot(), true);
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
    const locateBtn = el("button", "chk-locate", "⌖");
    locateBtn.title = t("locateTitle");
    locateBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      this.locateSegment(issue);
    });
    row.appendChild(locateBtn);
    if (issue.fixable) {
      const fixBtn = el("button", "chk-fix-all", t("fix"));
      fixBtn.title = t("fixTitle", { name: issue.suggestion ?? "" });
      fixBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        this.onFixOne(issue, fixBtn);
      });
      row.appendChild(fixBtn);
    }
    row.addEventListener("click", () => this.selectSegment(issue.segmentId));
    return row;
  }

  /** Fit the map to every segment of the group, with padding for context. */
  private zoomToGroup(group: IssueGroup): void {
    let minLon = Infinity;
    let minLat = Infinity;
    let maxLon = -Infinity;
    let maxLat = -Infinity;
    for (const issue of group.issues) {
      for (const point of issue.geometry.coordinates) {
        const lon = point[0] as number;
        const lat = point[1] as number;
        minLon = Math.min(minLon, lon);
        minLat = Math.min(minLat, lat);
        maxLon = Math.max(maxLon, lon);
        maxLat = Math.max(maxLat, lat);
      }
    }
    if (!Number.isFinite(minLon)) return;
    // 30% padding, with a floor so a single short segment keeps street-level context
    const padLon = Math.max((maxLon - minLon) * 0.3, 0.001);
    const padLat = Math.max((maxLat - minLat) * 0.3, 0.0007);
    try {
      this.sdk.Map.zoomToExtent({
        bbox: [minLon - padLon, minLat - padLat, maxLon + padLon, maxLat + padLat],
      });
    } catch {
      // extent issue: ignore, the rows' locate buttons still work
    }
  }

  private locateSegment(issue: Issue): void {
    try {
      this.sdk.Map.centerMapOnGeometry({ geometry: issue.geometry });
    } catch {
      // geometry may be stale; selection below still works if the segment is loaded
    }
    this.selectSegment(issue.segmentId);
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

  selectNextIssue(): void {
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

  private onFixOne(issue: Issue, button?: HTMLButtonElement): void {
    void withFixLock(async () => {
      if (button) {
        button.disabled = true;
        button.textContent = "…";
      }
      const outcome = fixSegment(this.sdk, issue, this.settings.get());
      if (!outcome.ok) {
        alert(t("fixFailed", { error: formatFixError(outcome) }));
      }
      return outcome;
    }).then((result) => {
      // null = another fix was already running; its own completion will re-render
      if (result !== null) this.scanner.reevaluate();
    });
  }

  private onFixGroup(group: IssueGroup, button?: HTMLButtonElement): void {
    const n = Math.min(group.issues.length, GROUP_FIX_CAP);
    if (
      n > GROUP_FIX_CONFIRM_THRESHOLD &&
      !confirm(t("confirmGroupFix", { name: group.suggestion ?? "", n }))
    ) {
      return;
    }
    void withFixLock(async () => {
      if (button) button.disabled = true;
      const outcomes = await fixGroup(this.sdk, group.issues, this.settings.get(), (done, total) => {
        if (button) button.textContent = `${done}/${total}…`;
      });
      const failed = outcomes.find((o) => !o.ok);
      if (failed) {
        alert(
          t("fixStopped", {
            done: outcomes.filter((o) => o.ok).length,
            total: n,
            error: formatFixError(failed),
            id: failed.segmentId,
          }),
        );
      }
      return outcomes;
    }).then((result) => {
      if (result !== null) this.scanner.reevaluate();
    });
  }

  private buildSettings(): HTMLElement {
    const details = el("details", "chk-settings");
    details.appendChild(el("summary", "", t("settingsTitle")));
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
    details.appendChild(el("div", "", t("roadTypesLabel")));
    details.appendChild(grid);

    const statusGrid = el("div", "chk-settings-grid");
    for (const status of ALL_STATUSES) {
      const label = el("label");
      label.title = t(LEGEND_KEYS[status]);
      const cb = el("input") as HTMLInputElement;
      cb.type = "checkbox";
      cb.checked = settings.enabledStatuses.includes(status);
      cb.addEventListener("change", () => {
        const current = new Set(this.settings.get().enabledStatuses);
        if (cb.checked) current.add(status);
        else current.delete(status);
        this.settings.update({ enabledStatuses: ALL_STATUSES.filter((s) => current.has(s)) });
        this.scanner.reevaluate();
      });
      const dot = el("span", "chk-dot");
      dot.style.background = STATUS_STYLES[status].strokeColor;
      label.append(cb, dot, status);
      statusGrid.appendChild(label);
    }
    details.appendChild(el("div", "", t("statusesLabel")));
    details.appendChild(statusGrid);

    const toggle = (
      textKey: StringKey,
      key: keyof Pick<
        Settings,
        | "altNameCountsAsOk"
        | "showMapLabels"
        | "keepOldNameAsAlt"
        | "guidelineChecks"
        | "editPanelHelper"
        | "geometryMatching"
      >,
      titleKey?: StringKey,
    ): HTMLElement => {
      const label = el("label");
      if (titleKey) label.title = t(titleKey);
      const cb = el("input") as HTMLInputElement;
      cb.type = "checkbox";
      cb.checked = settings[key];
      cb.addEventListener("change", () => apply({ [key]: cb.checked }));
      label.append(cb, t(textKey));
      const row = el("div", "chk-settings-row");
      row.appendChild(label);
      return row;
    };

    details.appendChild(toggle("altOk", "altNameCountsAsOk", "altOkTitle"));
    details.appendChild(toggle("showMapLabels", "showMapLabels"));
    details.appendChild(toggle("keepOldName", "keepOldNameAsAlt", "keepOldNameTitle"));
    details.appendChild(toggle("guidelineChecks", "guidelineChecks", "guidelineChecksTitle"));
    details.appendChild(toggle("helperSetting", "editPanelHelper"));
    details.appendChild(toggle("geometryMatching", "geometryMatching", "geometryMatchingTitle"));

    const scopingRow = el("div", "chk-settings-row");
    scopingRow.appendChild(el("span", "", t("scopingLabel")));
    const select = el("select") as HTMLSelectElement;
    const scopingLabels: Record<CityScoping, string> = {
      off: t("scopingOff"),
      warn: t("scopingWarn"),
      strict: t("scopingStrict"),
    };
    for (const value of ["off", "warn", "strict"] as CityScoping[]) {
      const opt = el("option", "", scopingLabels[value]) as HTMLOptionElement;
      opt.value = value;
      select.appendChild(opt);
    }
    select.value = settings.cityScoping;
    select.title = t("scopingTitle");
    select.addEventListener("change", () => apply({ cityScoping: select.value as CityScoping }));
    scopingRow.appendChild(select);
    details.appendChild(scopingRow);

    const zoomRow = el("div", "chk-settings-row");
    zoomRow.appendChild(el("span", "", t("minZoomLabel")));
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

    const langRow = el("div", "chk-settings-row");
    langRow.appendChild(el("span", "", t("languageLabel")));
    const langSelect = el("select") as HTMLSelectElement;
    for (const choice of LANGUAGE_CHOICES) {
      const opt = el(
        "option",
        "",
        choice.value === "auto" ? t("languageAuto") : choice.label,
      ) as HTMLOptionElement;
      opt.value = choice.value;
      langSelect.appendChild(opt);
    }
    langSelect.value = settings.language;
    langSelect.addEventListener("change", () => {
      const language = langSelect.value as LanguagePreference;
      this.settings.update({ language });
      setLocale(resolveLocale(language, this.sdk.Settings.getLocale().localeCode));
      this.rebuild();
    });
    langRow.appendChild(langSelect);
    details.appendChild(langRow);

    return details;
  }
}
