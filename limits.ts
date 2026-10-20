import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expandHome, type Config } from "./config.ts";

export type LimitWindow = {
  kind: string;
  title: string;
  remainingPercent: number;
  resetsAt?: string | null;
  /** Human text when we only have Token Stats' text output, e.g. "resets Wed 5:00 am". */
  resetsText?: string;
};

export type LimitAccount = {
  provider: string;
  plan?: string | null;
  email?: string | null;
  configDir?: string | null;
  label?: string | null;
  windows: LimitWindow[];
  notice?: string | null;
};

export type Limits = { generatedAt: string; accounts: LimitAccount[]; source: string };

const FRESH_MINUTES = 30;
const USABLE_HOURS = 6;

export const cachePath = (config: Config) => join(config.dataDir, "limits-cache.json");
const tokenStatsFile = (config: Config) => join(config.tokenStatsDir, "limits.json");

function readJson(path: string): any | null {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; }
}

function ageMinutes(limits: Limits, now: Date): number {
  return (now.getTime() - new Date(limits.generatedAt).getTime()) / 60_000;
}

/** Login mappings remain useful even when the quota snapshot is too old. */
export function readSavedLimits(config: Config): Limits | null {
  const candidates: Limits[] = [];
  const file = readJson(tokenStatsFile(config));
  if (file?.accounts) candidates.push({ generatedAt: file.generatedAt, accounts: file.accounts, source: "token-stats limits.json" });
  const cache = readJson(cachePath(config));
  if (cache?.accounts) candidates.push(cache);
  const newest = candidates
    .filter((l) => !Number.isNaN(new Date(l.generatedAt).getTime()))
    .sort((a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime())[0];
  return newest ?? null;
}

/** Hooks only use recent quota numbers, without any network calls. */
export function readCachedLimits(config: Config, now = new Date()): (Limits & { stale: boolean }) | null {
  const newest = readSavedLimits(config);
  if (!newest || ageMinutes(newest, now) > USABLE_HOURS * 60) return null;
  return { ...newest, stale: ageMinutes(newest, now) > FRESH_MINUTES };
}

/** Claim a file atomically; abandoned markers expire so a crash can't block forever. */
function claimRefreshMarker(path: string, maxAgeMs: number): boolean {
  try {
    if (existsSync(path)) {
      if (Date.now() - statSync(path).mtimeMs < maxAgeMs) return false;
      rmSync(path, { force: true });
    }
    writeFileSync(path, String(process.pid), { flag: "wx" });
    return true;
  } catch { return false; }
}

/** Ask Token Stats for fresh numbers (a couple of seconds) and cache them. */
export function refreshLimits(config: Config): Limits | null {
  const lock = join(config.dataDir, "limits-refresh-running");
  try { mkdirSync(config.dataDir, { recursive: true }); } catch { return null; }
  // Both Token Stats attempts together time out after at most three minutes.
  if (!claimRefreshMarker(lock, 5 * 60_000)) return null;
  try {
    if (!Bun.which("token-stats")) return null;
    let limits: Limits | null = null;
    const json = spawnSync("token-stats", ["limits", "--json"], { encoding: "utf8", timeout: 90_000 });
    // Exit code 2 means some provider didn't answer in time; a partial list still beats none.
    const parsed = safeParse(json.stdout ?? "");
    if (parsed?.accounts) {
      limits = { generatedAt: parsed.generatedAt ?? new Date().toISOString(), accounts: parsed.accounts, source: "token-stats limits --json" };
    } else {
      // Older Token Stats builds only print text.
      const text = spawnSync("token-stats", ["limits"], { encoding: "utf8", timeout: 90_000 });
      if (text.status === 0 && text.stdout.trim()) {
        limits = { generatedAt: new Date().toISOString(), accounts: parseLimitsText(text.stdout, config), source: "token-stats limits (text)" };
      }
    }
    if (limits) {
      const tmp = cachePath(config) + ".tmp";
      writeFileSync(tmp, JSON.stringify(limits, null, 2));
      renameSync(tmp, cachePath(config));
    }
    return limits;
  } finally {
    rmSync(lock, { force: true });
  }
}

/** Refresh in the background without waiting, for hooks that must return quickly. */
export function refreshInBackground(launcher: string, config: Config) {
  try {
    mkdirSync(config.dataDir, { recursive: true });
    if (!claimRefreshMarker(join(config.dataDir, "limits-refresh-request"), 2 * 60_000)) return;
    const child = spawn(launcher, ["limits", "--refresh", "--quiet"], { detached: true, stdio: "ignore" });
    // A missing launcher emits asynchronously; hooks must stay silent then too.
    child.on("error", () => {});
    child.unref();
  } catch {}
}

function safeParse(text: string): any | null {
  try { return JSON.parse(text); } catch { return null; }
}

function windowKind(title: string): string {
  if (title === "5-hour" || title.startsWith("5-hour ")) return "five_hour";
  if (title === "Weekly") return "weekly";
  if (title.startsWith("Weekly ")) return "weekly_model";
  if (title === "Daily") return "daily";
  if (title === "Monthly") return "monthly";
  if (title.startsWith("$") && title.endsWith(" allowance")) return "allowance";
  return "other";
}

/** Parse the text `token-stats limits` prints, for builds without --json. */
export function parseLimitsText(text: string, config: Config): LimitAccount[] {
  const accounts: LimitAccount[] = [];
  for (const line of text.split("\n")) {
    const header = /^(Codex|Claude|Grok|Muse)\s+(.*?)\s*\[(.+)\]\s*$/.exec(line);
    if (header) {
      const [, provider, middle, label] = header;
      const email = /\S+@\S+/.exec(middle)?.[0] ?? null;
      const plan = middle.replace(email ?? "", "").trim() || null;
      const configDir = label.startsWith("~") || label.startsWith("/")
        ? resolve(expandHome(label))
        : join(config.tokenStatsDir, "Accounts", label);
      accounts.push({ provider, plan, email, configDir, label, windows: [] });
      continue;
    }
    const window = /^\s+(.+?):\s+(\d+(?:\.\d+)?)% left\s*(.*)$/.exec(line);
    const current = accounts.at(-1);
    if (window && current) {
      const [, title, percent, rest] = window;
      const resets = /resets (.+)$/.exec(rest)?.[0];
      current.windows.push({ kind: windowKind(title), title, remainingPercent: Number(percent), resetsText: resets });
    } else if (current && /^\s+\S/.test(line)) {
      current.notice = (current.notice ? current.notice + " · " : "") + line.trim();
    }
  }
  return accounts;
}

const sameDir = (a?: string | null, b?: string | null) => !!a && !!b && resolve(expandHome(a)) === resolve(expandHome(b));

/** The calling session's identity takes precedence over the terminal's login. */
export function sessionEmail(config: Config, limits: Limits | null = null): string | null {
  const email = process.env.CLAUDE_CODE_USER_EMAIL?.trim();
  if (email) return email.toLowerCase();
  if (!process.env.CLAUDECODE) return null;
  const dir = process.env.CLAUDE_CONFIG_DIR ?? config.mainClaudeConfigDir;
  return (limits ?? readSavedLimits(config))?.accounts.find((a) => a.provider === "Claude" && sameDir(a.configDir, dir))?.email?.trim().toLowerCase() || null;
}

/** The Token Stats account behind a provider, or this session for "main". */
export function accountFor(limits: Limits | null, providerId: string, config: Config): LimitAccount | undefined {
  if (!limits) return undefined;
  if (providerId === "main") {
    const email = sessionEmail(config, limits) ?? config.mainClaudeEmail?.trim().toLowerCase();
    return email ? limits.accounts.find((a) => a.provider === "Claude" && a.email?.trim().toLowerCase() === email) : undefined;
  }
  const claude = config.claudeAccounts[providerId];
  if (claude) return limits.accounts.find((a) => a.provider === "Claude" && a.email?.toLowerCase() === claude.email.toLowerCase());
  const name = { codex: "Codex", grok: "Grok", muse: "Muse" }[providerId];
  return limits.accounts.find((a) => a.provider === name);
}

export type Headroom = { percent: number; window: LimitWindow } | null;

/** The tightest of the 5-hour and weekly windows, which are what actually stop work. */
export function headroom(account?: LimitAccount): Headroom {
  const windows = (account?.windows ?? []).filter((w) => w.kind === "five_hour" || w.kind === "weekly");
  if (!windows.length) return null;
  const tightest = windows.reduce((a, b) => (b.remainingPercent < a.remainingPercent ? b : a));
  return { percent: tightest.remainingPercent, window: tightest };
}

export function windowOf(account: LimitAccount | undefined, kind: string): LimitWindow | undefined {
  return account?.windows.find((w) => w.kind === kind);
}

export function resetsLabel(window?: LimitWindow): string {
  if (!window) return "";
  if (window.resetsText) return window.resetsText;
  if (!window.resetsAt) return "";
  const date = new Date(window.resetsAt);
  if (Number.isNaN(date.getTime())) return "";
  return "resets " + date.toLocaleString("en-AU", { weekday: "short", hour: "numeric", minute: "2-digit" });
}

export function hasTokenStats(config: Config): boolean {
  return existsSync(config.tokenStatsDir) || !!Bun.which("token-stats");
}

/** Text resets are relative to the snapshot, never to the time a hook reads it. */
export function resetTime(window: LimitWindow, observedAt: Date): Date | null {
  if (window.resetsAt) {
    const date = new Date(window.resetsAt);
    if (Number.isFinite(date.getTime())) return date;
  }
  const text = window.resetsText?.replace(/\s+/g, " ").trim() ?? "";
  const relative = /^resets in (?:(\d+)h(?: )?)?(?:(\d+)m)?$/i.exec(text);
  if (relative && (relative[1] || relative[2])) {
    return new Date(observedAt.getTime() + (Number(relative[1] ?? 0) * 60 + Number(relative[2] ?? 0)) * 60_000);
  }
  const weekday = /^resets (Sun|Mon|Tue|Wed|Thu|Fri|Sat) (\d{1,2}):(\d{2}) (am|pm)$/i.exec(text);
  if (!weekday) return null;
  const [, day, hour, minute, period] = weekday;
  if (+hour < 1 || +hour > 12 || +minute > 59) return null;
  const date = new Date(observedAt);
  const days = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  date.setDate(date.getDate() + (days.indexOf(day.toLowerCase()) - date.getDay() + 7) % 7);
  date.setHours(+hour % 12 + (period.toLowerCase() === "pm" ? 12 : 0), +minute, 0, 0);
  // A just-passed reset can still carry the previous week's percentage. Check
  // the previous occurrence too, including resets just before midnight.
  const previous = new Date(date);
  if (previous > observedAt) previous.setDate(previous.getDate() - 7);
  if (observedAt.getTime() - previous.getTime() <= 6 * 3600_000) return null;
  if (date <= observedAt) date.setDate(date.getDate() + 7);
  return date;
}
