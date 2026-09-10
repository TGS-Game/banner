import { useCallback, useLayoutEffect, useRef, useState } from "react";

// How long each pair of metals stays on screen before moving to the next pair.
export const CAROUSEL_HOLD_MS = 6000;
// How long the move between pairs takes (a slide, or a fade with "reduce motion").
export const CAROUSEL_TRANSITION_MS = 700;

// Space (px, before any scaling) kept either side of and between the metals on a slide.
const SLIDE_SPACING = 12;

// Timing of one full loop through `count` slides.
const loopTiming = (count) => {
  const step = CAROUSEL_HOLD_MS + CAROUSEL_TRANSITION_MS;
  const duration = count * step;
  return { step, duration, at: (ms) => ms / duration };
};

// Hold, slide left, hold, ... The track ends on a copy of the first slide, so
// going from the end of one loop to the start of the next is invisible.
const slideKeyframes = (count) => {
  const { step, at } = loopTiming(count);
  const frames = [];
  for (let i = 0; i < count; i++) {
    const transform = `translateX(${-100 * i}%)`;
    frames.push({ offset: at(i * step), transform });
    frames.push({ offset: at(i * step + CAROUSEL_HOLD_MS), transform, easing: "ease-in-out" });
  }
  frames.push({ offset: 1, transform: `translateX(${-100 * count}%)` });
  return frames;
};

// "Reduce motion": the slides sit on top of each other. The current one fades
// out over the first half of the transition, the next fades in over the second.
const fadeKeyframes = (count, index) => {
  const { step, at } = loopTiming(count);
  const half = CAROUSEL_TRANSITION_MS / 2;
  const shownFrom = index * step;
  const shownUntil = shownFrom + CAROUSEL_HOLD_MS;
  const fadeIn =
    index === 0
      ? [{ offset: 0, opacity: 1 }]
      : [
          { offset: 0, opacity: 0 },
          { offset: at(shownFrom - half), opacity: 0 },
          { offset: at(shownFrom), opacity: 1 },
        ];
  const fadeOut = [
    { offset: at(shownUntil), opacity: 1 },
    { offset: at(shownUntil + half), opacity: 0 },
  ];
  const end =
    index === 0
      ? [
          { offset: at(count * step - half), opacity: 0 },
          { offset: 1, opacity: 1 },
        ]
      : [{ offset: 1, opacity: 0 }];
  return [...fadeIn, ...fadeOut, ...end];
};

// Decides between the one-row banner and the carousel by measuring the row:
// the carousel is used when the four metals' natural widths, plus the banner's
// gaps and padding, are wider than the page. Re-measures when prices, fonts or
// the page size change. `scale` shrinks the slides only if the widest pair
// would not otherwise fit (a safety net; the CSS sizes normally fit).
export const useCarouselLayout = (bannerRef) => {
  const [layout, setLayout] = useState({ carousel: false, scale: 1 });

  const measure = useCallback(() => {
    const banner = bannerRef.current;
    const items = banner ? [...banner.querySelectorAll(":scope > .metalItem")] : [];
    if (!items.length) return;

    const style = getComputedStyle(banner);
    const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
    const gap = parseFloat(style.columnGap) || 0;
    const rowWidth =
      items.reduce((sum, item) => sum + item.getBoundingClientRect().width, 0) +
      gap * (items.length - 1) +
      padding;
    const carousel = rowWidth > document.documentElement.clientWidth;

    // Measure the slides as laid out (offsetWidth ignores the scale transform).
    let scale = 1;
    const track = banner.querySelector(".carouselTrack");
    if (carousel && track) {
      const slideWidth = Math.max(
        ...[...track.querySelectorAll(".carouselPair")].map(
          (pair) =>
            [...pair.children].reduce((sum, item) => sum + item.offsetWidth + 1, 0) +
            (pair.children.length + 1) * SLIDE_SPACING
        )
      );
      scale = Math.min(1, Math.floor((track.clientWidth / slideWidth) * 1000) / 1000);
    }

    setLayout((prev) =>
      prev.carousel === carousel && prev.scale === scale ? prev : { carousel, scale }
    );
  }, [bannerRef]);

  useLayoutEffect(() => measure());
  useLayoutEffect(() => {
    window.addEventListener("resize", measure);
    document.fonts?.addEventListener("loadingdone", measure);
    return () => {
      window.removeEventListener("resize", measure);
      document.fonts?.removeEventListener("loadingdone", measure);
    };
  }, [measure]);

  return layout;
};

// Shows each slide (an array of metal items) in turn, on an endless loop.
// Runs on the Web Animations API, so when new prices arrive React only updates
// the text in place: the animation keeps its position and timing.
const PriceCarousel = ({ slides, scale }) => {
  const trackRef = useRef(null);
  const count = slides.length;

  useLayoutEffect(() => {
    const track = trackRef.current;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let animations = [];
    const start = () => {
      animations.forEach((animation) => animation.cancel());
      const timing = { duration: loopTiming(count).duration, iterations: Infinity };
      animations = reduceMotion.matches
        ? [...track.children]
            .slice(0, count)
            .map((slide, i) => slide.animate(fadeKeyframes(count, i), timing))
        : [track.animate(slideKeyframes(count), timing)];
    };
    start();
    reduceMotion.addEventListener?.("change", start);
    return () => {
      reduceMotion.removeEventListener?.("change", start);
      animations.forEach((animation) => animation.cancel());
    };
  }, [count]);

  // Lay the pair out at full size, then shrink it to the slide's width.
  const pairStyle =
    scale < 1 ? { width: `${100 / scale}%`, transform: `scale(${scale})` } : undefined;

  return (
    <div className="carousel">
      <div className="carouselTrack" ref={trackRef}>
        {[...slides, slides[0]].map((slide, i) => (
          <div
            key={i}
            className={i < count ? "carouselSlide" : "carouselSlide carouselCopy"}
            aria-hidden={i < count ? undefined : true}
          >
            <div className="carouselPair" style={pairStyle}>
              {slide}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default PriceCarousel;
