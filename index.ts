#!/usr/bin/env bun
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { configPath, loadConfig, type Config } from "./config.ts";
import { formatConsensus, runConsensus } from "./consensus.ts";
import { allowedWithHeadroom, isPaused, pausedUntil, pauseUntil, preToolUse, resume, sessionStart } from "./hooks.ts";
import { installHooks, uninstallHooks } from "./install.ts";
import { accountFor, headroom, readCachedLimits, refreshInBackground, refreshLimits, resetsLabel, type Limits } from "./limits.ts";
import { allowedProviderIds, isEmployerWork, policyRefusal } from "./policy.ts";
import { allProviders, providerById, type Kind } from "./providers.ts";
import { exitCodeFor, formatRun, runDelegate, type RunRecord } from "./runner.ts";
import { parseDurationMs } from "./text.ts";
import { applyPatch, removeWorktree } from "./workspace.ts";

const KINDS: Kind[] = ["ask", "review", "research", "implement"];

const HELP = `delegate: hand work to your other AI subscriptions

  delegate run --to <provider> [--kind ask|review|research|implement] [brief text | --brief FILE | --brief -]
      [--write] [--in-place] [--no-repo] [--timeout 30m] [--model M] [--effort E] [--json]
  delegate consensus [question | --brief FILE | --brief -] [--panel a,b,c] [--chair id|self] [--all]
      [--deep] [--devil] [--no-repo] [--kind ask|review|research] [--words 400] [--timeout 20m]
  delegate providers          who's available here, and how much room each has
  delegate limits [--refresh] plan limits from Token Stats
  delegate show <id>          full answer of a run
  delegate diff <id>          patch from a --write / implement run
  delegate apply <id>         apply that patch to the repo it came from
  delegate clean <id>|--all   remove a write run's worktree and branch
  delegate hook pre-tool-use|session-start|pause [1h]|resume|status
  delegate install-hooks | uninstall-hooks

Read-only runs work in a throwaway copy of the repo (with your uncommitted
changes). Write runs get their own worktree and branch and never commit.
Run it from Claude Code with Bash run_in_background: true.`;

function fail(message: string, code = 2): never {
  console.error(`delegate: ${message}`);
  process.exit(code);
}

async function readBrief(values: { brief?: string }, positionals: string[]): Promise<string> {
  let brief = "";
  if (values.brief === "-") brief = await Bun.stdin.text();
  else if (values.brief) {
    if (!existsSync(values.brief)) fail(`brief file not found: ${values.brief}`);
    brief = readFileSync(values.brief, "utf8");
  } else brief = positionals.join(" ");
  if (!brief.trim()) fail("give it a brief: text after the options, --brief FILE, or --brief - for stdin");
  return brief;
}

function candidates(cwd: string, config: Config) {
  const providers = allProviders(config);
  const allowed = new Set(allowedProviderIds(cwd, config, providers));
  return providers.filter((p) => allowed.has(p.id) && !p.unavailable());
}

function limitsForRouting(config: Config): Limits | null {
  return readCachedLimits(config) ?? null;
}

async function cmdRun(argv: string[], config: Config) {
  const { values, positionals } = parseArgs({
    args: argv, allowPositionals: true, strict: true,
    options: {
      to: { type: "string" }, kind: { type: "string", default: "ask" }, brief: { type: "string" },
      write: { type: "boolean" }, "in-place": { type: "boolean" }, "no-repo": { type: "boolean" },
      timeout: { type: "string" }, model: { type: "string" }, effort: { type: "string" },
      words: { type: "string" }, json: { type: "boolean" }, lines: { type: "string", default: "80" },
    },
  });
  if (!values.to) fail(`say who to send it to with --to (${allProviders(config).map((p) => p.id).join(", ")})`);
  const kind = values.kind as Kind;
  if (!KINDS.includes(kind)) fail(`--kind must be one of ${KINDS.join(", ")}`);
  const provider = providerById(values.to, config) ?? fail(`unknown provider "${values.to}". Try \`delegate providers\`.`);
  const cwd = process.cwd();
  const refusal = policyRefusal(provider.id, cwd, config, allProviders(config));
  if (refusal) fail(refusal);
  const why = provider.unavailable();
  if (why) fail(`${provider.id} can't run: ${why}`);
  const brief = await readBrief(values, positionals);

  const record = await runDelegate({
    provider, kind, brief, cwd,
    write: values.write, inPlace: values["in-place"], noRepo: values["no-repo"],
    timeoutMs: values.timeout ? parseDurationMs(values.timeout) : undefined,
    model: values.model, effort: values.effort,
    maxWords: values.words ? Number(values.words) : undefined,
  }, config);
  console.log(values.json ? JSON.stringify(record, null, 2) : formatRun(record, { lines: Number(values.lines), chars: 6000 }));
  process.exit(exitCodeFor(record.status));
}

