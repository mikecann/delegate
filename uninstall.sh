#!/usr/bin/env bash
# Remove delegate's hooks, skill links and command link. Leaves ~/.delegate
# (run history) and ~/.config/delegate alone.
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
target_dir="${1:-$HOME/.local/bin}"

"$repo_dir/delegate" uninstall-hooks || true
for link in "$HOME/.claude/skills/delegate" "$HOME/.codex/skills/delegate" "$target_dir/delegate"; do
  if [[ -L "$link" ]]; then rm "$link" && echo "Removed $link"; fi
done
