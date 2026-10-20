import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { home, type Config } from "./config.ts";

const COMMAND = '"$HOME/.local/bin/delegate" hook';
const OURS = /delegate"?\s+hook\s+(pre-tool-use|session-start|user-prompt-submit)/;

type HookEntry = { matcher?: string; hooks: { type: string; command: string; timeout?: number }[] };
type Settings = { hooks?: Record<string, HookEntry[]> } & Record<string, unknown>;

function settingsPath(config: Config) {
  return join(config.mainClaudeConfigDir, "settings.json");
}

function stripOurs(entries: HookEntry[] = []): HookEntry[] {
  return entries
    .map((e) => ({ ...e, hooks: e.hooks.filter((h) => !OURS.test(h.command)) }))
    .filter((e) => e.hooks.length);
}

/** Pure merge, for tests: our hooks replace any earlier copies of themselves. */
export function withHooks(settings: Settings): Settings {
  const hooks = { ...(settings.hooks ?? {}) };
  hooks.SessionStart = [
    ...stripOurs(hooks.SessionStart),
    { hooks: [{ type: "command", command: `${COMMAND} session-start`, timeout: 10 }] },
  ];
  hooks.PreToolUse = [
    ...stripOurs(hooks.PreToolUse),
    { matcher: "Agent|Task|Workflow", hooks: [{ type: "command", command: `${COMMAND} pre-tool-use`, timeout: 10 }] },
  ];
  hooks.UserPromptSubmit = [
    ...stripOurs(hooks.UserPromptSubmit),
    { hooks: [{ type: "command", command: `${COMMAND} user-prompt-submit`, timeout: 10 }] },
  ];
  return { ...settings, hooks };
}

export function withoutHooks(settings: Settings): Settings {
  if (!settings.hooks) return settings;
  const hooks: Record<string, HookEntry[]> = {};
  for (const [event, entries] of Object.entries(settings.hooks)) {
    const kept = stripOurs(entries);
    if (kept.length) hooks[event] = kept;
  }
  return { ...settings, hooks };
}

function rewrite(config: Config, change: (s: Settings) => Settings): string {
  const path = settingsPath(config);
  const before = existsSync(path) ? readFileSync(path, "utf8") : "{}";
  const after = JSON.stringify(change(JSON.parse(before)), null, 2) + "\n";
  if (after === before) return path;
  if (existsSync(path)) {
    const backups = join(config.mainClaudeConfigDir, "backups");
    mkdirSync(backups, { recursive: true });
    copyFileSync(path, join(backups, `settings.json.before-delegate-${Date.now()}`));
  }
  // Write beside it and rename, so a crash can never leave Claude Code with half a settings file.
  const tmp = `${path}.delegate-${process.pid}.tmp`;
  writeFileSync(tmp, after);
  renameSync(tmp, path);
  return path;
}

export function installHooks(config: Config): string {
  const path = rewrite(config, withHooks);
  return `Added delegate's SessionStart, PreToolUse and UserPromptSubmit hooks to ${path.replace(home, "~")} (a backup is in backups/).`;
}

export function uninstallHooks(config: Config): string {
  const path = rewrite(config, withoutHooks);
  return `Removed delegate's hooks from ${path.replace(home, "~")}.`;
}
