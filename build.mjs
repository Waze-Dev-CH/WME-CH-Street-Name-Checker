import * as esbuild from "esbuild";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("./package.json", "utf8"));
const header = readFileSync("./userscript-header.txt", "utf8").replace("%VERSION%", pkg.version);
const watch = process.argv.includes("--watch");
const outfile = "dist/wme-ch-street-name-checker.user.js";

mkdirSync("dist", { recursive: true });

// Dev loader: install dist/dev.user.js once in Tampermonkey (enable "Allow access
// to file URLs" for the extension), then `npm run dev` and reload WME on changes.
const devHeader = header
  .replace(/^(\/\/ @name\s+)(.*)$/m, "$1$2 (dev)")
  .replace(
    "// ==/UserScript==",
    `// @require      file://${process.cwd()}/${outfile}\n// ==/UserScript==`,
  );
writeFileSync("dist/dev.user.js", devHeader);

/** @type {esbuild.BuildOptions} */
const options = {
  entryPoints: ["src/main.user.ts"],
  bundle: true,
  format: "iife",
  target: "es2022",
  outfile,
  banner: { js: header },
  charset: "utf8",
  define: { __SCRIPT_VERSION__: JSON.stringify(pkg.version) },
  loader: { ".svg": "dataurl" },
  logLevel: "info",
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
} else {
  await esbuild.build(options);
}
