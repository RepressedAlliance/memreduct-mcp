// Decides what a hook does, from the event and the memory figures. No I/O, so it can be tested.
//
// 1. When memory is needed: before work that adds load, or after an out-of-memory failure,
//    clean right away. Measured gains fade within minutes under load, so the moment just
//    before the job is the one that counts.
// 2. When memory is low: tell the agent at its next step, and clean at the critical level.
// 3. When a recent clean did not hold, say so instead of cleaning again.

const num = (name, fallback) => {
  const v = Number(process.env[name]);
  return process.env[name] && v >= 0 ? v : fallback;
};

export const defaults = () => ({
  needPct: num('MEMREDUCT_MCP_NEED_PCT', 25), // clean before heavy work below this
  warnPct: num('MEMREDUCT_MCP_WARN_PCT', 15), // remind the agent below this
  criticalPct: num('MEMREDUCT_MCP_CRITICAL_PCT', 6), // clean at the next step below this
  rearmPct: num('MEMREDUCT_MCP_REARM_PCT', 25), // remind again only after recovering above this
  repeatMinutes: 15, // or after this long, if memory stays low
  holdMinutes: 5, // low again within this long after a clean: the clean did not hold
  debounceSeconds: 30, // available RAM swings by gigabytes in seconds; ignore brief dips
  observationGapMinutes: 5, // a low reading this old says nothing about now
});

const HEAVY_TOOLS = /^(Agent|Task|Workflow)$|^mcp__.*start_process$/;
const SHELL_TOOLS = /^(Bash|PowerShell)$/;
const HEAVY_PROGRAMS = new Set(['blender', 'ffmpeg', 'melt', 'handbrakecli', 'ollama', 'llama-server', 'llama-cli', 'whisper', 'webpack', 'tsc', 'gradle', 'gradlew', 'mvn', 'mvnw', 'msbuild', 'ninja', 'pytest', 'playwright']);
const HEAVY_INVOCATION = /^(docker\s+(build|compose)|cargo\s+(build|test)|(npm|pnpm|yarn|bun)\s+(run\s+)?(build|test)|npx\s+(tsc|webpack|playwright|vite\s+build|next\s+build)|next\s+build|vite\s+build|dotnet\s+(build|test)|cmake\s+--build)\b/i;
const HEAVY_PYTHON = /^python\S*\s.*\b(torch|tensorflow|transformers|whisper|comfyui|train)\b/i;
const COMMAND_PREFIX = /^(?:\w+=\S*\s+|timeout\s+\S+\s+|nice\s+|time\s+|exec\s+|do\s+|then\s+|else\s+|&\s*)/;
// Graphics and GPU memory errors are not helped by freeing system RAM.
const MEMORY_ERROR = /out of memory|outofmemory|MemoryError|low virtual memory|bad_alloc|cannot allocate memory|insufficient memory|not enough memory|ENOMEM|0xC0000017|paging file is too small|heap out of memory/i;
const NOT_SYSTEM_RAM = /CUDA|VRAM|GPU|OptiX|Cg C\d+|shader/i;

// Looks at the program each part of a command runs, so "which blender" or a search for the
// word "ffmpeg" doesn't count as a render.
function isHeavySegment(raw) {
  let segment = raw.trim();
  while (COMMAND_PREFIX.test(segment)) segment = segment.replace(COMMAND_PREFIX, '');
  const match = /^"([^"]+)"|^'([^']+)'|^(\S+)/.exec(segment);
  if (!match) return false;
  const program = (match[1] ?? match[2] ?? match[3]).split(/[\\/]/).pop().replace(/\.(exe|cmd|bat)$/i, '').toLowerCase();
  const normalized = `${program}${segment.slice(match[0].length)}`;
  return HEAVY_PROGRAMS.has(program) || HEAVY_INVOCATION.test(normalized) || HEAVY_PYTHON.test(normalized);
}

export function isHeavy(toolName, toolInput = {}) {
  if (HEAVY_TOOLS.test(toolName)) return true;
  if (!SHELL_TOOLS.test(toolName)) return false;
  if (toolInput.run_in_background === true) return true;
  return String(toolInput.command ?? '').split(/&&|\|\||[;\n|]/).some(isHeavySegment);
}

export function isMemoryError(text) {
  const s = String(text ?? '');
  return MEMORY_ERROR.test(s) && !NOT_SYSTEM_RAM.test(s);
}

/**
 * Returns { action: 'none' | 'clean' | 'remind', kind, state }, where state is the updated
 * shared state (the same object when nothing changed).
 */
