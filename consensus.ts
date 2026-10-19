import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "./config.ts";
import { accountFor, headroom, type Limits } from "./limits.ts";
import type { Kind, Provider } from "./providers.ts";
import { newId, readOutput, runDelegate, type RunRecord } from "./runner.ts";
import { formatDuration } from "./text.ts";

const MIN_HEADROOM = 10;

export type ConsensusOptions = {
  question: string;
  cwd: string;
  kind: Kind;
  /** Explicit panel; otherwise one provider per lab. */
  panel?: string[];
  /** A provider id, "self" for no chair, or undefined to pick one. */
  chair?: string;
  all?: boolean;
  deep?: boolean;
  devil?: boolean;
  noRepo?: boolean;
  maxWords: number;
  timeoutMs?: number;
};

export type Answer = { letter: string; provider: string; text: string; round2?: string };

export type ConsensusResult = {
  id: string;
  dir: string;
  panel: RunRecord[];
  round2: RunRecord[];
  chair?: RunRecord;
  chairId: string | null;
  answers: Answer[];
  devil?: string;
  synthesis: string | null;
};

/**
 * Pick the panel and chair from the providers allowed and available here.
 * Default: one provider per lab, in panelPreference order, skipping anyone
 * nearly out of quota. The chair sits out, so it never judges its own answer.
 */
export function choosePanel(
  candidates: Provider[],
  options: Pick<ConsensusOptions, "panel" | "chair" | "all">,
  config: Config,
  limits: Limits | null,
): { panel: Provider[]; chair: Provider | null; skipped: string[] } {
  const skipped: string[] = [];
  const byId = new Map(candidates.map((p) => [p.id, p]));
  const roomy = (p: Provider) => {
    const room = headroom(accountFor(limits, p.id, config));
    if (room && room.percent < MIN_HEADROOM) { skipped.push(`${p.id} (${Math.round(room.percent)}% left)`); return false; }
    return true;
  };

  let panel: Provider[];
  if (options.panel?.length) {
    panel = options.panel.map((id) => {
      const p = byId.get(id);
      if (!p) throw new Error(`${id} isn't available here. Try \`delegate providers\`.`);
      return p;
    });
  } else {
    const order = [...config.panelPreference, ...candidates.map((p) => p.id)];
    const seenLabs = new Set<string>();
    panel = [];
    for (const id of order) {
      const p = byId.get(id);
      if (!p || seenLabs.has(p.lab) || panel.includes(p) || !roomy(p)) continue;
      seenLabs.add(p.lab);
      panel.push(p);
    }
  }

  let chair: Provider | null = null;
  if (options.all || options.chair === "self") {
    chair = null;
  } else if (options.chair) {
    chair = byId.get(options.chair) ?? null;
    if (!chair) throw new Error(`${options.chair} can't chair here. Try \`delegate providers\`.`);
  } else if (!options.panel?.length) {
    // Promote the preferred chair out of the panel, as long as two panellists remain.
    for (const id of config.chairPreference) {
      const p = panel.find((x) => x.id === id);
      if (p && panel.length > 2) { chair = p; break; }
    }
    if (!chair) chair = candidates.find((p) => !panel.includes(p) && roomy(p)) ?? null;
  } else {
    chair = config.chairPreference.map((id) => byId.get(id)).find((p) => p && !panel.includes(p)) ?? null;
  }
  if (chair) panel = panel.filter((p) => p !== chair);
  return { panel, chair, skipped };
}

export function panelBrief(question: string, maxWords: number, devil: boolean): string {
  return `You are one member of an independent panel. Panellists from other AI labs are answering the same question separately, and you won't see their answers. Give your own honest view, and push back on the question's framing if you think it's wrong.${devil ? "\n\nYou've been asked to play devil's advocate: make the strongest honest case against the answer you think most people would give. Don't misstate facts to do it." : ""}

# Question

${question.trim()}

# Answer format

At most ${maxWords} words of markdown, with these headings exactly:

### Position
Your answer in one or two lines.
### Reasons
Up to 4 bullets.
### Strongest counter-argument
The best case against your own position.
### Confidence
low, medium or high, and the one thing that would change your mind.`;
}

