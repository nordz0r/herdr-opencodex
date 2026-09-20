#!/usr/bin/env node
/**
 * OpenCodex stats collector for Herdr.
 * Modes: doctor | show | watch
 *
 * Prefers remote Management API (config baseUrl + apiKey).
 * Falls back to local `ocx` CLI when remote is not configured.
 * Never prints secrets.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const mode = (process.argv[2] || "show").toLowerCase();
const WATCH_INTERVAL_MS = Number(process.env.OCX_STATS_INTERVAL_MS || 5000);
const USAGE_RANGE_DEFAULT = process.env.OCX_STATS_RANGE || "1d";
const LOG_LIMIT_DEFAULT = Number(process.env.OCX_STATS_LOG_LIMIT || 8);

const stateDir = process.env.HERDR_PLUGIN_STATE_DIR || join(process.cwd(), ".state");
const configDir = process.env.HERDR_PLUGIN_CONFIG_DIR || join(process.cwd(), ".config");

function ensureDirs() {
  try {
    mkdirSync(stateDir, { recursive: true });
  } catch {
    /* ignore */
  }
}

function loadConfig() {
  const path = join(configDir, "config.json");
  let file = {};
  if (existsSync(path)) {
    try {
      file = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      file = {};
    }
  }
  const baseUrl = String(
    process.env.OCX_STATS_BASE_URL || file.baseUrl || file.server || "",
  )
    .trim()
    .replace(/\/+$/, "");
  const apiKey = String(
    process.env.OCX_STATS_API_KEY ||
      process.env.OPENCODEX_ADMIN_AUTH_TOKEN ||
      process.env.OPENCODEX_API_AUTH_TOKEN ||
      file.apiKey ||
      file.token ||
      file.adminToken ||
      "",
  ).trim();
  const range = String(file.range || USAGE_RANGE_DEFAULT).trim() || "1d";
  const logLimit = Number(file.logLimit || LOG_LIMIT_DEFAULT) || 8;
  return { baseUrl, apiKey, range, logLimit, configPath: path };
}

function whichOc() {
  const cmd = process.platform === "win32" ? "where" : "which";
  const r = spawnSync(cmd, ["ocx"], { encoding: "utf8" });
  if ((r.status ?? 1) !== 0) return null;
  return String(r.stdout || "").trim().split(/\r?\n/)[0] || null;
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

function tryParseJson(text) {
  const t = text.trim();
  if (!t) return null;
  try {
    return JSON.parse(t);
  } catch {
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

function authHeaders(apiKey) {
  return {
    Accept: "application/json",
    "X-OpenCodex-API-Key": apiKey,
    Authorization: `Bearer ${apiKey}`,
  };
}

async function httpJson(url, apiKey) {
  const res = await fetch(url, { headers: authHeaders(apiKey), redirect: "follow" });
  const text = await res.text();
  const json = tryParseJson(text);
  return {
    ok: res.ok,
    status: res.status,
    json,
    text: text.slice(0, 400),
  };
}

function pickNumber(...vals) {
  for (const v of vals) {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() && !Number.isNaN(Number(v))) return Number(v);
  }
  return null;
}

function summarizeUsage(data) {
  const root = data?.summary ?? data?.usage ?? data;
  const input = pickNumber(root?.inputTokens, root?.tokensIn, root?.input, root?.promptTokens);
  const output = pickNumber(root?.outputTokens, root?.tokensOut, root?.output, root?.completionTokens);
  const total =
    pickNumber(root?.totalTokens, root?.tokens, root?.total) ??
    (input != null && output != null ? input + output : null);
  const cost = pickNumber(root?.estimatedCostUsd, root?.estimatedCost, root?.costUsd, data?.estimatedCostUsd);
  const coverage = pickNumber(root?.usageCoverageRatio, root?.coverage, data?.usageCoverageRatio);
  const requests = pickNumber(root?.requests, root?.requestCount, data?.requests);
  return {
    input,
    output,
    total,
    cost,
    coverage,
    requests,
    rawKeys: root && typeof root === "object" ? Object.keys(root).slice(0, 24) : [],
  };
}

function formatDuration(ms) {
  if (ms == null) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function rowDuration(row) {
  return pickNumber(row?.durationMs, row?.duration_ms, row?.latencyMs, row?.duration, row?.elapsedMs);
}

async function fetchUsageRemote(cfg) {
  const url = `${cfg.baseUrl}/api/usage?range=${encodeURIComponent(cfg.range)}`;
  const r = await httpJson(url, cfg.apiKey);
  if (!r.ok || !r.json) {
    return {
      ok: false,
      error: `GET /api/usage → HTTP ${r.status}${r.text ? `: ${r.text}` : ""}`,
    };
  }
  return { ok: true, data: r.json, source: "remote" };
}

async function fetchLogsRemote(cfg) {
  const url = `${cfg.baseUrl}/api/logs`;
  const r = await httpJson(url, cfg.apiKey);
  if (!r.ok || !r.json) {
    return { ok: false, rows: [], error: `GET /api/logs → HTTP ${r.status}` };
  }
  let rows = [];
  if (Array.isArray(r.json)) rows = r.json;
  else if (Array.isArray(r.json.logs)) rows = r.json.logs;
  else if (Array.isArray(r.json.items)) rows = r.json.items;
  return { ok: true, rows: rows.slice(-cfg.logLimit), source: "remote" };
}

function fetchUsageLocal(range) {
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
    if (json) return { ok: true, data: json, source: "local-ocx" };
  }
  return {
    ok: false,
    error:
      "Could not parse JSON from local ocx usage. Set baseUrl+apiKey in plugin config, or fix local ocx.",
  };
}

function fetchLogsLocal(limit) {
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
      if (rows.length) return { ok: true, rows: rows.slice(-limit), source: "local-ocx" };
    }
    const json = tryParseJson(text);
    if (Array.isArray(json)) return { ok: true, rows: json.slice(-limit), source: "local-ocx" };
    if (json && Array.isArray(json.logs)) return { ok: true, rows: json.logs.slice(-limit), source: "local-ocx" };
    if (json && Array.isArray(json.items)) return { ok: true, rows: json.items.slice(-limit), source: "local-ocx" };
  }
  return { ok: false, rows: [] };
}

