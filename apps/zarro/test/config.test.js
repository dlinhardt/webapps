// DOM-independent unit test (Node, no browser). Browser behaviour is covered by the
// Playwright test in e2e/ — Node tests must not import modules that touch `document`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { APP } from "../src/config.js";

const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);

test("app id is lowercase kebab-case", () => {
  assert.match(APP.id, /^[a-z][a-z0-9-]*$/);
});

test("app config is frozen", () => {
  assert.ok(Object.isFrozen(APP));
});

test("app config version matches the release package version", () => {
  assert.equal(APP.version, packageJson.version);
});
