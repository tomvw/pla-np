<script>
  import { onMount, onDestroy } from "svelte";
  import { writable, derived, get } from "svelte/store";

  // Stores
  export const sessions = writable([]);
  export const activeIndex = writable(0);

  let progressTimer;
  let rotationTimer;
  let refreshTimer;

  let config;
  let configLoaded = false;
  let configVersion = null;

  let ALLOWED_PLAYERS = [];
  let ALLOWED_USERS = [];
  let ALLOWED_LIBRARIES = [];
  let ARTIST_DISPLAY = "both";
  let SHOW_USERNAME = true;
  let SHOW_PROGRESS = false;
  let SHOW_MEDIAINFO = true;
  let SHOW_CLIENTINFO = true;
  const SESSION_ROTATION_MS = 14000;
  const TRACK_TRANSITION_MS = 2800;
  const TRACK_TRANSITION_EASING = "cubic-bezier(0.16, 1, 0.3, 1)";
  const TRACK_TRANSITION_CLEANUP_MS = TRACK_TRANSITION_MS + 150;

  function getSyncedOffset(track, now = Date.now()) {
    if (!track) return 0;
    if (track.state !== "playing") return track.syncedOffset ?? track.localOffset ?? 0;
    const baseOffset = track.syncedOffset ?? track.localOffset ?? 0;
    const syncedAt = track.syncedAt ?? now;
    return Math.min(baseOffset + Math.max(0, now - syncedAt), track.duration || 0);
  }

  function getSessionIdentity(track) {
    return (
      track.sessionKey ||
      [track.player, track.product, track.user].filter(Boolean).join("::")
    );
  }

  function getTrackSignature(track) {
    return [track.guid, track.updatedAt, track.title, track.album, track.duration]
      .filter((value) => value !== undefined && value !== null)
      .join("::");
  }

  function getDisplayArtist(session) {
    if (!session) return "";
    if (
      session.albumArtist &&
      session.albumArtist.toLowerCase() !== "various artists"
    ) {
      return `${session.albumArtist} \/ ${session.trackArtist}`;
    }
    return session.trackArtist || "Unknown Artist";
  }

  function getRenderedArtist(session) {
    if (!session) return "Unknown Artist";
    if (ARTIST_DISPLAY === "both") {
      return getDisplayArtist(session);
    }
    if (
      ARTIST_DISPLAY === "album" &&
      session.albumArtist &&
      session.albumArtist.toLowerCase() !== "various artists"
    ) {
      return session.albumArtist;
    }
    if (ARTIST_DISPLAY === "track" && session.trackArtist) {
      return session.trackArtist;
    }
    return "Unknown Artist";
  }

  function getTextSnapshot(session) {
    if (!session) return null;
    const mediaInfo = getMediaInfoParts(session);
    const clientInfo = getClientInfoParts(session);
    return {
      identityKey: session.identityKey,
      title: session.title,
      artist: getRenderedArtist(session),
      album: session.album,
      year: session.year,
      codec: mediaInfo.codec,
      mediaBadges: mediaInfo.badges,
      clientBadges: clientInfo.badges,
    };
  }

  async function loadConfig({ reloadOnChange = false } = {}) {
    try {
      const res = await fetch("/api/config", { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load config");

      const nextConfig = await res.json();
      const nextVersion = nextConfig.CONFIG_VERSION ?? null;

      if (
        reloadOnChange &&
        configLoaded &&
        configVersion !== null &&
        nextVersion !== null &&
        nextVersion !== configVersion
      ) {
        window.location.reload();
        return;
      }

      config = nextConfig;
      configVersion = nextVersion;

      // Normalize allowed lists to lowercase trimmed strings for robust matching
      ALLOWED_PLAYERS = (config.PLAYERS || [])
        .map((p) => String(p).toLowerCase().trim())
        .filter(Boolean);
      ALLOWED_USERS = (config.USERS || [])
        .map((u) => String(u).toLowerCase().trim())
        .filter(Boolean);
      ALLOWED_LIBRARIES = (config.LIBRARIES || [])
        .map((l) => String(l).toLowerCase().trim())
        .filter(Boolean);
      // ARTIST_DISPLAY determines how to show artist info: 'track' = track artist only, 'album' = album artist only, 'both' = "album artist — track artist"
      ARTIST_DISPLAY = ["track", "album", "both"].includes(
        config.ARTIST_DISPLAY,
      )
        ? config.ARTIST_DISPLAY
        : "both";
      // SHOW_USERNAME determines whether to display the session user in the client line
      SHOW_USERNAME =
        config.SHOW_USERNAME === undefined
          ? true
          : Boolean(config.SHOW_USERNAME);
      // SHOW_PROGRESS determines whether to show the progress bar and time info
      SHOW_PROGRESS =
        config.SHOW_PROGRESS === undefined
          ? true
          : Boolean(config.SHOW_PROGRESS);
      // SHOW_MEDIAINFO determines whether to show codec/samplingRate/bitDepth info
      SHOW_MEDIAINFO =
        config.SHOW_MEDIAINFO === undefined
          ? true
          : Boolean(config.SHOW_MEDIAINFO);
      // SHOW_CLIENTINFO determines whether to show client product/player and optionally username
      SHOW_CLIENTINFO =
        config.SHOW_CLIENTINFO === undefined
          ? true
          : Boolean(config.SHOW_CLIENTINFO);

      configLoaded = true;
    } catch (err) {
      console.error("Failed to load runtime config", err);
    }
  }

  // Fetch Plex now playing sessions
  async function fetchNowPlaying() {
    if (!configLoaded) return;
    try {
      const res = await fetch("/api/sessions");
      const xmlText = await res.text();
      const parser = new DOMParser();
      const xml = parser.parseFromString(xmlText, "application/xml");

      const rawNodes = Array.from(xml.querySelectorAll("Track"));
      const fetchedAt = Date.now();
      let newTracks = rawNodes.map((track) => {
        const player = track.querySelector("Player");
        const user = track.querySelector("User");
        const mediainfo = track.querySelector("Part");

        // Locate Media and the audio Stream (streamType=2) under Part when available
        const mediaElem = track.querySelector("Media");
        const audioStream =
          (mediainfo && mediainfo.querySelector('Stream[streamType="2"]')) ||
          (mediainfo && mediainfo.querySelector("Stream")) ||
          track.querySelector("Stream");

        const trackArtist = (
          track.getAttribute("originalTitle") ||
          track.getAttribute("grandparentTitle") ||
          ""
        ).trim();
        const albumArtistRaw = (
          track.getAttribute("grandparentTitle") || ""
        ).trim();
        const albumArtist =
          albumArtistRaw &&
          albumArtistRaw.toLowerCase() !== "various artists" &&
          albumArtistRaw.toLowerCase() !== trackArtist.toLowerCase()
            ? albumArtistRaw
            : "";

        // Prefer attributes from the audio Stream, then Media, then Part
        const codecRaw =
          (audioStream &&
            (audioStream.getAttribute("codec") ||
              audioStream.getAttribute("audioCodec"))) ||
          (mediaElem && mediaElem.getAttribute("audioCodec")) ||
          (mediainfo && mediainfo.getAttribute("container")) ||
          "";

        const samplingRateAttr =
          (audioStream && audioStream.getAttribute("samplingRate")) ||
          (mediaElem && mediaElem.getAttribute("samplingRate")) ||
          "";
        const samplingRateRaw = samplingRateAttr
          ? Number(samplingRateAttr)
          : NaN;
        let samplingRateKHz = "";
        if (!isNaN(samplingRateRaw) && samplingRateRaw > 0) {
          const val = Math.round((samplingRateRaw / 1000) * 10) / 10; // rounded to 0.1 kHz
          samplingRateKHz =
            val % 1 === 0 ? String(val.toFixed(0)) : String(val.toFixed(1));
        }

        const bitDepthAttr =
          (audioStream && audioStream.getAttribute("bitDepth")) ||
          (mediaElem && mediaElem.getAttribute("bitDepth")) ||
          "";

        const bitrateAttr =
          (audioStream && audioStream.getAttribute("bitrate")) ||
          (mediaElem && mediaElem.getAttribute("bitrate")) ||
          (mediainfo && mediainfo.getAttribute("bitrate")) ||
          "";
        const bitrateNum = bitrateAttr ? Number(bitrateAttr) : NaN;
        const bitrateKbps =
          !isNaN(bitrateNum) && bitrateNum > 0 ? Math.round(bitrateNum) : "";

        const session = {
          sessionKey: track.getAttribute("sessionKey"),
          guid: track.getAttribute("guid"),
          updatedAt: track.getAttribute("updatedAt"),
          title: track.getAttribute("title")?.trim() || "",
          year: track.getAttribute("parentYear"),
          trackArtist,
          albumArtist,
          album: track.getAttribute("parentTitle")?.trim() || "",
          art:
            track.getAttribute("parentThumb") ||
            track.getAttribute("grandparentThumb") ||
            "",
          duration: Number(track.getAttribute("duration") || 0),
          localOffset: Number(track.getAttribute("viewOffset") || 0),
          library: track.getAttribute("librarySectionTitle"),
          state: player?.getAttribute("state"),
          player: player?.getAttribute("title"),
          product: player?.getAttribute("product"),
          user: user?.getAttribute("title"),
          codec: codecRaw ? codecRaw.toUpperCase() : "",
          bitDepth: bitDepthAttr,
          samplingRate: samplingRateKHz,
          bitrate: bitrateKbps,
        };

        return {
          ...session,
          syncedOffset: session.localOffset,
          syncedAt: fetchedAt,
          identityKey: getSessionIdentity(session),
          trackSignature: getTrackSignature(session),
        };
      });

      // Filter by allowed players if config is set
      // Apply filters in a single pass (AND semantics)
      if (
        ALLOWED_PLAYERS.length ||
        ALLOWED_USERS.length ||
        ALLOWED_LIBRARIES.length
      ) {
        newTracks = newTracks.filter((track) => {
          const p = String(track.player || "")
            .toLowerCase()
            .trim();
          const u = String(track.user || "")
            .toLowerCase()
            .trim();
          const l = String(track.library || "")
            .toLowerCase()
            .trim();
          if (ALLOWED_PLAYERS.length && !ALLOWED_PLAYERS.includes(p))
            return false;
          if (ALLOWED_USERS.length && !ALLOWED_USERS.includes(u)) return false;
          if (ALLOWED_LIBRARIES.length && !ALLOWED_LIBRARIES.includes(l))
            return false;
          return true;
        });
      }

      const current = get(sessions);
      const activeSessionBefore = current[get(activeIndex) || 0];
      const activeIdentityBefore = activeSessionBefore?.identityKey;

      const currentByIdentity = new Map(
        current.map((session) => [session.identityKey, session]),
      );
      const incomingByIdentity = new Map(
        newTracks.map((track) => [track.identityKey, track]),
      );

      // Preserve current ordering for active sessions to avoid visual churn when
      // Plex returns the same sessions in a different order between polls.
      const orderedTracks = [
        ...current
          .map((session) => incomingByIdentity.get(session.identityKey))
          .filter(Boolean),
        ...newTracks.filter((track) => !currentByIdentity.has(track.identityKey)),
      ];

      // Merge tracks: each client/session keeps a stable slide while the content
      // inside it updates when the track changes.
      const merged = orderedTracks.map((track) => {
        const existing = currentByIdentity.get(track.identityKey);

        if (!existing) {
          return { ...track };
        }

        if (existing.trackSignature !== track.trackSignature) {
          return { ...track };
        }

        return {
          ...track,
          localOffset: getSyncedOffset(track, fetchedAt),
        };
      });

      let nextActiveIndex = 0;
      if (merged.length > 0) {
        const preservedIndex = merged.findIndex(
          (session) => session.identityKey === activeIdentityBefore,
        );
        const currentIndex = get(activeIndex) || 0;
        nextActiveIndex =
          preservedIndex >= 0
            ? preservedIndex
            : Math.min(currentIndex, merged.length - 1);
      }

      sessions.set(merged);

      // If we transitioned from no sessions to some, ensure activeIndex is valid and start slideshow
      if (merged.length > 0) {
        activeIndex.set(nextActiveIndex);
        if (current.length === 0) {
          // start at the first playing session
          const startIdx = nextPlayingIndex(0, merged);
          activeIndex.set(startIdx);
          startSlideshow();
        } else if (merged.length !== current.length) {
          startSlideshow();
        }
      } else {
        // no sessions — ensure activeIndex resets to 0 so UI shows "Nothing playing" consistently
        activeIndex.set(0);
      }

      // If the currently active session is now paused, immediately advance
      // to the next playing session so paused items exit the slideshow faster.
      const listAfter = merged;
      if (listAfter.length) {
        const ci = get(activeIndex) || 0;
        const active = listAfter[ci];
        if (active && active.state !== "playing") {
          const next = nextPlayingIndex(ci, listAfter);
          activeIndex.set(next);
        }
      }
    } catch (err) {
      console.error("Failed to fetch Plex sessions", err);
    }
  }

  function startProgress() {
    clearInterval(progressTimer);
    progressTimer = setInterval(() => {
      const now = Date.now();
      sessions.update((list) =>
        list.map((s) =>
          s.state === "playing"
            ? { ...s, localOffset: getSyncedOffset(s, now) }
            : s,
        ),
      );
    }, 250);
  }

  function startSlideshow() {
    clearInterval(rotationTimer);
    rotationTimer = setInterval(() => {
      const list = get(sessions);
      if (!list.length) return;
      const prev = get(activeIndex) || 0;
      const next = nextPlayingIndex(prev, list);
      if (next !== prev) {
        activeIndex.set(next);
      }
    }, SESSION_ROTATION_MS);
  }

  // Find the next playing session index after `current`.
  // If no other playing sessions exist, returns `current`.
  function nextPlayingIndex(current, list) {
    const n = list.length;
    if (n === 0) return 0;
    for (let offset = 1; offset < n; offset++) {
      const idx = (current + offset) % n;
      if (list[idx] && list[idx].state === "playing") return idx;
    }
    return current;
  }

  function startAutoRefresh() {
    clearInterval(refreshTimer);
    refreshTimer = setInterval(async () => {
      await loadConfig({ reloadOnChange: true });
      fetchNowPlaying();
    }, 15000);
  }

  const activeSession = derived(
    [sessions, activeIndex],
    ([$sessions, $activeIndex]) => $sessions[$activeIndex],
  );

  let previousActiveSession = null;
  let textOverlay = null;
  let textOverlayTimer = null;

  $: if ($activeSession) {
    const sameSessionTrackChanged =
      previousActiveSession &&
      previousActiveSession.identityKey === $activeSession.identityKey &&
      previousActiveSession.trackSignature !== $activeSession.trackSignature;

    if (sameSessionTrackChanged) {
      textOverlay = getTextSnapshot(previousActiveSession);
      if (textOverlayTimer) clearTimeout(textOverlayTimer);
      textOverlayTimer = setTimeout(() => {
        textOverlay = null;
        textOverlayTimer = null;
      }, TRACK_TRANSITION_CLEANUP_MS);
    }

    previousActiveSession = $activeSession;
  } else {
    previousActiveSession = null;
    textOverlay = null;
    if (textOverlayTimer) {
      clearTimeout(textOverlayTimer);
      textOverlayTimer = null;
    }
  }

  const format = (ms) => {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };

  const getProgressPercent = (session) => {
    if (!session?.duration) return 0;
    return Math.max(
      0,
      Math.min(100, (session.localOffset / session.duration) * 100),
    );
  };

  // Format media info string: show codec, samplingRate (kHz) and bitDepth.
  // Only include the '/' separator between samplingRate and bitDepth when both exist.
  const getMediaInfoParts = (s) => {
    if (!s) return { codec: "", details: "", badges: [] };
    const detailParts = [];
    if (s.samplingRate) detailParts.push(`${s.samplingRate}kHz`);
    if (s.bitDepth) detailParts.push(`${s.bitDepth}bit`);
    if (s.bitrate) detailParts.push(`${s.bitrate}kbps`);
    const badges = detailParts.length ? [detailParts.join(" / ")] : [];
    return {
      codec: s.codec || "",
      details: badges.join(" / "),
      badges,
    };
  };

  const getClientInfoParts = (s) => {
    if (!s) return { badges: [] };
    const badges = [];
    if (s.product) badges.push(s.product);
    if (s.player) badges.push(s.player);
    if (SHOW_USERNAME && s.user) badges.push(s.user);
    return { badges };
  };

  const formatMediaInfo = (s) => {
    const { codec, details } = getMediaInfoParts(s);
    return [codec, details].filter(Boolean).join(" — ");
  };

  const slideMarqueeControllers = new WeakMap();

  function getSlideMarqueeController(slide, { baseSpeed, pauseDuration }) {
    let controller = slideMarqueeControllers.get(slide);
    if (controller) return controller;

    const subscribers = new Set();
    let frame = null;
    let lastTime = 0;
    let paused = true;
    let pauseRemaining = pauseDuration;
    let direction = 1;
    let progress = 0;

    const isActive = () => slide.classList.contains("visible");

    function getMaxDistance() {
      let maxDistance = 0;
      subscribers.forEach((subscriber) => {
        maxDistance = Math.max(maxDistance, subscriber.getDistance());
      });
      return maxDistance;
    }

    function notify() {
      subscribers.forEach((subscriber) => {
        subscriber.update({ progress, paused, direction, active: isActive() });
      });
    }

    function step(time) {
      frame = null;

      if (!isActive()) {
        progress = 0;
        paused = true;
        pauseRemaining = pauseDuration;
        direction = 1;
        notify();
        frame = requestAnimationFrame(step);
        return;
      }

      if (!lastTime) lastTime = time;
      const delta = time - lastTime;
      lastTime = time;

      const maxDistance = getMaxDistance();
      if (maxDistance <= 0) {
        progress = 0;
        paused = true;
        pauseRemaining = pauseDuration;
        direction = 1;
        notify();
        frame = requestAnimationFrame(step);
        return;
      }

      if (paused) {
        pauseRemaining -= delta;
        if (pauseRemaining <= 0) {
          paused = false;
          pauseRemaining = 0;
        }
      } else {
        const travelTime = Math.max((maxDistance / baseSpeed) * 1000, 1);
        const deltaProgress = delta / travelTime;
        progress += direction * deltaProgress;

        if (progress >= 1) {
          progress = 1;
          direction = -1;
          paused = true;
          pauseRemaining = pauseDuration;
        } else if (progress <= 0) {
          progress = 0;
          direction = 1;
          paused = true;
          pauseRemaining = pauseDuration;
        }
      }

      notify();
      frame = requestAnimationFrame(step);
    }

    function ensureRunning() {
      if (frame) return;
      lastTime = 0;
      frame = requestAnimationFrame(step);
    }

    controller = {
      subscribe(subscriber) {
        subscribers.add(subscriber);
        ensureRunning();
        notify();
      },
      unsubscribe(subscriber) {
        subscribers.delete(subscriber);
        if (!subscribers.size && frame) {
          cancelAnimationFrame(frame);
          frame = null;
        }
      },
      refresh() {
        notify();
      },
    };

    slideMarqueeControllers.set(slide, controller);
    return controller;
  }

  // Slower marquee with pause
  export function marquee(node, { baseSpeed = 30, pauseDuration = 2000 } = {}) {
    const span = node.querySelector("span");
    if (!span) return;

    span.style.display = "inline-block";
    span.style.whiteSpace = "nowrap";
    span.style.willChange = "transform";

    let containerWidth = node.clientWidth;
    let textWidth = span.scrollWidth;

    const slide = node.closest(".fade-slide");
    const isActive = () => {
      if (!slide) return true;
      return slide.classList.contains("visible");
    };

    function getDistance() {
      containerWidth = node.clientWidth;
      textWidth = span.scrollWidth;
      return Math.max(0, textWidth - containerWidth);
    }

    function updatePosition({ progress, active }) {
      const distance = getDistance();
      if (!active || distance <= 0) {
        span.style.transform = "";
        return;
      }
      span.style.transform = `translateX(${-distance * progress}px)`;
    }

    const subscriber = {
      getDistance,
      update: updatePosition,
    };

    const controller = slide
      ? getSlideMarqueeController(slide, { baseSpeed, pauseDuration })
      : null;

    if (controller) {
      controller.subscribe(subscriber);
    } else {
      updatePosition({ progress: 0, active: true });
    }

    const resizeObserver = new ResizeObserver(() => {
      if (controller) {
        controller.refresh();
      } else {
        updatePosition({ progress: 0, active: true });
      }
    });
    resizeObserver.observe(node);

    let mo = null;
    if (slide) {
      mo = new MutationObserver(() => {
        controller?.refresh();
      });
      mo.observe(slide, { attributes: true, attributeFilter: ["class"] });
    }

    return {
      destroy() {
        controller?.unsubscribe(subscriber);
        resizeObserver.disconnect();
        if (mo) mo.disconnect();
        span.style.transform = "";
      },
    };
  }

  // Action to smoothly preload and crossfade images for img elements or background divs.
  // Usage: use:smoothImage={{ src: session.art, isBg: true }} or use:smoothImage={{ src: session.art }}
  export function smoothImage(node, params) {
    let { src, isBg = false } = params || {};
    let lastSrc = null;
    let pending = null;

    const parent = node.parentElement;

    function fadeOutOldBackground(url) {
      const previousBackground = node.style.backgroundImage;
      const hasPrevious =
        previousBackground &&
        previousBackground !== "none" &&
        previousBackground !== `url("${url}")` &&
        previousBackground !== `url(${url})`;

      try {
        node.style.backgroundImage = `url(${url})`;
      } catch (e) {}

      if (!hasPrevious) return;

      const overlay = document.createElement("div");
      overlay.className = "bg-overlay";
      overlay.style.backgroundImage = previousBackground;
      overlay.style.opacity = "1";
      overlay.style.transition = `opacity ${TRACK_TRANSITION_MS}ms ${TRACK_TRANSITION_EASING}`;
      node.appendChild(overlay);

      requestAnimationFrame(() => {
        overlay.style.opacity = "0";
      });

      setTimeout(() => {
        overlay.remove();
      }, TRACK_TRANSITION_MS + 100);
    }

    function fadeOutOldArt(url) {
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
        overlay.style.transition = `opacity ${TRACK_TRANSITION_MS}ms ${TRACK_TRANSITION_EASING}`;
        parent.appendChild(overlay);
      }

      try {
        node.src = url;
      } catch (e) {}

      if (!overlay) return;

      requestAnimationFrame(() => {
        overlay.style.opacity = "0";
      });

      setTimeout(() => {
        overlay?.remove();
      }, TRACK_TRANSITION_MS + 100);
    }

    function doLoad(newSrc) {
      if (!newSrc) return;
      const url = `/api/art?thumb=${encodeURIComponent(newSrc)}`;
      if (newSrc === lastSrc) return;
      lastSrc = newSrc;

      const img = new Image();
      pending = img;
      img.onload = () => {
        if (pending !== img) return;
        pending = null;

        if (isBg) {
          fadeOutOldBackground(url);
        } else {
          fadeOutOldArt(url);
        }
      };
      img.onerror = () => {
        pending = null;
      };
      img.src = url;
    }

    doLoad(src);

    return {
      update(newParams) {
        src = newParams?.src;
        isBg = !!newParams?.isBg;
        doLoad(src);
      },
      destroy() {
        pending = null;
      },
    };
  }

  onMount(async () => {
    await loadConfig();

    if (!configLoaded) return;

    fetchNowPlaying();
    if (SHOW_PROGRESS) {
      startProgress();
    }
    startSlideshow();
    startAutoRefresh();
  });

  onDestroy(() => {
    clearInterval(progressTimer);
    clearInterval(rotationTimer);
    clearInterval(refreshTimer);
    if (textOverlayTimer) clearTimeout(textOverlayTimer);
  });
</script>

{#if !configLoaded}
  <div class="idle">Loading...</div>
{:else if $activeSession}
  <div class="fade-wrapper">
    {#each $sessions as session, i (session.identityKey)}
      <div
        class={`fade-slide ${i === $activeIndex ? "visible" : ""}`}
      >
        <div class="bg" use:smoothImage={{ src: session.art, isBg: true }}></div>

        <div class="player">
          <div class="art-container">
            <img class="art" alt="Album Art" use:smoothImage={{ src: session.art }} />
          </div>

          <div class="info">
            <div class="title" use:marquee><span>{session.title}</span></div>
            <div class="artist" use:marquee>
              <span>
                {getRenderedArtist(session)}
              </span>
            </div>
            <div class="album" use:marquee>
              <span
                >{session.album}
                {#if session.year}({session.year}){/if}</span
              >
            </div>

            <div class="meta-stack">
              {#if SHOW_PROGRESS}
                <div
                  class="progress-track"
                  role="progressbar"
                  aria-label="Track progress"
                  aria-valuemin="0"
                  aria-valuemax={session.duration}
                  aria-valuenow={session.localOffset}
                >
                  <div
                    class="progress-fill"
                    style={`width: ${getProgressPercent(session)}%;`}
                  >
                    <div class="progress-cap"></div>
                  </div>
                </div>
                <div class="time">
                  {format(session.localOffset)} / {format(session.duration)}
                </div>
              {/if}
              {#if SHOW_MEDIAINFO}
                {@const mediaInfo = getMediaInfoParts(session)}
                <div class="badge-row mediainfo">
                  {#if mediaInfo.codec}
                    <span class="info-badge codec-badge">{mediaInfo.codec}</span>
                  {/if}
                  {#each mediaInfo.badges as badge}
                    <span class="info-badge meta-badge">{badge}</span>
                  {/each}
                </div>
              {/if}
              {#if SHOW_CLIENTINFO && SHOW_MEDIAINFO}
                {@const clientInfo = getClientInfoParts(session)}
                <div class="badge-row client">
                  {#each clientInfo.badges as badge}
                    <span class="info-badge meta-badge">{badge}</span>
                  {/each}
                </div>
              {:else if SHOW_CLIENTINFO && !SHOW_MEDIAINFO}
                {@const clientInfo = getClientInfoParts(session)}
                <div class="badge-row client-nomediainfo">
                  {#each clientInfo.badges as badge}
                    <span class="info-badge meta-badge">{badge}</span>
                  {/each}
                </div>
              {/if}
            </div>

            {#if textOverlay && i === $activeIndex && session.identityKey === textOverlay.identityKey}
              <div class="info-overlay ambient-fade-out" aria-hidden="true">
                <div class="title"><span>{textOverlay.title}</span></div>
                <div class="artist">
                  <span>{textOverlay.artist}</span>
                </div>
                <div class="album">
                  <span
                    >{textOverlay.album}
                    {#if textOverlay.year}({textOverlay.year}){/if}</span
                  >
                </div>

                {#if SHOW_PROGRESS}
                  <div class="progress-spacer"></div>
                  <div class="time-spacer"></div>
                {/if}
                {#if SHOW_MEDIAINFO}
                  <div class="badge-row mediainfo">
                    {#if textOverlay.codec}
                      <span class="info-badge codec-badge">{textOverlay.codec}</span>
                    {/if}
                    {#each textOverlay.mediaBadges as badge}
                      <span class="info-badge meta-badge">{badge}</span>
                    {/each}
                  </div>
                {/if}
                {#if SHOW_CLIENTINFO && SHOW_MEDIAINFO}
                  <div class="badge-row client">
                    {#each textOverlay.clientBadges as badge}
                      <span class="info-badge meta-badge">{badge}</span>
                    {/each}
                  </div>
                {:else if SHOW_CLIENTINFO && !SHOW_MEDIAINFO}
                  <div class="badge-row client-nomediainfo">
                    {#each textOverlay.clientBadges as badge}
                      <span class="info-badge meta-badge">{badge}</span>
                    {/each}
                  </div>
                {/if}
              </div>
            {/if}
          </div>
        </div>
      </div>
    {/each}
  </div>
{:else}
  <div class="idle">Nothing playing</div>
{/if}
