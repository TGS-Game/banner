import React, { useState, useEffect, useRef } from "react";
import "./Prices.css";
import PriceCarousel, {
  useCarouselLayout,
  CAROUSEL_HOLD_MS,
  PHONE_CAROUSEL_HOLD_MS,
} from "./PriceCarousel";

// Replace these icon imports with your actual icon paths:
import goldIcon from "./icons/gold-icon.png";
import silverIcon from "./icons/silver-icon.png";
import platinumIcon from "./icons/platinum-icon.png";
import palladiumIcon from "./icons/palladium-icon.png";

// The four metals, in banner order.
const METALS = [
  { symbol: "USDXAU", name: "Gold", icon: goldIcon },
  { symbol: "USDXAG", name: "Silver", icon: silverIcon },
  { symbol: "USDXPT", name: "Platinum", icon: platinumIcon },
  { symbol: "USDXPD", name: "Palladium", icon: palladiumIcon },
];

// Narrow screens show two metals at a time (indexes into METALS); the 80px
// phone layout shows one at a time instead.
const PAIRS = [
  [0, 1], // Gold + Silver
  [2, 3], // Platinum + Palladium
];

const Prices = () => {
  const [prices, setPrices] = useState(null);            // Today’s prices
  const [yesterdayPrices, setYesterdayPrices] = useState(null); // Yesterday’s prices
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        // 1) Fetch Today’s Latest Prices
        const latestResponse = await fetch(
          "https://api.metalpriceapi.com/v1/latest?api_key=98ce31de34ecaadcd00d49d12137a56a&base=USD&symbols=XAU,XAG,XPT,XPD"
        );
        if (!latestResponse.ok) {
          throw new Error("Error fetching latest prices");
        }
        const latestData = await latestResponse.json();
        setPrices(latestData.rates);

        // 2) Calculate “Yesterday’s” Date String (YYYY-MM-DD)
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const year = yesterday.getFullYear();
        const month = String(yesterday.getMonth() + 1).padStart(2, "0");
        const day = String(yesterday.getDate()).padStart(2, "0");
        const dateStr = `${year}-${month}-${day}`;

        // 3) Fetch Yesterday’s Prices (Requires Historical Data in Your Plan)
        const historicalUrl = `https://api.metalpriceapi.com/v1/${dateStr}?api_key=98ce31de34ecaadcd00d49d12137a56a&base=USD&symbols=XAU,XAG,XPT,XPD`;
        const yesterdayResponse = await fetch(historicalUrl);
        if (!yesterdayResponse.ok) {
          throw new Error("Error fetching yesterday's prices");
        }
        const yesterdayData = await yesterdayResponse.json();
        setYesterdayPrices(yesterdayData.rates);
      } catch (err) {
        setError(err.message);
      }
    };

    fetchData();
    // Optional: Auto-refresh every 60 seconds
    const interval = setInterval(fetchData, 60000);
    return () => clearInterval(interval);
  }, []);

  // Helper function: compute difference and percent change
  const getChangeData = (symbolToday, symbolYesterday) => {
    if (!prices || !yesterdayPrices) return null;
    const todayPrice = prices[symbolToday];
    const ydayPrice = yesterdayPrices[symbolYesterday];
    if (!todayPrice || !ydayPrice) return null;

    const difference = todayPrice - ydayPrice;
    const percentChange = (difference / ydayPrice) * 100;
    return { difference, percentChange };
  };

  // Return appropriate class name (for red/green text)
  const getClassName = (difference) => {
    if (difference == null) return "";
    return difference >= 0 ? "changePositive" : "changeNegative";
  };

  // Format text like: “+2.50 (+1.22%)” or “-1.75 (-0.99%)”
  const formatChange = (changeObj) => {
    if (!changeObj) return "...";
    const { difference, percentChange } = changeObj;
    const sign = difference >= 0 ? "+" : "";
    return `${sign}${difference.toFixed(2)} (${sign}${percentChange.toFixed(2)}%)`;
  };

  // Percent only, e.g. “+1.2%”: used by the phone carousel instead of formatChange
  const formatPercent = (changeObj) => {
    if (!changeObj) return "...";
    const { difference, percentChange } = changeObj;
    const sign = difference >= 0 ? "+" : "";
    return `${sign}${percentChange.toFixed(1)}%`;
  };

  // One metal: icon, name, price and the change since yesterday. Only one of
  // the two change spans is shown: the amount + percent in the row, the
  // percent alone in the phone carousel (see Prices.css section 4).
  const renderMetal = ({ symbol, name, icon }) => {
    const change = getChangeData(symbol, symbol);
    const changeClass = getClassName(change?.difference);
    return (
      <div className="metalItem" key={symbol}>
        <img src={icon} alt={`${name} icon`} className="metalIcon" />
        <span className="metalName">{name}</span>
        <span className="price">${prices[symbol]?.toFixed(2)}</span>
        <span className={`${changeClass} changeAmount`}>{formatChange(change)}</span>
        <span className={`${changeClass} changePercent`}>{formatPercent(change)}</span>
      </div>
    );
  };

  // Wide screens show one row; when it doesn't fit, a carousel of pairs, or
  // of single metals in the 80px phone layout.
  const bannerRef = useRef(null);
  const layout = useCarouselLayout(bannerRef);

  return (
    <div className={layout.carousel ? "banner bannerCarousel" : "banner"} ref={bannerRef}>
      {error && <span className="errorMsg">Error: {error}</span>}

      {!error && (!prices || !yesterdayPrices) && (
        <span className="loadingMsg">Loading metal prices...</span>
      )}

      {!error && prices && yesterdayPrices && (
        <>
          {METALS.map(renderMetal)}

          {layout.carousel && (
            <PriceCarousel
              slides={
                layout.single
                  ? METALS.map((metal) => [renderMetal(metal)])
                  : PAIRS.map((pair) => pair.map((i) => renderMetal(METALS[i])))
              }
              scale={layout.scale}
              hold={layout.single ? PHONE_CAROUSEL_HOLD_MS : CAROUSEL_HOLD_MS}
            />
          )}
        </>
      )}
    </div>
  );
};

export default Prices;
