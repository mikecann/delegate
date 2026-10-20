import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { Config } from "./config.ts";
import { historyPath, readSavedLimits } from "./limits.ts";
import { formatDuration } from "./text.ts";

/**
 * `delegate stats`: a compact weekly summary a scheduled Claude session reads
 * to judge whether delegation is working. Every line costs main-account
 * tokens, so the markdown stays short and the detail lives in --json.
 */

export type StatsOptions = { since: Date; until: Date; projectsDir: string };

/** Desktop app sessions bill the main account; terminal `claude` is another login. */
const MAIN_ENTRYPOINT = "claude-desktop";
/** A weekly window rising this much between samples is a reset, not usage. */
const RESET_RISE = 25;
const RAN_OUT_PERCENT = 5;

// ---------- accounts ----------

type HistoryLine = { at: string; accounts: { provider: string; email: string | null; windows: Record<string, number> }[] };
type Sample = { at: Date; windows: Record<string, number> };

export type WeekSegment = { start: number; end: number; low: number; from: string; to: string };
export type AccountStats = {
  account: string;
  main: boolean;
  samples: number;
  weeks: WeekSegment[];
  /** Main account only. */
  lowestPerDay?: Record<string, number>;
  ranOut?: { window: string; at: string }[];
};

function readJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  const out: T[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch {}
  }
  return out;
}

const accountKey = (provider: string, email?: string | null) => `${provider} ${email?.trim().toLowerCase() ?? ""}`.trim();
const inWindow = (at: Date, o: { since: Date; until: Date }) => at >= o.since && at <= o.until;
const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** History lines plus the current cached limits, grouped by account and sorted by time. */
function accountSamples(config: Config, options: StatsOptions): Map<string, Sample[]> {
  const lines = readJsonl<HistoryLine>(historyPath(config));
  const current = readSavedLimits(config);
  if (current) {
    lines.push({
      at: current.generatedAt,
      accounts: current.accounts.map((a) => ({ provider: a.provider, email: a.email ?? null, windows: Object.fromEntries(a.windows.map((w) => [w.kind, w.remainingPercent])) })),
    });
  }
  const byAccount = new Map<string, Sample[]>();
  const seen = new Set<string>();
  for (const line of lines) {
    const at = new Date(line.at);
    if (Number.isNaN(at.getTime()) || !inWindow(at, options)) continue;
    for (const a of line.accounts ?? []) {
      const key = accountKey(a.provider, a.email);
      // The cache is usually also the last history line.
      if (seen.has(`${key}@${at.getTime()}`)) continue;
      seen.add(`${key}@${at.getTime()}`);
      byAccount.set(key, [...(byAccount.get(key) ?? []), { at, windows: a.windows ?? {} }]);
    }
  }
  for (const samples of byAccount.values()) samples.sort((a, b) => a.at.getTime() - b.at.getTime());
  return byAccount;
}

/** Split weekly percentages at each reset, so deltas never span one. */
export function weekSegments(samples: Sample[]): WeekSegment[] {
  const segments: WeekSegment[] = [];
  let previous: number | undefined;
  for (const s of samples) {
    const p = s.windows.weekly;
    if (typeof p !== "number") continue;
    const current = segments.at(-1);
    if (!current || (previous !== undefined && p - previous >= RESET_RISE)) {
      segments.push({ start: p, end: p, low: p, from: s.at.toISOString(), to: s.at.toISOString() });
    } else {
      current.end = p;
      current.low = Math.min(current.low, p);
      current.to = s.at.toISOString();
    }
    previous = p;
  }
  return segments;
}

export function accountStats(config: Config, options: StatsOptions): AccountStats[] {
  const main = config.mainClaudeEmail ? accountKey("Claude", config.mainClaudeEmail) : null;
  return [...accountSamples(config, options)].map(([account, samples]) => {
    const stats: AccountStats = { account, main: account === main, samples: samples.length, weeks: weekSegments(samples) };
    if (!stats.main) return stats;
    stats.lowestPerDay = {};
    stats.ranOut = [];
    const ranOut = new Set<string>();
    for (const s of samples) {
      const day = localDay(s.at);
      if (typeof s.windows.weekly === "number") stats.lowestPerDay[day] = Math.min(stats.lowestPerDay[day] ?? 100, s.windows.weekly);
      for (const [window, p] of Object.entries(s.windows)) {
        // Record the first sample of each window and day at or below the floor.
        if (p > RAN_OUT_PERCENT || ranOut.has(`${window}@${day}`)) continue;
        ranOut.add(`${window}@${day}`);
        stats.ranOut.push({ window, at: s.at.toISOString() });
      }
    }
    return stats;
  }).sort((a, b) => Number(b.main) - Number(a.main) || a.account.localeCompare(b.account));
}

