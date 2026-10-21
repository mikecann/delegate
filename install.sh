#!/usr/bin/env bash
# Link the delegate skill into Claude Code and Codex. Grok reads Claude's
# skills, so these two links cover all three. Safe to re-run, and re-run it if
# the clone moves.
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

for skills in "$HOME/.claude/skills" "$HOME/.codex/skills"; do
  link="$skills/delegate"
  if [[ -e "$link" && ! -L "$link" ]]; then
    echo "Skipped $link: something that isn't a link is already there"
    continue
  fi
  mkdir -p "$skills"
  ln -sfn "$repo_dir/skill" "$link"
  echo "Linked $link -> $repo_dir/skill"
done
