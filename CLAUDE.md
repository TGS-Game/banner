# banner

Live metal-price ticker banner for The Gold Standard. Shows USD spot prices for
gold, silver, platinum and palladium with a coloured daily change, refreshed every
60 seconds. Designed to be embedded on other pages (e.g. in an iframe).

Repo: https://github.com/TGS-Game/banner (public; transferred from `thegldstandard`).

## Stack

- Create React App (`react-scripts` 5), React 18. No backend, no database.
- Two components in `src/components/`: `prices.js` (reading `prices.json` and the
  one-row banner; + `Prices.css`, `icons/`) and `PriceCarousel.js` (the
  narrow-screen carousel). `src/App.js` just renders `Prices`. `public/style.css`
  holds global styles.
- `design/mobile-banner.png` is the design the phone layout follows.
- `scripts/fetch-prices.mjs` + `.github/workflows/update-prices.yml`: the job that
  fetches prices (see "Prices: how they flow"). `scripts/keep-prices.mjs`: part of
  `npm run deploy`.

## Prices: how they flow

- **The browser never calls metalpriceapi.** The banner reads only
  `prices.json`, next to the page: https://tgs-game.github.io/banner/prices.json
  (`${PUBLIC_URL}/prices.json`), on load and every 60 seconds, with
  `cache: "no-cache"` (Pages sends `max-age=600`). That costs no API quota.
- **The file lives on the `gh-pages` branch** (root), not on `main`. The
  "Update prices" workflow (`.github/workflows/update-prices.yml`) runs every 10
  minutes (`4-59/10`, off the top of the hour) and on demand. It runs
  `scripts/fetch-prices.mjs` on a checkout of `gh-pages`, commits `prices.json`
  if it changed, pushes, then asks GitHub Pages to rebuild (`POST
  /repos/TGS-Game/banner/pages/builds`, because a push with the built-in token
  does not start one).
