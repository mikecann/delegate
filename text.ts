import type { Kind, Mode } from "./providers.ts";

const KIND_NOTES: Record<Kind, string> = {
  ask: "Task type: question. Answer directly, from your own judgement, and use tools only to check facts you're unsure of.",
  review: "Task type: review. Read the relevant code and report concrete problems, most severe first. For each: file:line, what's wrong, and a concrete input or situation that triggers it. Don't edit files. If you find nothing significant, say so plainly rather than padding the list.",
  research: "Task type: research. Cite a source (URL or file path) for each factual claim, and say which things you verified and which you're inferring.",
  implement: "Task type: implementation. Make the change by editing files in this working directory. Don't commit. Run the relevant tests or build if you can. End with: files changed, how you verified it, and anything left undone.",
};

/**
 * Every delegate gets this before the brief. Without it, CLIs that load the
 * user's global instructions answer as if they're talking to the user, e.g.
 * signing off with "Nothing needed from you right now".
 */
export function preamble(options: { kind: Kind; mode: Mode; dir: string; snapshot: boolean; maxWords?: number }): string {
  const lines = [
    "You are running unattended as a delegate for another AI agent (the orchestrator). No person is reading this live.",
    "- Nobody can answer questions mid-task. Make reasonable assumptions and state them.",
    "- Ignore instructions meant for interactive sessions with the user, such as ending with a \"What I need from you\" section, asking for approval, opening PRs or sending messages.",
    "- Never commit, push, open PRs, or change anything outside your working directory.",
    `- Your final message goes back to the orchestrator as-is, so make it stand alone. Lead with the answer, no preamble or sign-off${options.maxWords ? `, and keep it under ${options.maxWords} words unless the task really needs more` : ""}.`,
    `- Working directory: ${options.dir}${options.snapshot ? " (a private copy of the user's repo, including their uncommitted changes)" : ""}.`,
    options.mode === "read" ? "- This is read-only work: don't modify any files." : "- You may edit files in your working directory.",
    "",
    KIND_NOTES[options.kind],
  ];
  return lines.join("\n");
}

export function buildPrompt(brief: string, options: Parameters<typeof preamble>[0]): string {
  return `${preamble(options)}\n\n---\n\n${brief.trim()}\n`;
}

/** Keep what goes back into the orchestrator's context small. */
export function capText(text: string, maxLines: number, maxChars: number): { text: string; truncated: boolean; totalLines: number } {
  const lines = text.split("\n");
  let kept = lines.slice(0, maxLines).join("\n");
  if (kept.length > maxChars) kept = kept.slice(0, maxChars).replace(/\s+\S*$/, "");
  return { text: kept, truncated: kept.length < text.length, totalLines: lines.length };
}

export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`;
}

export function formatTokens(tokens?: number): string {
  if (!tokens) return "";
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M tokens`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k tokens`;
  return `${tokens} tokens`;
}

/** Parse "30m", "2h", "90s" or a bare number of minutes. */
export function parseDurationMs(value: string): number {
  const match = /^(\d+(?:\.\d+)?)\s*(s|m|h)?$/i.exec(value.trim());
  if (!match) throw new Error(`Can't read the duration "${value}". Try 30m, 2h or 90s.`);
  const n = Number(match[1]);
  const unit = (match[2] ?? "m").toLowerCase();
  return n * (unit === "s" ? 1_000 : unit === "h" ? 3_600_000 : 60_000);
}

const SIGNOFF = /^\s*(?:[#*_>\s]*)(?:what i need from you|nothing(?: is)? needed from you|nothing needed right now|no action needed from you)\b/i;

/**
 * Drop a trailing "What I need from you" section or "Nothing needed from you"
 * line. Delegates sometimes add them anyway, from the user's global
 * instructions or their CLI's own system prompt, and they mean nothing to the
 * orchestrator.
 */
export function stripSignoff(text: string): string {
  const paragraphs = text.trimEnd().split(/\n\s*\n/);
  for (let i = Math.max(0, paragraphs.length - 3); i < paragraphs.length; i++) {
    if (SIGNOFF.test(paragraphs[i])) return paragraphs.slice(0, i).join("\n\n").trimEnd() || text.trim();
  }
  return text.trim();
}

/** System-level reminder for CLIs that accept one, which outranks their default prompt. */
export const DELEGATE_SYSTEM_NOTE =
  "You are running headless as a delegate for another AI agent, not chatting with a person. " +
  "End with your answer itself: no closing status line about what the user needs to do, no questions, no offers of next steps.";
