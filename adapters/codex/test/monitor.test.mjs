// Tests for monitor.mjs — the heartbeat read side the watchdog polls. Run with:
//   node --test adapters/codex/test/monitor.test.mjs
//
// No workflow runtime involved: these write a heartbeat.json by hand and read
// it back through the module, so the defensive branches (absent, non-JSON,
// wrong-shaped) are pinned directly rather than through a real agent() run.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { readHeartbeat, livenessSeconds, isWorkInFlight } from "../monitor.mjs";

const MONITOR = path.resolve(import.meta.dirname, "..", "monitor.mjs");

function tmpHeartbeatPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "monitor-test-"));
  return { hbPath: path.join(dir, "heartbeat.json"), cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

function write(hbPath, content) {
  fs.writeFileSync(hbPath, content);
}

// ── readHeartbeat ────────────────────────────────────────────────────

test("readHeartbeat returns the two fields for a valid file", () => {
  const { hbPath, cleanup } = tmpHeartbeatPath();
  write(hbPath, JSON.stringify({ mtime: 1700000000000, alive: true }));
  assert.deepEqual(readHeartbeat(hbPath), { mtime: 1700000000000, alive: true });
  cleanup();
});

test("readHeartbeat returns null for an absent file", () => {
  const { hbPath, cleanup } = tmpHeartbeatPath();
  assert.equal(readHeartbeat(hbPath), null);
  cleanup();
});

test("readHeartbeat returns null for non-JSON content", () => {
  const { hbPath, cleanup } = tmpHeartbeatPath();
  write(hbPath, "not json {{{");
  assert.equal(readHeartbeat(hbPath), null);
  cleanup();
});

test("readHeartbeat returns null for wrong-shaped JSON", () => {
  const { hbPath, cleanup } = tmpHeartbeatPath();
  for (const bad of [
    "null",
    "[1, 2]",
    JSON.stringify("a string"),
    JSON.stringify({ alive: true }), // missing mtime
    JSON.stringify({ mtime: 123 }), // missing alive
    JSON.stringify({ mtime: "123", alive: true }), // mtime wrong type
    JSON.stringify({ mtime: 123, alive: "yes" }) // alive wrong type
  ]) {
    write(hbPath, bad);
    assert.equal(readHeartbeat(hbPath), null, `expected null for ${bad}`);
  }
  cleanup();
});

// ── livenessSeconds ──────────────────────────────────────────────────

test("livenessSeconds floors the heartbeat's mtime from ms to s", () => {
  const { hbPath, cleanup } = tmpHeartbeatPath();
  write(hbPath, JSON.stringify({ mtime: 1700000000999, alive: false }));
  assert.equal(livenessSeconds(hbPath), Math.floor(1700000000999 / 1000));
  cleanup();
});

test("livenessSeconds falls back to 0 when there is no heartbeat", () => {
  const { hbPath, cleanup } = tmpHeartbeatPath();
  assert.equal(livenessSeconds(hbPath), 0);
  cleanup();
});

// ── isWorkInFlight ───────────────────────────────────────────────────

test("isWorkInFlight reflects the alive field, and reads false when there is no heartbeat", () => {
  const { hbPath, cleanup } = tmpHeartbeatPath();
  write(hbPath, JSON.stringify({ mtime: 1, alive: true }));
  assert.equal(isWorkInFlight(hbPath), true);
  write(hbPath, JSON.stringify({ mtime: 1, alive: false }));
  assert.equal(isWorkInFlight(hbPath), false);
  fs.rmSync(hbPath);
  assert.equal(isWorkInFlight(hbPath), false);
  cleanup();
});

// ── CLI ──────────────────────────────────────────────────────────────

function cli(args) {
  try {
    const stdout = execFileSync(process.execPath, [MONITOR, ...args], { encoding: "utf8" });
    return { status: 0, stdout };
  } catch (e) {
    return { status: e.status ?? 1, stdout: e.stdout?.toString() ?? "", stderr: e.stderr?.toString() ?? "" };
  }
}

test("CLI mtime prints the liveness seconds", () => {
  const { hbPath, cleanup } = tmpHeartbeatPath();
  write(hbPath, JSON.stringify({ mtime: 1700000000999, alive: true }));
  const { status, stdout } = cli(["mtime", hbPath]);
  assert.equal(status, 0);
  assert.equal(stdout.trim(), String(Math.floor(1700000000999 / 1000)));
  cleanup();
});

test("CLI alive prints 1 when a subprocess is live, 0 otherwise", () => {
  const { hbPath, cleanup } = tmpHeartbeatPath();
  write(hbPath, JSON.stringify({ mtime: 1, alive: true }));
  assert.equal(cli(["alive", hbPath]).stdout.trim(), "1");
  write(hbPath, JSON.stringify({ mtime: 1, alive: false }));
  assert.equal(cli(["alive", hbPath]).stdout.trim(), "0");
  cleanup();
});