// ---------- delegate runs ----------

type RunLine = { id: string; provider: string; kind: string; status: string; durationMs?: number; tokens?: number; costUsd?: number; cwd?: string; startedAt: string };

export type RunStats = {
  total: number;
  byProvider: { provider: string; runs: number; kinds: Record<string, number>; tokens: number; costUsd: number; medianMs: number }[];
  byStatus: Record<string, number>;
  notOk: { id: string; provider: string; status: string }[];
  topFolders: { folder: string; runs: number }[];
  consensus: number;
};

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const tilde = (path: string) => path.startsWith(homedir()) ? "~" + path.slice(homedir().length) : path;
/** Long scratch paths would eat a line each; the tail is the part that identifies them. */
const clip = (text: string, max = 50) => text.length > max ? "…" + text.slice(-(max - 1)) : text;

/** Consensus ids start with their local start time, e.g. 20261019-021201-consensus-2be2. */
function consensusTime(dir: string, name: string): Date {
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-/.exec(name);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  try { return statSync(join(dir, name)).mtime; } catch { return new Date(0); }
}

export function runStats(config: Config, options: StatsOptions): RunStats | null {
  const path = join(config.dataDir, "runs.jsonl");
  if (!existsSync(path)) return null;
  const runs = readJsonl<RunLine>(path).filter((r) => r.startedAt && inWindow(new Date(r.startedAt), options));
  const providers = new Map<string, RunLine[]>();
  for (const r of runs) providers.set(r.provider, [...(providers.get(r.provider) ?? []), r]);
  const byStatus: Record<string, number> = {};
  const folders = new Map<string, number>();
  for (const r of runs) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    if (r.cwd) folders.set(tilde(r.cwd), (folders.get(tilde(r.cwd)) ?? 0) + 1);
  }
  const consensusDir = join(config.dataDir, "consensus");
  const consensus = existsSync(consensusDir)
    ? readdirSync(consensusDir).filter((name) => inWindow(consensusTime(consensusDir, name), options)).length
    : 0;
  return {
    total: runs.length,
    byProvider: [...providers].map(([provider, list]) => ({
      provider, runs: list.length,
      kinds: list.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.kind]: (acc[r.kind] ?? 0) + 1 }), {}),
      tokens: list.reduce((sum, r) => sum + (r.tokens ?? 0), 0),
      costUsd: list.reduce((sum, r) => sum + (r.costUsd ?? 0), 0),
      medianMs: median(list.map((r) => r.durationMs ?? 0)),
    })).sort((a, b) => b.runs - a.runs),
    byStatus,
    notOk: runs.filter((r) => r.status !== "ok").map((r) => ({ id: r.id, provider: r.provider, status: r.status })),
    topFolders: [...folders].map(([folder, runs]) => ({ folder, runs })).sort((a, b) => b.runs - a.runs).slice(0, 5),
    consensus,
  };
}

// ---------- Claude Code sessions ----------

export type Usage = { input: number; output: number; cacheRead: number; cacheCreation: number };
type SessionTotals = { project: string; session: string; entrypoint: string; tokens: number; subagentTokens: number };

export type SessionStats = {
  filesRead: number;
  skippedFolders: number;
  byEntrypoint: Record<string, {
    sessions: number;
    byModel: Record<string, Usage>;
    subagentCalls: number;
    workflowCalls: number;
    subagentTokens: number;
    delegateRuns: number;
    delegateConsensus: number;
    hookBlocks: number;
  }>;
  top: SessionTotals[];
};

const emptyUsage = (): Usage => ({ input: 0, output: 0, cacheRead: 0, cacheCreation: 0 });
const usageTotal = (u: Usage) => u.input + u.output + u.cacheRead + u.cacheCreation;
const DELEGATE_CMD = /\bdelegate\s+(run|consensus)\b/;
const HOOK_BLOCK = "Blocked by the delegate hook";

