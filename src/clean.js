// One Mem Reduct clean, shared by the clean_memory tool and the hooks.
import { freemem } from 'node:os';
import { triggerClean } from './memreduct.js';
import { acquireCleanLock, readState, updateState } from './state.js';

// Cleaning trims every process's working set; pages come back from disk when used,
// so repeated cleans cost performance. Agents get a cooldown, not a turbo button.
const envCooldown = Number(process.env.MEMREDUCT_MCP_COOLDOWN);
// A client that leaves a config placeholder unexpanded must not switch the cooldown off.
export const COOLDOWN_SECONDS = process.env.MEMREDUCT_MCP_COOLDOWN && envCooldown >= 0 ? envCooldown : 120;

export const availableMB = () => Math.round(freemem() / 1048576);

/**
 * by: who asked, e.g. "agent" or "hook:before-job". Returns { status, beforeMB, ... } with
 * status one of cleaned, unconfirmed, cooldown, busy, not-ready.
 */
export async function performClean(by) {
  const beforeMB = availableMB();
  const release = acquireCleanLock();
  if (!release) return { status: 'busy', beforeMB };
  try {
    const wait = Math.ceil(COOLDOWN_SECONDS - (Date.now() - (readState().lastClean ?? 0)) / 1000);
    if (wait > 0) return { status: 'cooldown', waitSeconds: wait, beforeMB };
    // Written before the key press so the monitor can tell who triggered the clean it sees.
    updateState((s) => { s.pressAt = Date.now(); s.by = by; });
    const result = await triggerClean();
    if (!result.triggered) return { status: 'not-ready', setup: result.status, beforeMB };
    updateState((s) => { s.lastClean = Date.now(); });
    if (!result.confirmed) return { status: 'unconfirmed', hint: result.hint, hotkey: result.hotkey, beforeMB };
    await new Promise((r) => setTimeout(r, 1500)); // let freed pages settle before measuring
    const afterMB = availableMB();
    updateState((s) => { s.afterMB = afterMB; });
    return { status: 'cleaned', beforeMB, afterMB, hotkey: result.hotkey, memreductReported: result.memreductReported };
  } finally {
    release();
  }
}
