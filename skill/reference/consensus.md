# Consensus by hand

Send one question to a panel from different labs. Each answers alone in a fixed format, you shuffle and letter the answers, and a fresh chair that didn't answer writes up the consensus, the disagreements and the best minority point. It takes a few minutes. Agreement isn't proof, since the models share training data: a test or the code beats a vote.

## The panel

- **Default:** `codex`, `grok`, `muse` and Opus (on a Claude account with room), in parallel. Chair: a fresh Fable call (`--model claude-fable-5-1`) on a Claude account with room.
- **Big decisions (wide):** put every allowed provider on the panel and give the Claude account both a Fable and an Opus seat. Mike is happy to try as many model combinations as possible, so go wide for anything that matters. The chair is still a separate, fresh call, even if its account also answered.
- **Convex folders:** only the Convex account is allowed, so the panel is Fable, Opus and Sonnet on it (`--model claude-fable-5-1`, `opus`, `sonnet`), and the chair is a fresh Opus call on it.
- Skip any account with under 10% left, as usual. You need at least two answers to compare.

## Steps

1. Make a run folder (`RUN=~/.delegate/runs/$(date +%Y%m%d-%H%M%S)-consensus-<slug>`) and an empty folder for questions that don't need code (`mkdir -p "$RUN/empty"`). If they need the repo, give each panellist its own snapshot (see SKILL.md), or run Codex in place read-only.
2. Write the panel brief below to `$RUN/brief.md`, with the delegate preamble from SKILL.md on top (task note: question, or review for code). Phrase the question neutrally and don't hint at the answer you'd prefer.
3. Run every panellist at read-only, each in its own background Bash call, writing to `$RUN/answer-<name>.md` (e.g. `answer-codex.md`, `answer-opus.md`) and `$RUN/log-<name>.txt`. Commands are in [commands.md](commands.md).
4. When they're back, check each answer file isn't empty, then shuffle and letter them, keeping the key:

   ```zsh
   cd "$RUN" && ls answer-*.md | sort -R | awk '{print substr("ABCDEFGHIJ", NR, 1), $1}' > key.txt
   ```

5. Write the chair brief header below to `$RUN/chair-head.md`, then add the lettered answers:

   ```zsh
   cd "$RUN" && { cat chair-head.md; while read -r L F; do printf '\n## Panellist %s\n\n' "$L"; cat "$F"; done < key.txt; } > chair-brief.md
   ```

6. Run the chair on `chair-brief.md` in `$RUN/empty`, writing `chair-answer.md`. Read it, then map the letters back with `key.txt` when you report to Mike.

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

It roughly doubles the time. After round 1 and lettering, send each panellist this, writing to `$RUN/round2-<name>.md` (not `answer-*`, so the lettering step doesn't pick them up), then give the chair both rounds (add each panellist's round 2 under its round 1 as `### Panellist <letter>, round 2`):

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

The chair also gets the delegate preamble (task note: question) on top.
