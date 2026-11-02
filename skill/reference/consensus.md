# Consensus

Send one question to a panel from different labs. Each answers alone in a fixed format, you letter the answers in a random order, and a fresh chair that didn't answer writes up the consensus, the disagreements and the best minority point. It takes a few minutes. Agreement isn't proof, since the models share training data: a test or the code beats a vote.

## The panel

Each seat is one line in the run script ([cli.md](cli.md)), using the models and efforts from SKILL.md.

- **Default:** Codex (`gpt-6.1-sol`), Grok (`grok-4.7`), Muse (`muse-wonder-full-1.0`, until Mike's access ends on 13 Nov 2026) and Opus on a personal Claude account with room. Chair: a fresh Fable seat (`claude-fable-5-1`) on a personal Claude account with room. From 13 Nov the default is Codex, Grok and Opus, and adding Fable or `gpt-6-astra` as a fourth seat is worth it.
- **Big decisions (wide):** all of those plus extra seats: Fable as well as Opus on the Claude accounts (spread across `claude-main`, `claude-1` and `claude-3` by room), and a second Codex model (`gpt-6-astra`) if you think it adds something. Mike is happy to try as many model combinations as possible, so go wide for anything that matters. The chair is still a separate, fresh seat, even if its account also answered.
- **Convex folders:** only `claude-2` is allowed, so the panel is Fable, Opus and Sonnet on it (`claude-fable-5-1`, `claude-opus-5-5`, `claude-sonnet-5-5`), and the chair is a fresh Opus seat on it. If Mike explicitly asks for other labs, follow "The Convex rule" in SKILL.md: Claude seats and the chair stay on `claude-2`, and other labs get only what's public or generalised.
- Skip any account with under 10% room, as usual. Keep Muse even when its room is unknown, since a seat that fails just drops out. You need at least two answers to compare.

## Steps

1. Write the panel brief below, with the delegate preamble from SKILL.md on top (read-only, task note: question, or review for code). Phrase the question neutrally and don't hint at the answer you'd prefer.
2. If the question needs the repo, paste the relevant code into the brief, or point `DIR` at a worktree ([worktrees.md](worktrees.md)). Otherwise use an empty scratch folder.
3. Pick one panellist at random for the devil's-advocate line below, and write each seat's brief to `brief-<seat>.md`. Keep the seats in an array: in zsh, `printf '%s\n' $SEATS` doesn't split a string, so a pick from a string silently comes back as the whole list or nothing.

   ```zsh
   seats=(codex grok muse opus)
   devil=${seats[RANDOM % $#seats + 1]}; echo "$devil"
   ```

4. Run every seat from one script in the background:

   ```zsh
   #!/bin/zsh
   RUN=<run folder>; DIR=$RUN/scratch
   source ~/.claude/skills/delegate/reference/seats.zsh

   codex_seat  codex gpt-6.1-sol high
   grok_seat   grok  grok-4.7 high
   muse_seat   muse  muse-wonder-full-1.0 high
   claude_seat opus  claude-1 claude-opus-5-5 xhigh

   seats_wait
   ```

5. When it exits, read each `out-<seat>.md`. Drop failed or empty ones. Shuffle and letter the seats that answered, and keep the key:

   ```zsh
   answered=(codex grok muse opus)
   printf '%s\n' $answered | sort -R | awk '{print substr("ABCDEFGHIJ", NR, 1), $1}' | tee "$RUN/key"
   ```

6. Write `brief-chair.md`: the preamble (read-only, task note: question), then the chair header below, then each answer under `## Panellist <letter>` in letter order. Strip anything that gives a seat away first, like a first line of narration or a mention of its own tools. Run it as one more seat, in a new script with the same setup: `claude_seat chair claude-1 claude-fable-5-1 high`.
7. Read the chair's answer, then map the letters back with the key when you report to Mike. Remove any worktree the panel used.

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

It roughly doubles the time. After round 1 and lettering, run each panellist again as a new seat with the same provider, model and effort, named like `codex-r2`, with the preamble plus the prompt below in its brief. Then give the chair both rounds: add each panellist's round 2 under its round 1 as `### Panellist <letter>, round 2`.

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
