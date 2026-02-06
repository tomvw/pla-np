<script>
  import { onMount, onDestroy } from 'svelte';
  import { writable, derived, get } from 'svelte/store';

  // Stores
  export const sessions = writable([]);
  export const activeIndex = writable(0);

  let progressTimer;
  let rotationTimer;
  let refreshTimer;

  let config;
  let configLoaded = false;

  let ALLOWED_PLAYERS = [];
  let ALLOWED_USERS = [];
  let ALLOWED_LIBRARIES = [];
  let SHOW_USERNAME = true;
  let SHOW_PROGRESS = true;

  async function loadConfig() {
	  try {
    const res = await fetch('/api/config');
		if (!res.ok) throw new Error('Failed to load config');

		config = await res.json();

    // Server returns only public config (no token)
    // PLEX_URL = config.PLEX_URL;
    // Normalize allowed lists to lowercase trimmed strings for robust matching
    ALLOWED_PLAYERS = (config.PLAYERS || []).map(p => String(p).toLowerCase().trim()).filter(Boolean);
    ALLOWED_USERS = (config.USERS || []).map(u => String(u).toLowerCase().trim()).filter(Boolean);
    ALLOWED_LIBRARIES = (config.LIBRARIES || []).map(l => String(l).toLowerCase().trim()).filter(Boolean);
    // SHOW_USERNAME determines whether to display the session user in the client line
    SHOW_USERNAME = config.SHOW_USERNAME === undefined ? true : Boolean(config.SHOW_USERNAME);
    // SHOW_PROGRESS determines whether to show the progress bar and time info
    SHOW_PROGRESS = config.SHOW_PROGRESS === undefined ? true : Boolean(config.SHOW_PROGRESS);

		configLoaded = true;
	} catch (err) {
		console.error('Failed to load runtime config', err);
	}
  }

  // Fetch Plex now playing sessions
  async function fetchNowPlaying() {
    if (!configLoaded) return;
    try {
      // console.debug('fetchNowPlaying: starting', { PLEX_URL, ALLOWED_PLAYERS, ALLOWED_USERS, ALLOWED_LIBRARIES });
      const res = await fetch('/api/sessions');
      // if (!res.ok) {
      //   console.warn('fetchNowPlaying: /api/sessions returned non-OK', { status: res.status, statusText: res.statusText });
      //   return;
      // }
      const xmlText = await res.text();
      // console.debug('fetchNowPlaying: fetched text length', xmlText.length);
      const parser = new DOMParser();
      const xml = parser.parseFromString(xmlText, 'application/xml');

      const rawNodes = Array.from(xml.querySelectorAll('Track'));
      // console.debug('fetchNowPlaying: raw track nodes', rawNodes.length);
      let newTracks = rawNodes.map(track => {
        const player = track.querySelector('Player');
        const user = track.querySelector('User');
        const mediainfo = track.querySelector('Part');


        // Locate Media and the audio Stream (streamType=2) under Part when available
        const mediaElem = track.querySelector('Media');
        const audioStream = (mediainfo && mediainfo.querySelector('Stream[streamType="2"]'))
          || (mediainfo && mediainfo.querySelector('Stream'))
          || track.querySelector('Stream');

        const trackArtist = (track.getAttribute('originalTitle') || track.getAttribute('grandparentTitle') || '').trim();
        const albumArtistRaw = (track.getAttribute('grandparentTitle') || '').trim();
        const albumArtist = (albumArtistRaw && albumArtistRaw.toLowerCase() !== 'various artists' && albumArtistRaw.toLowerCase() !== trackArtist.toLowerCase())
          ? albumArtistRaw
          : '';

        // Prefer attributes from the audio Stream, then Media, then Part
        const codecRaw = (audioStream && (audioStream.getAttribute('codec') || audioStream.getAttribute('audioCodec')))
          || (mediaElem && mediaElem.getAttribute('audioCodec'))
          || (mediainfo && mediainfo.getAttribute('container'))
          || '';

        const samplingRateAttr = (audioStream && audioStream.getAttribute('samplingRate'))
          || (mediaElem && mediaElem.getAttribute('samplingRate'))
          || '';
        const samplingRateRaw = samplingRateAttr ? Number(samplingRateAttr) : NaN;
        let samplingRateKHz = '';
        if (!isNaN(samplingRateRaw) && samplingRateRaw > 0) {
          const val = Math.round((samplingRateRaw / 1000) * 10) / 10; // rounded to 0.1 kHz
          samplingRateKHz = (val % 1 === 0) ? String(val.toFixed(0)) : String(val.toFixed(1));
        }

        const bitDepthAttr = (audioStream && audioStream.getAttribute('bitDepth'))
          || (mediaElem && mediaElem.getAttribute('bitDepth'))
          || '';

        const bitrateAttr = (audioStream && audioStream.getAttribute('bitrate'))
          || (mediaElem && mediaElem.getAttribute('bitrate'))
          || (mediainfo && mediainfo.getAttribute('bitrate'))
          || '';
        const bitrateNum = bitrateAttr ? Number(bitrateAttr) : NaN;
        const bitrateKbps = !isNaN(bitrateNum) && bitrateNum > 0 ? Math.round(bitrateNum) : '';

        return {
          sessionKey: track.getAttribute('sessionKey'),
          guid: track.getAttribute('guid'),
          updatedAt: track.getAttribute('updatedAt'),
          title: track.getAttribute('title')?.trim() || '',
          year: track.getAttribute('parentYear'),
          trackArtist,
          albumArtist,
          album: track.getAttribute('parentTitle')?.trim() || '',
          art: track.getAttribute('parentThumb') || track.getAttribute('grandparentThumb') || '',
          duration: Number(track.getAttribute('duration') || 0),
          localOffset: Number(track.getAttribute('viewOffset') || 0),
          library: track.getAttribute('librarySectionTitle'),
          state: player?.getAttribute('state'),
          player: player?.getAttribute('title'),
          product: player?.getAttribute('product'),
          user: user?.getAttribute('title'),
          codec: codecRaw ? codecRaw.toUpperCase() : '',
          bitDepth: bitDepthAttr,
          samplingRate: samplingRateKHz,
          bitrate: bitrateKbps
        };
      });

      // Filter by allowed players if config is set
      // Apply filters in a single pass (AND semantics)
      if (ALLOWED_PLAYERS.length || ALLOWED_USERS.length || ALLOWED_LIBRARIES.length) {
        // const beforeCount = newTracks.length;
        newTracks = newTracks.filter(track => {
          const p = String(track.player || '').toLowerCase().trim();
          const u = String(track.user || '').toLowerCase().trim();
          const l = String(track.library || '').toLowerCase().trim();
          if (ALLOWED_PLAYERS.length && !ALLOWED_PLAYERS.includes(p)) return false;
          if (ALLOWED_USERS.length && !ALLOWED_USERS.includes(u)) return false;
          if (ALLOWED_LIBRARIES.length && !ALLOWED_LIBRARIES.includes(l)) return false;
          return true;
        });
        // console.debug('fetchNowPlaying: filtered tracks', { before: beforeCount, after: newTracks.length });
      }

      const current = get(sessions);

      // Merge tracks: each client/session+track keeps its own progress
      const merged = newTracks.map(track => {
        const existing = current.find(
          s => s.sessionKey === track.sessionKey && s.guid === track.guid
        );

        if (!existing || existing.updatedAt !== track.updatedAt) {
          return { ...track };
        }

        return { ...track, localOffset: existing.localOffset };
      });

      // Debug: log session counts for troubleshooting intermittent empty state
      // try { console.debug('Plex: fetched sessions', { previousCount: current.length, newCount: merged.length }); } catch (e) {}

      sessions.set(merged);

      // If we transitioned from no sessions to some, ensure activeIndex is valid and start slideshow
      if (merged.length > 0) {
        const ci = get(activeIndex) || 0;
        if (ci >= merged.length) activeIndex.set(0);
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
        if (active && active.state !== 'playing') {
          const next = nextPlayingIndex(ci, listAfter);
          activeIndex.set(next);
        }
      }
    } catch (err) {
      console.error('Failed to fetch Plex sessions', err);
    }
  }

  function startProgress() {
    clearInterval(progressTimer);
    // console.debug('startProgress: starting interval');
    progressTimer = setInterval(() => {
      sessions.update(list =>
        list.map(s =>
          s.state === 'playing'
            ? { ...s, localOffset: Math.min(s.localOffset + 1000, s.duration) }
            : s
        )
      );
    }, 1000);
  }

  function startSlideshow() {
    clearInterval(rotationTimer);
    // console.debug('startSlideshow: starting rotation');
    rotationTimer = setInterval(() => {
      const list = get(sessions);
      if (!list.length) return;
      const prev = get(activeIndex) || 0;
      const next = nextPlayingIndex(prev, list);
      if (next !== prev) {
        console.debug('startSlideshow: advancing index', { from: prev, to: next });
        activeIndex.set(next);
      }
    }, 10000);
  }

  // Find the next playing session index after `current`.
  // If no other playing sessions exist, returns `current`.
  function nextPlayingIndex(current, list) {
    const n = list.length;
    if (n === 0) return 0;
    for (let offset = 1; offset < n; offset++) {
      const idx = (current + offset) % n;
      if (list[idx] && list[idx].state === 'playing') return idx;
    }
    return current;
  }

  function startAutoRefresh() {
    clearInterval(refreshTimer);
    refreshTimer = setInterval(fetchNowPlaying, 15000);
  }

  const activeSession = derived([sessions, activeIndex], ([$sessions, $activeIndex]) => $sessions[$activeIndex]);

  // Track active changes so we can animate in-place content updates
  let prevActiveGuid = null;
  let prevActiveIndex = null;
  let contentChanging = false;
  let _contentChangeTimer = null;

  $: if ($activeSession !== undefined) {
    // When the active index stays the same but guid changes, it's a new song
    if (prevActiveIndex !== null && $activeIndex === prevActiveIndex && prevActiveGuid && $activeSession && $activeSession.guid !== prevActiveGuid) {
      contentChanging = true;
      if (_contentChangeTimer) clearTimeout(_contentChangeTimer);
      _contentChangeTimer = setTimeout(() => {
        contentChanging = false;
        _contentChangeTimer = null;
      }, 520);
    }
    prevActiveGuid = $activeSession ? $activeSession.guid : null;
    prevActiveIndex = $activeIndex;
  }

  const format = ms => {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2,'0')}`;
  };

  // Format media info string: show codec, samplingRate (kHz) and bitDepth.
  // Only include the '/' separator between samplingRate and bitDepth when both exist.
  const formatMediaInfo = s => {
    if (!s) return '';
    const parts = [];
    if (s.codec) parts.push(s.codec);
    const audioParts = [];
    if (s.samplingRate) audioParts.push(`${s.samplingRate}kHz`);
    if (s.bitDepth) audioParts.push(`${s.bitDepth}bit`);
    if (s.bitrate) {
      // show bitrate after bitDepth when present, otherwise after samplingRate
      audioParts.push(`${s.bitrate}kbps`);
    }
    if (audioParts.length) parts.push(audioParts.join(' / '));
    return parts.join(' — ');
  };

  // Slower marquee with pause
  export function marquee(node, { baseSpeed = 30, pauseDuration = 2000 } = {}) {
    const span = node.querySelector('span');
    if (!span) return;

    span.style.display = 'inline-block';
    span.style.whiteSpace = 'nowrap';
    span.style.willChange = 'transform';

    let offset = 0;
    let frame = null;
    let containerWidth = node.clientWidth;
    let textWidth = span.scrollWidth;
    let lastTime = 0;
    let paused = true;
    let pauseTimer = null;

    const slide = node.closest('.fade-slide');
    const isActive = () => {
      if (!slide) return true;
      return slide.classList.contains('visible');
    };

    function startLoop() {
      if (frame) return;
      lastTime = performance.now();
      frame = requestAnimationFrame(step);
    }

    function stopLoop() {
      if (!frame) return;
      cancelAnimationFrame(frame);
      frame = null;
    }

    function step(time) {
      frame = null;
      if (!isActive()) {
        // not visible — reset transform and pause
        span.style.transform = '';
        paused = true;
        if (pauseTimer) { clearTimeout(pauseTimer); pauseTimer = null; }
        // keep checking until visible
        frame = requestAnimationFrame(step);
        return;
      }

      const delta = time - lastTime;
      lastTime = time;

      // recalc sizes if needed
      containerWidth = node.clientWidth;
      textWidth = span.scrollWidth;

      if (textWidth > containerWidth) {
        if (paused) {
          if (!pauseTimer) pauseTimer = setTimeout(() => { paused = false; pauseTimer = null; }, pauseDuration);
        } else {
          const speed = baseSpeed * (containerWidth / textWidth);
          offset -= speed * (delta / 1000); // pixels/sec
          if (offset <= -textWidth) {
            offset = 0;
            paused = true;
            if (pauseTimer) clearTimeout(pauseTimer);
            pauseTimer = setTimeout(() => { paused = false; pauseTimer = null; }, pauseDuration);
            lastTime = performance.now();
          }
          span.style.transform = `translateX(${offset}px)`;
        }
      } else {
        // text fits — ensure reset
        offset = 0;
        span.style.transform = '';
        paused = true;
        if (pauseTimer) { clearTimeout(pauseTimer); pauseTimer = null; }
      }

      frame = requestAnimationFrame(step);
    }

    // Start the loop — it will immediately pause if not active
    startLoop();

    const resizeObserver = new ResizeObserver(() => {
      containerWidth = node.clientWidth;
      textWidth = span.scrollWidth;
      if (offset <= -textWidth) offset = 0;
    });
    resizeObserver.observe(node);

    // Observe visibility changes by watching the slide's class attribute
    let mo = null;
    if (slide) {
      mo = new MutationObserver(() => {
        // when visibility changes, (re)start loop so it can pick up new active state
        if (isActive()) {
          // ensure sizes are up-to-date
          containerWidth = node.clientWidth;
          textWidth = span.scrollWidth;
          if (paused) {
            // restart after pause to show the initial paused state then scroll
            if (!pauseTimer) pauseTimer = setTimeout(() => { paused = false; pauseTimer = null; }, pauseDuration);
          }
        } else {
          // reset immediately when hidden
          offset = 0;
          span.style.transform = '';
          paused = true;
          if (pauseTimer) { clearTimeout(pauseTimer); pauseTimer = null; }
        }
      });
      mo.observe(slide, { attributes: true, attributeFilter: ['class'] });
    }

    return {
      destroy() {
        stopLoop();
        resizeObserver.disconnect();
        if (mo) mo.disconnect();
        if (pauseTimer) clearTimeout(pauseTimer);
        span.style.transform = '';
      }
    };
  }

  $: displayArtist = $activeSession
    ? ($activeSession.albumArtist && $activeSession.albumArtist.toLowerCase() !== 'various artists')
      ? `${$activeSession.albumArtist} — ${$activeSession.trackArtist}`
      : $activeSession.trackArtist || 'Unknown Artist'
    : '';

  onMount(async () => {
    await loadConfig();

    if (!configLoaded) return;

    fetchNowPlaying();
    if (SHOW_PROGRESS) {
      startProgress();
    };
    startSlideshow();
    startAutoRefresh();
  });

  onDestroy(() => {
    clearInterval(progressTimer);
    clearInterval(rotationTimer);
    clearInterval(refreshTimer);
  });
</script>

<style>
:root { --main-font: 'Inter', 'Helvetica Neue', Helvetica, Arial, sans-serif; }
:global(:root) { --main-font: 'Fira Sans', 'Inter', 'Helvetica Neue', Helvetica, Arial, sans-serif; --max-content-width: 1400px; }

:global(body) { font-family: var(--main-font); }

.fade-wrapper { position: relative; width: 100%; height: 100vh; display: flex; justify-content: center; align-items: center; }
.fade-slide { position: absolute; inset: 0; opacity: 0; transition: opacity 1s ease; padding-inline: 2rem; box-sizing: border-box; }
.fade-slide.visible { opacity: 1; }

/* Prevent marquee transforms from causing horizontal scrolling */
.fade-wrapper, .fade-slide { overflow: hidden; }

.player {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 1.5rem;
  align-items: center;
  height: 100vh;
  padding: 1.5rem 2rem;
  color: white;
  position: relative;
  max-width: var(--max-content-width);
  margin: 0 auto;
}

.art-container { min-width: 0; display:flex; align-items:center; justify-content:center; }
.art { width: clamp(240px, 42vh, 320px); aspect-ratio: 1/1; object-fit: cover; border-radius: 18px; box-shadow: 0 20px 60px rgba(0,0,0,0.6); }

.info { min-width: 0; }
.title, .artist, .album { white-space: nowrap; overflow: hidden; position: relative; text-overflow: ellipsis; }
.title { font-size: clamp(1.4rem, 3.5vw, 2.2rem); padding-bottom: 5px; }
.artist { font-size: clamp(1.1rem, 3vw, 1.6rem); opacity: 0.85; padding-bottom: 5px; }
.album { font-size: clamp(0.95rem, 2.5vw, 1.2rem); opacity: 0.6; padding-bottom: 5px;}

progress { width: 100%; height: 8px; margin-top: 0.75rem; }
/* Prevent long marquee text from crowding the right edge of the progress bar
   by adding a small right padding in landscape / wide layouts and
   shrinking the progress width accordingly. */
@media (orientation: landscape) and (min-width: 900px) {
  /* larger right gap to ensure progress and controls never hit viewport edge */
  .info { box-sizing: border-box; }
  progress { max-width: calc(100% - 3.5rem); width: 100%; }
}
.time { margin-top: 0.25rem; font-size: 0.85rem; opacity: 0.7; }
.client { margin-top: 0.1rem; font-size: 0.9rem; opacity: 0.7; }
.mediainfo { margin-top: 0.7rem; font-size: 0.9rem; opacity: 0.7; }

.bg {
  position: fixed;
  inset: 0;
  background-size: cover;
  background-position: center;
  filter: blur(32px) brightness(0.45);
  transform: scale(1.15);
  z-index: -1;
}

/* In-place content change (same session, new song) */
.fade-slide.content-changing .bg { transition: opacity .45s ease; opacity: 0; }
.player.content-changing .art,
.player.content-changing .info { transition: opacity .45s ease, transform .45s ease; opacity: 0; transform: translateY(6px); }
.player .art, .player .info { transition: opacity .45s ease, transform .45s ease; opacity: 1; transform: none; }

.idle { color: white; display: flex; align-items: center; justify-content: center; height: 100vh; }

/* Larger screens: more generous spacing and art */
@media (min-width: 1200px) {
  .player { gap: 2.5rem; padding: 2.5rem 4rem; }
  .art { width: clamp(320px, 50vh, 520px); border-radius: 20px; box-shadow: 0 30px 80px rgba(0,0,0,0.6); }
  .title { font-size: 2.6rem; }
  .artist { font-size: 1.8rem; }
}

/* Very large ultra-wide screens */
@media (min-width: 1600px) {
  .player { padding-left: 6rem; padding-right: 6rem; }
}

/* Portrait / narrow screens: stack vertically */
@media (orientation: portrait), (max-width: 600px) {
  .fade-wrapper { height: auto; min-height: 100vh; }
  .player {
    grid-template-columns: 1fr;
    grid-template-rows: auto 1fr;
    gap: 1rem;
    padding: 1rem;
    height: auto;
    margin: auto; /* center horizontally and allow vertical centering by parent */
    max-height: calc(100vh - 4rem);
  }
  /* center the absolute/overlayed slide content vertically */
  .fade-slide { display: flex; align-items: center; justify-content: center; padding: 1rem; }
  .art { width: min(80vw, 560px); margin: 0 auto; aspect-ratio: 1/1; }
  .info { padding-top: 0.75rem; text-align: center; }
  .title, .artist, .album { white-space: normal; overflow: visible; }
  progress { height: 6px; }
  .client { opacity: 0.8; }
}

/* Ensure marquee text doesn't overflow on small screens */
.title span, .artist span, .album span { display:inline-block; max-width:100%; }

/* Accessibility: increase hit target on mobile */
@media (max-width: 600px) {
  .player { padding: 1rem; gap: 0.75rem; }
  .title { font-size: 1.25rem; }
}
</style>

{#if !configLoaded}
<div class="idle">Loading...</div>
{:else if $activeSession}
<div class="fade-wrapper">
  {#each $sessions as session, i (session.sessionKey + session.guid)}
    <div class={`fade-slide ${i === $activeIndex ? 'visible' : ''} ${contentChanging && i === $activeIndex ? 'content-changing' : ''}`}>
      <div class="bg" style={`background-image: url(/api/art?thumb=${encodeURIComponent(session.art)})`}></div>

      <div class={`player ${contentChanging && i === $activeIndex ? 'content-changing' : ''}`}>
        <div class="art-container">
          <img class="art" alt="Album Art" src={`/api/art?thumb=${encodeURIComponent(session.art)}`} />
        </div>

        <div class="info">
          <div class="title" use:marquee><span>{session.title}</span></div>
          <div class="artist" use:marquee><span>{displayArtist}</span></div>
          <div class="album" use:marquee><span>{session.album} {#if session.year}({session.year}){/if}</span></div>

          {#if SHOW_PROGRESS}
            <progress value={session.localOffset} max={session.duration}></progress>
            <div class="time">{format(session.localOffset)} / {format(session.duration)}</div>
          {/if}
          <div class="mediainfo">{formatMediaInfo(session)}</div>
          <div class="client">{session.product} — {session.player}{#if SHOW_USERNAME && session.user} — {session.user}{/if}</div>
        </div>
      </div>
    </div>
  {/each}
</div>
{:else}
<div class="idle">Nothing playing</div>
{/if}