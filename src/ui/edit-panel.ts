import type { WmeSDK } from "wme-sdk-typings";
import { fixGroup, fixSegment, formatFixError, GROUP_FIX_CAP, GROUP_FIX_CONFIRM_THRESHOLD } from "../fix";
import { t } from "../i18n";
import { log } from "../log";
import { STATUS_STYLES } from "../map-layer";
import type { Issue } from "../matching/evaluate";
import type { Scanner } from "../scan";
import type { SettingsStore } from "../settings";
import { formatNote, LEGEND_KEYS, STATE_KEYS } from "./tab";

const CONTAINER_ID = "chk-edit-helper";
/** The WME edit panel renders asynchronously after a selection; retry injection. */
const INJECT_RETRY_DELAYS_MS = [0, 250, 750];
const OK_COLOR = "#4a8f3c";

/** All issues sharing the reference issue's group (same status, name and suggestion). */
export function issuesInSameGroup(issues: ReadonlyMap<number, Issue>, ref: Issue): Issue[] {
  const key = (i: Issue): string => `${i.status}|${i.currentName ?? ""}|${i.suggestion ?? ""}`;
  const refKey = key(ref);
  return [...issues.values()].filter((i) => key(i) === refKey);
}

/**
 * Compact companion box at the top of the WME segment edit panel: shows the
 * scan verdict for the selected segment and offers Fix / Fix all shortcuts.
 * No search UI by design (removed in 0.4.1 after field feedback).
 */
export class EditPanelBox {
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
      if (document.getElementById(CONTAINER_ID)) this.schedule();
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
        log.warn("#edit-panel not found; the edit-panel box is unavailable in this WME version");
      }
      return;
    }
    let container = document.getElementById(CONTAINER_ID);
    if (!container) {
      container = document.createElement("div");
      container.id = CONTAINER_ID;
      container.className = "chk-helper";
      panel.prepend(container);
    }
    this.render(container, segmentId);
  }

  private render(container: HTMLElement, segmentId: number): void {
    container.replaceChildren();
    const snapshot = this.scanner.getSnapshot();
    const issue = snapshot.issues.get(segmentId);

    const head = document.createElement("div");
    head.className = "chk-helper-head";
    const title = document.createElement("b");
    title.textContent = "CH Names";
    const dot = document.createElement("span");
    dot.className = "chk-dot";
    const statusText = document.createElement("span");
    head.append(title, dot, statusText);
    container.appendChild(head);

    if (!issue) {
      if (snapshot.state !== "done") {
        dot.style.background = "#bbb";
        statusText.textContent = t(STATE_KEYS[snapshot.state]);
        statusText.className = "chk-muted";
      } else if (this.isCheckedAndNamed(segmentId)) {
        dot.style.background = OK_COLOR;
        statusText.textContent = t("helperOk");
      } else {
        container.remove(); // nothing meaningful to say (skipped type, uncovered area)
      }
      return;
    }

    dot.style.background = STATUS_STYLES[issue.status].strokeColor;
    statusText.textContent = issue.status;

    const detail = document.createElement("div");
    detail.className = "chk-muted";
    detail.textContent = t(LEGEND_KEYS[issue.status]);
    container.appendChild(detail);

    if (issue.suggestion && issue.suggestion !== issue.currentName) {
      const line = document.createElement("div");
      line.className = "chk-helper-sug";
      const name = document.createElement("b");
      name.textContent = `→ ${issue.suggestion}`;
      line.appendChild(name);
      const noteText = formatNote(issue.note);
      if (noteText) {
        const note = document.createElement("span");
        note.className = "chk-note";
        note.textContent = ` (${noteText})`;
        line.appendChild(note);
      }
      container.appendChild(line);
    }

    if (issue.fixable) {
      const buttons = document.createElement("div");
      buttons.className = "chk-helper-sug";
      const fixBtn = document.createElement("button");
      fixBtn.textContent = t("fix");
      fixBtn.title = t("fixTitle", { name: issue.suggestion ?? "" });
      fixBtn.addEventListener("click", () => this.onFixOne(issue));
      buttons.appendChild(fixBtn);

      const group = issuesInSameGroup(snapshot.issues, issue);
      if (group.length > 1) {
        const fixAllBtn = document.createElement("button");
        fixAllBtn.textContent = t("fixAll", { n: Math.min(group.length, GROUP_FIX_CAP) });
        fixAllBtn.addEventListener("click", () => this.onFixGroup(issue, group));
        buttons.appendChild(fixAllBtn);
      }
      container.appendChild(buttons);
    }
  }

  private isCheckedAndNamed(segmentId: number): boolean {
    try {
      const segment = this.sdk.DataModel.Segments.getById({ segmentId });
      if (!segment || !this.settings.get().checkedRoadTypes.includes(segment.roadType)) {
        return false;
      }
      const address = this.sdk.DataModel.Segments.getAddress({ segmentId });
      return Boolean(address.street?.name?.trim());
    } catch {
      return false;
    }
  }

  private onFixOne(issue: Issue): void {
    const outcome = fixSegment(this.sdk, issue, this.settings.get());
    if (!outcome.ok) {
      alert(t("fixFailed", { error: formatFixError(outcome) }));
      return;
    }
    this.scanner.reevaluate();
    this.schedule();
  }

  private onFixGroup(issue: Issue, group: Issue[]): void {
    const n = Math.min(group.length, GROUP_FIX_CAP);
    if (
      n > GROUP_FIX_CONFIRM_THRESHOLD &&
      !confirm(t("confirmGroupFix", { name: issue.suggestion ?? "", n }))
    ) {
      return;
    }
    const outcomes = fixGroup(this.sdk, group, this.settings.get());
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
    this.scanner.reevaluate();
    this.schedule();
  }
}
