// End-to-end check against the real machine: starts the bundled server over stdio
// and calls every tool. Cleaning really runs (Mem Reduct must be set up).
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const client = new Client({ name: 'smoke-test', version: '0.0.0' });
await client.connect(new StdioClientTransport({
  command: process.execPath,
  args: [new URL('../dist/index.cjs', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')],
  env: { ...process.env, MEMREDUCT_MCP_COOLDOWN: process.env.MEMREDUCT_MCP_COOLDOWN ?? '0' },
}));

const { tools } = await client.listTools();
console.log('tools:', tools.map((t) => t.name).join(', '));
for (const name of ['memreduct_setup_check', 'memory_status', 'clean_memory']) {
  const res = await client.callTool({ name, arguments: {} });
  console.log(`\n== ${name}${res.isError ? ' (ERROR)' : ''}\n${res.content[0].text}`);
}
const skip = await client.callTool({ name: 'clean_memory', arguments: { needed_mb: 1 } });
console.log(`\n== clean_memory needed_mb=1\n${skip.content[0].text}`);
await client.close();
