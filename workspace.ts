import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readlinkSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { dirname, join, relative } from "node:path";

export type Workspace = {
  /** Where the delegate runs. Inside a snapshot this mirrors the caller's subfolder. */
  dir: string;
  kind: "snapshot" | "worktree" | "in-place";
  repoRoot?: string;
  worktree?: string;
  baseline?: string;
  branch?: string;
  /** Ignored dependency folders linked in from the caller's repo, kept out of the diff. */
  linked?: string[];
  notes: string[];
};

export type Changes = { files: string[]; stat: string; patch: string };

const MAX_UNTRACKED_BYTES = 20 * 1024 * 1024;

/**
 * Installed dependencies are ignored by git, so a fresh worktree has none and
 * nothing can build or test. Link the caller's copies in instead. The write
 * sandboxes block writes through the link, since it points outside the worktree.
 */
const LINKED_DEPENDENCY_DIRS = ["node_modules", ".venv"];

function git(cwd: string, args: string[], input?: string, env?: Record<string, string>) {
  const result = spawnSync("git", ["-C", cwd, ...args], {
    encoding: "utf8", input, maxBuffer: 512 * 1024 * 1024, env: env ? { ...process.env, ...env } : undefined,
  });
  return { ok: result.status === 0, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function mustGit(cwd: string, args: string[], input?: string, env?: Record<string, string>): string {
  const result = git(cwd, args, input, env);
  if (!result.ok) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
  return result.stdout;
}

export function repoRootOf(cwd: string): string | null {
  const result = git(cwd, ["rev-parse", "--show-toplevel"]);
  return result.ok ? result.stdout.trim() : null;
}

/**
 * The whole working directory (tracked, changed and untracked files) as a git
 * tree, built in a throwaway index so HEAD and the real index are untouched.
 */
function workingTree(worktree: string, exclude: string[] = []): string {
  const indexFile = join(tmpdir(), `delegate-${process.pid}-${randomBytes(4).toString("hex")}.index`);
  const env = { GIT_INDEX_FILE: indexFile };
  try {
    mustGit(worktree, ["read-tree", "HEAD"], undefined, env);
    mustGit(worktree, ["add", "-A", "--", ".", ...exclude], undefined, env);
    return mustGit(worktree, ["write-tree"], undefined, env).trim();
  } finally {
    rmSync(indexFile, { force: true });
  }
}

/**
 * Give the delegate its own copy of the repo: a worktree at HEAD with the
 * caller's staged, unstaged and untracked changes recreated as they are, so
 * `git diff HEAD` inside it shows the same thing as in the caller's repo. The
 * baseline is a tree of that state, kept outside the history, so we can tell
 * exactly what the delegate changed. Read-only work uses a detached snapshot
 * that's thrown away; write work gets a `delegate/<id>` branch that stays
 * until `delegate clean`.
 */
export function prepareWorkspace(options: {
  cwd: string; mode: "read" | "write"; inPlace: boolean; id: string; dataDir: string;
  /** Link the caller's node_modules/.venv in. Only safe when the provider sandboxes writes. */
  linkDependencies?: boolean;
  /** The provider's read-only mode really stops writes, so running in place is safe. */
  enforcesReadOnly?: boolean;
}): Workspace {
  const repoRoot = repoRootOf(options.cwd);
  if (!repoRoot) {
    if (options.mode === "write") throw new Error(`${options.cwd} isn't a git repo, and write work needs one so its changes can be reviewed.`);
    if (!options.inPlace && !options.enforcesReadOnly) {
      throw new Error(`${options.cwd} isn't a git repo, so there's nothing to snapshot, and this provider's read-only mode doesn't reliably stop writes. ` +
        "Pass --in-place to let it work on these files anyway, or --no-repo if it doesn't need them.");
    }
    return { dir: options.cwd, kind: "in-place", notes: [] };
  }
  if (!git(repoRoot, ["rev-parse", "--verify", "--quiet", "HEAD"]).ok) {
    if (options.mode === "write") throw new Error(`${repoRoot} has no commits yet. Make a first commit so the delegate's changes can be reviewed.`);
    if (!options.inPlace && !options.enforcesReadOnly) {
      throw new Error(`${repoRoot} has no commits yet, so there's nothing to snapshot, and this provider's read-only mode doesn't reliably stop writes. ` +
        "Make a first commit, or pass --in-place to let it work on these files anyway.");
    }
    return { dir: options.cwd, kind: "in-place", repoRoot, notes: ["This repo has no commits yet, so the delegate ran in your working tree."] };
  }
  if (options.inPlace) {
    if (options.mode === "write") throw new Error("--in-place is only for read-only work. Write work always gets its own worktree.");
    return { dir: options.cwd, kind: "in-place", repoRoot, notes: [] };
  }

  const worktree = join(options.dataDir, "worktrees", options.id);
  mkdirSync(dirname(worktree), { recursive: true });
  const branch = options.mode === "write" ? `delegate/${options.id}` : undefined;
  mustGit(repoRoot, ["worktree", "add", "--quiet", ...(branch ? ["-b", branch] : ["--detach"]), worktree, "HEAD"]);

  const notes: string[] = [];
  let baseline: string;
  const linked: string[] = [];
  try {
    const staged = mustGit(repoRoot, ["diff", "--cached", "--binary"]);
    const unstaged = mustGit(repoRoot, ["diff", "--binary"]);
    if (staged.trim()) {
      const applied = git(worktree, ["apply", "--index", "--binary", "--whitespace=nowarn"], staged);
      if (!applied.ok) notes.push(`Couldn't copy your staged changes into the snapshot: ${applied.stderr.trim()}`);
    }
    if (unstaged.trim()) {
      const applied = git(worktree, ["apply", "--binary", "--whitespace=nowarn"], unstaged);
      if (!applied.ok) notes.push(`Couldn't copy your unstaged changes into the snapshot: ${applied.stderr.trim()}`);
    }
    const untracked = mustGit(repoRoot, ["ls-files", "--others", "--exclude-standard", "-z"]).split("\0").filter(Boolean);
    let skipped = 0;
    for (const file of untracked) {
      const from = join(repoRoot, file);
      const to = join(worktree, file);
      try {
        const stat = lstatSync(from);
        if (stat.size > MAX_UNTRACKED_BYTES) { skipped++; continue; }
        mkdirSync(dirname(to), { recursive: true });
        if (stat.isSymbolicLink()) symlinkSync(readlinkSync(from), to);
        else copyFileSync(from, to);
      } catch { skipped++; }
    }
    if (skipped) notes.push(`Left ${skipped} untracked file(s) out of the snapshot (over 20 MB or unreadable).`);
    if (existsSync(join(repoRoot, ".gitmodules"))) notes.push("This repo has submodules, and they aren't included in the snapshot.");

    baseline = workingTree(worktree);

    if (options.linkDependencies) {
      for (const name of LINKED_DEPENDENCY_DIRS) {
        const from = join(repoRoot, name);
        const to = join(worktree, name);
        if (existsSync(from) && !existsSync(to)) {
          try { symlinkSync(from, to); linked.push(name); } catch {}
        }
      }
    } else if (options.mode === "write" && LINKED_DEPENDENCY_DIRS.some((name) => existsSync(join(repoRoot, name)))) {
      notes.push("Your node_modules/.venv weren't linked in, because this provider's writes aren't sandboxed. It can install its own in the worktree.");
    }
  } catch (error) {
    removeWorktree(repoRoot, worktree, branch);
    throw error;
  }

  const sub = relative(realpathSync(repoRoot), realpathSync(options.cwd));
  const dir = sub && !sub.startsWith("..") ? join(worktree, sub) : worktree;
  return { dir: existsSync(dir) ? dir : worktree, kind: branch ? "worktree" : "snapshot", repoRoot, worktree, baseline, branch, linked, notes };
}

/** Everything the delegate changed since the baseline, including anything it committed. */
export function workspaceChanges(ws: Workspace): Changes {
  if (!ws.worktree || !ws.baseline) return { files: [], stat: "", patch: "" };
  const now = workingTree(ws.worktree, (ws.linked ?? []).map((name) => `:(exclude)${name}`));
  return {
    files: mustGit(ws.worktree, ["diff", "--name-only", ws.baseline, now]).split("\n").filter(Boolean),
    stat: mustGit(ws.worktree, ["diff", "--shortstat", ws.baseline, now]).trim(),
    patch: mustGit(ws.worktree, ["diff", "--binary", ws.baseline, now]),
  };
}

export function removeWorktree(repoRoot: string, worktree: string, branch?: string) {
  git(repoRoot, ["worktree", "remove", "--force", worktree]);
  if (branch) git(repoRoot, ["branch", "-D", branch]);
}

/**
 * Apply a delegate's patch to the caller's repo. It only applies if it applies
 * cleanly, unless threeWay is set, which merges and can leave conflict markers.
 */
export function applyPatch(repoRoot: string, patch: string, threeWay = false): { ok: boolean; message: string } {
  if (!patch.trim()) return { ok: true, message: "Nothing to apply." };
  if (threeWay) {
    const merged = git(repoRoot, ["apply", "--binary", "--3way", "--whitespace=nowarn"], patch);
    return merged.ok
      ? { ok: true, message: "Applied with a 3-way merge." }
      : { ok: false, message: `${merged.stderr.trim()}\nResolve the conflict markers, then \`git add\` the files.` };
  }
  const check = git(repoRoot, ["apply", "--check", "--binary", "--whitespace=nowarn"], patch);
  if (!check.ok) {
    return { ok: false, message: `It doesn't apply cleanly, so nothing was changed:\n${check.stderr.trim()}\nRun it again with --3way to merge it, which may leave conflict markers.` };
  }
  const applied = git(repoRoot, ["apply", "--binary", "--whitespace=nowarn"], patch);
  return applied.ok ? { ok: true, message: "Applied cleanly." } : { ok: false, message: applied.stderr.trim() };
}

/** The repo a worktree belongs to, for cleaning up worktrees whose run record is gone. */
export function repoOfWorktree(worktree: string): string | null {
  const result = git(worktree, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  return result.ok ? dirname(result.stdout.trim()) : null;
}
