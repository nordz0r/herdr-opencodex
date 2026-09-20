#!/usr/bin/env node
/**
 * OpenCodex stats collector for Herdr.
 * Modes: doctor | show | watch
 *
 * Reads metrics from the local `ocx` CLI (usage / logs). Does not scrape
 * Herdr pane output. Never prints secrets.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const mode = (process.argv[2] || "show").toLowerCase();
const WATCH_INTERVAL_MS = Number(process.env.OCX_STATS_INTERVAL_MS || 5000);
const LOG_LIMIT = Number(process.env.OCX_STATS_LOG_LIMIT || 8);
const USAGE_RANGE = process.env.OCX_STATS_RANGE || "1d";

const stateDir = process.env.HERDR_PLUGIN_STATE_DIR || join(process.cwd(), ".state");
const configDir = process.env.HERDR_PLUGIN_CONFIG_DIR || join(process.cwd(), ".config");

function ensureDirs() {
  try {
    mkdirSync(stateDir, { recursive: true });
  } catch {
    /* ignore */
  }
}

function runOc(args, { allowFail = false } = {}) {
  const result = spawnSync("ocx", args, {
    encoding: "utf8",
    env: process.env,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error) {
    return { ok: false, error: result.error.message, stdout: "", stderr: String(result.stderr || "") };
  }
  const status = result.status ?? 1;
  if (status !== 0 && !allowFail) {
    return {
      ok: false,
      error: `ocx ${args.join(" ")} exited ${status}`,
      stdout: String(result.stdout || ""),
      stderr: String(result.stderr || ""),
    };
  }
  return {
    ok: status === 0,
    status,
    stdout: String(result.stdout || ""),
    stderr: String(result.stderr || ""),
  };
}

function whichOc() {
  const cmd = process.platform === "win32" ? "where" : "which";
  const r = spawnSync(cmd, ["ocx"], { encoding: "utf8" });
  if ((r.status ?? 1) !== 0) return null;
  return String(r.stdout || "").trim().split(/\r?\n/)[0] || null;
}

function tryParseJson(text) {
  const t = text.trim();
  if (!t) return null;
  try {
    return JSON.parse(t);
  } catch {
    // Some CLIs print a banner then JSON — take last {...} or [...]
    const obj = t.lastIndexOf("{");
    const arr = t.lastIndexOf("[");
    const start = Math.max(obj, arr);
    if (start < 0) return null;
    try {
      return JSON.parse(t.slice(start));
    } catch {
      return null;
    }
  }
}

function loadConfig() {
  const path = join(configDir, "config.json");
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

function doctor() {
  ensureDirs();
  const path = whichOc();
  const health = path ? runOc(["health"], { allowFail: true }) : null;
  const report = {
    at: new Date().toISOString(),
    ocxPath: path,
    healthOk: Boolean(health?.ok),
    healthStdout: health?.stdout?.trim() || null,
    healthStderr: health?.stderr?.trim() || null,
    herdrPluginId: process.env.HERDR_PLUGIN_ID || null,
    note: "Cost figures from ocx usage are list-price estimates, not invoices.",
  };
  writeFileSync(join(stateDir, "doctor.json"), JSON.stringify(report, null, 2));
  if (!path) {
    console.error("ocx not found on PATH. Install OpenCodex CLI, then retry.");
    process.exit(1);
  }
  console.log(`ocx: ${path}`);
  console.log(`health: ${report.healthOk ? "ok" : "not ready (proxy may be stopped)"}`);
  if (health?.stdout?.trim()) console.log(health.stdout.trim());
  if (!report.healthOk && health?.stderr?.trim()) console.error(health.stderr.trim());
  process.exit(report.healthOk ? 0 : 2);
}

function fetchUsage(range) {
  // Flag shapes differ slightly across ocx versions; try common forms.
  const attempts = [
    ["usage", "--json", "--range", range],
    ["usage", "--range", range, "--json"],
    ["observe", "usage", "--json", "--range", range],
    ["usage", "--json"],
  ];
  for (const args of attempts) {
    const r = runOc(args, { allowFail: true });
    if (!r.ok) continue;
    const json = tryParseJson(r.stdout);
    if (json) return { ok: true, args, data: json, raw: r.stdout };
  }
  const last = runOc(["usage", "--help"], { allowFail: true });
  return {
    ok: false,
    error: "Could not parse JSON from ocx usage. Run `ocx usage --json` locally and adjust bin/ocx-stats.mjs.",
    help: last.stdout || last.stderr,
  };
}

function fetchRecentLogs(limit) {
  const attempts = [
    ["logs", "--json", "--limit", String(limit)],
    ["logs", "--jsonl", "--limit", String(limit)],
    ["observe", "logs", "--json", "--limit", String(limit)],
    ["logs", "--json"],
  ];
  for (const args of attempts) {
    const r = runOc(args, { allowFail: true });
    if (!r.ok) continue;
    const text = r.stdout.trim();
    if (!text) continue;
    // jsonl
    if (text.includes("\n") && text.trim().startsWith("{")) {
      const rows = [];
      for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) continue;
        try {
          rows.push(JSON.parse(line));
        } catch {
          /* skip */
        }
      }
      if (rows.length) return { ok: true, rows: rows.slice(-limit) };
    }
    const json = tryParseJson(text);
    if (Array.isArray(json)) return { ok: true, rows: json.slice(-limit) };
    if (json && Array.isArray(json.logs)) return { ok: true, rows: json.logs.slice(-limit) };
    if (json && Array.isArray(json.items)) return { ok: true, rows: json.items.slice(-limit) };
  }
  return { ok: false, rows: [] };
}

