// Run by `npm run deploy` (predeploy), after the build: copies the current
// prices.json from the gh-pages branch on origin into build/, because
// `gh-pages -d build` replaces the whole branch and would otherwise delete it.
// The workflow in .github/workflows/update-prices.yml keeps that file up to date.
//
// If the branch has no prices.json yet (the workflow has never run) the deploy
// goes ahead without one and the banner shows "Loading metal prices..." until
// the next run. Any other problem stops the deploy.

import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";

const git = (...args) =>
  execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

git("fetch", "origin", "gh-pages");

let prices;
try {
  prices = git("show", "origin/gh-pages:prices.json");
} catch {
  // Never publish a local test copy (public/prices.json) in its place.
  rmSync("build/prices.json", { force: true });
  console.warn("keep-prices: gh-pages has no prices.json yet; deploying without one.");
  process.exit(0);
}

JSON.parse(prices); // stop the deploy rather than publish a broken file
writeFileSync("build/prices.json", prices);
console.log("keep-prices: copied prices.json from origin/gh-pages into build/");
