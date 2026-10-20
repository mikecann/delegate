import { describe, expect, test } from "bun:test";
import { chairBrief, choosePanel, letterAnswers, panelBrief } from "./consensus.ts";
import { capText, parseDurationMs, stripSignoff } from "./text.ts";
import { isolateSessionEnv, fakeProvider, limitsFixture, testConfig } from "./test-helpers.ts";

isolateSessionEnv();

const config = testConfig();
const codex = fakeProvider("", "codex", "openai");
const grok = fakeProvider("", "grok", "xai");
const muse = fakeProvider("", "muse", "meta");
const claude = fakeProvider("", "claude-gmail", "anthropic");
const all = [codex, grok, muse, claude];

describe("choosePanel", () => {
  test("one per lab, with the preferred chair sitting out", () => {
    const { panel, chair } = choosePanel(all, {}, config, null);
    expect(chair?.id).toBe("claude-gmail");
    expect(panel.map((p) => p.id)).toEqual(["codex", "grok", "muse"]);
  });

  test("skips providers that are nearly out", () => {
    const { panel, skipped } = choosePanel(all, {}, config, limitsFixture());
    expect(panel.map((p) => p.id)).not.toContain("grok");
    expect(skipped[0]).toContain("grok (5% left)");
  });

  test("--all puts everyone on the panel with no chair", () => {
    const { panel, chair } = choosePanel(all, { all: true }, config, null);
    expect(chair).toBeNull();
    expect(panel).toHaveLength(4);
  });

  test("an explicit panel gets a chair from outside it", () => {
    const { panel, chair } = choosePanel(all, { panel: ["grok", "muse"] }, config, null);
    expect(panel.map((p) => p.id)).toEqual(["grok", "muse"]);
    expect(chair?.id).toBe("claude-gmail");
  });

  test("with only two providers, both answer and nobody chairs", () => {
    const { panel, chair } = choosePanel([codex, grok], {}, config, null);
    expect(panel).toHaveLength(2);
    expect(chair).toBeNull();
  });

  test("unknown panellists are an error", () => {
    expect(() => choosePanel(all, { panel: ["nope"] }, config, null)).toThrow("isn't available");
  });
});

describe("briefs", () => {
  test("answers are lettered in a shuffled order", () => {
    const answers = letterAnswers([{ provider: "a", text: "1" }, { provider: "b", text: "2" }, { provider: "c", text: "3" }], () => 0);
    expect(answers.map((a) => a.letter)).toEqual(["A", "B", "C"]);
    expect(answers.map((a) => a.provider)).toEqual(["b", "c", "a"]);
  });

  test("the chair never sees provider names", () => {
    const answers = letterAnswers([{ provider: "codex", text: "use X" }, { provider: "grok", text: "use Y" }]);
    const brief = chairBrief("Which?", answers, "B");
    expect(brief).not.toContain("codex");
    expect(brief).not.toContain("grok");
    expect(brief).toContain("Panellist B (asked to play devil's advocate)");
  });

  test("panel brief asks for the fixed headings", () => {
    const brief = panelBrief("Q?", 300, true);
    expect(brief).toContain("### Strongest counter-argument");
    expect(brief).toContain("devil's advocate");
    expect(brief).toContain("At most 300 words");
  });
});

describe("text helpers", () => {
  test("capText cuts by lines and characters", () => {
    expect(capText("a\nb\nc", 2, 100)).toMatchObject({ text: "a\nb", truncated: true, totalLines: 3 });
    expect(capText("short", 10, 100).truncated).toBe(false);
  });

  test("durations", () => {
    expect(parseDurationMs("90s")).toBe(90_000);
    expect(parseDurationMs("2h")).toBe(7_200_000);
    expect(parseDurationMs("5")).toBe(300_000);
    expect(() => parseDurationMs("soon")).toThrow();
  });
});

describe("stripSignoff", () => {
  test("drops a trailing sign-off line or section", () => {
    expect(stripSignoff("The answer is 42.\n\nNothing is needed from you right now. The work is finished.")).toBe("The answer is 42.");
    expect(stripSignoff("Done.\n\n**What I need from you**\n1. Merge it")).toBe("Done.");
  });
  test("leaves normal text alone", () => {
    expect(stripSignoff("We need from you a decision on X.\n\nThat's it.")).toBe("We need from you a decision on X.\n\nThat's it.");
    expect(stripSignoff("Nothing needed from you")).toBe("Nothing needed from you");
  });
});

