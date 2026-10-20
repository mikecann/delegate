import { existsSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "./config.ts";
import { isSessionProvider } from "./providers.ts";
import { accountFor, headroom, resetTime, resetsLabel, sessionEmail, windowOf, type Limits } from "./limits.ts";

export const SUBAGENT_TOOLS = new Set(["Agent", "Task", "Workflow"]);

export type HookContext = {
  config: Config;
  limits: Limits | null;
  /** Providers this cwd may use, with their headroom when known. */
  allowed: { id: string; percent: number | null }[];
  employerWork: boolean;
  paused: boolean;
  now?: Date;
};

function othersText(ctx: HookContext): string {
  if (!ctx.allowed.length) return "none allowed here";
  return [...ctx.allowed]
    .sort((a, b) => (b.percent ?? -1) - (a.percent ?? -1))
    .map((p) => (p.percent === null ? p.id : `${p.id} ${Math.round(p.percent)}%`))
    .join(", ");
}

export function mainBudget(ctx: HookContext) {
  const main = accountFor(ctx.limits, "main", ctx.config);
  const weekly = windowOf(main, "weekly");
  const fiveHour = windowOf(main, "five_hour");
  const now = ctx.now ?? new Date();
  const observedAt = ctx.limits ? new Date(ctx.limits.generatedAt) : now;
  const reset = weekly ? resetTime(weekly, observedAt) : null;
  const weekLeft = reset && Number.isFinite(reset.getTime())
    ? Math.max(0, Math.min(100, (reset.getTime() - now.getTime()) / (7 * 86400_000) * 100)) : null;
  const behind = weekly && weekLeft !== null ? weekLeft - weekly.remainingPercent : null;
  const thresholds = ctx.config.hook;
  const floor = (!!weekly && weekly.remainingPercent < thresholds.blockBelowWeeklyPercent) ||
    (!!fiveHour && fiveHour.remainingPercent < thresholds.blockBelowFiveHourPercent);
  // Without a reset, preserve the old 40% weekly cutoff as well as configured floors.
  const low = floor || (behind === null
    ? !!weekly && weekly.remainingPercent < 40
    : behind >= thresholds.behindPaceBlockPercent - 1e-9);
  const state = low ? "well behind" : behind !== null && behind >= thresholds.behindPaceWarnPercent - 1e-9 ? "behind pace" : "on pace";
  const parts: string[] = [];
  if (weekly) parts.push(`${Math.round(weekly.remainingPercent)}% of its weekly limit left${weekLeft !== null ? ` and ${Math.round(weekLeft)}% of the week to go` : ""}${resetsLabel(weekly) ? ` (${resetsLabel(weekly)})` : ""}`);
  if (fiveHour) parts.push(`${Math.round(fiveHour.remainingPercent)}% of its 5-hour limit`);
  return { known: !!(weekly || fiveHour), low, state, weekLeft, behind, text: parts.join(", ") };
}

// Mike wants Opus doing the building while any Claude account has room.
const OPUS = " Coding and anything needing judgement goes to Opus with `delegate run --to claude`; only menial jobs go to Codex.";

function guidance(state: string): string {
  if (state === "on pace") return "Act as the orchestrator: hand big chunks of work (multi-file builds, investigations, reviews, research) to other accounts with `delegate`, and keep this session for planning, decisions, checking results and talking to Mike." + OPUS;
  return "Act as the orchestrator: delegate everything but quick edits to other accounts with `delegate`, and keep this session for planning, decisions, checking results and talking to Mike." + OPUS +
    (state === "well behind" ? " This session is well behind, so built-in sub-agents are blocked." : "");
}

function budgetLine(ctx: HookContext): string {
  const budget = mainBudget(ctx);
  const email = sessionEmail(ctx.config, ctx.limits);
  const identity = email ? `this session runs on ${email}`
    : ctx.config.mainClaudeEmail ? `using the protected main account ${ctx.config.mainClaudeEmail} (session account unknown)`
    : "this session's account is unknown";
  return budget.known
    ? `Plan limits: ${identity}, with ${budget.text}, so it's ${budget.state}.`
    : `Plan limits: ${identity}; its limits are unknown right now (is Token Stats running?).`;
}

/** Built-in agents bill this session; local tools and a paused hook always pass. */
export function preToolUse(input: any, ctx: HookContext): object | null {
  const tool = String(input?.tool_name ?? "");
  if (!SUBAGENT_TOOLS.has(tool) || ctx.paused || process.env.DELEGATE_CHILD === "1") return null;
  if (/^\s*local:/i.test(String(input?.tool_input?.description ?? ""))) return null;
  const budget = mainBudget(ctx);
  if (budget.low) {
    const escape = tool === "Workflow"
      ? "If the user wants this workflow on this session's account, run `delegate hook pause 1h` first."
      : `If it needs this session's own tools (browser, MCP connectors), retry with a description starting with "local:".`;
    return { hookSpecificOutput: {
      hookEventName: "PreToolUse", permissionDecision: "deny",
      permissionDecisionReason: `Blocked by the delegate hook. ${budgetLine(ctx)} ${guidance(budget.state)} Run this work through delegate with Bash and run_in_background: true and a self-contained brief. Accounts with room: ${othersText(ctx)}. ${escape}`,
    } };
  }
  return { hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext:
    `${budgetLine(ctx)} Built-in sub-agents bill this session. ${guidance(budget.state)} Other accounts: ${othersText(ctx)}.` } };
}

/** One line of budget and guidance at the start of a session. */
export function sessionStart(ctx: HookContext): object | null {
  if (ctx.paused || process.env.DELEGATE_CHILD === "1") return null;
  let text = `${budgetLine(ctx)} Other accounts: ${othersText(ctx)}. ${guidance(mainBudget(ctx).state)}`;
  if (ctx.employerWork && ctx.config.employer) {
    text += ` This is ${ctx.config.employer.name} work, so its code may only go to: ${ctx.config.employer.allow.join(", ")}.`;
  }
  return { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: text } };
}

export function userPromptSubmit(ctx: HookContext): object | null {
  const budget = mainBudget(ctx);
  if (ctx.paused || process.env.DELEGATE_CHILD === "1" || budget.state === "on pace") return null;
  return { hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: `${budgetLine(ctx)} ${guidance(budget.state)} Other accounts: ${othersText(ctx)}.` } };
}

export function allowedWithHeadroom(ids: string[], limits: Limits | null, config: Config) {
  return ids.filter((id) => !isSessionProvider(id, config, limits))
    .map((id) => ({ id, percent: headroom(accountFor(limits, id, config))?.percent ?? null }));
}

const pauseFile = (config: Config) => join(config.dataDir, "hook-paused-until");

export function isPaused(config: Config, now = new Date()): boolean {
  if (!existsSync(pauseFile(config))) return false;
  const until = new Date(readFileSync(pauseFile(config), "utf8").trim());
  return !Number.isNaN(until.getTime()) && until > now;
}

export function pauseUntil(config: Config, until: Date) {
  mkdirSync(config.dataDir, { recursive: true });
  writeFileSync(pauseFile(config), until.toISOString());
}

export function resume(config: Config) {
  rmSync(pauseFile(config), { force: true });
}

export function pausedUntil(config: Config): Date | null {
  if (!isPaused(config)) return null;
  return new Date(readFileSync(pauseFile(config), "utf8").trim());
}
