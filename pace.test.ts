import { expect, test } from "bun:test";
import { mainBudget, preToolUse, sessionStart, userPromptSubmit, type HookContext } from "./hooks.ts";
import { resetTime } from "./limits.ts";
import { isolateSessionEnv, limitsFixture, testConfig, withMainWeekly } from "./test-helpers.ts";

isolateSessionEnv();

const now = new Date(2026, 9, 20, 12, 0);
function ctx(budget: number, week: number | null): HookContext {
  const limits = withMainWeekly(limitsFixture(), budget);
  limits.generatedAt = now.toISOString();
  const window = limits.accounts[0].windows[1];
  window.resetsText = "unknown";
  if (week !== null) window.resetsAt = new Date(now.getTime() + week / 100 * 7 * 86400000).toISOString();
  return { config: testConfig({ mainClaudeEmail: "me@main.com" }), limits, allowed: [], employerWork: false, paused: false, now };
}

test("reset parser handles real relative, weekday and narrow-space shapes", () => {
  for (const text of ["resets in 19h 15m", "resets in 3h 35m", "resets in 15m"]) {
    const date = resetTime({ kind: "weekly", title: "Weekly", remainingPercent: 50, resetsText: text }, now);
    expect(date?.getTime()).toBeGreaterThan(now.getTime());
  }
  for (const [text, day, hour, minute] of [
    ["resets Fri 12:59 am", 5, 0, 59], ["resets Sun 6:32\u202fam", 0, 6, 32], ["resets Thu 3:59 pm", 4, 15, 59],
  ] as const) {
    const date = resetTime({ kind: "weekly", title: "Weekly", remainingPercent: 50, resetsText: text }, now)!;
    expect([date.getDay(), date.getHours(), date.getMinutes()]).toEqual([day, hour, minute]);
  }
  expect(resetTime({ kind: "weekly", title: "Weekly", remainingPercent: 50, resetsText: "resets eventually" }, now)).toBeNull();
  expect(resetTime({ kind: "weekly", title: "Weekly", remainingPercent: 50, resetsText: "resets Fri 99:59 am" }, now)).toBeNull();
});

test("machine timestamps win and cached relative resets stay anchored to observation time", () => {
  const window = { kind: "weekly", title: "Weekly", remainingPercent: 50, resetsAt: now.toISOString(), resetsText: "resets in 19h 15m" };
  expect(resetTime(window, now)?.getTime()).toBe(now.getTime());
  const context = ctx(50, null);
  context.limits!.accounts[0].windows[1].resetsText = "resets in 19h 15m";
  context.now = new Date(now.getTime() + 3600000);
  expect(mainBudget(context).weekLeft).toBeCloseTo(18.25 / 168 * 100);
});

test("pace states use warning, blocking and absolute floors", () => {
  expect(mainBudget(ctx(43, 38)).state).toBe("on pace");
  expect(mainBudget(ctx(43, 48)).state).toBe("behind pace");
  expect(mainBudget(ctx(43, 58)).state).toBe("well behind");
  expect(mainBudget(ctx(9, 2)).state).toBe("well behind");
  const five = ctx(90, 20);
  five.limits!.accounts[0].windows[0].remainingPercent = 14;
  expect(mainBudget(five).state).toBe("well behind");
  expect(mainBudget(ctx(35, null)).state).toBe("well behind");
  expect(mainBudget(ctx(50, null)).state).toBe("on pace");
});

test("session and prompt guidance includes session email, pace and orchestrator role", () => {
  process.env.CLAUDE_CODE_USER_EMAIL = "me@main.com";
  const text = (sessionStart(ctx(43, 38)) as any).hookSpecificOutput.additionalContext;
  expect(text).toContain("this session runs on me@main.com");
  expect(text).toContain("43% of its weekly limit left and 38% of the week to go");
  expect(text).toContain("Act as the orchestrator");
  expect(userPromptSubmit(ctx(43, 38))).toBeNull();
  const behind: any = userPromptSubmit(ctx(43, 48));
  expect(behind.hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
  expect(behind.hookSpecificOutput.additionalContext).toContain("delegate everything but quick edits");
  expect((userPromptSubmit(ctx(43, 58)) as any).hookSpecificOutput.additionalContext).toContain("built-in sub-agents are blocked");
  expect(userPromptSubmit({ ...ctx(10, 90), paused: true })).toBeNull();
});

test("only well behind blocks built-in agents; local and pause still pass", () => {
  const agent = { tool_name: "Task", tool_input: { description: "review" } };
  expect((preToolUse(agent, ctx(43, 48)) as any).hookSpecificOutput.permissionDecision).toBeUndefined();
  expect((preToolUse(agent, ctx(43, 58)) as any).hookSpecificOutput.permissionDecision).toBe("deny");
  expect(preToolUse({ ...agent, tool_input: { description: "local: browser" } }, ctx(10, 90))).toBeNull();
});

test("pace boundaries respect configured thresholds and clamp elapsed/reset windows", () => {
  const custom = ctx(50, 58);
  custom.config.hook.behindPaceWarnPercent = 10;
  custom.config.hook.behindPaceBlockPercent = 20;
  expect(mainBudget(custom).state).toBe("on pace");
  custom.limits!.accounts[0].windows[1].remainingPercent = 48;
  expect(mainBudget(custom).state).toBe("behind pace");
  custom.limits!.accounts[0].windows[1].remainingPercent = 38;
  expect(mainBudget(custom).state).toBe("well behind");
  const elapsed = ctx(40, -1);
  expect(mainBudget(elapsed).weekLeft).toBe(0);
  expect(mainBudget(elapsed).state).toBe("on pace");
  expect(mainBudget(ctx(90, 200)).weekLeft).toBe(100);
});


test("weekday resets just passed are unknown until the snapshot catches up", () => {
  const window = { kind: "weekly", title: "Weekly", remainingPercent: 50, resetsText: "resets Tue 12:00 pm" };
  for (const minutes of [0, 1, 360]) {
    expect(resetTime(window, new Date(2026, 9, 20, 12, minutes))).toBeNull();
  }
  expect(resetTime(window, new Date(2026, 9, 20, 18, 1))?.getTime()).toBe(new Date(2026, 9, 27, 12).getTime());
  // The six-hour grace also crosses midnight into the next weekday.
  expect(resetTime({ ...window, resetsText: "resets Mon 11:59 pm" }, new Date(2026, 9, 20, 0, 1))).toBeNull();
  const context = ctx(50, null);
  context.limits!.generatedAt = new Date(2026, 9, 20, 12, 1).toISOString();
  context.now = new Date(context.limits!.generatedAt);
  context.limits!.accounts[0].windows[1] = window;
  expect(mainBudget(context).weekLeft).toBeNull();
  expect(mainBudget(context).state).toBe("on pace");
  expect((preToolUse({ tool_name: "Agent" }, context) as any).hookSpecificOutput.permissionDecision).toBeUndefined();
});