- **API calls:** `latest` every run; yesterday's historical rates only when the
  UTC date rolls over (otherwise recovered from the file as price - change). So
  about 145 calls a day, about 4,400 a month. Each run is 1 call (2 once a day).
  The plan is **Basic Plus** (50,000 a month, prices update every 5 minutes), so
  there is plenty of room; 10 minutes is a deliberate choice, not a limit (the
  prices don't move enough to justify 5). The schedule is the `cron` line.
- **File format:** `fetchedAt`, `ratesAt` (the API's timestamp), `yesterdayDate`
  (UTC), and `metals.{XAU,XAG,XPT,XPD}.{price, change, changePercent}`: the same
  sums the banner used to do. The banner formats them with `toFixed(2)`.
- **Checks before writing:** all four metals present, numeric and within a sane
  range (`RANGES` in the script), a move of at most 25% since yesterday, and
  rates at most 4 days old. On any failure nothing is written (the last good
  file stays) and the run fails, visibly, in the Actions tab.
- **Banner on failure:** before the first good file it shows **nothing**: an
  empty strip of the background colour, no text (class `bannerEmpty`, fixed at
  24px so nothing moves when the prices appear; the phone layout's inline 40px
  wins over it). After that a failed, broken or incomplete read keeps the last
  prices. It never shows error or placeholder text.
- **Secret:** `METALPRICE_API_KEY`, a GitHub Actions repository secret. The code
  contains no key.
- **Run it now:** GitHub > Actions > "Update prices" > "Run workflow", or
  `gh workflow run update-prices.yml -R TGS-Game/banner` then
  `gh run watch -R TGS-Game/banner`. Each run spends 1-2 API calls.
- **Schedule caveats: GitHub runs this far less often than every 10 minutes.**
  The `cron` is right and the workflow is `active`, but GitHub drops most runs.
  Measured over the first night (2026-09-22/23), 3 runs happened where about 60
  were due: 19:22 (manual) -> 22:21 -> 00:46 -> 05:17, gaps of 3h 0m, 2h 25m and
  4h 31m. The runs that do happen start 2-7 minutes after a slot, and all of them
  succeeded. So **expect prices a few hours old, not the 10-25 minutes first
  estimated**; that estimate assumed the schedule mostly fires.
  - Nothing breaks when runs are skipped: the banner keeps showing the last
    prices. Staleness shows as an old `fetchedAt` in `prices.json`.
  - If the cadence matters, trigger `workflow_dispatch` from a scheduler off
    GitHub (e.g. a Windows Scheduled Task running `gh workflow run`) and treat
    the `cron` as a fallback. Not built; discuss first.
- Schedules only run from the default branch (`main`), and in a public repo
  are turned off after 60 days with no repository activity: re-enable in the
  Actions tab.
- `npm run deploy` would otherwise delete `prices.json` (it replaces the whole
  `gh-pages` branch), so `predeploy` runs `scripts/keep-prices.mjs`, which copies
  the current file from `origin/gh-pages` into `build/`. A deploy and a job run
  pushing at the same moment: one push is rejected; re-run it.

## Layout: row vs carousel

- Wide screens show the original one-row banner, 24px tall. When the four metals
  don't fit on one row (measured at runtime; about 1048px with typical prices), it
  switches to a carousel. With "reduce motion" on, slides fade instead of sliding.
- **24px carousel** (the page is too narrow for the row, but not a phone frame):
  two metals at a time, Gold + Silver then Platinum + Palladium, sliding left on
  a loop. Each pair holds 6s (13.4s loop).
- **Phone layout**: in a frame at most 768px wide and at least
  `PHONE_BANNER_HEIGHT` (40px) tall the banner is that height and the carousel
  shows the same **pairs** (Gold + Silver, Platinum + Palladium), styled after
  `design/mobile-banner.png`: 22px icon in a filled circle, name, price. **No
  daily change** on phones. Each pair holds 5s (11.4s loop). JS adds the
  `bannerPhone` class and the height; `Prices.css` section 4 keys off the class
  (no media query), so the height is one setting.
  thegoldstandard.com's phone iframe is 80px tall; it must be set to 40px or
  the frame shows 40px of blank space under the banner.
- Phone text is 14px name / 15px price from a ~386px-wide frame up, and shrinks
  smoothly (vw-based, `--phone-text` in `Prices.css`) below that so the widest
  realistic slide still fits: `PLATINUM $2000.00` + `PALLADIUM $2000.00`
  (0 is League Spartan's widest digit; realistic caps are Gold/Platinum
  $9999.99, Palladium $4999.99, Silver $199.99). The formula's constants
  assume the icon, margin and `PHONE_SLIDE_SPACING` values: update them together.
  Prices render with `toFixed(2)`, so no thousands comma.
- Settings, at the top of `PriceCarousel.js`: `PHONE_BANNER_HEIGHT` (40),
  `CAROUSEL_HOLD_MS` (6000, the 24px pairs carousel), `PHONE_CAROUSEL_HOLD_MS`
  (5000, the phone layout), `CAROUSEL_TRANSITION_MS` (700, both) and
  `PHONE_SLIDE_SPACING` (8). A loop is slides × (hold + transition). The pairs
  are `PAIRS` in `prices.js`.

## Branches: work on `main`

- **`main` is the live branch.** Deployed 2026-09-22: `gh-pages` `be793fd` =
  build of `63657c4` (prices from the scheduled job, no API calls in the
  browser): live serves `main.9bccde13.js`, `main.f3ffac55.css` and
  `206.966e2417.chunk.js`, and no `.map` files. `prices.json` sits beside them,
  committed by the job, and survived this deploy (`keep-prices`). History:
  2026-09-18 `gh-pages` `eb71b14` =
  build of `9abaeb7` (40px phone pairs): `main.fa2023fd.js`,
  `main.22f1760a.css` and `453.df2d0003.chunk.js`; earlier 2026-09-18
  `gh-pages` `1353be1` = build of `1fe617e` (one-metal phone layout;
  `main.9740394e.js`, `main.2ffbd2cd.css`); 2026-09-10 `gh-pages`
  `29c7c71` = build of `a290afe` (carousel; `main.02a3d7bd.js`,
  `main.563b34a8.css`); 2025-04-01 `e4218a0` = build of `a994e4a`. Building
  `master` does not reproduce any of these.
- `main` has been the GitHub **default** branch since 2026-09-22 (needed: the
  scheduled workflow only runs from the default branch). `master` is stale,
  with hardcoded placeholder daily-change figures and the old API key in
  `src/components/prices.js`.

## Running locally

```powershell
npm ci            # install from lockfile (re-run after switching branches)
npm run build     # production build to ./build; offline, touches nothing live
npm start         # dev server on http://localhost:3000
npm test          # jest (watch mode)
```

- Windows Server here has system animations off, so headless Chrome reports
  `prefers-reduced-motion: reduce` (the fade, not the slide) unless you emulate
  `no-preference`.
- `npm start` and the built page make **no** metalpriceapi calls. They read
  `/banner/prices.json`, which doesn't exist locally, so the banner stays an
  empty strip. To see prices, put a test file in
  `public/prices.json` (gitignored; `keep-prices` never publishes it), e.g. a
  copy of the live one.
- To test the job without the API, stub `fetch` (e.g. `node --import` a module
  that replaces `globalThis.fetch`). Running it for real spends 1-2 calls.
- `npm test`: `src/App.test.js` is untouched CRA boilerplate ("learn react") and
  is expected to fail. Treat it as stale, not as a regression.
- To check a build matches what's live, compare the `static/js/main.*.js` and
  `static/css/main.*.css` filenames (content hashes) with
  https://tgs-game.github.io/banner/asset-manifest.json.

## Deployment (= production)

- `npm run deploy` runs `predeploy` (`npm run build`, then
  `scripts/keep-prices.mjs`, which does a `git fetch` and copies the live
  `prices.json` into `build/`), then `gh-pages -d build` (`gh-pages` ^4 on
  `main`), which **pushes the build to the `gh-pages` branch on origin**.
- `.env` sets `GENERATE_SOURCEMAP=false` (not a secret), so no `.map` files are
  published. GitHub Pages (legacy mode, source `gh-pages` /) serves it at
  **https://tgs-game.github.io/banner/**. That is the live site.
- Never run `npm run deploy` or push to `gh-pages` without explicit approval.
- `homepage` in package.json is `https://tgs-game.github.io/banner/`, so asset
  paths resolve to `/banner/`. The old URL `https://thegldstandard.github.io/banner/`
  returns 404. thegoldstandard.com's iframe points at
  `https://tgs-game.github.io/banner` (checked 2026-09-22), as does the site
  rebuild in `thegoldstandard-main` / `-mobile` (`src/site.js` `tickerUrl`).
- This machine has `core.autocrlf=true`, so files copied from `public/` (e.g.
  `style.css`) get CRLF line endings in local builds. That doesn't reach the
  live site: `gh-pages` commits through git, which converts them back to LF on
  commit, so a deploy from here does not change `style.css`'s bytes (verified
  on the 2026-09-18 deploy, `gh-pages` `1353be1`).
- Not deployed on Railway. The folder is not `railway link`ed. Don't link it or
  set Railway variables.

## Environment variables & secrets

- The banner reads **no environment variables**. `.env` only holds
  `GENERATE_SOURCEMAP=false`.
- The job reads `METALPRICE_API_KEY`, from the GitHub Actions repository secret of
  that name. Never add it to `.env`, `REACT_APP_*` or any file: CRA would inline
  it into the public bundle.
- The **old** key was hardcoded in `src/components/prices.js` from `0f5fb8c`
  (2025-02-25) until this change, and is still there on `master`. It is public in
  git history, in every `gh-pages` commit, and in a saved copy of an old bundle in
  `support-auvesta-v3/public/login-assets/` (dead code, but served). The fix is a
  new key in the secret and deleting the old one; don't rewrite history.
  - Never print, log, echo or copy any key into files, docs or messages.
    `fetch-prices.mjs` never logs request URLs or response bodies (the URL
    contains the key); keep it that way.
- Report env vars and secrets only as "set / not set", never their values.

## How to work in this repo (user's rules)

1. **Investigate**: read the relevant code and confirm you're on `main`.
2. **Build**: make the change.
3. **Verify**: at minimum `npm run build` must succeed. Check it visually with
   `npm start` when the UI changes (with a test `public/prices.json`).
4. **Show the diff**: `git status` + `git diff`.
5. **Stop.** Do not commit, push or deploy until the user explicitly says so.

Before running anything, say whether it would touch a live service (the
metalpriceapi quota, the `gh-pages` branch, GitHub Pages or the "Update prices"
workflow). Never run the workflow without explicit approval.

Environment: Windows. Use PowerShell syntax.
