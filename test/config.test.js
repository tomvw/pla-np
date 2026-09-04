import test from "node:test";
import assert from "node:assert/strict";
import { parsePositiveInteger, validateConfig } from "../server/config.js";

const valid = { PLEX_URL: "http://plex.local", PLEX_TOKEN: "token" };

test("configuration validation rejects unsafe types", () => {
  assert.deepEqual(validateConfig({ ...valid, SHOW_PROGRESS: "false", PLAYERS: "player" }).sort(), [
    "PLAYERS must be an array",
    "SHOW_PROGRESS must be boolean",
  ]);
  assert.deepEqual(validateConfig(valid), []);
});

test("positive integer parsing falls back for invalid values", () => {
  assert.equal(parsePositiveInteger("5000", 1000), 5000);
  assert.equal(parsePositiveInteger("-1", 1000), 1000);
  assert.equal(parsePositiveInteger("nope", 1000), 1000);
});
