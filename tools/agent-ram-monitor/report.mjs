// Turns the monitor's JSON Lines files into a summary (printed) and an HTML page with a
// timeline. Every clean is counted, small or large; sleep gaps are shown, not bridged.
// Usage: node report.mjs [dataDir] [days]
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dataDir = process.argv[2] ?? join(process.env.USERPROFILE, '.memreduct-mcp', 'monitor');
const days = Number(process.argv[3] ?? 7);
const since = Date.now() - days * 86400e3;

const records = [];
for (const f of readdirSync(dataDir).filter((n) => n.endsWith('.jsonl')).sort()) {
  for (const line of readFileSync(join(dataDir, f), 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line.replace(/^﻿/, ''));
      r.ms = Date.parse(r.t);
      if (r.ms >= since) records.push(r);
    } catch { /* a line cut short by a crash or power loss */ }
  }
}
records.sort((a, b) => a.ms - b.ms);
const samples = records.filter((r) => r.kind === 'sample');
const cleans = records.filter((r) => r.kind === 'clean');
const followups = records.filter((r) => r.kind === 'followup');
const resumes = records.filter((r) => r.kind === 'monitor' && r.event === 'resume');

const agentWs = (s) => (s?.agents?.claude?.workingSetMB ?? 0) + (s?.agents?.codex?.workingSetMB ?? 0);
const agentPriv = (s) => (s?.agents?.claude?.privateMB ?? 0) + (s?.agents?.codex?.privateMB ?? 0);
const median = (xs) => { const v = xs.filter(Number.isFinite).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null; };
const gb = (mb) => (mb == null ? '–' : `${(mb / 1024).toFixed(2)} GB`);
const parseAmount = (s) => { const m = /([\d.]+)\s*(GB|MB|KB)/i.exec(s ?? ''); return m ? Number(m[1]) * { GB: 1024, MB: 1, KB: 1 / 1024 }[m[2].toUpperCase()] : null; };

// Per clean: agent memory freed right away, and how much of it is still free later.
const rows = cleans.map((c) => {
  const before = agentWs(c.before);
  const freed = c.before ? before - agentWs(c.after) : null;
  const later = {};
  for (const f of followups.filter((x) => x.cleanId === c.id)) later[f.minutes] = c.before ? before - agentWs(f.sample) : null;
  return {
    t: c.t, source: c.source, reported: parseAmount(c.memreductReported), reportedText: c.memreductReported,
    availBefore: c.beforeSystem?.availableMB ?? c.before?.availableMB, availAfter: c.after?.availableMB,
    agentBefore: c.before ? before : null, agentFreed: freed, later, beforeAge: c.beforeAgeSeconds,
  };
});

const bySource = {};
for (const r of rows) (bySource[r.source] ??= []).push(r);
const summary = Object.entries(bySource).map(([source, rs]) => ({
  source, cleans: rs.length,
  medianReported: median(rs.map((r) => r.reported)),
  medianAvailGain: median(rs.map((r) => r.availAfter - r.availBefore)),
  medianAgentFreed: median(rs.map((r) => r.agentFreed)),
  medianAgentStillFree5: median(rs.map((r) => r.later[5])),
  medianAgentStillFree15: median(rs.map((r) => r.later[15])),
}));

const first = samples[0]?.ms; const last = samples.at(-1)?.ms;
const gapMs = resumes.reduce((a, r) => a + r.gapSeconds * 1000, 0);
const sampleSeconds = records.filter((r) => r.kind === 'monitor' && r.event === 'start').at(-1)?.sampleSeconds ?? 60;
const expected = first ? Math.max(1, (last - first - gapMs) / (sampleSeconds * 1000) + 1) : 0;
const lines = [
  `Period: ${first ? new Date(first).toLocaleString() : '–'} to ${last ? new Date(last).toLocaleString() : '–'}`,
  `Samples: ${samples.length} (about ${Math.round(expected)} expected while awake; ${resumes.length} sleep gaps, ${Math.round(gapMs / 60e3)} min)`,
  `Agent memory (Claude + Codex trees), working set: median ${gb(median(samples.map((s) => agentWs(s.sample))))}, max ${gb(Math.max(0, ...samples.map((s) => agentWs(s.sample))))}; private commit median ${gb(median(samples.map((s) => agentPriv(s.sample))))}`,
  '',
  'Cleans by source (medians):',
  ...summary.map((s) => `  ${s.source}: ${s.cleans} cleans; Mem Reduct reported ${gb(s.medianReported)}; available RAM +${gb(s.medianAvailGain)}; agent memory freed ${gb(s.medianAgentFreed)}, still free after 5 min ${gb(s.medianAgentStillFree5)}, after 15 min ${gb(s.medianAgentStillFree15)}`),
];
console.log(lines.join('\n'));