/** Read a JSONL file a chunk at a time; transcripts can be hundreds of MB. */
async function eachLine(path: string, onLine: (line: string) => void) {
  const decoder = new TextDecoder();
  let rest = "";
  for await (const chunk of Bun.file(path).stream()) {
    const text = rest + decoder.decode(chunk, { stream: true });
    const lines = text.split("\n");
    rest = lines.pop() ?? "";
    for (const line of lines) onLine(line);
  }
  if (rest) onLine(rest);
}

type FileScan = {
  entrypoint: string | null;
  byModel: Record<string, Usage>;
  sidechainTokens: number;
  subagentCalls: number;
  workflowCalls: number;
  delegateRuns: number;
  delegateConsensus: number;
  hookBlocks: number;
  active: boolean;
};

/** One transcript: usage per unique message, plus tool calls and hook blocks. */
export async function scanTranscript(path: string, options: { since: Date; until: Date }): Promise<FileScan> {
  const scan: FileScan = { entrypoint: null, byModel: {}, sidechainTokens: 0, subagentCalls: 0, workflowCalls: 0, delegateRuns: 0, delegateConsensus: 0, hookBlocks: 0, active: false };
  const seen = new Set<string>();
  await eachLine(path, (line) => {
    // Cheap substring checks first: most lines are tool results we don't need.
    const assistant = line.includes('"type":"assistant"');
    const block = !assistant && line.includes(HOOK_BLOCK);
    if (!assistant && !block && scan.entrypoint) return;
    let event: any;
    try { event = JSON.parse(line); } catch { return; }
    scan.entrypoint ??= event.entrypoint ?? null;
    const at = new Date(event.timestamp);
    if (!event.timestamp || Number.isNaN(at.getTime()) || !inWindow(at, options)) return;
    if (event.type === "user" && block) {
      for (const c of Array.isArray(event.message?.content) ? event.message.content : []) {
        if (c.type === "tool_result" && c.is_error && JSON.stringify(c.content ?? "").includes(HOOK_BLOCK)) scan.hookBlocks++;
      }
      return;
    }
    if (event.type !== "assistant") return;
    const message = event.message ?? {};
    for (const c of Array.isArray(message.content) ? message.content : []) {
      if (c.type !== "tool_use") continue;
      if (c.name === "Agent" || c.name === "Task") scan.subagentCalls++;
      if (c.name === "Workflow") scan.workflowCalls++;
      const command = c.name === "Bash" ? DELEGATE_CMD.exec(String(c.input?.command ?? "")) : null;
      if (command?.[1] === "run") scan.delegateRuns++;
      if (command?.[1] === "consensus") scan.delegateConsensus++;
    }
    // A message is logged once per content block, each with the same usage.
    const id = message.id ?? event.requestId ?? event.uuid;
    if (!message.usage || seen.has(id)) return;
    seen.add(id);
    const u = message.usage;
    const usage: Usage = { input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, cacheCreation: u.cache_creation_input_tokens ?? 0 };
    if (message.model === "<synthetic>") return;
    scan.active = true;
    const model = message.model ?? "unknown";
    const total = (scan.byModel[model] ??= emptyUsage());
    for (const k of Object.keys(usage) as (keyof Usage)[]) total[k] += usage[k];
    if (event.isSidechain) scan.sidechainTokens += usageTotal(usage);
  });
  return scan;
}

/** Employer code must never be read into this run, so its folders are skipped by name. */
export const isEmployerFolder = (name: string) => /convex/i.test(name);

function recentJsonl(dir: string, since: Date): string[] {
  try {
    return readdirSync(dir).filter((f) => f.endsWith(".jsonl")).map((f) => join(dir, f))
      .filter((f) => { try { return statSync(f).mtime >= since; } catch { return false; } });
  } catch { return []; }
}

export async function sessionStats(options: StatsOptions): Promise<SessionStats | null> {
  if (!existsSync(options.projectsDir)) return null;
  const stats: SessionStats = { filesRead: 0, skippedFolders: 0, byEntrypoint: {}, top: [] };
  const jobs: Promise<void>[] = [];
  for (const project of readdirSync(options.projectsDir)) {
    if (isEmployerFolder(project)) { stats.skippedFolders++; continue; }
    const dir = join(options.projectsDir, project);
    for (const file of recentJsonl(dir, options.since)) {
      jobs.push(scanSession(project, file, options, stats));
    }
  }
  await Promise.all(jobs);
  stats.top = stats.top.sort((a, b) => b.tokens - a.tokens).slice(0, 8);
  return stats;
}

