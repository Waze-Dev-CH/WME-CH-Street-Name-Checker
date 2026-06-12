import { TileFetcher } from "./geoadmin/tiles";
import { resolveLocale, setLocale } from "./i18n";
import { log } from "./log";
import { HighlightLayer, registerLayerCheckbox } from "./map-layer";
import { Scanner } from "./scan";
import { initSdk } from "./sdk";
import { SettingsStore } from "./settings";
import { TabUI } from "./ui/tab";

async function main(): Promise<void> {
  const sdk = await initSdk();
  await sdk.Events.once({ eventName: "wme-ready" });

  const settings = new SettingsStore();
  setLocale(resolveLocale(settings.get().language, sdk.Settings.getLocale().localeCode));
  const fetcher = new TileFetcher();
  const scanner = new Scanner(sdk, fetcher, settings);
  const layer = new HighlightLayer(sdk, settings);

  layer.init();
  registerLayerCheckbox(sdk, (checked) => {
    layer.setVisible(checked);
    scanner.setPaused(!checked);
  });

  scanner.onUpdate((snapshot) => {
    layer.sync(snapshot.issues, settings.get().showCosmetic);
  });

  const tab = new TabUI(sdk, scanner, settings);
  await tab.init();

  scanner.start();
  log.info(`v${__SCRIPT_VERSION__} ready (SDK ${sdk.getSDKVersion()}, WME ${sdk.getWMEVersion()})`);
}

main().catch((err) => log.error("Initialization failed", err));