// Timeline: agent working set and system available RAM, with a tick per clean.
const W = 1100, H = 320, P = 40;
const x = (ms) => P + ((ms - first) / Math.max(1, last - first)) * (W - 2 * P);
const maxMB = Math.max(1024, ...samples.map((s) => Math.max(agentWs(s.sample), s.sample.availableMB)));
const y = (mb) => H - P - (mb / maxMB) * (H - 2 * P);
const path = (fn) => {
  let d = ''; let prev = null;
  for (const s of samples) {
    const gap = prev && resumes.some((r) => r.ms > prev.ms && r.ms <= s.ms);
    d += `${!prev || gap ? 'M' : 'L'}${x(s.ms).toFixed(1)},${y(fn(s.sample)).toFixed(1)} `;
    prev = s;
  }
  return d;
};
const colors = { 'memreduct-mcp': '#d9480f' };
const tick = (c) => `<line x1="${x(c.ms)}" x2="${x(c.ms)}" y1="${P}" y2="${H - P}" stroke="${colors[c.source] ?? '#adb5bd'}" stroke-width="${c.source === 'memreduct-mcp' ? 2 : 1}" opacity="0.7"><title>${c.t} ${c.source} ${c.memreductReported ?? ''}</title></line>`;
const esc = (s) => String(s).replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]));
const html = `<!doctype html><meta charset="utf-8"><title>Agent RAM monitor</title>
<style>body{font:14px system-ui;margin:24px;max-width:1150px}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:4px 8px;text-align:right}th:first-child,td:first-child{text-align:left}pre{background:#f6f6f6;padding:12px}</style>
<h1>Agent RAM monitor</h1><pre>${esc(lines.join('\n'))}</pre>
${first ? `<svg width="${W}" height="${H}" style="border:1px solid #ddd">
<path d="${path(agentWs)}" fill="none" stroke="#1c7ed6" stroke-width="1.5"/><path d="${path((s) => s.availableMB)}" fill="none" stroke="#2f9e44" stroke-width="1.5"/>
${cleans.map(tick).join('')}
<text x="${P}" y="20" fill="#1c7ed6">Claude + Codex working set</text><text x="${P + 230}" y="20" fill="#2f9e44">system available RAM</text>
<text x="${P + 420}" y="20" fill="#d9480f">| clean by memreduct-mcp</text><text x="${P + 600}" y="20" fill="#868e96">| other cleans</text>
<text x="4" y="${y(maxMB) + 4}" font-size="11">${gb(maxMB)}</text><text x="4" y="${H - P}" font-size="11">0</text></svg>` : '<p>No samples yet.</p>'}
<h2>Every clean</h2><table><tr><th>Time</th><th>Source</th><th>Mem Reduct reported</th><th>Available before → after</th><th>Agent memory before</th><th>Agent freed</th><th>Still free +2 / +5 / +15 min</th></tr>
${rows.map((r) => `<tr><td>${esc(new Date(r.t).toLocaleString())}</td><td>${esc(r.source)}</td><td>${esc(r.reportedText ?? '–')}</td><td>${gb(r.availBefore)} → ${gb(r.availAfter)}</td><td>${gb(r.agentBefore)}</td><td>${gb(r.agentFreed)}</td><td>${[2, 5, 15].map((m) => gb(r.later[m])).join(' / ')}</td></tr>`).join('\n')}</table>`;
const out = join(dataDir, 'report.html');
writeFileSync(out, html);
console.log(`\nReport: ${out}`);
