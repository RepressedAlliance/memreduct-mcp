#!/usr/bin/env node
// MCP server that lets AI agents free RAM with the user's own Mem Reduct.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { availableMB, COOLDOWN_SECONDS, performClean } from './clean.js';
import { setupStatus } from './memreduct.js';
import { memoryStatus } from './memory.js';

const VERSION = '0.2.1';

const NOTE = 'Cleaning frees physical RAM for a while (working sets, standby and modified lists). '
  + 'Programs read trimmed pages back when they use them, so it does not make the PC faster in general. '
  + 'Use it right before a memory-hungry task, not as routine maintenance.';

const tools = [
  {
    name: 'memory_status',
    description: 'Report total, available and committed RAM and the processes using the most memory. Read-only.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'clean_memory',
    description: 'Free RAM with the user\'s running Mem Reduct (via its clean hotkey; no admin prompt). '
      + 'Returns available RAM before and after. Call it yourself, without asking, before starting a memory-hungry job when available RAM is short, '
      + 'and after an out-of-memory or "low virtual memory" failure (then retry the job once). '
      + `Has a ${COOLDOWN_SECONDS}-second cooldown. ${NOTE}`,
    inputSchema: {
      type: 'object',
      properties: {
        needed_mb: { type: 'number', description: 'Skip cleaning if at least this much RAM (MB) is already available.' },
      },
    },
  },
  {
    name: 'memreduct_setup_check',
    description: 'Check whether Mem Reduct is installed, running and has its clean hotkey enabled, and say exactly what the user must do if not.',
    inputSchema: { type: 'object', properties: {} },
  },
];

async function cleanMemory({ needed_mb: needed } = {}) {
  const before = availableMB();
  if (needed && before >= needed) {
    return { cleaned: false, reason: `Already ${before} MB available (needed ${needed} MB).`, availableMB: before };
  }
  const clean = await performClean('agent');
  if (clean.status === 'cooldown') return { cleaned: false, reason: `Cooldown: try again in ${clean.waitSeconds} s.`, availableMB: before };
  if (clean.status === 'busy') return { cleaned: false, reason: 'Another session is cleaning right now.', availableMB: before };
  if (clean.status === 'not-ready') return { cleaned: false, reason: 'Mem Reduct is not ready.', setup: clean.setup };
  if (clean.status === 'unconfirmed') return { cleaned: false, availableBeforeMB: before, availableAfterMB: availableMB(), hotkey: clean.hotkey, hint: clean.hint, note: NOTE };
  return {
    cleaned: true,
    availableBeforeMB: clean.beforeMB,
    availableAfterMB: clean.afterMB,
    freedMB: clean.afterMB - clean.beforeMB,
    ...(needed ? { neededMB: needed, fits: clean.afterMB >= needed } : {}),
    ...(needed && clean.afterMB < needed ? { advice: 'Still short of what the job needs. Lower its parallelism, wait for running jobs, or tell the user what is using the memory.' } : {}),
    ...(clean.memreductReported ? { memreductReported: clean.memreductReported } : {}),
    hotkey: clean.hotkey,
    note: NOTE,
  };
}

const handlers = {
  memory_status: () => memoryStatus(),
  clean_memory: (args) => cleanMemory(args),
  memreduct_setup_check: () => setupStatus(),
};

// Sent to every client at initialize, so agents know when to clean without a separate skill:
// Claude Code adds it to the system prompt, Codex uses it to describe this server's tools.
const INSTRUCTIONS = 'Frees physical RAM on Windows through the user\'s running Mem Reduct. Use it on your own, without asking first: '
  + '(1) before work that needs a lot of memory (builds, model inference, renders, many parallel agents or subagents), call memory_status and, if available RAM is short, clean_memory with needed_mb set to what the job needs; '
  + '(2) after a step fails with out-of-memory, "low virtual memory" or similar errors, or when commands slow down or time out while available RAM is low, clean once and retry once. '
  + 'Do not clean on a schedule or repeatedly: there is a cooldown, and programs read trimmed pages back from disk. '
  + 'If memory is holding you back, try a clean before lowering parallelism. Tell the user available RAM before and after. If clean_memory reports setup problems, relay them; never elevate or change Mem Reduct\'s settings.';

const server = new Server({ name: 'memreduct-mcp', version: VERSION }, { capabilities: { tools: {} }, instructions: INSTRUCTIONS });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const handler = handlers[req.params.name];
  if (!handler) return { isError: true, content: [{ type: 'text', text: `Unknown tool ${req.params.name}` }] };
  try {
    const result = await handler(req.params.arguments ?? {});
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  } catch (error) {
    return { isError: true, content: [{ type: 'text', text: String(error.message ?? error) }] };
  }
});

if (process.platform !== 'win32') {
  console.error('memreduct-mcp only runs on Windows.');
  process.exit(1);
}
server.connect(new StdioServerTransport()).catch((error) => {
  console.error(error);
  process.exit(1);
});