async function cmdConsensus(argv: string[], config: Config) {
  const { values, positionals } = parseArgs({
    args: argv, allowPositionals: true, strict: true,
    options: {
      brief: { type: "string" }, panel: { type: "string" }, chair: { type: "string" }, all: { type: "boolean" },
      deep: { type: "boolean" }, devil: { type: "boolean" }, "no-repo": { type: "boolean" },
      kind: { type: "string", default: "ask" }, words: { type: "string", default: "400" }, timeout: { type: "string" },
    },
  });
  const kind = values.kind as Kind;
  if (!["ask", "review", "research"].includes(kind)) fail("consensus --kind must be ask, review or research");
  const question = await readBrief(values, positionals);
  const cwd = process.cwd();
  const limits = limitsForRouting(config);
  try {
    const result = await runConsensus({
      question, cwd, kind,
      panel: values.panel?.split(",").map((s) => s.trim()).filter(Boolean),
      chair: values.chair, all: values.all, deep: values.deep, devil: values.devil, noRepo: values["no-repo"],
      maxWords: Number(values.words),
      timeoutMs: values.timeout ? parseDurationMs(values.timeout) : undefined,
    }, candidates(cwd, config), config, limits);
    console.log(formatConsensus(result));
  } catch (e) {
    fail((e as Error).message, 1);
  }
}

function cmdProviders(config: Config) {
  const cwd = process.cwd();
  const providers = allProviders(config);
  const employer = isEmployerWork(cwd, config);
  const allowed = new Set(allowedProviderIds(cwd, config, providers, employer));
  const limits = readCachedLimits(config) ?? refreshLimits(config);
  if (employer && config.employer) console.log(`This is ${config.employer.name} work: only ${config.employer.allow.join(", ")} may receive its code.\n`);
  const main = headroom(accountFor(limits, "main", config));
  console.log(`main Claude account: ${main ? `${Math.round(main.percent)}% (${main.window.title}${resetsLabel(main.window) ? `, ${resetsLabel(main.window)}` : ""})` : "unknown"}\n`);
  for (const p of providers) {
    const why = p.unavailable();
    const room = headroom(accountFor(limits, p.id, config));
    const state = !allowed.has(p.id) ? "not allowed here" : why ? why : "ready";
    const roomText = room ? `${Math.round(room.percent)}% ${room.window.title.toLowerCase()}` : "room unknown";
    console.log(`${p.id.padEnd(14)} ${p.lab.padEnd(10)} ${state === "ready" ? roomText.padEnd(18) : "".padEnd(18)} ${state}`);
  }
  if (limits) console.log(`\nlimits from ${limits.source}, ${limits.generatedAt}`);
}

function cmdLimits(argv: string[], config: Config) {
  const { values } = parseArgs({ args: argv, strict: true, options: { refresh: { type: "boolean" }, quiet: { type: "boolean" }, json: { type: "boolean" } } });
  const limits = values.refresh ? refreshLimits(config) : readCachedLimits(config) ?? refreshLimits(config);
  if (values.quiet) return;
  if (!limits) fail("no plan limits available. Is Token Stats installed?", 1);
  if (values.json) { console.log(JSON.stringify(limits, null, 2)); return; }
  for (const a of limits.accounts) {
    console.log(`${a.provider} ${a.plan ?? ""} ${a.email ?? ""} [${a.label ?? a.configDir ?? ""}]`.replace(/\s+/g, " "));
    for (const w of a.windows) console.log(`  ${w.title}: ${Math.round(w.remainingPercent)}% left ${resetsLabel(w)}`);
  }
  console.log(`(from ${limits.source}, ${limits.generatedAt})`);
}

