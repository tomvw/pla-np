export function marquee(
  node,
  { lowPowerMode = false, pageVisible = true, baseSpeed = 30, pauseDuration = 2000 } = {},
) {
  if (lowPowerMode) return;

  const span = node.querySelector("span");
  if (!span) return;

  span.style.display = "inline-block";
  span.style.whiteSpace = "nowrap";

  const slide = node.closest(".fade-slide");
  const isActive = () => {
    if (!slide) return true;
    return pageVisible && slide.classList.contains("visible");
  };

  let animation = null;

  function stopAnimation(reset = true) {
    if (animation) {
      animation.cancel();
      animation = null;
    }
    if (reset) span.style.transform = "";
  }

  function refreshAnimation() {
    stopAnimation();

    if (!isActive()) return;

    const distance = Math.max(0, span.scrollWidth - node.clientWidth);
    if (distance <= 0) return;

    const travelTime = Math.max((distance / baseSpeed) * 1000, 1);
    const totalDuration = travelTime + pauseDuration * 2;
    const pauseRatio = pauseDuration / totalDuration;

    animation = span.animate(
      [
        { transform: "translateX(0px)", offset: 0 },
        { transform: "translateX(0px)", offset: pauseRatio },
        {
          transform: `translateX(${-distance}px)`,
          offset: 1 - pauseRatio,
        },
        { transform: `translateX(${-distance}px)`, offset: 1 },
      ],
      {
        duration: totalDuration,
        iterations: Infinity,
        direction: "alternate",
        easing: "linear",
        fill: "both",
      },
    );
  }

  const resizeObserver = new ResizeObserver(() => {
    refreshAnimation();
  });
  resizeObserver.observe(node);

  let slideObserver = null;
  if (slide) {
    slideObserver = new MutationObserver(() => {
      if (isActive()) {
        refreshAnimation();
      } else {
        stopAnimation();
      }
    });
    slideObserver.observe(slide, {
      attributes: true,
      attributeFilter: ["class"],
    });
  }

  const textObserver = new MutationObserver(() => {
    refreshAnimation();
  });
  textObserver.observe(span, {
    childList: true,
    characterData: true,
    subtree: true,
  });

  refreshAnimation();

  return {
    update(nextParams = {}) {
      lowPowerMode = !!nextParams.lowPowerMode;
      pageVisible = nextParams.pageVisible ?? pageVisible;
      baseSpeed = nextParams.baseSpeed ?? baseSpeed;
      pauseDuration = nextParams.pauseDuration ?? pauseDuration;

      if (lowPowerMode) {
        stopAnimation();
        return;
      }

      refreshAnimation();
    },
    destroy() {
      stopAnimation();
      resizeObserver.disconnect();
      if (slideObserver) slideObserver.disconnect();
      textObserver.disconnect();
      span.style.transform = "";
    },
  };
}

export function smoothImage(node, params) {
  let { src, isBg = false, lowPowerMode = false } = params || {};
  let lastSrc = null;
  let pending = null;

  const parent = node.parentElement;

  function fadeOutOldBackground(url, transitionMs, easing) {
    const previousBackground = node.style.backgroundImage;
    const hasPrevious =
      previousBackground &&
      previousBackground !== "none" &&
      previousBackground !== `url("${url}")` &&
      previousBackground !== `url(${url})`;

    try {
      node.style.backgroundImage = `url(${url})`;
    } catch {}

    if (!hasPrevious) return;

    const overlay = document.createElement("div");
    overlay.className = "bg-overlay";
    overlay.style.backgroundImage = previousBackground;
    overlay.style.opacity = "1";
    overlay.style.transition = `opacity ${transitionMs}ms ${easing}`;
    node.appendChild(overlay);

    requestAnimationFrame(() => {
      overlay.style.opacity = "0";
    });

    setTimeout(() => {
      overlay.remove();
    }, transitionMs + 100);
  }

  function fadeOutOldArt(url, transitionMs, easing) {
    const previousSrc = node.currentSrc || node.getAttribute("src");
    const hasPrevious = previousSrc && previousSrc !== url;

    if (hasPrevious && parent && getComputedStyle(parent).position === "static") {
      parent.style.position = "relative";
    }

    let overlay = null;
    if (hasPrevious && parent) {
      overlay = document.createElement("img");
      overlay.className = "art-overlay";
      overlay.src = previousSrc;
      overlay.alt = node.alt || "Album Art";
      overlay.style.opacity = "1";
      overlay.style.transition = `opacity ${transitionMs}ms ${easing}`;
      parent.appendChild(overlay);
    }

    try {
      node.src = url;
    } catch {}

    if (!overlay) return;

    requestAnimationFrame(() => {
      overlay.style.opacity = "0";
    });

    setTimeout(() => {
      overlay?.remove();
    }, transitionMs + 100);
  }

  function doLoad(newSrc) {
    if (!newSrc) return;

    const url = `/api/art?thumb=${encodeURIComponent(newSrc)}`;
    if (newSrc === lastSrc) return;
    lastSrc = newSrc;

    if (lowPowerMode) {
      pending = null;
      if (isBg) {
        node.style.backgroundImage = `url(${url})`;
      } else {
        node.src = url;
      }
      return;
    }

    const transitionMs = 2800;
    const easing = "cubic-bezier(0.16, 1, 0.3, 1)";
    const img = new Image();
    pending = img;
    img.onload = () => {
      if (pending !== img) return;
      pending = null;

      if (isBg) {
        fadeOutOldBackground(url, transitionMs, easing);
      } else {
        fadeOutOldArt(url, transitionMs, easing);
      }
    };
    img.onerror = () => {
      pending = null;
    };
    img.src = url;
  }

  doLoad(src);

  return {
    update(nextParams) {
      src = nextParams?.src;
      isBg = !!nextParams?.isBg;
      lowPowerMode = !!nextParams?.lowPowerMode;
      doLoad(src);
    },
    destroy() {
      pending = null;
    },
  };
}