describe("Claude model panels", () => {
  const cann = fakeProvider('printf "answer"', "claude-cannstudios", "anthropic");
  const convex = fakeProvider('printf "answer"', "claude-convex", "anthropic");

  test("self is excluded even when explicitly requested as panel or chair", () => {
    const c = testConfig({ mainClaudeEmail: "mike.cann@gmail.com" });
    expect(choosePanel(all, { all: true }, c, null).panel.map((p) => p.id)).not.toContain("claude-gmail");
    expect(() => choosePanel(all, { chair: "claude-gmail" }, c, null)).toThrow("can't chair");
    expect(() => choosePanel(all, { panel: ["claude-gmail", "codex"] }, c, null)).toThrow("isn't available");
  });

  test("claude preference picks non-self Claude for chair", () => {
    const c = testConfig({ mainClaudeEmail: "mike.cann@gmail.com" });
    const result = choosePanel([...all, cann], {}, c, null);
    expect(result.chair?.id).toBe(cann.id);
    expect(result.panel.map((p) => p.id)).toEqual(["codex", "grok", "muse"]);
  });

  test("one allowed lab gets three model seats and fresh Opus chair", () => {
    const { panel, chair } = choosePanel([convex], {}, config, null);
    expect(panel.map((p) => p.id)).toEqual(["claude-convex/claude-fable-5-1", "claude-convex/opus", "claude-convex/sonnet"]);
    expect(chair?.id).toBe("claude-convex/opus");
    expect(choosePanel([convex], { all: true }, config, null).chair).toBeNull();
  });

  test("wide seats all allowed providers plus Opus and keeps a fresh chair", () => {
    const c = testConfig({ mainClaudeEmail: "mike.cann@gmail.com" });
    const result = choosePanel([...all, cann], { wide: true }, c, null);
    expect(result.panel.map((p) => p.id)).toEqual(["codex", "grok", "muse", "claude-cannstudios/claude-fable-5-1", "claude-cannstudios/opus"]);
    expect(result.chair?.id).toBe(cann.id);
    expect(choosePanel([...all, cann], { wide: true, all: true }, c, null).chair).toBeNull();
  });
});

describe("model panel execution", () => {
  test("deep and devil keep model seats distinct, anonymise them and run a fresh Opus chair", async () => {
    const { runConsensus, formatConsensus } = await import("./consensus.ts");
    const { readFileSync } = await import("node:fs");
    const calls: { model?: string; prompt: string }[] = [];
    const fake = fakeProvider('printf "independent answer"', "claude-convex", "anthropic");
    const provider = { ...fake, invocation(ctx: Parameters<typeof fake.invocation>[0]) {
      calls.push({ model: ctx.model, prompt: ctx.prompt });
      return fake.invocation(ctx);
    } };
    const result = await runConsensus({ question: "Which?", cwd: "/tmp", kind: "ask", maxWords: 100, noRepo: true, deep: true, devil: true }, [provider], config, null);
    expect(calls.map((c) => c.model).sort()).toEqual(["claude-fable-5-1", "claude-fable-5-1", "opus", "opus", "opus", "sonnet", "sonnet"].sort());
    expect(result.panel).toHaveLength(3);
    expect(result.round2).toHaveLength(3);
    expect(new Set(result.panel.map((r) => r.provider)).size).toBe(3);
    expect(result.panel.every((r) => !r.id.includes("/"))).toBe(true);
    expect(calls.filter((c) => c.prompt.includes("You've been asked to play devil's advocate"))).toHaveLength(1);
    const chairPrompt = calls.at(-1)!.prompt;
    expect(chairPrompt.slice(chairPrompt.indexOf("You are chairing"))).not.toContain("claude-convex");
    expect(chairPrompt).toContain("Panellist " + result.devil);
    expect(chairPrompt).toContain("round 2");
    const key = JSON.parse(readFileSync(result.dir + "/key.json", "utf8"));
    expect(Object.values(key.key).sort()).toEqual(result.panel.map((r) => r.provider).sort());
    expect(formatConsensus(result)).toContain("claude-convex/sonnet");
  });

  test("wide, all, deep and devil work together without a chair", async () => {
    const { runConsensus } = await import("./consensus.ts");
    const c = testConfig({ mainClaudeEmail: "mike.cann@gmail.com" });
    const providers = [fakeProvider('echo answer', "codex", "openai"), fakeProvider('echo answer', "claude-cannstudios", "anthropic")];
    const result = await runConsensus({ question: "Q?", cwd: "/tmp", kind: "review", maxWords: 100, noRepo: true, wide: true, all: true, deep: true, devil: true }, providers, c, null);
    expect(result.panel).toHaveLength(3);
    expect(result.round2).toHaveLength(3);
    expect(result.chair).toBeUndefined();
    expect(result.devil).toBeDefined();
  });
});

test("an explicit single Claude panel still expands into different models", () => {
  const provider = fakeProvider("", "claude-convex", "anthropic");
  const { panel, chair } = choosePanel([provider], { panel: ["claude"], chair: "claude-convex" }, config, null);
  expect(panel.map((p) => p.id)).toEqual(["claude-convex/claude-fable-5-1", "claude-convex/opus", "claude-convex/sonnet"]);
  expect(chair?.id).toBe("claude-convex/opus");
});
