#!/usr/bin/env bash
# Link delegate onto PATH, link its skill into Claude Code and Codex, write a
# starter config and add the Claude Code hooks. Re-run if the clone moves.
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
target_dir="$HOME/.local/bin"
skip_deps=0
skip_hooks=0
for arg in "$@"; do
  case "$arg" in
    --skip-deps) skip_deps=1 ;;
    --no-hooks) skip_hooks=1 ;;
    -h|--help)
      echo 'Usage: install.sh [target_bin_dir] [--skip-deps] [--no-hooks]'
      exit 0 ;;
    -*) echo "Unknown option: $arg" >&2; exit 1 ;;
    *) target_dir="$arg" ;;
  esac
done

if [[ "$skip_deps" -eq 0 ]]; then
  command -v bun >/dev/null 2>&1 || [[ -x "$HOME/.bun/bin/bun" ]] || { echo 'Install Bun from https://bun.sh first.' >&2; exit 1; }
  (cd "$repo_dir" && "$(command -v bun || echo "$HOME/.bun/bin/bun")" install)
fi

mkdir -p "$target_dir"
chmod +x "$repo_dir/delegate"
ln -sf "$repo_dir/delegate" "$target_dir/delegate"
echo "Linked $target_dir/delegate"

# Grok reads ~/.claude/skills too, so these two cover all three.
for skills in "$HOME/.claude/skills" "$HOME/.codex/skills"; do
  [[ -d "$(dirname "$skills")" ]] || continue
  mkdir -p "$skills"
  if [[ -e "$skills/delegate" && ! -L "$skills/delegate" ]]; then
    echo "Skipped $skills/delegate: something that isn't a link is already there"
    continue
  fi
  ln -sfn "$repo_dir/skill" "$skills/delegate"
  echo "Linked the skill into $skills"
done

config="$HOME/.config/delegate/config.json"
if [[ ! -f "$config" ]]; then
  mkdir -p "$(dirname "$config")"
  cp "$repo_dir/config.example.json" "$config"
  echo "Wrote $config (edit it to match your accounts)"
fi

if [[ "$skip_hooks" -eq 0 ]]; then
  "$repo_dir/delegate" install-hooks
fi
