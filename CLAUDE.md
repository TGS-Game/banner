# banner

> PUBLIC repo, and this file is tracked: keep personal names, email addresses, local machine paths and secrets
> out of it (and out of docs/HISTORY.md). Long detail and the deploy history are in docs/HISTORY.md.

## What this app does
The live metal-price ticker for The Gold Standard: USD spot prices for gold, silver, platinum and palladium with
the daily change, refreshed every 60 s, embedded in other pages by iframe. Create React App (React 18), no backend.
`src/components/prices.js` (reads `prices.json`, the one-row banner) and `PriceCarousel.js` (narrow screens).
Repo: https://github.com/TGS-Game/banner (public).

## How it connects to other apps
- **Shown on:** thegoldstandard.com (the main site, `src/site.js` `tickerUrl`) at https://tgs-game.github.io/banner.
  When a carousel slide moves, it posts `{type:'tgs-banner:move'}` to the framing page, which accepts it only from
  `https://tgs-game.github.io`. The site's iframe should be 40px tall below 1035px wide, 24px above.
- **Prices:** the browser never calls metalpriceapi. It reads only `prices.json` beside the page (on the
  `gh-pages` branch). The "Update prices" GitHub Action (`.github/workflows/update-prices.yml`,
  `scripts/fetch-prices.mjs`, secret `METALPRICE_API_KEY`) fetches metalpriceapi (Basic Plus plan, 50,000 calls a
  month; about 4,400 used) and commits the file, then asks GitHub Pages to rebuild.
- **Triggered by:** the VPS "Banner price watchdog" every 10 min, GitHub's own `cron` (`4-59/10`) as a backstop
  (GitHub drops most of those), and by hand.
- **Alerts:** the watchdog posts to Slack #depot-alerts. Nothing runs on Railway.

## How it's run, tested and deployed
- Local (PowerShell): `npm ci`, `npm run build` (offline, touches nothing live), `npm start` (localhost:3000).
  Locally there's no `prices.json`, so the banner is an empty strip: put a test copy in `public/prices.json`
  (git-ignored, never published).
- `npm test` (jest): `src/App.test.js` is CRA boilerplate and is expected to fail; it is broken anyway (missing
  `@testing-library/jest-dom`). Watchdog tests (offline, fake Slack and fake GitHub):
  `powershell -ExecutionPolicy Bypass -File ops\test-price-watchdog.ps1`.
- **Deploy = `npm run deploy`** (build, `scripts/keep-prices.mjs` copies the live `prices.json` into `build/`,
  then `gh-pages -d build` pushes to the `gh-pages` branch). GitHub Pages serves it at
  **https://tgs-game.github.io/banner/** (the live site). Pushing to `main` does not deploy the banner, but
  changes to the workflow on `main` take effect at once.
- Check a build against live: compare `static/js/main.*.js` / `static/css/main.*.css` names with
  https://tgs-game.github.io/banner/asset-manifest.json.
- Run the price job now: `gh workflow run update-prices.yml -R TGS-Game/banner` (only with approval; spends
  1-2 API calls; does nothing within `MIN_GAP_MINUTES` (8) of the last fetch).

## Price watchdog (Windows Scheduled Task on the VPS)
- Task **"Banner price watchdog"**, as SYSTEM, every 10 min, priority 4. It runs a copy of
  `ops/price-watchdog.ps1` in `$env:ProgramData\BannerWatchdog` made by `ops/install-watchdog.ps1`:
  **after editing the script, re-run the installer** (elevated), or the task keeps the old copy.
  Remove: the installer with `-Uninstall`.
- Each run checks the live `prices.json`, then triggers the workflow (`workflow_dispatch`, ref `main`).
- **Alert thresholds (pending commit of the watchdog change, 12 Nov 2026; until it is committed and the installer
  is re-run, the VPS still runs the old rules in docs/HISTORY.md):** only sustained problems alert, each with one
  message and one "fixed".

  | Problem | Alerts after | "Fixed" after |
  |---|---|---|
  | Prices stale (over 45 min old) | 2 checks in a row (about 55 min) | 2 fresh checks in a row |
  | Token error (401/403/404) | 2 failures in a row (was 1) | 2 good triggers in a row |
  | Other trigger errors | 3 in a row | 2 good triggers in a row |
  | Can't read prices.json | 3 in a row | 2 good reads in a row |

  No "stale" message is sent while the trigger is failing (the trigger alert covers it). Markets closed (rates
  unchanged, file kept) counts as fresh. A failed Slack post is retried next run. State is in `state.json`,
  the log in `watchdog.log` (rotates at 1 MB), both beside the script copy.
