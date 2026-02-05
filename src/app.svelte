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

  let PLEX_URL;
  let PLEX_TOKEN;
  let ALLOWED_PLAYERS = [];
  let ALLOWED_USERS = [];
  let ALLOWED_LIBRARIES = [];

  async function loadConfig() {
	  try {
    const res = await fetch('/api/config');
		if (!res.ok) throw new Error('Failed to load config');

		config = await res.json();

    // Server returns only public config (no token)
    PLEX_URL = config.PLEX_URL;
		ALLOWED_PLAYERS = config.PLAYERS || [];
		ALLOWED_USERS = config.USERS || [];
		ALLOWED_LIBRARIES = config.LIBRARIES || [];

		configLoaded = true;
	} catch (err) {
		console.error('Failed to load runtime config', err);
	}
  }

  // Fetch Plex now playing sessions
  async function fetchNowPlaying() {
    if (!configLoaded) return;
    try {
      const res = await fetch('/api/sessions');
      const xmlText = await res.text();
      const parser = new DOMParser();
      const xml = parser.parseFromString(xmlText, 'application/xml');

      let newTracks = Array.from(xml.querySelectorAll('Track')).map(track => {
        const player = track.querySelector('Player');
        const user = track.querySelector('User');

        const trackArtist = (track.getAttribute('originalTitle') || track.getAttribute('grandparentTitle') || '').trim();
        const albumArtistRaw = (track.getAttribute('grandparentTitle') || '').trim();
        const albumArtist = (albumArtistRaw && albumArtistRaw.toLowerCase() !== 'various artists' && albumArtistRaw !== trackArtist)
          ? albumArtistRaw
          : '';

        return {
          sessionKey: track.getAttribute('sessionKey'),
          guid: track.getAttribute('guid'),
          updatedAt: track.getAttribute('updatedAt'),
          title: track.getAttribute('title')?.trim() || '',
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
          user: user?.getAttribute('title')
        };
      });

      // Filter by allowed players if config is set
      if (ALLOWED_PLAYERS.length > 0) {
        newTracks = newTracks.filter(track => ALLOWED_PLAYERS.includes(track.player));
      }

      if (ALLOWED_USERS.length > 0) {
        newTracks = newTracks.filter(track => ALLOWED_USERS.includes(track.user));
      }

      if (ALLOWED_LIBRARIES.length > 0) {
        newTracks = newTracks.filter(track => ALLOWED_LIBRARIES.includes(track.library));
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

      sessions.set(merged);

      if (merged.length !== current.length) startSlideshow();

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
    rotationTimer = setInterval(() => {
      const list = get(sessions);
      if (!list.length) return;
      activeIndex.update(i => nextPlayingIndex(i, list));
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

  const format = ms => {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2,'0')}`;
  };

  // Slower marquee with pause
  export function marquee(node, { baseSpeed = 30, pauseDuration = 2000 } = {}) {
    const span = node.querySelector('span');
    if (!span) return;

    span.style.display = 'inline-block';
    span.style.whiteSpace = 'nowrap';
    span.style.willChange = 'transform';

    let offset = 0;
    let frame;
    let containerWidth = node.clientWidth;
    let textWidth = span.scrollWidth;
    let lastTime = performance.now();
    let paused = true;

    function step(time) {
      const delta = time - lastTime;
      lastTime = time;

      if (textWidth > containerWidth) {
        if (paused) {
          setTimeout(() => { paused = false; }, pauseDuration);
        } else {
          const speed = baseSpeed * (containerWidth / textWidth);
          offset -= speed * (delta / 1000); // pixels/sec
          if (offset <= -textWidth) {
            offset = 0;
            paused = true;
            lastTime = performance.now();
          }
          span.style.transform = `translateX(${offset}px)`;
        }
      }

      frame = requestAnimationFrame(step);
    }

    step(performance.now());

    const resizeObserver = new ResizeObserver(() => {
      containerWidth = node.clientWidth;
      textWidth = span.scrollWidth;
      if (offset <= -textWidth) offset = 0;
    });

    resizeObserver.observe(node);

    return {
      destroy() {
        cancelAnimationFrame(frame);
        resizeObserver.disconnect();
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
    startProgress();
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

.fade-wrapper { position: relative; width: 100%; height: 100vh; }
.fade-slide { position: absolute; inset: 0; opacity: 0; transition: opacity 1s ease; }
.fade-slide.visible { opacity: 1; }

.player {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 1.5rem;
  align-items: center;
  height: 100vh;
  padding: 1.5rem 2rem;
  color: white;
  position: relative;
}

.art-container { min-width: 0; }
.art { width: clamp(240px, 42vh, 320px); aspect-ratio: 1/1; object-fit: cover; border-radius: 18px; box-shadow: 0 20px 60px rgba(0,0,0,0.6); }

.info { min-width: 0; }
.title, .artist, .album { white-space: nowrap; overflow: hidden; position: relative; }
.title { font-size: clamp(1.4rem, 3.5vw, 2.2rem); padding-bottom: 5px; }
.artist { font-size: clamp(1.1rem, 3vw, 1.6rem); opacity: 0.85; padding-bottom: 5px; }
.album { font-size: clamp(0.95rem, 2.5vw, 1.2rem); opacity: 0.6; padding-bottom: 5px;}

progress { width: 100%; height: 8px; margin-top: 0.75rem; }
.time { margin-top: 0.25rem; font-size: 0.85rem; opacity: 0.7; }
.client { margin-top: 0.5rem; font-size: 0.9rem; opacity: 0.7; }

.bg {
  position: fixed;
  inset: 0;
  background-size: cover;
  background-position: center;
  filter: blur(32px) brightness(0.45);
  transform: scale(1.15);
  z-index: -1;
}

.idle { color: white; display: flex; align-items: center; justify-content: center; height: 100vh; }
</style>

{#if !configLoaded}
<div class="idle">Loading...</div>
{:else if $activeSession}
<div class="fade-wrapper">
  {#each $sessions as session, i (session.sessionKey + session.guid)}
    <div class="fade-slide {i === $activeIndex ? 'visible' : ''}">
      <div class="bg" style={`background-image: url(/api/art?thumb=${encodeURIComponent(session.art)})`}></div>

      <div class="player">
        <div class="art-container">
          <img class="art" alt="Album Art" src={`/api/art?thumb=${encodeURIComponent(session.art)}`} />
        </div>

        <div class="info">
          <div class="title" use:marquee><span>{session.title}</span></div>
          <div class="artist" use:marquee><span>{displayArtist}</span></div>
          <div class="album" use:marquee><span>{session.album}</span></div>

          <progress value={session.localOffset} max={session.duration}></progress>
          <div class="time">{format(session.localOffset)} / {format(session.duration)}</div>
          <div class="client">{session.product} — {session.player} — {session.user}</div>
        </div>
      </div>
    </div>
  {/each}
</div>
{:else}
<div class="idle">Nothing playing</div>
{/if}