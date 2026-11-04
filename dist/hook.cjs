// src/hook.js
var import_node_os3 = require("node:os");

// src/clean.js
var import_node_os2 = require("node:os");

// src/memreduct.js
var import_node_child_process = require("node:child_process");
var import_node_fs = require("node:fs");
var import_node_path = require("node:path");
var DEFAULT_INSTALL_DIR = "C:\\Program Files\\Mem Reduct";
var DEFAULT_HOTKEY = 624;
var HOTKEYF = { SHIFT: 1, CONTROL: 2, ALT: 4 };
function run(file, args, timeoutMs = 2e4) {
  return new Promise((resolve, reject) => {
    (0, import_node_child_process.execFile)(
      file,
      args,
      { windowsHide: true, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => error ? reject(new Error(`${file} failed: ${stderr || error.message}`)) : resolve(stdout)
    );
  });
}
function powershell(script, timeoutMs) {
  return run("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], timeoutMs);
}
async function installDir() {
  try {
    const out = await run("reg.exe", ["query", "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall", "/s", "/f", "Mem Reduct", "/v", "InstallLocation"]);
    const m = out.match(/InstallLocation\s+REG_(?:EXPAND_)?SZ\s+"?([^"\r\n]+)"?/);
    if (m && (0, import_node_fs.existsSync)((0, import_node_path.join)(m[1], "memreduct.exe"))) return m[1];
  } catch {
  }
  return (0, import_node_fs.existsSync)((0, import_node_path.join)(DEFAULT_INSTALL_DIR, "memreduct.exe")) ? DEFAULT_INSTALL_DIR : null;
}
function iniCandidates(dir) {
  const list = [];
  if (dir) list.push((0, import_node_path.join)(dir, "memreduct.ini"));
  if (process.env.APPDATA) list.push((0, import_node_path.join)(process.env.APPDATA, "Henry++", "Mem Reduct", "memreduct.ini"));
  return list;
}
function decode(buf) {
  if (buf[0] === 255 && buf[1] === 254) return buf.toString("utf16le").slice(1);
  if (buf.length > 1 && buf[1] === 0) return buf.toString("utf16le");
  return buf.toString("utf8");
}
function readIni(path) {
  const text = decode((0, import_node_fs.readFileSync)(path));
  const values = {};
  let section = "";
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("[")) section = line.slice(1, -1);
    else if (section === "memreduct" && line.includes("=")) {
      const i = line.indexOf("=");
      values[line.slice(0, i)] = line.slice(i + 1);
    }
  }
  return values;
}
function decodeHotkey(value) {
  const vk = value & 255;
  const flags = value >> 8 & 255;
  const names = [];
  if (flags & HOTKEYF.CONTROL) names.push("Ctrl");
  if (flags & HOTKEYF.ALT) names.push("Alt");
  if (flags & HOTKEYF.SHIFT) names.push("Shift");
  const key = vk >= 112 && vk <= 135 ? `F${vk - 111}` : vk >= 48 && vk <= 90 ? String.fromCharCode(vk) : `VK_0x${vk.toString(16)}`;
  return { vk, ctrl: !!(flags & HOTKEYF.CONTROL), alt: !!(flags & HOTKEYF.ALT), shift: !!(flags & HOTKEYF.SHIFT), label: [...names, key].join("+") };
}
function lastLoggedClean(iniPath) {
  try {
    const text = decode((0, import_node_fs.readFileSync)((0, import_node_path.join)(iniPath, "..", "memreduct_debug.log")));
    const line = text.split(/\r?\n/).filter((l) => l.startsWith('"Info"') && l.includes("Cleanup (")).pop();
    if (!line) return null;
    const [, time, reason, , amount] = line.split('","').map((s) => s.replace(/^"|"$/g, ""));
    return { time, reason, amount };
  } catch {
    return null;
  }
}
async function isRunning() {
  const out = await run("tasklist.exe", ["/FI", "IMAGENAME eq memreduct.exe", "/FO", "CSV", "/NH"]);
  return /memreduct\.exe/i.test(out);
}
async function setupStatus() {
  const dir = await installDir();
  const iniPath = iniCandidates(dir).find((p) => (0, import_node_fs.existsSync)(p)) ?? null;
  const ini = iniPath ? readIni(iniPath) : {};
  const hotkeyEnabled = ini.HotkeyCleanEnable === "true";
  const hotkey = decodeHotkey(Number(ini.HotkeyClean ?? DEFAULT_HOTKEY));
  const running = dir ? await isRunning() : false;
  const problems = [];
  if (!dir) problems.push("Mem Reduct is not installed. Install it from https://github.com/henrypp/memreduct/releases.");
  if (dir && !running) problems.push('Mem Reduct is not running. Start it (it asks for administrator rights once) and keep it in the tray; enable "Load on system startup" in its settings to keep it there.');
  if (dir && !hotkeyEnabled) problems.push('The clean hotkey is off. In Mem Reduct: Settings > Hotkeys > enable "Clean memory" (any key combination; a rarely used one such as Ctrl+Alt+Shift+F12 is safest), then click OK.');
  return {
    ready: problems.length === 0,
    installDir: dir,
    iniPath,
    running,
    hotkeyEnabled,
    hotkey: hotkey.label,
    // Optional: lets clean_memory also return the amount Mem Reduct itself reports
    resultLogging: ini.LogCleanResults === "true",
    lastCleanUnix: ini.StatisticLastReduct ? Number(ini.StatisticLastReduct) : null,
    problems
  };
}
async function triggerClean(timeoutMs = 15e3) {
  const status = await setupStatus();
  if (!status.ready) return { triggered: false, status };
  const hk = decodeHotkey(Number(readIni(status.iniPath).HotkeyClean ?? DEFAULT_HOTKEY));
  const down = [hk.ctrl && 17, hk.alt && 18, hk.shift && 16, hk.vk].filter(Boolean);
  const press = down.map((k) => `[MemReductMcp.K]::keybd_event(${k},0,0,[UIntPtr]::Zero)`).join(";");
  const release = [...down].reverse().map((k) => `[MemReductMcp.K]::keybd_event(${k},0,2,[UIntPtr]::Zero)`).join(";");
  await powershell(
    `Add-Type -Namespace MemReductMcp -Name K -MemberDefinition '[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, System.UIntPtr extra);';${press};${release}`
  );
  const before = status.lastCleanUnix;
  const logBefore = status.resultLogging ? JSON.stringify(lastLoggedClean(status.iniPath)) : null;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500));
    const now = readIni(status.iniPath).StatisticLastReduct;
    if (now && Number(now) !== before) {
      let logged = null;
      for (let i = 0; status.resultLogging && i < 12; i++) {
        const entry = lastLoggedClean(status.iniPath);
        if (entry && JSON.stringify(entry) !== logBefore) {
          logged = entry;
          break;
        }
        await new Promise((r) => setTimeout(r, 250));
      }
      return {
        triggered: true,
        confirmed: true,
        hotkey: hk.label,
        lastCleanUnix: Number(now),
        ...logged && logged.reason === "Cleanup (Hotkey)" ? { memreductReported: logged.amount } : {}
      };
    }
  }
  return {
    triggered: true,
    confirmed: false,
    hotkey: hk.label,
    hint: "Mem Reduct did not record a clean. Likely causes: another program owns the same hotkey, an elevated window (for example Task Manager) has keyboard focus so Windows blocked the key press, or the workstation is locked."
  };
}