function render({ usage, logs, range, error, source }) {
  const lines = [];
  lines.push("OpenCodex stats (Herdr plugin)");
  lines.push(`range: ${range}   source: ${source || "—"}   refreshed: ${new Date().toISOString()}`);
  lines.push("".padEnd(56, "─"));
  if (error) {
    lines.push(`error: ${error}`);
  } else if (usage) {
    const s = summarizeUsage(usage.data);
    lines.push(`tokens in:     ${s.input ?? "—"}`);
    lines.push(`tokens out:    ${s.output ?? "—"}`);
    lines.push(`tokens total:  ${s.total ?? "—"}`);
    lines.push(`requests:      ${s.requests ?? "—"}`);
    lines.push(`est. cost USD: ${s.cost != null ? s.cost.toFixed(4) : "—"}  (list-price estimate)`);
    lines.push(`coverage:      ${s.coverage != null ? s.coverage : "—"}`);
    if (s.input == null && s.total == null && s.rawKeys.length) {
      lines.push(`(unmapped usage keys: ${s.rawKeys.join(", ")})`);
    }
  }
  lines.push("".padEnd(56, "─"));
  lines.push("recent requests:");
  if (!logs?.ok || !logs.rows.length) {
    lines.push("  (no log rows)");
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

async function snapshot() {
  ensureDirs();
  const cfg = loadConfig();
  const remote = Boolean(cfg.baseUrl && cfg.apiKey);
  let usage;
  let logs;
  let source;
  if (remote) {
    usage = await fetchUsageRemote(cfg);
    logs = await fetchLogsRemote(cfg);
    source = "remote";
  } else {
    usage = fetchUsageLocal(cfg.range);
    logs = fetchLogsLocal(cfg.logLimit);
    source = "local-ocx";
  }
  if (usage.ok) {
    writeFileSync(join(stateDir, "last-usage.json"), JSON.stringify(usage.data, null, 2));
  }
  return {
    range: cfg.range,
    usage: usage.ok ? usage : null,
    logs,
    error: usage.ok ? null : usage.error,
    source,
  };
}

async function doctor() {
  ensureDirs();
  const cfg = loadConfig();
  const path = whichOc();
  const report = {
    at: new Date().toISOString(),
    configPath: cfg.configPath,
    baseUrl: cfg.baseUrl || null,
    apiKeyConfigured: Boolean(cfg.apiKey),
    ocxPath: path,
    remoteOk: null,
    localHealthOk: null,
    note: "Cost figures are list-price estimates, not invoices. Prefer admin token for /api/usage.",
  };

  if (cfg.baseUrl && cfg.apiKey) {
    try {
      const usage = await fetchUsageRemote(cfg);
      report.remoteOk = usage.ok;
      report.remoteError = usage.ok ? null : usage.error;
      if (usage.ok) {
        writeFileSync(join(stateDir, "last-usage.json"), JSON.stringify(usage.data, null, 2));
      }
    } catch (e) {
      report.remoteOk = false;
      report.remoteError = e instanceof Error ? e.message : String(e);
    }
  } else if (cfg.baseUrl && !cfg.apiKey) {
    report.remoteOk = false;
    report.remoteError = "baseUrl set but apiKey missing in config.json / env";
  }

  if (path) {
    const health = runOc(["health"], { allowFail: true });
    report.localHealthOk = Boolean(health.ok);
    report.healthStdout = health.stdout?.trim() || null;
  }

  writeFileSync(join(stateDir, "doctor.json"), JSON.stringify(report, null, 2));

  console.log(`config: ${cfg.configPath}`);
  console.log(`remote: ${cfg.baseUrl || "(not set)"}  apiKey: ${cfg.apiKey ? "set" : "missing"}`);
  if (cfg.baseUrl) {
    console.log(`remote check: ${report.remoteOk ? "ok" : `fail (${report.remoteError || "?"})`}`);
  }
  console.log(`local ocx: ${path || "not on PATH"}`);
  if (path) console.log(`local health: ${report.localHealthOk ? "ok" : "not ready"}`);

  const ok = report.remoteOk === true || report.localHealthOk === true;
  if (!ok) {
    console.error(
      "Configure HERDR_PLUGIN_CONFIG_DIR/config.json with baseUrl+apiKey, or install/start local ocx.",
    );
  }
  process.exit(ok ? 0 : 2);
}

async function show() {
  const snap = await snapshot();
  console.log(render(snap));
  process.exit(snap.error ? 1 : 0);
}

async function watch() {
  const clear = () => {
    if (process.stdout.isTTY) process.stdout.write("\x1b[2J\x1b[H");
  };
  const tick = async () => {
    const snap = await snapshot();
    clear();
    console.log(render(snap));
    if (snap.error) console.error(snap.error);
  };
  await tick();
  setInterval(() => {
    tick().catch((e) => console.error(e));
  }, WATCH_INTERVAL_MS);
}

if (mode === "doctor") await doctor();
else if (mode === "watch") await watch();
else if (mode === "show") await show();
else {
  console.error(`Unknown mode: ${mode}. Use doctor | show | watch`);
  process.exit(1);
}
