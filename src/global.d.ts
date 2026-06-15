/** Injected by esbuild at build time (see build.mjs `define`). */
declare const __SCRIPT_VERSION__: string;

/** SVG assets imported as data URIs (esbuild `dataurl` loader, see build.mjs). */
declare module "*.svg" {
  const url: string;
  export default url;
}