// src/state.js
var import_node_fs2 = require("node:fs");
var import_node_os = require("node:os");
var import_node_path2 = require("node:path");
var DATA_DIR = process.env.MEMREDUCT_MCP_DATA_DIR || (0, import_node_path2.join)((0, import_node_os.homedir)(), ".memreduct-mcp");
var STATE = (0, import_node_path2.join)(DATA_DIR, "state.json");
var LOCK = (0, import_node_path2.join)(DATA_DIR, "clean.lock");
var LOG = (0, import_node_path2.join)(DATA_DIR, "hook-log.jsonl");
var LOCK_STALE_MS = 6e4;
function readState() {
  try {
    return JSON.parse((0, import_node_fs2.readFileSync)(STATE, "utf8"));
  } catch {
    return {};
  }
}
function writeState(state) {
  (0, import_node_fs2.mkdirSync)(DATA_DIR, { recursive: true });
  const tmp = `${STATE}.${process.pid}.tmp`;
  (0, import_node_fs2.writeFileSync)(tmp, JSON.stringify(state));
  try {
    (0, import_node_fs2.renameSync)(tmp, STATE);
  } catch {
    (0, import_node_fs2.writeFileSync)(STATE, JSON.stringify(state));
    try {
      (0, import_node_fs2.unlinkSync)(tmp);
    } catch {
    }
  }
}
function updateState(change) {
  const state = readState();
  change(state);
  writeState(state);
}
function acquireCleanLock() {
  (0, import_node_fs2.mkdirSync)(DATA_DIR, { recursive: true });
  try {
    if (Date.now() - (0, import_node_fs2.statSync)(LOCK).mtimeMs > LOCK_STALE_MS) (0, import_node_fs2.unlinkSync)(LOCK);
  } catch {
  }
  try {
    (0, import_node_fs2.closeSync)((0, import_node_fs2.openSync)(LOCK, "wx"));
  } catch {
    return null;
  }
  return () => {
    try {
      (0, import_node_fs2.unlinkSync)(LOCK);
    } catch {
    }
  };
}
function logEvent(record) {
  try {
    (0, import_node_fs2.mkdirSync)(DATA_DIR, { recursive: true });
    (0, import_node_fs2.appendFileSync)(LOG, `${JSON.stringify({ t: (/* @__PURE__ */ new Date()).toISOString(), ...record })}
`);
  } catch {
  }
}

