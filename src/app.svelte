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
  let ARTIST_DISPLAY = 'both';
  let SHOW_USERNAME = true;
  let SHOW_PROGRESS = true;

  async function loadConfig() {
	  try {
    const res = await fetch('/api/config');
		if (!res.ok) throw new Error('Failed to load config');

		config = await res.json();

    // Normalize allowed lists to lowercase trimmed strings for robust matching
    ALLOWED_PLAYERS = (config.PLAYERS || []).map(p => String(p).toLowerCase().trim()).filter(Boolean);
    ALLOWED_USERS = (config.USERS || []).map(u => String(u).toLowerCase().trim()).filter(Boolean);
    ALLOWED_LIBRARIES = (config.LIBRARIES || []).map(l => String(l).toLowerCase().trim()).filter(Boolean);
    // ARTIST_DISPLAY determines how to show artist info: 'track' = track artist only, 'album' = album artist only, 'both' = "album artist — track artist"
    ARTIST_DISPLAY = ['track', 'album', 'both'].includes(config.ARTIST_DISPLAY) ? config.ARTIST_DISPLAY : 'both';
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
      const res = await fetch('/api/sessions');
      const xmlText = await res.text();
      const parser = new DOMParser();
      const xml = parser.parseFromString(xmlText, 'application/xml');

      const rawNodes = Array.from(xml.querySelectorAll('Track'));
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
        newTracks = newTracks.filter(track => {
          const p = String(track.player || '').toLowerCase().trim();
          const u = String(track.user || '').toLowerCase().trim();
          const l = String(track.library || '').toLowerCase().trim();
          if (ALLOWED_PLAYERS.length && !ALLOWED_PLAYERS.includes(p)) return false;
          if (ALLOWED_USERS.length && !ALLOWED_USERS.includes(u)) return false;
          if (ALLOWED_LIBRARIES.length && !ALLOWED_LIBRARIES.includes(l)) return false;
          return true;
        });
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
      let dir = -1; // -1 = move left (toward negative offset), 1 = move right (toward 0)

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
          span.style.transform = '';
          paused = true;
          if (pauseTimer) { clearTimeout(pauseTimer); pauseTimer = null; }
          frame = requestAnimationFrame(step);
          return;
        }

        const delta = time - lastTime;
        lastTime = time;

        containerWidth = node.clientWidth;
        textWidth = span.scrollWidth;
        const minOffset = Math.min(0, containerWidth - textWidth); // usually negative when text overflows

        if (textWidth > containerWidth) {
          if (paused) {
            if (!pauseTimer) pauseTimer = setTimeout(() => { paused = false; pauseTimer = null; lastTime = performance.now(); }, pauseDuration);
          } else {
            const speed = baseSpeed * (containerWidth / textWidth);
            offset += dir * speed * (delta / 1000);

            if (offset <= minOffset) {
              offset = minOffset;
              dir = 1; // reverse toward 0
              paused = true;
              if (pauseTimer) clearTimeout(pauseTimer);
              pauseTimer = setTimeout(() => { paused = false; pauseTimer = null; lastTime = performance.now(); }, pauseDuration);
            } else if (offset >= 0) {
              offset = 0;
              dir = -1; // reverse toward minOffset
              paused = true;
              if (pauseTimer) clearTimeout(pauseTimer);
              pauseTimer = setTimeout(() => { paused = false; pauseTimer = null; lastTime = performance.now(); }, pauseDuration);
            }

            span.style.transform = `translateX(${offset}px)`;
          }
        } else {
          offset = 0;
          span.style.transform = '';
          paused = true;
          if (pauseTimer) { clearTimeout(pauseTimer); pauseTimer = null; }
        }

        frame = requestAnimationFrame(step);
      }

      startLoop();

      const resizeObserver = new ResizeObserver(() => {
        containerWidth = node.clientWidth;
        textWidth = span.scrollWidth;
        const minOffset = Math.min(0, containerWidth - textWidth);
        if (offset < minOffset) offset = minOffset;
        if (offset > 0) offset = 0;
      });
      resizeObserver.observe(node);

      let mo = null;
      if (slide) {
        mo = new MutationObserver(() => {
          if (isActive()) {
            containerWidth = node.clientWidth;
            textWidth = span.scrollWidth;
            if (paused) {
              if (!pauseTimer) pauseTimer = setTimeout(() => { paused = false; pauseTimer = null; lastTime = performance.now(); }, pauseDuration);
            }
          } else {
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
          <div class="artist" use:marquee><span>
          {#if ARTIST_DISPLAY === 'both' && session.albumArtist && session.albumArtist.toLowerCase() !== 'various artists'}
            {displayArtist}
          {:else if ARTIST_DISPLAY === 'album' && session.albumArtist && session.albumArtist.toLowerCase() !== 'various artists'}
            {session.albumArtist}
          {:else}
            {session.trackArtist || 'Unknown Artist'}
          {/if}
          </span></div>
          <div class="album" use:marquee><span>{session.album} {#if session.year}({session.year}){/if}</span></div>

          {#if SHOW_PROGRESS}
            <progress value={session.localOffset} max={session.duration}></progress>
            <div class="time">{format(session.localOffset)} / {format(session.duration)}</div>
          {/if}
          <div class="mediainfo">{formatMediaInfo(session)}</div>
          <div class="client">{session.product} — {session.player} {#if SHOW_USERNAME && session.user} — {session.user}{/if}</div>
        </div>
      </div>
    </div>
  {/each}
</div>
{:else}
<div class="idle">Nothing playing</div>
{/if}