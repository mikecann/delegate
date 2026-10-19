import { existsSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "./config.ts";
import { accountFor, headroom, resetsLabel, windowOf, type Limits } from "./limits.ts";

export const SUBAGENT_TOOLS = new Set(["Agent", "Task", "Workflow"]);

export type HookContext = {
  config: Config;
  limits: Limits | null;
  /** Providers this cwd may use, with their headroom when known. */
  allowed: { id: string; percent: number | null }[];
  employerWork: boolean;
  paused: boolean;
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
  const { blockBelowWeeklyPercent, blockBelowFiveHourPercent } = ctx.config.hook;
  const low = (!!weekly && weekly.remainingPercent < blockBelowWeeklyPercent) ||
    (!!fiveHour && fiveHour.remainingPercent < blockBelowFiveHourPercent);
  const parts: string[] = [];
  if (weekly) parts.push(`${Math.round(weekly.remainingPercent)}% of its weekly limit left${resetsLabel(weekly) ? ` (${resetsLabel(weekly)})` : ""}`);
  if (fiveHour) parts.push(`${Math.round(fiveHour.remainingPercent)}% of its 5-hour limit`);
  return { known: !!(weekly || fiveHour), low, text: parts.join(" and ") };
}

/**
 * PreToolUse on Claude Code's built-in sub-agent tools. Normally it only adds
 * a reminder. When the main account is low it blocks, and the model sees the
 * reason. A description starting with "local:" always gets through, for
 * sub-agents that need this session's own tools.
 */
export function preToolUse(input: any, ctx: HookContext): object | null {
  const tool = String(input?.tool_name ?? "");
  if (!SUBAGENT_TOOLS.has(tool) || ctx.paused) return null;
  const description = String(input?.tool_input?.description ?? "");
  if (/^\s*local:/i.test(description)) return null;

  const what = tool === "Workflow" ? "workflow" : "sub-agent";
  const budget = mainBudget(ctx);
  const others = othersText(ctx);

  if (budget.known && budget.low) {
    const escape = tool === "Workflow"
      ? "If the user really wants this workflow on the main account, they can run `delegate hook pause 1h` first."
      : "If this sub-agent genuinely needs this session's own tools (the browser, MCP connectors), retry with its description starting with \"local:\".";
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason:
          `Blocked by the delegate hook: the main Claude account has ${budget.text}, and a built-in ${what} would bill it. ` +
          `Run this work through delegate instead, with Bash and run_in_background: true, e.g. ` +
          `\`delegate run --to codex --kind research --brief - <<'EOF' ... EOF\` with a self-contained brief. ` +
          `Accounts with room: ${others}. See the delegate skill for which account suits which job. ${escape}`,
      },
    };
  }

  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      additionalContext:
        `delegate hook: this ${what} bills the main Claude account${budget.known ? `, which has ${budget.text}` : ""}. ` +
        `Unless it needs this session's own tools, \`delegate\` could run it on another subscription instead (${others}). See the delegate skill.`,
    },
  };
}

/** One short line of budget for the start of every session. */
export function sessionStart(ctx: HookContext): object {
  const budget = mainBudget(ctx);
  const lines: string[] = [];
  if (budget.known) {
    lines.push(`Plan limits: the main Claude account has ${budget.text}. Other accounts: ${othersText(ctx)}.`);
  } else {
    lines.push(`Plan limits are unknown right now (is Token Stats running?). Other accounts: ${othersText(ctx)}.`);
  }
  lines.push(
    budget.known && budget.low
      ? "The main account is low, so built-in sub-agents are blocked. Hand sub-agent work, reviews and research to other accounts with `delegate` (see the delegate skill)."
      : "Built-in sub-agents bill the main account. Prefer handing sub-agent work, reviews and research to other accounts with `delegate` (see the delegate skill).",
  );
  if (ctx.employerWork && ctx.config.employer) {
    lines.push(`This is ${ctx.config.employer.name} work, so its code may only go to: ${ctx.config.employer.allow.join(", ")}.`);
  }
  return { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: lines.join(" ") } };
}

export function allowedWithHeadroom(ids: string[], limits: Limits | null, config: Config) {
  return ids.map((id) => ({ id, percent: headroom(accountFor(limits, id, config))?.percent ?? null }));
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
