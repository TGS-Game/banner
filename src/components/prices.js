import React, { useState, useEffect, useRef } from "react";
import "./Prices.css";
import PriceCarousel, {
  useCarouselLayout,
  CAROUSEL_HOLD_MS,
  PHONE_CAROUSEL_HOLD_MS,
  PHONE_BANNER_HEIGHT,
} from "./PriceCarousel";

// Replace these icon imports with your actual icon paths:
import goldIcon from "./icons/gold-icon.png";
import silverIcon from "./icons/silver-icon.png";
import platinumIcon from "./icons/platinum-icon.png";
import palladiumIcon from "./icons/palladium-icon.png";

// The four metals, in banner order.
const METALS = [
  { symbol: "XAU", name: "Gold", icon: goldIcon },
  { symbol: "XAG", name: "Silver", icon: silverIcon },
  { symbol: "XPT", name: "Platinum", icon: platinumIcon },
  { symbol: "XPD", name: "Palladium", icon: palladiumIcon },
];

// Narrow screens, phones included, show two metals at a time (indexes into METALS).
const PAIRS = [
  [0, 1], // Gold + Silver
  [2, 3], // Platinum + Palladium
];

// Prices, with the change since yesterday, written every 10 minutes by the
// "Update prices" GitHub workflow (scripts/fetch-prices.mjs) next to this page.
const PRICES_URL = `${process.env.PUBLIC_URL}/prices.json`;
const REFRESH_MS = 60000;

// Two decimals with a thousands comma: 4290.06 -> "4,290.06".
const money = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// The file's metals, if all four are there with numbers; otherwise null.
const readMetals = (data) => {
  const metals = data?.metals;
  const complete = METALS.every(({ symbol }) =>
    ["price", "change", "changePercent"].every((field) =>
      Number.isFinite(metals?.[symbol]?.[field])
    )
  );
  return complete ? metals : null;
};

const Prices = () => {
  // The last good prices. A failed or broken read keeps these.
  const [metals, setMetals] = useState(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        // no-cache: always ask the server for a newer copy (Pages caches 10 min)
        const response = await fetch(PRICES_URL, { cache: "no-cache" });
        if (!response.ok) return;
        const latest = readMetals(await response.json());
        if (latest) setMetals(latest);
      } catch {
        // Offline or a broken file: keep what's on screen.
      }
    };

    fetchData();
    // Re-read the file every 60 seconds (it changes about every 10 minutes).
    const interval = setInterval(fetchData, REFRESH_MS);
    return () => clearInterval(interval);
  }, []);

  // Return appropriate class name (for red/green text)
  const getClassName = (difference) => {
    if (difference == null) return "";
    return difference >= 0 ? "changePositive" : "changeNegative";
  };

  // Format text like: “+2.50 (+1.22%)” or “-1.75 (-0.99%)”
  const formatChange = ({ change, changePercent }) => {
    const sign = change >= 0 ? "+" : "";
    return `${sign}${money.format(change)} (${sign}${changePercent.toFixed(2)}%)`;
  };

  // One metal: icon, name, price and the change since yesterday. The phone
  // layout hides the change (see Prices.css section 4).
  const renderMetal = ({ symbol, name, icon }) => {
    const metal = metals[symbol];
    return (
      <div className="metalItem" key={symbol}>
        <img src={icon} alt={`${name} icon`} className="metalIcon" />
        <span className="metalName">{name}</span>
        <span className="price">${money.format(metal.price)}</span>
        <span className={`${getClassName(metal.change)} changeAmount`}>
          {formatChange(metal)}
        </span>
      </div>
    );
  };

  // Wide screens show one row; when it doesn't fit, a carousel of pairs, which
  // phones show in their own, taller layout.
  const bannerRef = useRef(null);
  const layout = useCarouselLayout(bannerRef);
  const bannerClass =
    "banner" +
    (layout.carousel ? " bannerCarousel" : "") +
    (layout.phone ? " bannerPhone" : "") +
    // Before the first prices arrive: an empty strip, no text, same height.
    (metals ? "" : " bannerEmpty");

  return (
    <div
      className={bannerClass}
      style={layout.phone ? { height: PHONE_BANNER_HEIGHT } : undefined}
      ref={bannerRef}
    >
      {metals && (
        <>
          {METALS.map(renderMetal)}

          {layout.carousel && (
            <PriceCarousel
              slides={PAIRS.map((pair) => pair.map((i) => renderMetal(METALS[i])))}
              scale={layout.scale}
              hold={layout.phone ? PHONE_CAROUSEL_HOLD_MS : CAROUSEL_HOLD_MS}
            />
          )}
        </>
      )}
    </div>
  );
};

export default Prices;
