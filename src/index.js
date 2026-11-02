#!/usr/bin/env node
// MCP server that lets AI agents free RAM with the user's own Mem Reduct.
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { setupStatus, triggerClean } from './memreduct.js';
import { availableMB, memoryStatus } from './memory.js';

const VERSION = '0.1.0';
const STATE = join(tmpdir(), 'memreduct-mcp-state.json');
// Cleaning trims every process's working set; pages come back from disk when used,
// so repeated cleans cost performance. Agents get a cooldown, not a turbo button.
// A client that leaves a config placeholder unexpanded must not switch the cooldown off.
const envCooldown = Number(process.env.MEMREDUCT_MCP_COOLDOWN);
const COOLDOWN_SECONDS = process.env.MEMREDUCT_MCP_COOLDOWN && envCooldown >= 0 ? envCooldown : 120;

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
      + 'Returns available RAM before and after. Use before starting a memory-hungry job when available RAM is short. '
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

function lastClean() {
  try { return JSON.parse(readFileSync(STATE, 'utf8')).lastClean ?? 0; } catch { return 0; }
}

async function cleanMemory({ needed_mb: needed } = {}) {
  const before = await availableMB();
  if (needed && before >= needed) {
    return { cleaned: false, reason: `Already ${before} MB available (needed ${needed} MB).`, availableMB: before };
  }
  const wait = Math.ceil(COOLDOWN_SECONDS - (Date.now() - lastClean()) / 1000);
  if (wait > 0) return { cleaned: false, reason: `Cooldown: try again in ${wait} s.`, availableMB: before };
  const result = await triggerClean();
  if (!result.triggered) return { cleaned: false, reason: 'Mem Reduct is not ready.', setup: result.status };
  writeFileSync(STATE, JSON.stringify({ lastClean: Date.now() }));
  await new Promise((r) => setTimeout(r, 1500)); // let freed pages settle before measuring
  const after = await availableMB();
  return {
    cleaned: result.confirmed,
    availableBeforeMB: before,
    availableAfterMB: after,
    freedMB: after - before,
    ...(result.memreductReported ? { memreductReported: result.memreductReported } : {}),
    hotkey: result.hotkey,
    ...(result.confirmed ? {} : { hint: result.hint }),
    note: NOTE,
  };
}

const handlers = {
  memory_status: () => memoryStatus(),
  clean_memory: (args) => cleanMemory(args),
  memreduct_setup_check: () => setupStatus(),
};

const server = new Server({ name: 'memreduct-mcp', version: VERSION }, { capabilities: { tools: {} } });
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