/** A session is its main transcript plus any sub-agent transcripts beside it. */
async function scanSession(project: string, file: string, options: StatsOptions, stats: SessionStats) {
  const session = basename(file, ".jsonl");
  const main = await scanTranscript(file, options);
  const subagents = await Promise.all(recentJsonl(join(options.projectsDir, project, session, "subagents"), options.since).map((f) => scanTranscript(f, options)));
  stats.filesRead += 1 + subagents.length;
  if (!main.active && !subagents.some((s) => s.active)) return;
  const entrypoint = main.entrypoint ?? subagents.find((s) => s.entrypoint)?.entrypoint ?? "unknown";
  const e = (stats.byEntrypoint[entrypoint] ??= { sessions: 0, byModel: {}, subagentCalls: 0, workflowCalls: 0, subagentTokens: 0, delegateRuns: 0, delegateConsensus: 0, hookBlocks: 0 });
  e.sessions++;
  let tokens = 0;
  let subagentTokens = main.sidechainTokens;
  for (const scan of [main, ...subagents]) {
    for (const [model, usage] of Object.entries(scan.byModel)) {
      const total = (e.byModel[model] ??= emptyUsage());
      for (const k of Object.keys(usage) as (keyof Usage)[]) total[k] += usage[k];
      tokens += usageTotal(usage);
      if (scan !== main) subagentTokens += usageTotal(usage);
    }
    e.subagentCalls += scan.subagentCalls;
    e.workflowCalls += scan.workflowCalls;
    e.delegateRuns += scan.delegateRuns;
    e.delegateConsensus += scan.delegateConsensus;
    e.hookBlocks += scan.hookBlocks;
  }
  e.subagentTokens += subagentTokens;
  stats.top.push({ project, session, entrypoint, tokens, subagentTokens });
}

// ---------- report ----------

export type Stats = {
  since: string;
  until: string;
  ratio: string;
  accounts: AccountStats[];
  runs: RunStats | null;
  sessions: SessionStats | null;
  elapsedMs: number;
};

export async function collectStats(config: Config, options: StatsOptions): Promise<Stats> {
  const started = performance.now();
  const accounts = accountStats(config, options);
  const runs = runStats(config, options);
  const sessions = await sessionStats(options);
  return {
    since: options.since.toISOString(), until: options.until.toISOString(),
    ratio: ratioLine(runs, sessions), accounts, runs, sessions,
    elapsedMs: Math.round(performance.now() - started),
  };
}

/**
 * Handed-off work: delegate runs (each consensus seat counts) versus built-in
 * sub-agent spawns in desktop sessions, which bill the main account. Jobs are
 * the fairest unit: token counts differ too much between providers.
 */
export function ratioLine(runs: RunStats | null, sessions: SessionStats | null): string {
  const main = sessions?.byEntrypoint[MAIN_ENTRYPOINT];
  if (!runs && !main) return "No delegate runs or main-account sessions to compare.";
  const delegated = runs?.total ?? 0;
  const kept = (main?.subagentCalls ?? 0) + (main?.workflowCalls ?? 0);
  const share = delegated + kept ? Math.round((100 * delegated) / (delegated + kept)) : 0;
  const mainTokens = main ? Object.values(main.byModel).reduce((s, u) => s + usageTotal(u), 0) : 0;
  return `${share}% of handed-off jobs went to delegates (${delegated} delegate runs vs ${kept} built-in sub-agent/workflow calls in desktop sessions); ` +
    `delegates used ${tokens(runs?.byProvider.reduce((s, p) => s + p.tokens, 0) ?? 0)} tokens, main-account sub-agents ${tokens(main?.subagentTokens ?? 0)} of the main account's ${tokens(mainTokens)}.`;
}