export function round2Brief(question: string, own: string, others: { letter: string; text: string }[], maxWords: number): string {
  return `This is round 2 of an independent panel. Below are the question, your round-1 answer and the other panellists' answers (anonymised).

Engage with the strongest argument you disagree with. Change your position only if an argument or piece of evidence actually warrants it. Don't move towards the others just to agree.

Answer in at most ${maxWords} words, with the same headings as before plus a final "### What changed" heading (one line: "Nothing", or what changed and why).

# Question

${question.trim()}

# Your round-1 answer

${own.trim()}

# The other answers

${others.map((o) => `## Panellist ${o.letter}\n\n${o.text.trim()}`).join("\n\n")}`;
}

export function shuffle<T>(items: T[], random = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function letterAnswers(answers: { provider: string; text: string; round2?: string }[], random = Math.random): Answer[] {
  return shuffle(answers, random).map((a, i) => ({ ...a, letter: String.fromCharCode(65 + i) }));
}

export function chairBrief(question: string, answers: Answer[], devilLetter?: string): string {
  const n = answers.length;
  const rounds = answers.some((a) => a.round2);
  const body = answers.map((a) => {
    const r1 = `## Panellist ${a.letter}${a.letter === devilLetter ? " (asked to play devil's advocate)" : ""}\n\n${a.text.trim()}`;
    return a.round2 ? `${r1}\n\n### Panellist ${a.letter}, round 2\n\n${a.round2.trim()}` : r1;
  }).join("\n\n");
  return `You are chairing an independent panel. ${n} panellists from different AI labs answered the question below without seeing each other's answers${rounds ? ", then each answered a second round after reading the others" : ""}. Their identities are hidden, so refer to them only by letter.

Your job is to synthesise, not to add another opinion. Be precise about how many panellists support each point. Treat agreement as evidence, not proof: they share a lot of training data, so if they all rest on the same doubtful assumption, say so. If there's no real consensus, say that plainly.

Output at most 350 words of markdown, with these headings exactly:
### Overall answer
One or two lines, with the split (e.g. "use X, 3 of ${n}").
### Consensus
Points at least ${Math.max(2, n - 1)} panellists made, each tagged with their letters.
### Disagreements
Where they split, who is on which side, and which side you find stronger and why. One line each. "None" if they agree.
### Strongest minority point
The best point only one panellist made.
### Recommendation
Up to 5 bullets of what to do, drawn from the panel.
### Chair's note
Anything factually wrong in any answer, or a blind spot they share. "None" if nothing.

---

# Question

${question.trim()}

---

# Answers

${body}`;
}

export async function runConsensus(options: ConsensusOptions, candidates: Provider[], config: Config, limits: Limits | null): Promise<ConsensusResult & { skipped: string[] }> {
  const { panel, chair, skipped } = choosePanel(candidates, options, config, limits);
  if (panel.length < 2) {
    throw new Error(`Consensus needs at least 2 panellists, and only ${panel.length} ${panel.length === 1 ? "is" : "are"} available here (${panel.map((p) => p.id).join(", ") || "none"}).` +
      (skipped.length ? ` Skipped for low quota: ${skipped.join(", ")}.` : ""));
  }

  const id = newId("consensus");
  const dir = join(config.dataDir, "consensus", id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "question.md"), options.question);

  const devil = options.devil ? panel[Math.floor(Math.random() * panel.length)].id : undefined;
  const common = { cwd: options.cwd, kind: options.kind, noRepo: options.noRepo, timeoutMs: options.timeoutMs, top: true, maxWords: options.maxWords, parentDir: join(dir, "round1") };

  const round1 = await Promise.all(panel.map((p) =>
    runDelegate({ ...common, provider: p, brief: panelBrief(options.question, options.maxWords, p.id === devil) }, config)));
  const ok1 = round1.filter((r) => r.status === "ok");
  if (ok1.length < 2) {
    throw new Error(`Only ${ok1.length} panellist(s) answered, so there's nothing to compare. ` +
      round1.filter((r) => r.status !== "ok").map((r) => `${r.provider}: ${r.status}${r.error ? ` (${r.error.split("\n")[0]})` : ""}`).join("; "));
  }

  let answers = letterAnswers(ok1.map((r) => ({ provider: r.provider, text: readOutput(r) })));

  let round2: RunRecord[] = [];
  if (options.deep) {
    const byProvider = new Map(panel.map((p) => [p.id, p]));
    round2 = await Promise.all(answers.map((a) =>
      runDelegate({
        ...common, parentDir: join(dir, "round2"), provider: byProvider.get(a.provider)!,
        brief: round2Brief(options.question, a.text, answers.filter((o) => o !== a), options.maxWords),
      }, config)));
    answers = answers.map((a) => {
      const r = round2.find((x) => x.provider === a.provider && x.status === "ok");
      return r ? { ...a, round2: readOutput(r) } : a;
    });
  }

  const key = Object.fromEntries(answers.map((a) => [a.letter, a.provider]));
  const devilLetter = answers.find((a) => a.provider === devil)?.letter;
  writeFileSync(join(dir, "key.json"), JSON.stringify({ key, devil: devilLetter ?? null }, null, 2));

  let chairRun: RunRecord | undefined;
  let synthesis: string | null = null;
  if (chair) {
    chairRun = await runDelegate({
      provider: chair, kind: "ask", cwd: options.cwd, noRepo: true, top: true, timeoutMs: options.timeoutMs,
      brief: chairBrief(options.question, answers, devilLetter), parentDir: join(dir, "chair"),
    }, config);
    if (chairRun.status === "ok") synthesis = readOutput(chairRun);
  }
  if (synthesis) writeFileSync(join(dir, "synthesis.md"), synthesis + "\n");

  return { id, dir, panel: round1, round2, chair: chairRun, chairId: chair?.id ?? null, answers, devil: devilLetter, synthesis, skipped };
}

