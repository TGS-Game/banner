import { useCallback, useLayoutEffect, useRef, useState } from "react";

// How long each pair of metals stays on screen before moving to the next pair.
export const CAROUSEL_HOLD_MS = 6000;
// The same for the phone layout.
export const PHONE_CAROUSEL_HOLD_MS = 5000;
// How long the move between slides takes (a slide, or a fade with "reduce motion").
export const CAROUSEL_TRANSITION_MS = 700;

// Height (px) of the phone banner. The phone layout (section 4 of Prices.css,
// class `bannerPhone`) is used in frames under 768px wide and at least this
// tall; shorter frames, like the site's 20px desktop iframe, keep the 24px banner.
export const PHONE_BANNER_HEIGHT = 40;
const PHONE_QUERY = `(max-width: 767.98px) and (min-height: ${PHONE_BANNER_HEIGHT}px)`;

// Height (px) of the tablet banner. The tablet layout (section 5 of Prices.css,
// class `bannerTablet`) shows all four metals in one row, styled like the phone
// layout, with no carousel. It is used in frames 768-1034px wide (the site's
// tablet band, where its frame is 40px) and at least this tall, whether or not
// the full row would fit; shorter frames get the row or the 24px carousel.
export const TABLET_BANNER_HEIGHT = 40;
const TABLET_QUERY = `(min-width: 768px) and (max-width: 1034.98px) and (min-height: ${TABLET_BANNER_HEIGHT}px)`;

// Space (px, before any scaling) kept either side of and between the metals on
// a slide; the phone layout's is tighter (Prices.css section 4 counts on it).
const SLIDE_SPACING = 12;
const PHONE_SLIDE_SPACING = 8;
// The least the slides are ever shrunk (see `scale` in useCarouselLayout).
// The most real slides need is 0.663 (the 24px carousel in a 320px frame).
const MIN_SCALE = 0.5;

// Timing of one full loop through `count` slides, each held for `hold` ms.
const loopTiming = (count, hold) => {
  const step = hold + CAROUSEL_TRANSITION_MS;
  const duration = count * step;
  return { step, duration, at: (ms) => ms / duration };
};

// Hold, slide left, hold, ... The track ends on a copy of the first slide, so
// going from the end of one loop to the start of the next is invisible.
const slideKeyframes = (count, hold) => {
  const { step, at } = loopTiming(count, hold);
  const frames = [];
  for (let i = 0; i < count; i++) {
    const transform = `translateX(${-100 * i}%)`;
    frames.push({ offset: at(i * step), transform });
    frames.push({ offset: at(i * step + hold), transform, easing: "ease-in-out" });
  }
  frames.push({ offset: 1, transform: `translateX(${-100 * count}%)` });
  return frames;
};

