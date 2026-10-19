import { describe, expect, test } from "bun:test";
import { chairBrief, choosePanel, letterAnswers, panelBrief } from "./consensus.ts";
import { capText, parseDurationMs, stripSignoff } from "./text.ts";
import { fakeProvider, limitsFixture, testConfig } from "./test-helpers.ts";

const config = testConfig();
const codex = fakeProvider("", "codex", "openai");
const grok = fakeProvider("", "grok", "xai");
const muse = fakeProvider("", "muse", "meta");
const claude = fakeProvider("", "claude-gmail", "anthropic");
const all = [codex, grok, muse, claude];

describe("choosePanel", () => {
  test("one per lab, with the preferred chair sitting out", () => {
    const { panel, chair } = choosePanel(all, {}, config, null);
    expect(chair?.id).toBe("codex");
    expect(panel.map((p) => p.id)).toEqual(["grok", "muse", "claude-gmail"]);
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
    expect(chair?.id).toBe("codex");
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
