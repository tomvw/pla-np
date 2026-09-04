import test from "node:test";
import assert from "node:assert/strict";
import { format, getProgressPercent, getMediaInfoParts } from "../src/lib/playerDisplay.js";

test("format renders milliseconds as mm:ss", () => {
  assert.equal(format(125000), "2:05");
});

test("progress is clamped and handles invalid durations", () => {
  assert.equal(getProgressPercent({ localOffset: 50, duration: 100 }), 50);
  assert.equal(getProgressPercent({ localOffset: 200, duration: 100 }), 100);
  assert.equal(getProgressPercent({ localOffset: 0, duration: 0 }), 0);
});

test("media info exposes codec and audio details", () => {
  assert.deepEqual(getMediaInfoParts({ codec: "FLAC", samplingRate: "44.1", bitDepth: "24", bitrate: 1000 }), {
    codec: "FLAC",
    details: "44.1kHz / 24bit / 1000kbps",
    badges: ["44.1kHz / 24bit / 1000kbps"],
  });
});