- Secrets: machine environment variables `BANNER_GH_TOKEN` (fine-grained, this repo only, Actions read/write,
  never expires) and `BANNER_SLACK_WEBHOOK`. Never print them. To replace the token, paste the new one into
  System Properties > Environment Variables; the next run uses it.
- Is it running? `Get-ScheduledTaskInfo 'Banner price watchdog'` and the last lines of `watchdog.log`; on GitHub,
  `gh run list -R TGS-Game/banner -w update-prices.yml` shows `workflow_dispatch` runs every ~10 min.
- Not covered: if the VPS is down nothing alerts, and a failed run that the next run fixes only sends GitHub's
  failure email.

## Rules and gotchas
- If you change any key, password or variable, log it in the owner's private key-change log (the rule and its
  location are in the private CLAUDE.md of the parent projects folder) and ask the owner to re-export the
  encrypted variables backup into Bitwarden.
- Work on **`main`** (the default and live branch). `master` is stale and still has the old API key in
  `src/components/prices.js`; never build or deploy it.
- Never run `npm run deploy`, push to `gh-pages` or run the workflow without explicit approval. Before running
  anything, say whether it touches the metalpriceapi quota, `gh-pages`, GitHub Pages or the workflow.
- Never put `METALPRICE_API_KEY` in `.env`, `REACT_APP_*` or any file: CRA would inline it into the public
  bundle. `fetch-prices.mjs` never logs request URLs or bodies (the URL holds the key); keep it so. Report secrets
  only as "set / not set". `.env` holds only `GENERATE_SOURCEMAP=false`.
- `npm run deploy` would delete `prices.json` without `keep-prices` (it replaces the whole `gh-pages` branch).
- GitHub Pages allows 10 builds an hour: the job builds at most ~8 (`MIN_GAP_MINUTES` 8). Don't lower it or add
  triggers without redoing that sum.
- In a public repo, schedules stop after 60 days with no activity: re-enable in the Actions tab.
- Prices checks before writing: all four metals, sane ranges, at most a 25% daily move, rates at most 4 days old;
  otherwise nothing is written and the run fails. Just after midnight UTC a metal missing from yesterday's rates
  is only a warning for 60 min (`HISTORICAL_GRACE_MINUTES`).
- The banner never shows error text: an empty strip before the first prices, then the last good prices.
- Layout bands: phones under 768px = 40px carousel of pairs (no daily change); tablets 768-1034px = 40px row of
  four; above = the 24px row (24px carousel if it doesn't fit). Settings at the top of `PriceCarousel.js`.
- Headless Chrome here reports reduced motion (the fade, not the slide) unless you emulate `no-preference`.
- Not on Railway: don't `railway link` this folder or set Railway variables.
- Way of working: investigate on `main`, build, verify (`npm run build` at least; look at it with `npm start`
  when the UI changes), show `git status` + `git diff`, then stop. No commit, push or deploy until told.
  Windows: use PowerShell syntax.

## Current state and open items (12 Nov 2026)
- Live: `gh-pages` = build of `2070e7c` (deployed 2026-10-04). Latest `main` commits (10 Nov) are the price job's
  midnight grace and retries plus CLAUDE.md fixes; the job runs from `main`, so they are live.
- 12 Nov: the watchdog change (the new thresholds above, plus `ops/test-price-watchdog.ps1`, 31/31 offline tests),
  this shorter CLAUDE.md and `docs/HISTORY.md` were committed, pushed and re-installed on the VPS.
- After any future watchdog change: re-run `ops\install-watchdog.ps1` (elevated) on the VPS.
- Open: the old metalpriceapi key is still public in git history, `master`, old `gh-pages` builds and an old
  bundle copy in the support site. It was rotated on 2026-10-22; check the old key is really revoked.
- Open: prices show no "as of" time, so stale prices look live to visitors.