// src/clean.js
var envCooldown = Number(process.env.MEMREDUCT_MCP_COOLDOWN);
var COOLDOWN_SECONDS = process.env.MEMREDUCT_MCP_COOLDOWN && envCooldown >= 0 ? envCooldown : 120;
var availableMB = () => Math.round((0, import_node_os2.freemem)() / 1048576);
async function performClean(by) {
  const beforeMB = availableMB();
  const release = acquireCleanLock();
  if (!release) return { status: "busy", beforeMB };
  try {
    const wait = Math.ceil(COOLDOWN_SECONDS - (Date.now() - (readState().lastClean ?? 0)) / 1e3);
    if (wait > 0) return { status: "cooldown", waitSeconds: wait, beforeMB };
    updateState((s) => {
      s.pressAt = Date.now();
      s.by = by;
    });
    const result = await triggerClean();
    if (!result.triggered) return { status: "not-ready", setup: result.status, beforeMB };
    updateState((s) => {
      s.lastClean = Date.now();
    });
    if (!result.confirmed) return { status: "unconfirmed", hint: result.hint, hotkey: result.hotkey, beforeMB };
    await new Promise((r) => setTimeout(r, 1500));
    const afterMB = availableMB();
    updateState((s) => {
      s.afterMB = afterMB;
    });
    return { status: "cleaned", beforeMB, afterMB, hotkey: result.hotkey, memreductReported: result.memreductReported };
  } finally {
    release();
  }
}

// src/memory.js
var SCRIPT = `
$os = Get-CimInstance Win32_OperatingSystem
$top = Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 8 |
  ForEach-Object { [pscustomobject]@{ name = $_.ProcessName; pid = $_.Id; workingSetMB = [math]::Round($_.WorkingSet64 / 1MB) } }
[pscustomobject]@{
  totalMB = [math]::Round($os.TotalVisibleMemorySize / 1KB)
  availableMB = [math]::Round((Get-Counter '\\Memory\\Available MBytes').CounterSamples[0].CookedValue)
  commitLimitMB = [math]::Round($os.TotalVirtualMemorySize / 1KB)
  commitUsedMB = [math]::Round(($os.TotalVirtualMemorySize - $os.FreeVirtualMemory) / 1KB)
  topProcesses = @($top)
} | ConvertTo-Json -Depth 3 -Compress`;
async function memoryStatus() {
  return JSON.parse(await powershell(SCRIPT));
}