// "Reduce motion": the slides sit on top of each other. The current one fades
// out over the first half of the transition, the next fades in over the second.
const fadeKeyframes = (count, hold, index) => {
  const { step, at } = loopTiming(count, hold);
  const half = CAROUSEL_TRANSITION_MS / 2;
  const shownFrom = index * step;
  const shownUntil = shownFrom + hold;
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

// Decides between the one-row banner and the carousel by measuring the row
// (and whether the frame gets the phone or tablet layout, see PHONE_QUERY and
// TABLET_QUERY; tablet frames always get the tablet layout, in place of both):
// the carousel is used when the four metals' natural widths, plus the banner's
// gaps and padding, are wider than the page. Re-measures when prices, fonts,
// styles or the page size change. `scale` shrinks the slides only if the widest
// pair would not otherwise fit (a safety net; the CSS sizes normally fit).
export const useCarouselLayout = (bannerRef) => {
  const [layout, setLayout] = useState({
    carousel: false,
    phone: false,
    tablet: false,
    scale: 1,
  });

  const measure = useCallback(() => {
    const phone = window.matchMedia(PHONE_QUERY).matches;
    const tablet = window.matchMedia(TABLET_QUERY).matches;
    const banner = bannerRef.current;
    const items = banner ? [...banner.querySelectorAll(":scope > .metalItem")] : [];
    if (!items.length) {
      // Before the first prices: no row to measure, but the phone and tablet
      // heights still apply.
      setLayout((prev) =>
        prev.phone === phone && prev.tablet === tablet
          ? prev
          : { ...prev, phone, tablet }
      );
      return;
    }

    const style = getComputedStyle(banner);
    const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
    const gap = parseFloat(style.columnGap) || 0;
    const rowWidth =
      items.reduce((sum, item) => sum + item.getBoundingClientRect().width, 0) +
      gap * (items.length - 1) +
      padding;
    // The tablet layout also hides the row (see `.bannerCarousel > .metalItem`).
    const carousel = tablet || rowWidth > document.documentElement.clientWidth;

    // Measure the slides as laid out (offsetWidth ignores the scale transform).
    let scale = 1;
    const track = banner.querySelector(".carouselTrack");
    if (carousel && track) {
      const spacing = phone ? PHONE_SLIDE_SPACING : SLIDE_SPACING;
      const slideWidth = Math.max(
        ...[...track.querySelectorAll(".carouselPair")].map(
          (pair) =>
            [...pair.children].reduce((sum, item) => sum + item.offsetWidth + 1, 0) +
            (pair.children.length + 1) * spacing
        )
      );
      scale = Math.min(1, Math.floor((track.clientWidth / slideWidth) * 1000) / 1000);
      // A measure taken before the styles apply can come out near 0, which
      // draws nothing; real slides never need much shrinking.
      scale = Math.max(MIN_SCALE, scale);
    }

    setLayout((prev) =>
      prev.carousel === carousel &&
      prev.phone === phone &&
      prev.tablet === tablet &&
      prev.scale === scale
        ? prev
        : { carousel, phone, tablet, scale }
    );
  }, [bannerRef]);

  // Re-measures when the frame resizes, and whenever the banner or any metal
  // changes size however that happens: fonts loading, or the stylesheet
  // applying after the first measure (WebKit can run this before Prices.css,
  // waiting on its font @import, applies; that measure shrank the slides to
  // nothing and, with no later resize, the banner stayed blank).
  const observer = useRef(null);
  useLayoutEffect(() => {
    let frame = 0;
    if (typeof ResizeObserver !== "undefined") {
      // In the next frame, so a measure never resizes what is being observed
      // within the same observation.
      observer.current = new ResizeObserver(() => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(measure);
      });
    }
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(frame);
      observer.current?.disconnect();
      observer.current = null;
      window.removeEventListener("resize", measure);
    };
  }, [measure]);
  // After every render: measure, and watch the elements now on screen.
  useLayoutEffect(() => {
    measure();
    const banner = bannerRef.current;
    if (!observer.current || !banner) return;
    observer.current.disconnect();
    observer.current.observe(banner);
    banner.querySelectorAll(".metalItem").forEach((item) => observer.current.observe(item));
  });

  return layout;
};

// Shows each slide (an array of metal items) in turn, on an endless loop,
// holding each for `hold` ms.
// Runs on the Web Animations API, so when new prices arrive React only updates
// the text in place: the animation keeps its position and timing.
const PriceCarousel = ({ slides, scale, hold = CAROUSEL_HOLD_MS }) => {
  const trackRef = useRef(null);
  const count = slides.length;

  useLayoutEffect(() => {
    const track = trackRef.current;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let animations = [];
    const start = () => {
      animations.forEach((animation) => animation.cancel());
      const timing = { duration: loopTiming(count, hold).duration, iterations: Infinity };
      animations = reduceMotion.matches
        ? [...track.children]
            .slice(0, count)
            .map((slide, i) => slide.animate(fadeKeyframes(count, hold, i), timing))
        : [track.animate(slideKeyframes(count, hold), timing)];
    };
    start();
    reduceMotion.addEventListener?.("change", start);
    return () => {
      reduceMotion.removeEventListener?.("change", start);
      animations.forEach((animation) => animation.cancel());
    };
  }, [count, hold]);

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
