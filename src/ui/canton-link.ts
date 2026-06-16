import type { LineString } from "geojson";
import { cantonCodeFromName, cantonMapUrlForGeometry } from "../canton-map";
import { t } from "../i18n";
import beFlag from "../../assets/canton-flags/be.svg";
import blFlag from "../../assets/canton-flags/bl.svg";
import geFlag from "../../assets/canton-flags/ge.svg";
import neFlag from "../../assets/canton-flags/ne.svg";
import soFlag from "../../assets/canton-flags/so.svg";
import szFlag from "../../assets/canton-flags/sz.svg";
import tiFlag from "../../assets/canton-flags/ti.svg";
import vdFlag from "../../assets/canton-flags/vd.svg";

/** Bundled canton flags (data URIs) for the covered cantons. Others fall back to a code badge. */
const FLAGS: Record<string, string> = {
  be: beFlag,
  bl: blFlag,
  ge: geFlag,
  ne: neFlag,
  so: soFlag,
  sz: szFlag,
  ti: tiFlag,
  vd: vdFlag,
};

/**
 * Build a link that opens the segment's location on the relevant cantonal
 * geoportal (sibling of the map.geo.admin.ch "↗" link). Shows the canton flag
 * when bundled, otherwise the 2-letter code. Returns null when the canton is
 * unknown or has no configured map (caller skips the button).
 */
export function cantonMapLink(
  geometry: LineString,
  cantonName: string | null,
): HTMLAnchorElement | null {
  const url = cantonMapUrlForGeometry(geometry, cantonName);
  const code = cantonCodeFromName(cantonName);
  if (!url || !code) return null;

  const a = document.createElement("a");
  a.href = url;
  a.target = "_blank";
  a.rel = "noopener";
  a.title = t("cantonMapLinkTitle", { canton: code.toUpperCase() });

  const flag = FLAGS[code];
  if (flag) {
    a.className = "chk-canton-link";
    const img = document.createElement("img");
    img.className = "chk-canton-flag";
    img.src = flag;
    img.alt = code.toUpperCase();
    a.appendChild(img);
  } else {
    a.className = "chk-canton-link chk-canton-badge";
    a.textContent = code.toUpperCase();
  }
  return a;
}
