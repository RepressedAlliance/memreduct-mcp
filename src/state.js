// State shared by every MCP server and hook on this PC, so all agent sessions agree on
// when the last clean happened. It lives outside AppData because Windows redirects
// AppData writes from processes inside a Store (MSIX) app, such as the Claude desktop app.
import { appendFileSync, closeSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const DATA_DIR = process.env.MEMREDUCT_MCP_DATA_DIR || join(homedir(), '.memreduct-mcp');
const STATE = join(DATA_DIR, 'state.json');
const LOCK = join(DATA_DIR, 'clean.lock');
const LOG = join(DATA_DIR, 'hook-log.jsonl');
const LOCK_STALE_MS = 60000;

export function readState() {
  try { return JSON.parse(readFileSync(STATE, 'utf8')); } catch { return {}; }
}

export function writeState(state) {
  mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${STATE}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(state));
  try {
    renameSync(tmp, STATE);
  } catch {
    // Windows refuses the rename while another process is reading; a plain write will do.
    writeFileSync(STATE, JSON.stringify(state));
    try { unlinkSync(tmp); } catch { /* already gone */ }
  }
}

export function updateState(change) {
  const state = readState();
  change(state);
  writeState(state);
}

/** One clean at a time across all sessions. Returns a release function, or null if busy. */
export function acquireCleanLock() {
  mkdirSync(DATA_DIR, { recursive: true });
  try {
    if (Date.now() - statSync(LOCK).mtimeMs > LOCK_STALE_MS) unlinkSync(LOCK);
  } catch { /* no lock file */ }
  try {
    closeSync(openSync(LOCK, 'wx'));
  } catch {
    return null;
  }
  return () => { try { unlinkSync(LOCK); } catch { /* already gone */ } };
}

/** What the hooks did. Memory figures, tool names and session ids only. */
export function logEvent(record) {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    appendFileSync(LOG, `${JSON.stringify({ t: new Date().toISOString(), ...record })}\n`);
  } catch { /* logging must never get in the way */ }
}
