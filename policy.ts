import { realpathSync } from "node:fs";
import { resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { expandHome, type Config } from "./config.ts";

function real(path: string): string {
  try { return realpathSync(path); } catch { return resolve(path); }
}

export function gitRemotes(cwd: string): string[] {
  const result = spawnSync("git", ["-C", cwd, "remote", "-v"], { encoding: "utf8" });
  if (result.status !== 0) return [];
  return [...new Set(result.stdout.split("\n").map((line) => line.split(/\s+/)[1]).filter(Boolean))];
}

/** True when cwd is inside an employer folder or a repo with an employer remote. */
export function isEmployerWork(cwd: string, config: Config, remotes = gitRemotes(cwd)): boolean {
  const employer = config.employer;
  if (!employer) return false;
  const here = real(cwd);
  for (const path of employer.paths) {
    const root = real(expandHome(path));
    if (here === root || here.startsWith(root + sep)) return true;
  }
  return employer.remotes.some((pattern) => {
    const regex = new RegExp(pattern, "i");
    return remotes.some((remote) => regex.test(remote));
  });
}

export type ProviderPolicy = { id: string; employerOnly?: boolean };

/**
 * Which providers may receive work from cwd. Employer work only goes to the
 * employer's allow list, and employer-only accounts never see anything else.
 */
export function allowedProviderIds(cwd: string, config: Config, providers: ProviderPolicy[], employerWork = isEmployerWork(cwd, config)): string[] {
  if (employerWork && config.employer) {
    const allow = new Set(config.employer.allow);
    return providers.filter((p) => allow.has(p.id)).map((p) => p.id);
  }
  return providers.filter((p) => !p.employerOnly).map((p) => p.id);
}

export function policyRefusal(providerId: string, cwd: string, config: Config, providers: ProviderPolicy[], employerWork = isEmployerWork(cwd, config)): string | null {
  if (allowedProviderIds(cwd, config, providers, employerWork).includes(providerId)) return null;
  if (employerWork && config.employer) {
    return `${cwd} is ${config.employer.name} work, so its code may only go to: ${config.employer.allow.join(", ") || "nobody"}. ` +
      `Edit "employer" in the delegate config to change this.`;
  }
  return `${providerId} is reserved for ${config.employer?.name ?? "employer"} work.`;
}
