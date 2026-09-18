# banner

Live metal-price ticker banner for The Gold Standard. Shows USD spot prices for
gold, silver, platinum and palladium with a coloured daily change, refreshed every
60 seconds. Designed to be embedded on other pages (e.g. in an iframe).

Repo: https://github.com/TGS-Game/banner (public; transferred from `thegldstandard`).

## Stack

- Create React App (`react-scripts` 5), React 18. No backend, no database.
- Two components in `src/components/`: `prices.js` (fetching and the one-row
  banner; + `Prices.css`, `icons/`) and `PriceCarousel.js` (the narrow-screen
  carousel). `src/App.js` just renders `Prices`. `public/style.css` holds global styles.
- `design/mobile-banner.png` is the design the phone layout follows.
- Data comes from `https://api.metalpriceapi.com/v1/...`, called **directly from
  the browser**. On `main` it fetches `latest` plus yesterday's historical rates,
  so each refresh makes 2 API calls.

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

- **`main` is the live branch.** Deployed 2026-09-18: `gh-pages` `eb71b14` =
  build of `9abaeb7` (40px phone pairs): live serves `main.fa2023fd.js`,
  `main.22f1760a.css` and `453.df2d0003.chunk.js`. History: earlier 2026-09-18
  `gh-pages` `1353be1` = build of `1fe617e` (one-metal phone layout;
  `main.9740394e.js`, `main.2ffbd2cd.css`); 2026-09-10 `gh-pages`
  `29c7c71` = build of `a290afe` (carousel; `main.02a3d7bd.js`,
  `main.563b34a8.css`); 2025-04-01 `e4218a0` = build of `a994e4a`. Building
  `master` does not reproduce any of these.
- `master` is stale: 7 commits behind `main`, with hardcoded placeholder
  daily-change figures. It is still the GitHub **default** branch, so a fresh
  clone lands on `master`. Run `git switch main` after cloning.

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
- `npm start` (and opening the built page) makes **real calls to metalpriceapi.com
  using the production key**, so it spends the live API quota: 2 calls per minute
  per open tab. It does not write anywhere.
- `npm test`: `src/App.test.js` is untouched CRA boilerplate ("learn react") and
  is expected to fail. Treat it as stale, not as a regression.
- To check a build matches what's live, compare the `static/js/main.*.js` and
  `static/css/main.*.css` filenames (content hashes) with
  https://tgs-game.github.io/banner/asset-manifest.json.

## Deployment (= production)

- `npm run deploy` runs `predeploy` (`npm run build`), then `gh-pages -d build`
  (`gh-pages` ^4 on `main`), which **pushes the build to the `gh-pages` branch on
  origin**. GitHub Pages (legacy mode, source `gh-pages` /) serves it at
  **https://tgs-game.github.io/banner/**. That is the live site.
- Never run `npm run deploy` or push to `gh-pages` without explicit approval.
- `homepage` in package.json is `https://tgs-game.github.io/banner/`, so asset
  paths resolve to `/banner/`. The old URL `https://thegldstandard.github.io/banner/`
  returns 404, and thegoldstandard.com's iframe still points at it (checked
  2026-09-10), so the site shows no banner until that iframe's `src` is updated.
- This machine has `core.autocrlf=true`, so files copied from `public/` (e.g.
  `style.css`) get CRLF line endings in local builds. That doesn't reach the
  live site: `gh-pages` commits through git, which converts them back to LF on
  commit, so a deploy from here does not change `style.css`'s bytes (verified
  on the 2026-09-18 deploy, `gh-pages` `1353be1`).
- Not deployed on Railway. The folder is not `railway link`ed. Don't link it or
  set Railway variables.

## Environment variables & secrets

- The code reads **no environment variables** and has no `.env` files.
- The metalpriceapi key is **hardcoded** in `src/components/prices.js` on both
  branches. It is public in git history and in the shipped JS bundle.
  - Never print, log, echo or copy the key into new files, docs or messages.
  - Moving it to `REACT_APP_*` does not hide it: CRA inlines those values into the
    client bundle. A real fix is a server-side proxy and/or rotating the key with
    domain restrictions. Discuss with the user first.
- Report env vars only as "set / not set", never their values.

## How to work in this repo (user's rules)

1. **Investigate**: read the relevant code and confirm you're on `main`.
2. **Build**: make the change.
3. **Verify**: at minimum `npm run build` must succeed. Check it visually with
   `npm start` when the UI changes (flag the API-quota cost first).
4. **Show the diff**: `git status` + `git diff`.
5. **Stop.** Do not commit, push or deploy until the user explicitly says so.

Before running anything, say whether it would touch a live service (the
metalpriceapi quota, the `gh-pages` branch or GitHub Pages).

Environment: Windows. Use PowerShell syntax.
