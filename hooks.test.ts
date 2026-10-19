import { describe, expect, test } from "bun:test";
import { allowedWithHeadroom, isPaused, pauseUntil, preToolUse, resume, sessionStart, type HookContext } from "./hooks.ts";
import { withHooks, withoutHooks } from "./install.ts";
import { limitsFixture, testConfig, withMainWeekly } from "./test-helpers.ts";

const config = testConfig({ mainClaudeConfigDir: "/home/me/.claude" });

function ctx(limits = limitsFixture(), extra: Partial<HookContext> = {}): HookContext {
  return { config, limits, allowed: allowedWithHeadroom(["codex", "grok", "claude-gmail"], limits, config), employerWork: false, paused: false, ...extra };
}

const agent = (description = "Find the auth code") => ({ tool_name: "Agent", tool_input: { description, prompt: "..." } });

describe("pre-tool-use", () => {
  test("ignores other tools", () => {
    expect(preToolUse({ tool_name: "Bash", tool_input: {} }, ctx())).toBeNull();
  });

  test("nudges when the main account has room", () => {
    const out: any = preToolUse(agent(), ctx());
    expect(out.hookSpecificOutput.permissionDecision).toBeUndefined();
    expect(out.hookSpecificOutput.additionalContext).toContain("78% of its weekly limit");
    expect(out.hookSpecificOutput.additionalContext).toContain("codex 97%");
  });

  test("blocks when the weekly limit is low, listing accounts with the most room first", () => {
    const out: any = preToolUse(agent(), ctx(withMainWeekly(limitsFixture(), 35)));
    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
    const reason = out.hookSpecificOutput.permissionDecisionReason;
    expect(reason).toContain("35% of its weekly limit");
    expect(reason).toContain("codex 97%, claude-gmail 60%, grok 5%");
    expect(reason).toContain('"local:"');
  });

  test("blocks when the 5-hour window is low", () => {
    const limits = limitsFixture();
    limits.accounts[0].windows[0].remainingPercent = 10;
    expect((preToolUse(agent(), ctx(limits)) as any).hookSpecificOutput.permissionDecision).toBe("deny");
  });

  test("local: always gets through, even when low", () => {
    expect(preToolUse(agent("local: check the browser"), ctx(withMainWeekly(limitsFixture(), 5)))).toBeNull();
  });

  test("workflows are blocked too, with the pause hint instead of local:", () => {
    const out: any = preToolUse({ tool_name: "Workflow", tool_input: { script: "..." } }, ctx(withMainWeekly(limitsFixture(), 5)));
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain("delegate hook pause");
  });

  test("unknown limits only nudge", () => {
    const out: any = preToolUse(agent(), ctx(null as any));
    expect(out.hookSpecificOutput.permissionDecision).toBeUndefined();
  });

  test("pausing turns it off", () => {
    expect(preToolUse(agent(), ctx(withMainWeekly(limitsFixture(), 5), { paused: true }))).toBeNull();
  });
});

describe("session-start", () => {
  test("gives one line of budget", () => {
    const text = (sessionStart(ctx()) as any).hookSpecificOutput.additionalContext;
    expect(text).toContain("78% of its weekly limit left (resets Wed 5:00 am)");
    expect(text).toContain("Prefer handing sub-agent work");
  });

  test("mentions the employer rule in employer repos", () => {
    const text = (sessionStart(ctx(limitsFixture(), { employerWork: true, allowed: [] })) as any).hookSpecificOutput.additionalContext;
    expect(text).toContain("Convex work");
  });
});

describe("pause file", () => {
  test("pause and resume", () => {
    const c = testConfig();
    expect(isPaused(c)).toBe(false);
    pauseUntil(c, new Date(Date.now() + 60_000));
    expect(isPaused(c)).toBe(true);
    resume(c);
    expect(isPaused(c)).toBe(false);
  });
});

describe("settings merge", () => {
  const existing = {
    model: "x",
    hooks: { SessionStart: [{ hooks: [{ type: "command", command: "sh voice.sh" }] }] },
  };

  test("adds both hooks and keeps the user's own", () => {
    const merged: any = withHooks(existing);
    expect(merged.model).toBe("x");
    expect(merged.hooks.SessionStart).toHaveLength(2);
    expect(merged.hooks.SessionStart[0].hooks[0].command).toBe("sh voice.sh");
    expect(merged.hooks.PreToolUse[0].matcher).toBe("Agent|Task|Workflow");
  });

  test("installing twice doesn't duplicate", () => {
    expect(withHooks(withHooks(existing))).toEqual(withHooks(existing));
  });

  test("uninstall removes only ours", () => {
    expect(withoutHooks(withHooks(existing))).toEqual(existing);
  });
});