function findRun(id: string, config: Config): RunRecord {
  const roots = [join(config.dataDir, "runs")];
  const consensus = join(config.dataDir, "consensus");
  if (existsSync(consensus)) {
    for (const c of readdirSync(consensus)) for (const r of ["round1", "round2", "chair"]) roots.push(join(consensus, c, r));
  }
  for (const root of roots) {
    const path = join(root, id, "status.json");
    if (existsSync(path)) return JSON.parse(readFileSync(path, "utf8"));
  }
  fail(`no run called ${id}`);
}

function cmdClean(argv: string[], config: Config) {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, strict: true, options: { all: { type: "boolean" } } });
  const ids = values.all
    ? readdirSync(join(config.dataDir, "runs")).filter((id) => existsSync(join(config.dataDir, "worktrees", id)))
    : positionals;
  if (!ids.length) fail("say which run to clean, or --all");
  for (const id of ids) {
    const record = findRun(id, config);
    if (record.repoRoot && record.worktree) removeWorktree(record.repoRoot, record.worktree, record.branch);
    console.log(`cleaned ${id}`);
  }
}

async function cmdHook(argv: string[], config: Config) {
  const [sub, arg] = argv;
  if (sub === "pause") {
    const until = new Date(Date.now() + parseDurationMs(arg ?? "1h"));
    pauseUntil(config, until);
    console.log(`delegate hook paused until ${until.toLocaleString()}`);
    return;
  }
  if (sub === "resume") { resume(config); console.log("delegate hook resumed"); return; }
  if (sub === "status") {
    const until = pausedUntil(config);
    console.log(until ? `paused until ${until.toLocaleString()}` : "active");
    return;
  }
  if (sub !== "pre-tool-use" && sub !== "session-start") fail("hook needs pre-tool-use, session-start, pause, resume or status");

  // Hooks must never break a session: any error means "no opinion".
  try {
    const input = JSON.parse((await Bun.stdin.text()) || "{}");
    if (sub === "pre-tool-use" && !["Agent", "Task", "Workflow"].includes(input.tool_name)) return;
    const cwd = input.cwd || process.cwd();
    const limits = readCachedLimits(config);
    if (!limits || limits.stale) refreshInBackground(join(import.meta.dir, "delegate"));
    const providers = allProviders(config);
    const employerWork = isEmployerWork(cwd, config);
    const ids = allowedProviderIds(cwd, config, providers, employerWork);
    const ctx = { config, limits, allowed: allowedWithHeadroom(ids, limits, config), employerWork, paused: isPaused(config) };
    const output = sub === "pre-tool-use" ? preToolUse(input, ctx) : sessionStart(ctx);
    if (output) console.log(JSON.stringify(output));
  } catch {}
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  let config: Config;
  try {
    config = loadConfig();
  } catch (e) {
    // A broken config must never break a Claude Code session through the hooks.
    if (command === "hook" && (rest[0] === "pre-tool-use" || rest[0] === "session-start")) process.exit(0);
    fail(`couldn't read the config at ${configPath()}: ${(e as Error).message}`);
  }
  switch (command) {
    case "run": return cmdRun(rest, config);
    case "consensus": return cmdConsensus(rest, config);
    case "providers": return cmdProviders(config);
    case "limits": return cmdLimits(rest, config);
    case "show": {
      const record = findRun(rest[0] ?? fail("show needs a run id"), config);
      console.log(readFileSync(join(record.runDir, "output.md"), "utf8"));
      return;
    }
    case "diff": {
      const record = findRun(rest[0] ?? fail("diff needs a run id"), config);
      const patch = join(record.runDir, "changes.patch");
      if (!existsSync(patch)) fail("that run didn't change anything (or wasn't a write run)");
      process.stdout.write(readFileSync(patch, "utf8"));
      return;
    }
    case "apply": {
      const record = findRun(rest[0] ?? fail("apply needs a run id"), config);
      const patch = join(record.runDir, "changes.patch");
      if (!record.repoRoot || !existsSync(patch) || !statSync(patch).size) fail("that run has no changes to apply");
      const result = applyPatch(record.repoRoot, readFileSync(patch, "utf8"));
      console.log(result.message);
      process.exit(result.ok ? 0 : 1);
    }
    case "clean": return cmdClean(rest, config);
    case "hook": return cmdHook(rest, config);
    case "install-hooks": console.log(installHooks(config)); return;
    case "uninstall-hooks": console.log(uninstallHooks(config)); return;
    case undefined: case "help": case "--help": case "-h": console.log(HELP); return;
    default: fail(`unknown command "${command}"\n\n${HELP}`);
  }
}

await main();
