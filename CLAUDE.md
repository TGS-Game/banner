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
- Data comes from `https://api.metalpriceapi.com/v1/...`, called **directly from
  the browser**. On `main` it fetches `latest` plus yesterday's historical rates,
  so each refresh makes 2 API calls.

## Layout: row vs carousel

- Wide screens show the original one-row banner, 24px tall. When the four metals
  don't fit on one row (measured at runtime; about 1048px with typical prices), it
  switches to a carousel of two metals at a time: Gold + Silver, then Platinum +
  Palladium, sliding left on a loop. With "reduce motion" on, the pairs fade.
- In a frame at most 768px wide and at least 80px tall (thegoldstandard.com's phone
  iframe is 80px tall at 768px and below) the carousel is 80px with larger text;
  otherwise it is 24px.
- Settings: `CAROUSEL_HOLD_MS` (6000) and `CAROUSEL_TRANSITION_MS` (700) at the top
  of `PriceCarousel.js`; the pairs are `PAIRS` in `prices.js`; the 80px phone sizes
  are section 4) of `Prices.css`.

## Branches: work on `main`

- **`main` is the live branch.** Verified 2026-09-10: building `main` @ `a994e4a`
  reproduces the live site's `main.3d5895be.js`, `main.f54e2d47.css` and
  `453.df2d0003.chunk.js` byte-for-byte. Building `master` does not. The live
  site matches the `gh-pages` branch at `e4218a0` (deployed 2025-04-01).
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
  `style.css`) get CRLF line endings in local builds. The content is identical,
  but a deploy from here would change those files' bytes.
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