function pickNumber(...vals) {
  for (const v of vals) {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() && !Number.isNaN(Number(v))) return Number(v);
  }
  return null;
}

function summarizeUsage(data) {
  // Best-effort across possible shapes; refine after capturing live schema.
  const root = data?.summary ?? data?.usage ?? data;
  const input = pickNumber(root?.inputTokens, root?.tokensIn, root?.input, root?.promptTokens);
  const output = pickNumber(root?.outputTokens, root?.tokensOut, root?.output, root?.completionTokens);
  const total = pickNumber(root?.totalTokens, root?.tokens, root?.total) ?? (input != null && output != null ? input + output : null);
  const cost = pickNumber(root?.estimatedCostUsd, root?.estimatedCost, root?.costUsd, data?.estimatedCostUsd);
  const coverage = pickNumber(root?.usageCoverageRatio, root?.coverage, data?.usageCoverageRatio);
  return { input, output, total, cost, coverage, rawKeys: root && typeof root === "object" ? Object.keys(root).slice(0, 24) : [] };
}

function formatDuration(ms) {
  if (ms == null) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function rowDuration(row) {
  return pickNumber(row?.durationMs, row?.duration_ms, row?.latencyMs, row?.duration, row?.elapsedMs);
}

function render({ usage, logs, range, error }) {
  const lines = [];
  lines.push("OpenCodex stats (Herdr plugin)");
  lines.push(`range: ${range}   refreshed: ${new Date().toISOString()}`);
  lines.push("".padEnd(56, "─"));
  if (error) {
    lines.push(`error: ${error}`);
  } else if (usage) {
    const s = summarizeUsage(usage.data);
    lines.push(`tokens in:     ${s.input ?? "—"}`);
    lines.push(`tokens out:    ${s.output ?? "—"}`);
    lines.push(`tokens total:  ${s.total ?? "—"}`);
    lines.push(`est. cost USD: ${s.cost != null ? s.cost.toFixed(4) : "—"}  (list-price estimate)`);
    lines.push(`coverage:      ${s.coverage != null ? s.coverage : "—"}`);
    if (s.input == null && s.total == null && s.rawKeys.length) {
      lines.push(`(unmapped usage keys: ${s.rawKeys.join(", ")})`);
    }
  }
  lines.push("".padEnd(56, "─"));
  lines.push("recent requests:");
  if (!logs?.ok || !logs.rows.length) {
    lines.push("  (no log rows — start ocx proxy or check `ocx logs --json`)");
  } else {
    for (const row of logs.rows) {
      const model = row.model || row.resolvedModel || row.outboundModel || "?";
      let status = row.status || row.outcome || "";
      if (!status) {
        if (row.ok === false) status = "err";
        else if (row.ok === true) status = "ok";
      }
      const dur = formatDuration(rowDuration(row));
      const provider = row.provider || row.destination || "";
      lines.push(`  ${dur.padStart(8)}  ${String(status).padEnd(4)}  ${provider} ${model}`.trimEnd());
    }
  }
  lines.push("".padEnd(56, "─"));
  lines.push("q / Ctrl-C to leave the pane · doctor: node bin/ocx-stats.mjs doctor");
  return lines.join("\n");
}

function snapshot() {
  ensureDirs();
  const cfg = loadConfig();
  const range = cfg.range || USAGE_RANGE;
  const usage = fetchUsage(range);
  if (usage.ok) {
    writeFileSync(join(stateDir, "last-usage.json"), JSON.stringify(usage.data, null, 2));
  }
  const logs = fetchRecentLogs(LOG_LIMIT);
  return {
    range,
    usage: usage.ok ? usage : null,
    logs,
    error: usage.ok ? null : usage.error,
  };
}

function show() {
  const snap = snapshot();
  console.log(render(snap));
  process.exit(snap.error ? 1 : 0);
}

function watch() {
  const clear = () => {
    if (process.stdout.isTTY) {
      process.stdout.write("\x1b[2J\x1b[H");
    }
  };
  const tick = () => {
    const snap = snapshot();
    clear();
    console.log(render(snap));
    if (snap.error) console.error(snap.error);
  };
  tick();
  setInterval(tick, WATCH_INTERVAL_MS);
}

if (mode === "doctor") doctor();
else if (mode === "watch") watch();
else if (mode === "show") show();
else {
  console.error(`Unknown mode: ${mode}. Use doctor | show | watch`);
  process.exit(1);
}
