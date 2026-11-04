// Claude Code / Codex hook: reads the event on stdin and, when memory calls for it, cleans
// and tells the agent. Agents can't feel memory pressure and don't think about it during a
// long job, so this runs at each of their steps. It must never get in the agent's way:
// any failure exits 0 with no output, and the common case only reads os.freemem().
import { freemem, totalmem } from 'node:os';
import { performClean } from './clean.js';
import { memoryStatus } from './memory.js';
import { decide, describe } from './policy.js';
import { logEvent, readState, writeState } from './state.js';

const readStdin = () => new Promise((resolve) => {
  let data = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { data += chunk; });
  process.stdin.on('end', () => resolve(data));
  process.stdin.on('error', () => resolve(''));
});

async function largestProcesses() {
  try {
    const { topProcesses } = await memoryStatus();
    return topProcesses.slice(0, 3).map((p) => `${p.name} ${(p.workingSetMB / 1024).toFixed(1)} GB`);
  } catch {
    return [];
  }
}

function respond(event, context, userNote) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: event, additionalContext: context },
    ...(userNote ? { systemMessage: userNote } : {}),
  }));
}

async function main() {
  if (process.platform !== 'win32' || process.env.MEMREDUCT_MCP_HOOKS === 'off') return;
  const input = JSON.parse((await readStdin()) || '{}');
  const event = input.hook_event_name;
  const session = input.session_id ?? 'unknown';
  const toolName = input.tool_name;
  const totalMB = Math.round(totalmem() / 1048576);
  const availMB = Math.round(freemem() / 1048576);
  const now = Date.now();
  const state = readState();

  const result = decide({ event, toolName, toolInput: input.tool_input, error: input.error, availMB, totalMB, now, session, state });
  if (result.state !== state) writeState(result.state);
  if (result.action === 'none') return;

  const log = { event, tool: toolName, session, availMB, totalMB, kind: result.kind };
  const minutesSinceClean = Math.max(1, Math.round((now - (state.lastClean ?? 0)) / 60000));

  if (result.action === 'clean') {
    const clean = await performClean(`hook:${result.kind}`);
    logEvent({ ...log, action: 'clean', status: clean.status, beforeMB: clean.beforeMB, afterMB: clean.afterMB, reported: clean.memreductReported });
    if (clean.status === 'cleaned') {
      const text = describe(result.kind, { ...clean, totalMB });
      respond(event, text, text);
    } else if (clean.status === 'not-ready' || clean.status === 'unconfirmed') {
      respond(event, describe('cannot-clean', { availMB, totalMB, setupProblems: clean.setup?.problems, hint: clean.hint }));
    }
    // cooldown or busy: another session just cleaned; nothing useful to add.
    return;
  }

  logEvent({ ...log, action: 'remind' });
  const top = await largestProcesses();
  respond(event, describe(result.kind, { availMB, totalMB, minutesSinceClean, top }));
}

main().catch((error) => logEvent({ action: 'error', message: String(error?.message ?? error) }));
