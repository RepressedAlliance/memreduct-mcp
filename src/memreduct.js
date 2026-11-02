// Talks to a running Mem Reduct (https://github.com/henrypp/memreduct) through its
// global "clean memory" hotkey. Mem Reduct runs elevated and registers the hotkey
// with RegisterHotKey, so an unelevated agent can trigger a clean without UAC.
// A hotkey clean shows no confirmation and no modal dialog (only an optional tray
// balloon), unlike `memreduct.exe -clean`, which always ends with a MessageBox.
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DEFAULT_INSTALL_DIR = 'C:\\Program Files\\Mem Reduct';
// Mem Reduct's default hotkey value: MAKEWORD(VK_F1, HOTKEYF_CONTROL)
const DEFAULT_HOTKEY = 0x0270;
const HOTKEYF = { SHIFT: 1, CONTROL: 2, ALT: 4 };

export function run(file, args, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => (error ? reject(new Error(`${file} failed: ${stderr || error.message}`)) : resolve(stdout)));
  });
}

export function powershell(script, timeoutMs) {
  return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], timeoutMs);
}

async function installDir() {
  try {
    const out = await run('reg.exe', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall', '/s', '/f', 'Mem Reduct', '/v', 'InstallLocation']);
    const m = out.match(/InstallLocation\s+REG_(?:EXPAND_)?SZ\s+"?([^"\r\n]+)"?/);
    if (m && existsSync(join(m[1], 'memreduct.exe'))) return m[1];
  } catch {
    // not installed through the setup program; fall through to the default path
  }
  return existsSync(join(DEFAULT_INSTALL_DIR, 'memreduct.exe')) ? DEFAULT_INSTALL_DIR : null;
}

function iniCandidates(dir) {
  // Portable mode keeps memreduct.ini next to the exe; otherwise it lives in %APPDATA%.
  const list = [];
  if (dir) list.push(join(dir, 'memreduct.ini'));
  if (process.env.APPDATA) list.push(join(process.env.APPDATA, 'Henry++', 'Mem Reduct', 'memreduct.ini'));
  return list;
}

function readIni(path) {
  const buf = readFileSync(path);
  const text = buf[0] === 0xff && buf[1] === 0xfe ? buf.toString('utf16le').slice(1) : buf.toString('utf8');
  const values = {};
  let section = '';
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('[')) section = line.slice(1, -1);
    else if (section === 'memreduct' && line.includes('=')) {
      const i = line.indexOf('=');
      values[line.slice(0, i)] = line.slice(i + 1);
    }
  }
  return values;
}

export function decodeHotkey(value) {
  const vk = value & 0xff;
  const flags = (value >> 8) & 0xff;
  const names = [];
  if (flags & HOTKEYF.CONTROL) names.push('Ctrl');
  if (flags & HOTKEYF.ALT) names.push('Alt');
  if (flags & HOTKEYF.SHIFT) names.push('Shift');
  const key = vk >= 0x70 && vk <= 0x87 ? `F${vk - 0x6f}`
    : (vk >= 0x30 && vk <= 0x5a ? String.fromCharCode(vk) : `VK_0x${vk.toString(16)}`);
  return { vk, ctrl: !!(flags & HOTKEYF.CONTROL), alt: !!(flags & HOTKEYF.ALT), shift: !!(flags & HOTKEYF.SHIFT), label: [...names, key].join('+') };
}

async function isRunning() {
  const out = await run('tasklist.exe', ['/FI', 'IMAGENAME eq memreduct.exe', '/FO', 'CSV', '/NH']);
  return /memreduct\.exe/i.test(out);
}

/** Everything an agent or user needs to know before cleaning works. */
export async function setupStatus() {
  const dir = await installDir();
  const iniPath = iniCandidates(dir).find((p) => existsSync(p)) ?? null;
  const ini = iniPath ? readIni(iniPath) : {};
  const hotkeyEnabled = ini.HotkeyCleanEnable === 'true';
  const hotkey = decodeHotkey(Number(ini.HotkeyClean ?? DEFAULT_HOTKEY));
  const running = dir ? await isRunning() : false;
  const problems = [];
  if (!dir) problems.push('Mem Reduct is not installed. Install it from https://github.com/henrypp/memreduct/releases.');
  if (dir && !running) problems.push('Mem Reduct is not running. Start it (it asks for administrator rights once) and keep it in the tray; enable "Load on system startup" in its settings to keep it there.');
  if (dir && !hotkeyEnabled) problems.push('The clean hotkey is off. In Mem Reduct: Settings > Hotkeys > enable "Clean memory" (any key combination; a rarely used one such as Ctrl+Alt+Shift+F12 is safest), then click OK.');
  return {
    ready: problems.length === 0,
    installDir: dir,
    iniPath,
    running,
    hotkeyEnabled,
    hotkey: hotkey.label,
    lastCleanUnix: ini.StatisticLastReduct ? Number(ini.StatisticLastReduct) : null,
    problems,
  };
}

/**
 * Press Mem Reduct's clean hotkey, then wait until Mem Reduct records a new
 * StatisticLastReduct timestamp in its ini (it writes one after every clean).
 */
export async function triggerClean(timeoutMs = 15000) {
  const status = await setupStatus();
  if (!status.ready) return { triggered: false, status };
  const hk = decodeHotkey(Number(readIni(status.iniPath).HotkeyClean ?? DEFAULT_HOTKEY));
  const down = [hk.ctrl && 0x11, hk.alt && 0x12, hk.shift && 0x10, hk.vk].filter(Boolean);
  const press = down.map((k) => `[MemReductMcp.K]::keybd_event(${k},0,0,[UIntPtr]::Zero)`).join(';');
  const release = [...down].reverse().map((k) => `[MemReductMcp.K]::keybd_event(${k},0,2,[UIntPtr]::Zero)`).join(';');
  await powershell(
    "Add-Type -Namespace MemReductMcp -Name K -MemberDefinition '[System.Runtime.InteropServices.DllImport(\"user32.dll\")] public static extern void keybd_event(byte vk, byte scan, uint flags, System.UIntPtr extra);';"
    + `${press};${release}`);
  const before = status.lastCleanUnix;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500));
    const now = readIni(status.iniPath).StatisticLastReduct;
    if (now && Number(now) !== before) return { triggered: true, confirmed: true, hotkey: hk.label, lastCleanUnix: Number(now) };
  }
  return {
    triggered: true,
    confirmed: false,
    hotkey: hk.label,
    hint: 'Mem Reduct did not record a clean. Likely causes: another program owns the same hotkey, an elevated window (for example Task Manager) has keyboard focus so Windows blocked the key press, or the workstation is locked.',
  };
}
