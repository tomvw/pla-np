export function format(ms) {
  const safeMs = Number.isFinite(Number(ms)) ? Math.max(0, Number(ms)) : 0;
  const s = Math.floor(safeMs / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function getProgressPercent(session) {
  const duration = Number(session?.duration);
  const offset = Number(session?.localOffset);
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(offset)) return 0;
  return Math.max(
    0,
    Math.min(100, (offset / duration) * 100),
  );
}

export function getMediaInfoParts(session) {
  if (!session) return { codec: "", details: "", badges: [] };

  const detailParts = [];
  if (session.samplingRate) detailParts.push(`${session.samplingRate}kHz`);
  if (session.bitDepth) detailParts.push(`${session.bitDepth}bit`);
  if (session.bitrate) detailParts.push(`${session.bitrate}kbps`);

  const badges = detailParts.length ? [detailParts.join(" / ")] : [];

  return {
    codec: session.codec || "",
    details: badges.join(" / "),
    badges,
  };
}

export function getClientInfoParts(session, showUsername = true) {
  if (!session) return { badges: [] };

  const badges = [];
  if (session.product) badges.push(session.product);
  if (session.player) badges.push(session.player);
  if (showUsername && session.user) badges.push(session.user);

  return { badges };
}