export function decide({ event, toolName, toolInput, error, availMB, totalMB, now, session, state }, config = defaults()) {
  const pct = (availMB / totalMB) * 100;
  const recentClean = now - (state.lastClean ?? 0) < config.holdMinutes * 60000;
  const none = (next = state) => ({ action: 'none', state: next });

  if (event === 'PostToolUseFailure') {
    if (!isMemoryError(error)) return none();
    return recentClean ? { action: 'remind', kind: 'oom-did-not-hold', state } : { action: 'clean', kind: 'after-oom', state };
  }

  if (event === 'PreToolUse') {
    if (!isHeavy(toolName, toolInput) || pct >= config.needPct) return none();
    if (!recentClean) return { action: 'clean', kind: 'before-job', state };
    // Already cleaned and still short: fall through to the rate-limited reminder below.
    if (pct >= config.warnPct) return none();
  } else if (pct < config.criticalPct && !recentClean) {
    return { action: 'clean', kind: 'critical', state };
  }

  // Reminder state: a reminder per session, again after recovery or after repeatMinutes.
  if (pct >= config.warnPct) {
    if (!state.lowSince && (pct < config.rearmPct || state.recovered)) return none();
    const next = { ...state, lastLowAt: undefined, lowSince: undefined };
    if (pct >= config.rearmPct) { next.recovered = true; next.rearmAt = now; }
    return none(next);
  }
  const lastObservation = state.lastLowAt ?? 0;
  const lowSince = state.lowSince && now - lastObservation < config.observationGapMinutes * 60000 ? state.lowSince : now;
  const next = { ...state, lowSince, lastLowAt: now, recovered: false };
  const urgent = pct < config.criticalPct || event === 'PreToolUse';
  if (!urgent && now - lowSince < config.debounceSeconds * 1000) return none(next);

  const lastWarn = state.sessions?.[session]?.lastWarn ?? 0;
  const armed = lastWarn < (state.rearmAt ?? 0);
  if (!armed && lastWarn && now - lastWarn < config.repeatMinutes * 60000) return none(next);
  const sessions = {};
  for (const [id, s] of Object.entries(state.sessions ?? {})) if (now - s.lastWarn < 86400000) sessions[id] = s;
  sessions[session] = { lastWarn: now };
  next.sessions = sessions;
  return { action: 'remind', kind: recentClean ? 'did-not-hold' : 'low', state: next };
}

const gb = (mb) => `${(mb / 1024).toFixed(1)} GB`;

export function describe(kind, { beforeMB, afterMB, availMB, totalMB, minutesSinceClean, top, setupProblems, hint }) {
  const of = (mb) => `${gb(mb)} of ${gb(totalMB)} (${Math.round((mb / totalMB) * 100)}%)`;
  const topText = top?.length ? ` Largest processes: ${top.join(', ')}.` : '';
  switch (kind) {
    case 'before-job':
    case 'critical':
    case 'after-oom': {
      const opening = { 'before-job': 'before this step', critical: 'because memory was critically low', 'after-oom': 'after this out-of-memory failure' }[kind];
      const close = kind === 'after-oom'
        ? 'Retrying the failed step once is reasonable if it now fits.'
        : 'Freed memory tends to fill again within minutes under load, so start what you need now and avoid adding more parallel work than fits.';
      return `memreduct cleaned RAM ${opening}: available went from ${gb(beforeMB)} to ${of(afterMB)}. ${close}`;
    }
    case 'no-gain':
      return `memreduct ran a clean, but available RAM went from ${gb(beforeMB)} to ${of(afterMB)}: the memory is in active use, so cleaning can't free it. Lower parallelism, wait for running jobs, or tell the user what is using the memory.`;
    case 'low':
      return `Available RAM is ${of(availMB)}.${topText} The memreduct clean_memory tool can free some of it now; if the next steps need memory, use it before starting them.`;
    case 'oom-did-not-hold':
      return `This failure looks like out-of-memory. A clean ran ${minutesSinceClean} min ago and available RAM is now ${of(availMB)}, so another clean is unlikely to add much.${topText} Retry once if the step should fit now; otherwise lower parallelism, wait for running jobs, or tell the user what is using the memory.`;
    case 'did-not-hold':
      return `Available RAM is ${of(availMB)}, and a clean ${minutesSinceClean} min ago did not hold, so another clean is unlikely to help.${topText} Options: wait for running jobs to finish, lower parallelism, or tell the user what is using the memory.`;
    case 'cannot-clean':
      return `Available RAM is ${of(availMB)}, but memreduct could not clean: ${setupProblems?.join(' ') || hint || 'another clean is in progress.'}`;
    default:
      return '';
  }
}
