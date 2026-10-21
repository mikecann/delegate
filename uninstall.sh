#!/usr/bin/env bash
# Remove the delegate skill links that install.sh made.
set -euo pipefail

for link in "$HOME/.claude/skills/delegate" "$HOME/.codex/skills/delegate"; do
  if [[ -L "$link" ]]; then rm "$link" && echo "Removed $link"; fi
done
