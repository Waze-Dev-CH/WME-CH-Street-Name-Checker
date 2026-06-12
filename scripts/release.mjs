import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

// Bump the version, rebuild dist, and assert the built header matches.
// Mechanical half of the /release flow: keeping package.json and the userscript
// @version in lockstep is what prevents a stale dist from shipping.

const BUMPS = new Set(["patch", "minor", "major"]);
const bump = process.argv[2];
if (!BUMPS.has(bump)) {
  console.error("Usage: node scripts/release.mjs <patch|minor|major>");
  process.exit(1);
}

const pkgPath = "./package.json";
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const [major, minor, patch] = pkg.version.split(".").map(Number);
if ([major, minor, patch].some((n) => !Number.isInteger(n))) {
  console.error(`Cannot parse current version "${pkg.version}" as SemVer X.Y.Z`);
  process.exit(1);
}

const next =
  bump === "major"
    ? `${major + 1}.0.0`
    : bump === "minor"
      ? `${major}.${minor + 1}.0`
      : `${major}.${minor}.${patch + 1}`;

pkg.version = next;
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
console.log(`Version: ${major}.${minor}.${patch} -> ${next}`);

// Rebuild so the userscript header picks up the new version.
execFileSync("node", ["build.mjs"], { stdio: "inherit" });

// Guard against a desynced dist: the built @version must equal package.json.
const dist = readFileSync("dist/wme-ch-street-name-checker.user.js", "utf8");
const headerVersion = dist.match(/^\/\/ @version\s+(.+)$/m)?.[1]?.trim();
if (headerVersion !== next) {
  console.error(
    `Version mismatch: dist header is "${headerVersion}", expected "${next}". Aborting.`,
  );
  process.exit(1);
}

console.log(`\nBuilt dist @version ${headerVersion} OK.`);
console.log("Stage for the release commit:");
console.log("  package.json CHANGELOG.md dist/wme-ch-street-name-checker.user.js");
