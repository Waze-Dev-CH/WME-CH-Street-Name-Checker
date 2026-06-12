import { IdbTileStore } from "./geoadmin/idb-store";
import { TileFetcher } from "./geoadmin/tiles";
import { resolveLocale, setLocale } from "./i18n";
import { log } from "./log";
import { HighlightLayer, registerLayerCheckbox } from "./map-layer";
import { Scanner } from "./scan";
import { registerShortcuts } from "./shortcuts";
import { initSdk } from "./sdk";
import { SettingsStore } from "./settings";
import { EditPanelBox } from "./ui/edit-panel";
import { TabUI } from "./ui/tab";

async function main(): Promise<void> {
  const sdk = await initSdk();
  await sdk.Events.once({ eventName: "wme-ready" });

  const settings = new SettingsStore();
  setLocale(resolveLocale(settings.get().language, sdk.Settings.getLocale().localeCode));
  const fetcher = new TileFetcher(undefined, undefined, new IdbTileStore());
  const scanner = new Scanner(sdk, fetcher, settings);
  const layer = new HighlightLayer(sdk, settings);

  layer.init();
  registerLayerCheckbox(sdk, (checked) => {
    layer.setVisible(checked);
    scanner.setPaused(!checked);
  });

  // Resync the OpenLayers layer only when results actually change; progress
  // ticks during a fetch reuse the same issues map and must stay free.
  let lastSyncedIssues: ReadonlyMap<number, unknown> | null = null;
  scanner.onUpdate((snapshot) => {
    if (snapshot.issues !== lastSyncedIssues) {
      lastSyncedIssues = snapshot.issues;
      layer.sync(snapshot.issues);
    }
  });

  const tab = new TabUI(sdk, scanner, settings);
  await tab.init();

  new EditPanelBox(sdk, scanner, settings).init();
  registerShortcuts(sdk, scanner, settings, { nextIssue: () => tab.selectNextIssue() });

  scanner.start();
  log.info(`v${__SCRIPT_VERSION__} ready (SDK ${sdk.getSDKVersion()}, WME ${sdk.getWMEVersion()})`);
}

main().catch((err) => log.error("Initialization failed", err));
