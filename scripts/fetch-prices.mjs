// Fetches metal prices from metalpriceapi and writes prices.json, the only
// file the banner reads. Run by .github/workflows/update-prices.yml, every
// 10 minutes, on a checkout of the gh-pages branch:
//
//   METALPRICE_API_KEY=... node scripts/fetch-prices.mjs <path/to/prices.json>
//
// Calls: `latest` on every run. Yesterday's prices (for the daily change) only
// when the date rolls over (UTC); otherwise they are recovered from the existing
// file (price - change).
//
// Everything is checked before anything is written. On any failure the script
// exits with an error and leaves the existing file untouched, so the banner keeps
// the last good prices and the workflow run shows as failed.
//
// Never log request URLs or response bodies: the URLs contain the key.

import { readFile, rename, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const API = "https://api.metalpriceapi.com/v1";
const SYMBOLS = ["XAU", "XAG", "XPT", "XPD"];

// Sane USD-per-ounce ranges. A price outside these is treated as bad data.
const RANGES = {
  XAU: [1000, 20000],
  XAG: [10, 500],
  XPT: [300, 10000],
  XPD: [300, 10000],
};
// Largest believable move since yesterday, in percent.
const MAX_DAILY_MOVE = 25;
// `latest` may lag over a weekend, but not by more than this.
const MAX_RATES_AGE_DAYS = 4;
// Two triggers start this job: GitHub's schedule and a Scheduled Task on the
// VPS (ops/price-watchdog.ps1), each every 10 minutes. A run within this many
// minutes of the last fetch does nothing (no API call, no push, no Pages
// build), so at most 8 Pages builds an hour come from here, whatever the
// triggers do. GitHub allows 10 an hour, which leaves room for deploys.
export const MIN_GAP_MINUTES = 8;

// YYYY-MM-DD for the UTC day before `now`.
export const yesterdayUTC = (now) =>
  new Date(now.getTime() - 86400000).toISOString().slice(0, 10);

// One API call. Returns the `rates` object as USD per ounce, keyed XAU etc.
const getRates = async (fetchFn, key, endpoint, what) => {
  const url = `${API}/${endpoint}?api_key=${encodeURIComponent(key)}&base=USD&symbols=${SYMBOLS.join(",")}`;
  let response;
  try {
    response = await fetchFn(url, { signal: AbortSignal.timeout(20000) });
  } catch (err) {
    throw new Error(`${what}: request failed (${err.name})`);
  }
  if (!response.ok) throw new Error(`${what}: HTTP ${response.status}`);
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error(`${what}: response is not JSON`);
  }
  if (!body || body.success !== true || typeof body.rates !== "object") {
    const code = body?.error?.statusCode ?? "unknown";
    throw new Error(`${what}: API reported failure (code ${code})`);
  }
  const rates = {};
  for (const symbol of SYMBOLS) {
    const price = body.rates[`USD${symbol}`];
    const [low, high] = RANGES[symbol];
    if (typeof price !== "number" || !Number.isFinite(price)) {
      throw new Error(`${what}: ${symbol} missing`);
    }
    if (price < low || price > high) {
      throw new Error(`${what}: ${symbol} = ${price} is outside ${low}-${high}`);
    }
    rates[symbol] = price;
  }
  return { rates, body };
};

// Yesterday's prices from a previous prices.json, if it is for `date`.
const yesterdayFromFile = (previous, date) => {
  if (!previous || previous.yesterdayDate !== date) return null;
  const rates = {};
  for (const symbol of SYMBOLS) {
    const metal = previous.metals?.[symbol];
    const yday = metal?.price - metal?.change;
    const [low, high] = RANGES[symbol];
    if (!Number.isFinite(yday) || yday < low || yday > high) return null;
    rates[symbol] = yday;
  }
  return rates;
};

// Builds the new prices.json content. Makes 1 API call, or 2 when yesterday's
// prices are not in `previous`. Throws on anything incomplete or implausible.
export const buildPrices = async ({ fetchFn, key, now, previous }) => {
  if (!key) throw new Error("METALPRICE_API_KEY is not set");

  const { rates: today, body } = await getRates(fetchFn, key, "latest", "latest");
  const ratesTime = new Date(body.timestamp * 1000);
  if (!Number.isFinite(ratesTime.getTime())) throw new Error("latest: no timestamp");
  if (now - ratesTime > MAX_RATES_AGE_DAYS * 86400000) {
    throw new Error(`latest: rates are from ${ratesTime.toISOString()}, too old`);
  }

  const yesterdayDate = yesterdayUTC(now);
  let yesterday = yesterdayFromFile(previous, yesterdayDate);
  const calls = yesterday ? 1 : 2;
  if (!yesterday) {
    ({ rates: yesterday } = await getRates(fetchFn, key, yesterdayDate, "historical"));
  }

  const metals = {};
  for (const symbol of SYMBOLS) {
    // The same sums the banner used to do in the browser.
    const change = today[symbol] - yesterday[symbol];
    const changePercent = (change / yesterday[symbol]) * 100;
    if (Math.abs(changePercent) > MAX_DAILY_MOVE) {
      throw new Error(`${symbol} moved ${changePercent.toFixed(1)}% since yesterday`);
    }
    metals[symbol] = { price: today[symbol], change, changePercent };
  }

  return {
    prices: {
      fetchedAt: now.toISOString(),
      ratesAt: ratesTime.toISOString(),
      yesterdayDate,
      metals,
    },
    calls,
  };
};

const main = async () => {
  const file = process.argv[2];
  if (!file) throw new Error("usage: node scripts/fetch-prices.mjs <prices.json>");

  let previous = null;
  try {
    previous = JSON.parse(await readFile(file, "utf8"));
  } catch {
    // No file yet, or unreadable: fetch yesterday's prices too.
  }

  const sinceLast = (Date.now() - Date.parse(previous?.fetchedAt)) / 60000;
  if (sinceLast >= 0 && sinceLast < MIN_GAP_MINUTES) {
    console.log(`Fetched ${sinceLast.toFixed(1)} min ago; skipping (0 API calls)`);
    return;
  }

  const { prices, calls } = await buildPrices({
    fetchFn: fetch,
    key: process.env.METALPRICE_API_KEY,
    now: new Date(),
    previous,
  });

  // Same rates as last time (e.g. markets closed): keep the file, so the
  // workflow has nothing to commit.
  if (
    previous?.ratesAt === prices.ratesAt &&
    previous?.yesterdayDate === prices.yesterdayDate &&
    Object.entries(prices.metals).every(([s, m]) => previous.metals?.[s]?.price === m.price)
  ) {
    console.log(`Unchanged since ${prices.ratesAt}: ${calls} API call(s), file kept`);
    return;
  }

  // Write a temporary file, then rename it over the old one.
  const temp = `${file}.tmp`;
  await writeFile(temp, JSON.stringify(prices, null, 2) + "\n");
  await rename(temp, file);
  console.log(`Wrote ${file}: ${calls} API call(s), rates at ${prices.ratesAt}`);
  for (const [symbol, m] of Object.entries(prices.metals)) {
    console.log(`  ${symbol} ${m.price.toFixed(2)} (${m.changePercent.toFixed(2)}%)`);
  }
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`::error::${err.message}`);
    process.exit(1);
  });
}
