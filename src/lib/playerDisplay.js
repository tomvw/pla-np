export function format(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function getProgressPercent(session) {
  if (!session?.duration) return 0;
  return Math.max(
    0,
    Math.min(100, (session.localOffset / session.duration) * 100),
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