// src/policy.js
var num = (name, fallback) => {
  const v = Number(process.env[name]);
  return process.env[name] && v >= 0 ? v : fallback;
};
var defaults = () => ({
  needPct: num("MEMREDUCT_MCP_NEED_PCT", 25),
  // clean before heavy work below this
  warnPct: num("MEMREDUCT_MCP_WARN_PCT", 15),
  // remind the agent below this
  criticalPct: num("MEMREDUCT_MCP_CRITICAL_PCT", 6),
  // clean at the next step below this
  rearmPct: num("MEMREDUCT_MCP_REARM_PCT", 25),
  // remind again only after recovering above this
  repeatMinutes: 15,
  // or after this long, if memory stays low
  holdMinutes: 5,
  // low again within this long after a clean: the clean did not hold
  debounceSeconds: 30,
  // available RAM swings by gigabytes in seconds; ignore brief dips
  observationGapMinutes: 5
  // a low reading this old says nothing about now
});
var HEAVY_TOOLS = /^(Agent|Task|Workflow)$|^mcp__.*start_process$/;
var SHELL_TOOLS = /^(Bash|PowerShell)$/;
var HEAVY_COMMAND = /\b(blender|ffmpeg|melt|handbrake|comfyui|ollama|llama|whisper|torch|tensorflow|transformers|docker\s+(build|compose)|cargo\s+(build|test)|(npm|pnpm|yarn|bun)\s+(run\s+)?(build|test)|next\s+build|vite\s+build|webpack|tsc|gradle|mvn|msbuild|dotnet\s+(build|test)|cmake\s+--build|ninja|pytest|playwright)\b/i;
var MEMORY_ERROR = /out of memory|outofmemory|MemoryError|low virtual memory|bad_alloc|cannot allocate memory|insufficient memory|not enough memory|ENOMEM|0xC0000017|paging file is too small|heap out of memory/i;
var NOT_SYSTEM_RAM = /CUDA|VRAM|GPU|OptiX|Cg C\d+|shader/i;
function isHeavy(toolName, toolInput = {}) {
  if (HEAVY_TOOLS.test(toolName)) return true;
  if (!SHELL_TOOLS.test(toolName)) return false;
  return toolInput.run_in_background === true || HEAVY_COMMAND.test(String(toolInput.command ?? ""));
}
function isMemoryError(text) {
  const s = String(text ?? "");
  return MEMORY_ERROR.test(s) && !NOT_SYSTEM_RAM.test(s);
}
function decide({ event, toolName, toolInput, error, availMB, totalMB, now, session, state }, config = defaults()) {
  const pct = availMB / totalMB * 100;
  const recentClean = now - (state.lastClean ?? 0) < config.holdMinutes * 6e4;
  const none = (next2 = state) => ({ action: "none", state: next2 });
  if (event === "PostToolUseFailure") {
    if (!isMemoryError(error)) return none();
    return recentClean ? { action: "remind", kind: "oom-did-not-hold", state } : { action: "clean", kind: "after-oom", state };
  }
  if (event === "PreToolUse") {
    if (!isHeavy(toolName, toolInput) || pct >= config.needPct) return none();
    if (!recentClean) return { action: "clean", kind: "before-job", state };
    if (pct >= config.warnPct) return none();
  } else if (pct < config.criticalPct && !recentClean) {
    return { action: "clean", kind: "critical", state };
  }
  if (pct >= config.warnPct) {
    if (!state.lowSince && (pct < config.rearmPct || state.recovered)) return none();
    const next2 = { ...state, lastLowAt: void 0, lowSince: void 0 };
    if (pct >= config.rearmPct) {
      next2.recovered = true;
      next2.rearmAt = now;
    }
    return none(next2);
  }
  const lastObservation = state.lastLowAt ?? 0;
  const lowSince = state.lowSince && now - lastObservation < config.observationGapMinutes * 6e4 ? state.lowSince : now;
  const next = { ...state, lowSince, lastLowAt: now, recovered: false };
  const urgent = pct < config.criticalPct || event === "PreToolUse";
  if (!urgent && now - lowSince < config.debounceSeconds * 1e3) return none(next);
  const lastWarn = state.sessions?.[session]?.lastWarn ?? 0;
  const armed = lastWarn < (state.rearmAt ?? 0);
  if (!armed && lastWarn && now - lastWarn < config.repeatMinutes * 6e4) return none(next);
  const sessions = {};
  for (const [id, s] of Object.entries(state.sessions ?? {})) if (now - s.lastWarn < 864e5) sessions[id] = s;
  sessions[session] = { lastWarn: now };
  next.sessions = sessions;
  return { action: "remind", kind: recentClean ? "did-not-hold" : "low", state: next };
}
var gb = (mb) => `${(mb / 1024).toFixed(1)} GB`;
function describe(kind, { beforeMB, afterMB, availMB, totalMB, minutesSinceClean, top, setupProblems, hint }) {
  const of = (mb) => `${gb(mb)} of ${gb(totalMB)} (${Math.round(mb / totalMB * 100)}%)`;
  const topText = top?.length ? ` Largest processes: ${top.join(", ")}.` : "";
  switch (kind) {
    case "before-job":
    case "critical":
    case "after-oom": {
      const opening = { "before-job": "before this step", critical: "because memory was critically low", "after-oom": "after this out-of-memory failure" }[kind];
      const close = kind === "after-oom" ? "Retrying the failed step once is reasonable if it now fits." : "Freed memory tends to fill again within minutes under load, so start what you need now and avoid adding more parallel work than fits.";
      return `memreduct cleaned RAM ${opening}: available went from ${gb(beforeMB)} to ${of(afterMB)}. ${close}`;
    }
    case "no-gain":
      return `memreduct ran a clean, but available RAM went from ${gb(beforeMB)} to ${of(afterMB)}: the memory is in active use, so cleaning can't free it. Lower parallelism, wait for running jobs, or tell the user what is using the memory.`;
    case "low":
      return `Available RAM is ${of(availMB)}.${topText} The memreduct clean_memory tool can free some of it now; if the next steps need memory, use it before starting them.`;
    case "oom-did-not-hold":
      return `This failure looks like out-of-memory. A clean ran ${minutesSinceClean} min ago and available RAM is now ${of(availMB)}, so another clean is unlikely to add much.${topText} Retry once if the step should fit now; otherwise lower parallelism, wait for running jobs, or tell the user what is using the memory.`;
    case "did-not-hold":
      return `Available RAM is ${of(availMB)}, and a clean ${minutesSinceClean} min ago did not hold, so another clean is unlikely to help.${topText} Options: wait for running jobs to finish, lower parallelism, or tell the user what is using the memory.`;
    case "cannot-clean":
      return `Available RAM is ${of(availMB)}, but memreduct could not clean: ${setupProblems?.join(" ") || hint || "another clean is in progress."}`;
    default:
      return "";
  }
}