export function formatConsensus(result: ConsensusResult & { skipped: string[] }): string {
  const out: string[] = [];
  const timing = (r: RunRecord) => `${r.provider} ${r.status === "ok" ? formatDuration(r.durationMs) : r.status}`;
  if (result.synthesis) {
    out.push(result.synthesis.trim());
  } else {
    if (result.chair) out.push(`The chair (${result.chairId}) didn't produce a synthesis: ${result.chair.status}${result.chair.error ? `, ${result.chair.error.split("\n")[0]}` : ""}.`, "");
    out.push("No chair synthesis. Here are the anonymised answers; weigh them yourself (consensus, disagreements, the best minority point).", "");
    for (const a of result.answers) {
      out.push(`## Panellist ${a.letter}${a.letter === result.devil ? " (devil's advocate)" : ""}`, "", a.text.trim(), "");
      if (a.round2) out.push(`### Round 2`, "", a.round2.trim(), "");
    }
  }
  out.push("");
  out.push(`panel: ${result.answers.map((a) => `${a.letter} = ${a.provider}${a.letter === result.devil ? " (devil's advocate)" : ""}`).join(", ")}`);
  out.push(`timing: ${result.panel.map(timing).join(", ")}${result.round2.length ? ` · round 2: ${result.round2.map(timing).join(", ")}` : ""}${result.chair ? ` · chair: ${timing(result.chair)}` : ""}`);
  const failed = result.panel.filter((r) => r.status !== "ok");
  if (failed.length) out.push(`didn't answer: ${failed.map((r) => `${r.provider} (${r.status})`).join(", ")}`);
  if (result.skipped.length) out.push(`skipped for low quota: ${result.skipped.join(", ")}`);
  out.push(`files: ${result.dir}`);
  return out.join("\n");
}
