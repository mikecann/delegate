# Consensus

Send one question to a panel from different labs. Each answers alone in a fixed format, you letter the answers in a random order, and a fresh chair that didn't answer writes up the consensus, the disagreements and the best minority point. It takes a few minutes. Agreement isn't proof, since the models share training data: a test or the code beats a vote.

## The panel

Each seat is one `delegate_task` call, using the models and options from SKILL.md.

- **Default:** Codex (`gpt-6.1-sol`), Grok (`grok-4.7`), Muse (`muse-wonder-full-1.0`) and Opus on a personal Claude account with room. Chair: a fresh Fable task (`claude-fable-5-1`) on a personal Claude account with room.
- **Big decisions (wide):** every provider `orchestrator_capabilities` shows as enabled, plus extra seats: Fable as well as Opus on the Claude accounts (spread across `claudeAgent` and `claudeGmail` by room), and a second Codex model (`gpt-6-astra`) or Muse model if you think it adds something. Mike is happy to try as many model combinations as possible, so go wide for anything that matters. The chair is still a separate, fresh task, even if its account also answered.
- **Convex folders:** only `claudeConvex` is allowed, so the panel is Fable, Opus and Sonnet on it (`claude-fable-5-1`, `claude-opus-5-5`, `claude-sonnet-5-5`), and the chair is a fresh Opus task on it.
- Skip any account with under 10% room, as usual. Keep Muse even when its room is unknown, since a seat that fails just drops out. You need at least two answers to compare.

## Steps

1. Write the panel brief below, with the delegate preamble from SKILL.md on top (read-only, task note: question, or review for code). Phrase the question neutrally and don't hint at the answer you'd prefer.
2. If the question needs the repo, paste the relevant code into the brief, or give each panellist its own worktree ([worktrees.md](worktrees.md)) and strip their `Worktree:` lines before the chair sees the answers. Otherwise run them shared.
3. Pick one panellist at random for the devil's-advocate line below.
4. Send every seat in the same turn: one async `delegate_task` per seat, each with its own `clientRequestId` (e.g. `<slug>-codex-r1`) and a `title` like `Panel: codex`. End your turn. Each completion wakes you.
5. When they're all back, take each answer from its task result (`task_status` if it isn't in front of you). Drop failed or empty ones. Shuffle and letter the seats that answered, and keep the key:

   ```zsh
   printf '%s\n' codex grok muse opus | sort -R | awk '{print substr("ABCDEFGHIJ", NR, 1), $1}'
   ```

6. Send the chair one `delegate_task`, shared, with the preamble (read-only, task note: question), then the chair header below, then each answer under `## Panellist <letter>` in letter order.
7. Read the chair's answer, then map the letters back with the key when you report to Mike. Remove any worktrees the panel used.

If the chair fails, weigh the lettered answers yourself: consensus, disagreements, the best minority point.

## Panel brief

```markdown
You are one member of an independent panel. Other panellists are answering the same question separately, and you won't see their answers. Give your own honest view, and push back on the question's framing if you think it's wrong.

# Question

<the question, with enough context to answer it>

# Answer format

At most 400 words of markdown, with these headings exactly:

### Position
Your answer in one or two lines.
### Reasons
Up to 4 bullets.
### Strongest counter-argument
The best case against your own position.
### Confidence
low, medium or high, and the one thing that would change your mind.
```

**Devil's advocate:** for one panellist, picked at random, add this after the first paragraph, and tell the chair which letter it was:

> You've been asked to play devil's advocate: make the strongest honest case against the answer you think most people would give. Don't misstate facts to do it.

## Second round (for big, contested decisions)

It roughly doubles the time. After round 1 and lettering, send each panellist a new `delegate_task` with the same provider, model and options, a new `clientRequestId` (e.g. `<slug>-codex-r2`), and the preamble plus the prompt below. Don't message its round-1 thread. Then give the chair both rounds: add each panellist's round 2 under its round 1 as `### Panellist <letter>, round 2`.

```markdown
This is round 2 of an independent panel. Below are the question, your round-1 answer and the other panellists' answers (anonymised).

Engage with the strongest argument you disagree with. Change your position only if an argument or piece of evidence actually warrants it. Don't move towards the others just to agree.

Answer in at most 400 words, with the same headings as before plus a final "### What changed" heading (one line: "Nothing", or what changed and why).

# Question

<the question>

# Your round-1 answer

<its answer>

# The other answers

## Panellist <letter>

<answer>
```

## Chair brief header

Fill in N (the number of answers) and the consensus threshold (N - 1, at least 2). Add "then each answered a second round after reading the others" after "answers" if you ran round 2, and "(Panellist <letter> was asked to play devil's advocate.)" if you used one.

```markdown
You are chairing an independent panel. <N> panellists answered the question below without seeing each other's answers. Their identities are hidden, so refer to them only by letter.

Your job is to synthesise, not to add another opinion. Be precise about how many panellists support each point. Treat agreement as evidence, not proof: they share a lot of training data, so if they all rest on the same doubtful assumption, say so. If there's no real consensus, say that plainly.

Output at most 350 words of markdown, with these headings exactly:
### Overall answer
One or two lines, with the split (e.g. "use X, 3 of <N>").
### Consensus
Points at least <N - 1> panellists made, each tagged with their letters.
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

<the question>

---

# Answers
```
