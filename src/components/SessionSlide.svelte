<script>
  import { smoothImage, marquee } from "../lib/playerActions.js";
  import {
    format,
    getClientInfoParts,
    getDisplayLines,
    getMediaInfoParts,
    getProgressPercent,
  } from "../lib/playerDisplay.js";
  import SessionOverlay from "./SessionOverlay.svelte";

  let {
    session,
    isActive,
    lowPowerMode,
    pageVisible,
    renderedArtist,
    textOverlay = null,
    showProgress,
    showMediaInfo,
    showClientInfo,
    showUsername,
  } = $props();

  const mediaInfo = $derived(getMediaInfoParts(session));
  const clientInfo = $derived(getClientInfoParts(session, showUsername));
  const displayLines = $derived(getDisplayLines(session, renderedArtist));
  const backgroundArt = $derived(session.backgroundArt || session.art);
  const showHours = $derived((session.duration || 0) >= 60 * 60 * 1000);
  const overlayMatches =
    $derived(textOverlay && session.identityKey === textOverlay.identityKey);
</script>

<div class={`fade-slide media-${session.viewType || "music"} ${isActive ? "visible" : ""}`}>
  <div
    class="bg"
    use:smoothImage={{ src: backgroundArt, isBg: true, lowPowerMode }}
  ></div>

  <div class="player">
    <div class="art-container">
      <img
        class="art"
        alt={displayLines.artAlt}
        use:smoothImage={{ src: session.art, lowPowerMode }}
      />
    </div>

    <div class="info">
      <div
        class="title"
        use:marquee={{ lowPowerMode, pageVisible }}
      ><span>{displayLines.title}</span></div>
      <div
        class="artist"
        use:marquee={{ lowPowerMode, pageVisible }}
      >
        <span>{displayLines.subtitle}</span>
      </div>
      <div
        class="album"
        use:marquee={{ lowPowerMode, pageVisible }}
      >
        <span>{displayLines.detail}</span>
      </div>

      <div class="meta-stack">
        {#if showProgress}
          <div class="progress-block">
            <div class="time time-start">
              {format(session.localOffset, { forceHours: showHours })}
            </div>
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
            <div class="time time-end">
              {format(session.duration, { forceHours: showHours })}
            </div>
          </div>
        {/if}
        {#if showMediaInfo}
          <div class="badge-row mediainfo">
            {#if mediaInfo.codec}
              <span class="info-badge codec-badge">{mediaInfo.codec}</span>
            {/if}
            {#each mediaInfo.badges as badge, badgeIndex}
              <span class={`info-badge meta-badge ${mediaInfo.badgeTypes?.[badgeIndex] || ""}`}>{badge}</span>
            {/each}
          </div>
        {/if}
        {#if showClientInfo && showMediaInfo}
          <div class="badge-row client">
            {#each clientInfo.badges as badge}
              <span class="info-badge meta-badge">{badge}</span>
            {/each}
          </div>
        {:else if showClientInfo && !showMediaInfo}
          <div class="badge-row client-nomediainfo">
            {#each clientInfo.badges as badge}
              <span class="info-badge meta-badge">{badge}</span>
            {/each}
          </div>
        {/if}
      </div>

      {#if overlayMatches && isActive}
        <SessionOverlay
          overlay={textOverlay}
          showProgress={showProgress}
          showMediaInfo={showMediaInfo}
          showClientInfo={showClientInfo}
          showUsername={showUsername}
        />
      {/if}
    </div>
  </div>
</div>
