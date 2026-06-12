import { STATUS_STYLES } from "../map-layer";
import type { IssueStatus } from "../matching/evaluate";

const statusChipRules = (Object.keys(STATUS_STYLES) as IssueStatus[])
  .map(
    (status) => `
.chk-badge-${status} { background: ${STATUS_STYLES[status].strokeColor}; }`,
  )
  .join("\n");

export const CSS = `
.chk-pane { font-size: 12px; padding: 6px 8px; display: flex; flex-direction: column; gap: 8px; }
.chk-pane button { cursor: pointer; }
.chk-header { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.chk-status-line { flex: 1; min-width: 120px; }
.chk-unsaved { color: #b35c00; font-weight: bold; }
.chk-chips { display: flex; flex-wrap: wrap; gap: 4px; }
.chk-chip { border: 1px solid #ccc; border-radius: 10px; padding: 1px 8px; background: #fff; font-size: 11px; }
.chk-chip.chk-chip-active { border-color: #333; box-shadow: inset 0 0 0 1px #333; }
.chk-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 4px; flex-shrink: 0; }
.chk-groups { display: flex; flex-direction: column; gap: 4px; max-height: 50vh; overflow-y: auto; }
.chk-group { border: 1px solid #ddd; border-radius: 4px; }
.chk-group-header { display: flex; align-items: center; gap: 6px; padding: 4px 6px; cursor: pointer; }
.chk-group-header:hover { background: #f5f5f5; }
.chk-badge { display: inline-block; min-width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
${statusChipRules}
.chk-group-names { flex: 1; overflow: hidden; text-overflow: ellipsis; }
.chk-arrow { color: #888; }
.chk-suggestion { font-weight: bold; }
.chk-note { color: #888; font-style: italic; }
.chk-count { color: #666; }
.chk-fix-all { font-size: 11px; }
.chk-rows { border-top: 1px solid #eee; }
.chk-row { display: flex; align-items: center; gap: 6px; padding: 2px 6px 2px 18px; cursor: pointer; }
.chk-row:hover { background: #f0f7ff; }
.chk-row.chk-selected { background: #e0efff; }
.chk-row-meta { color: #888; flex: 1; }
.chk-settings summary { cursor: pointer; font-weight: bold; margin: 4px 0; }
.chk-settings-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 8px; margin: 4px 0; }
.chk-settings label { display: flex; align-items: center; gap: 4px; font-weight: normal; }
.chk-settings-row { display: flex; align-items: center; gap: 6px; margin: 3px 0; }
.chk-empty { color: #4a8f3c; font-weight: bold; padding: 8px 0; }
.chk-muted { color: #888; }
.chk-error { color: #c00; }
`;

let injected = false;

export function injectStyles(): void {
  if (injected) return;
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);
  injected = true;
}