function tokens(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`;
  return String(n);
}

const short = (iso: string) => new Date(iso).toLocaleString("en-AU", { weekday: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const pct = (n: number) => `${Math.round(n)}%`;
const counts = (record: Record<string, number>) => Object.entries(record).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ");

function accountLines(accounts: AccountStats[]): string[] {
  if (!accounts.length) return ["no data"];
  const lines: string[] = [];
  for (const a of accounts) {
    const weeks = a.weeks.map((w) => `${pct(w.start)} → ${pct(w.end)} (low ${pct(w.low)})`).join("; reset, then ");
    lines.push(`- ${a.account}${a.main ? " (main)" : ""}: ${weeks || "no weekly window"}, ${a.samples} sample${a.samples === 1 ? "" : "s"}`);
    if (!a.main) continue;
    const days = Object.entries(a.lowestPerDay ?? {}).map(([d, p]) => `${d.slice(5)} ${pct(p)}`).join(", ");
    if (days) lines.push(`  - lowest weekly by day: ${days}`);
    lines.push(`  - ran out (≤${RAN_OUT_PERCENT}%): ${a.ranOut?.length ? a.ranOut.map((r) => `${r.window} ${short(r.at)}`).join(", ") : "no"}`);
  }
  if (accounts.every((a) => a.samples < 3)) lines.push("- (limits history is short: it only started on 2026-10-20)");
  return lines;
}

function runLines(runs: RunStats | null): string[] {
  if (!runs) return ["no data"];
  const lines = [`${runs.total} runs, ${runs.consensus} consensus panels. Status: ${counts(runs.byStatus) || "none"}.`];
  for (const p of runs.byProvider) {
    const cost = p.costUsd ? `, $${p.costUsd.toFixed(2)}` : "";
    lines.push(`- ${p.provider}: ${p.runs} (${counts(p.kinds)}), ${tokens(p.tokens)} tokens${cost}, median ${formatDuration(p.medianMs)}`);
  }
  if (runs.notOk.length) {
    const shown = runs.notOk.slice(0, 10).map((r) => `${r.id} ${r.status}`).join(", ");
    lines.push(`- not ok: ${shown}${runs.notOk.length > 10 ? `, +${runs.notOk.length - 10} more` : ""}`);
  }
  if (runs.topFolders.length) lines.push(`- top folders: ${runs.topFolders.map((f) => `${clip(f.folder)} ${f.runs}`).join(", ")}`);
  return lines;
}

function sessionLines(sessions: SessionStats | null): string[] {
  if (!sessions) return ["no data"];
  const entries = Object.entries(sessions.byEntrypoint).sort((a, b) => (b[0] === MAIN_ENTRYPOINT ? 1 : 0) - (a[0] === MAIN_ENTRYPOINT ? 1 : 0) || b[1].sessions - a[1].sessions);
  if (!entries.length) return [`no sessions in the window (${sessions.filesRead} transcripts read, ${sessions.skippedFolders} employer folders skipped)`];
  const lines = [
    `Split by transcript entrypoint: ${MAIN_ENTRYPOINT} is the desktop app (main account); cli is terminal claude; sdk-cli is claude -p (including delegate's own Claude runs); sdk-ts is Agent SDK apps. ${sessions.skippedFolders} employer folders skipped.`,
  ];
  for (const [entrypoint, e] of entries) {
    lines.push(`- **${entrypoint}**: ${e.sessions} sessions, ${e.subagentCalls} Agent/Task calls (${tokens(e.subagentTokens)} tokens inside), ${e.workflowCalls} Workflow calls, ${e.delegateRuns} delegate run, ${e.delegateConsensus} delegate consensus, ${e.hookBlocks} hook blocks`);
    for (const [model, u] of Object.entries(e.byModel).sort((a, b) => usageTotal(b[1]) - usageTotal(a[1]))) {
      lines.push(`  - ${model}: in ${tokens(u.input)}, out ${tokens(u.output)}, cache read ${tokens(u.cacheRead)}, cache write ${tokens(u.cacheCreation)}`);
    }
  }
  lines.push("", "Top sessions by tokens:");
  for (const s of sessions.top) {
    const share = s.tokens ? Math.round((100 * s.subagentTokens) / s.tokens) : 0;
    lines.push(`- ${clip(s.project)} ${s.session.slice(0, 8)} (${s.entrypoint}): ${tokens(s.tokens)}, ${share}% sub-agent`);
  }
  return lines;
}

export function formatStats(stats: Stats): string {
  return [
    `# delegate stats, ${short(stats.since)} to ${short(stats.until)}`,
    "",
    `**Ratio:** ${stats.ratio}`,
    "",
    "## Accounts (weekly % left)",
    ...accountLines(stats.accounts),
    "",
    "## Delegate runs",
    ...runLines(stats.runs),
    "",
    "## Claude Code sessions",
    ...sessionLines(stats.sessions),
    "",
    `(${stats.sessions?.filesRead ?? 0} transcripts read in ${(stats.elapsedMs / 1000).toFixed(1)}s)`,
  ].join("\n");
}
