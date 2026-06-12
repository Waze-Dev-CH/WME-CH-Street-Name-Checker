import type { WmeSDK } from "wme-sdk-typings";
import type { Issue, IssueStatus } from "./matching/evaluate";
import type { SettingsStore } from "./settings";

export const LAYER_NAME = "CH Street Check";
const LABEL_MIN_ZOOM = 17;

interface StatusStyle {
  strokeColor: string;
  strokeDashstyle: "solid" | "dash";
}

export const STATUS_STYLES: Record<IssueStatus, StatusStyle> = {
  COSMETIC: { strokeColor: "#f7c948", strokeDashstyle: "dash" },
  VARIANT: { strokeColor: "#f7c948", strokeDashstyle: "solid" },
  NEAR: { strokeColor: "#ff8c00", strokeDashstyle: "solid" },
  WRONG_TYPE: { strokeColor: "#ff5722", strokeDashstyle: "dash" },
  WRONG_STREET: { strokeColor: "#b71c1c", strokeDashstyle: "solid" },
  WRONG_CITY: { strokeColor: "#ff5ca8", strokeDashstyle: "solid" },
  NOT_FOUND: { strokeColor: "#e02020", strokeDashstyle: "solid" },
  UNNAMED: { strokeColor: "#9b59b6", strokeDashstyle: "dash" },
  MICRO_SEGMENT: { strokeColor: "#00bcd4", strokeDashstyle: "solid" },
  LOOP: { strokeColor: "#795548", strokeDashstyle: "solid" },
  NARROW_MISUSE: { strokeColor: "#3f51b5", strokeDashstyle: "dash" },
};

export class HighlightLayer {
  constructor(
    private sdk: WmeSDK,
    private settings: SettingsStore,
  ) {}

  init(): void {
    this.sdk.Map.addLayer({
      layerName: LAYER_NAME,
      styleContext: {
        getLabel: ({ feature, zoomLevel }) => {
          if (!this.settings.get().showMapLabels || zoomLevel < LABEL_MIN_ZOOM) return "";
          const suggestion = feature?.properties.suggestion;
          return typeof suggestion === "string" && suggestion !== "" ? `→ ${suggestion}` : "";
        },
      },
      styleRules: (Object.keys(STATUS_STYLES) as IssueStatus[]).map((status) => ({
        predicate: (properties) => properties.status === status,
        style: {
          strokeColor: STATUS_STYLES[status].strokeColor,
          strokeDashstyle: STATUS_STYLES[status].strokeDashstyle,
          strokeWidth: 6,
          strokeOpacity: 0.75,
          strokeLinecap: "round",
          pointerEvents: "none",
          label: "${getLabel}",
          fontColor: "#222222",
          fontSize: "12px",
          fontWeight: "bold",
          labelOutlineColor: "#ffffff",
          labelOutlineWidth: 3,
        },
      })),
    });
  }

  sync(issues: ReadonlyMap<number, Issue>, showCosmetic: boolean): void {
    this.sdk.Map.removeAllFeaturesFromLayer({ layerName: LAYER_NAME });
    const features = [...issues.values()]
      .filter((issue) => showCosmetic || issue.status !== "COSMETIC")
      .map((issue) => ({
        type: "Feature" as const,
        id: `chk-${issue.segmentId}`,
        geometry: issue.geometry,
        properties: {
          status: issue.status,
          suggestion: issue.suggestion,
          currentName: issue.currentName,
        },
      }));
    if (features.length > 0) {
      this.sdk.Map.addFeaturesToLayer({ layerName: LAYER_NAME, features });
    }
  }

  setVisible(visible: boolean): void {
    this.sdk.Map.setLayerVisibility({ layerName: LAYER_NAME, visibility: visible });
  }
}

/** Layer-switcher checkbox controlling both layer visibility and scan pausing. */
export function registerLayerCheckbox(sdk: WmeSDK, onToggle: (checked: boolean) => void): void {
  sdk.LayerSwitcher.addLayerCheckbox({ name: LAYER_NAME, isChecked: true });
  sdk.Events.on({
    eventName: "wme-layer-checkbox-toggled",
    eventHandler: (payload) => {
      if (payload.name === LAYER_NAME) onToggle(payload.checked);
    },
  });
}