// src/hook.js
var MEANINGFUL_GAIN_MB = 300;
var readStdin = () => new Promise((resolve) => {
  let data = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    data += chunk;
  });
  process.stdin.on("end", () => resolve(data));
  process.stdin.on("error", () => resolve(""));
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
    ...userNote ? { systemMessage: userNote } : {}
  }));
}
async function main() {
  if (process.platform !== "win32" || process.env.MEMREDUCT_MCP_HOOKS === "off") return;
  const input = JSON.parse(await readStdin() || "{}");
  const event = input.hook_event_name;
  const session = input.session_id ?? "unknown";
  const toolName = input.tool_name;
  const totalMB = Math.round((0, import_node_os3.totalmem)() / 1048576);
  const availMB = Math.round((0, import_node_os3.freemem)() / 1048576);
  const now = Date.now();
  const state = readState();
  const result = decide({ event, toolName, toolInput: input.tool_input, error: input.error, availMB, totalMB, now, session, state });
  if (result.state !== state) writeState(result.state);
  if (result.action === "none") return;
  const log = { event, tool: toolName, session, availMB, totalMB, kind: result.kind };
  const minutesSinceClean = Math.max(1, Math.round((now - (state.lastClean ?? 0)) / 6e4));
  if (result.action === "clean") {
    const clean = await performClean(`hook:${result.kind}`);
    logEvent({ ...log, action: "clean", status: clean.status, beforeMB: clean.beforeMB, afterMB: clean.afterMB, reported: clean.memreductReported });
    if (clean.status === "cleaned") {
      const gained = clean.afterMB - clean.beforeMB >= MEANINGFUL_GAIN_MB;
      const text = describe(gained ? result.kind : "no-gain", { ...clean, totalMB });
      respond(event, text, text);
    } else if (clean.status === "not-ready" || clean.status === "unconfirmed") {
      respond(event, describe("cannot-clean", { availMB, totalMB, setupProblems: clean.setup?.problems, hint: clean.hint }));
    }
    return;
  }
  logEvent({ ...log, action: "remind" });
  const top = await largestProcesses();
  respond(event, describe(result.kind, { availMB, totalMB, minutesSinceClean, top }));
}
main().catch((error) => logEvent({ action: "error", message: String(error?.message ?? error) }));
