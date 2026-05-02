<script>
  import {
    getClientInfoParts,
    getMediaInfoParts,
  } from "../lib/playerDisplay.js";

  let {
    overlay,
    showProgress,
    showMediaInfo,
    showClientInfo,
    showUsername,
  } = $props();

  const mediaInfo = $derived(getMediaInfoParts(overlay));
  const clientInfo = $derived(getClientInfoParts(overlay, showUsername));
</script>

<div class="info-overlay ambient-fade-out" aria-hidden="true">
  <div class="title"><span>{overlay.title}</span></div>
  <div class="artist">
    <span>{overlay.subtitle}</span>
  </div>
  <div class="album">
    <span>{overlay.detail}</span>
  </div>

  {#if showProgress}
    <div class="progress-spacer"></div>
    <div class="time-spacer"></div>
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
