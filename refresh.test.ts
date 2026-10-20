import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { refreshInBackground } from "./limits.ts";
import { tempDir, testConfig } from "./test-helpers.ts";

async function until(check: () => boolean) {
  const deadline = Date.now() + 3000;
  while (!check() && Date.now() < deadline) await Bun.sleep(20);
  expect(check()).toBe(true);
}

test("background refresh requests are throttled for two minutes, including failed launches", async () => {
  const config = testConfig();
  const dir = tempDir();
  const calls = join(dir, "calls");
  const launcher = join(dir, "fake-delegate");
  const marker = join(config.dataDir, "limits-refresh-request");
  writeFileSync(launcher, `#!/bin/sh\necho called >> '${calls}'\n`);
  chmodSync(launcher, 0o755);
  for (let i = 0; i < 5; i++) refreshInBackground(launcher, config);
  await until(() => existsSync(calls));
  expect(readFileSync(calls, "utf8").trim().split("\n")).toHaveLength(1);
  expect(existsSync(marker)).toBe(true);
  const old = new Date(Date.now() - 121_000);
  utimesSync(marker, old, old);
  refreshInBackground(launcher, config);
  await until(() => readFileSync(calls, "utf8").trim().split("\n").length === 2);

  const failed = testConfig();
  refreshInBackground(join(dir, "missing-launcher"), failed);
  await Bun.sleep(50);
  // A failed launch keeps the cooldown too, so every hook doesn't retry it.
  expect(existsSync(join(failed.dataDir, "limits-refresh-request"))).toBe(true);
  refreshInBackground(launcher, failed);
  await Bun.sleep(50);
  expect(readFileSync(calls, "utf8").trim().split("\n")).toHaveLength(2);
});

test("refresh itself skips concurrent work and releases its lock on success or failure", async () => {
  const config = testConfig();
  const bin = tempDir();
  const calls = join(bin, "calls");
  const release = join(bin, "release");
  const fake = join(bin, "token-stats");
  writeFileSync(fake, `#!${process.execPath}\nimport { appendFileSync, existsSync } from 'node:fs';
appendFileSync(${JSON.stringify(calls)}, 'called\\n');
const deadline = Date.now() + 5000;
while (!existsSync(${JSON.stringify(release)}) && Date.now() < deadline) await Bun.sleep(20);
console.log(JSON.stringify({ generatedAt: new Date().toISOString(), accounts: [] }));
`);
  chmodSync(fake, 0o755);
  const code = `import { refreshLimits } from ${JSON.stringify(join(import.meta.dir, "limits.ts"))}; console.log(JSON.stringify(refreshLimits(${JSON.stringify(config)})));`;
  const env = { ...process.env, PATH: bin };
  const first = Bun.spawn([process.execPath, "-e", code], { env, stdout: "pipe", stderr: "pipe" });
  try {
    await until(() => existsSync(calls));
    const second = spawnSync(process.execPath, ["-e", code], { env, encoding: "utf8", timeout: 1000 });
    expect(second.status).toBe(0);
    expect(second.stdout.trim()).toBe("null");
    expect(readFileSync(calls, "utf8").trim().split("\n")).toHaveLength(1);
  } finally {
    writeFileSync(release, "done");
    await first.exited;
  }
  expect(JSON.parse(await new Response(first.stdout).text()).accounts).toEqual([]);
  expect(existsSync(join(config.dataDir, "limits-refresh-running"))).toBe(false);
  // Failure and a crashed prior process must not leave refresh permanently locked.
  mkdirSync(config.dataDir, { recursive: true });
  const lock = join(config.dataDir, "limits-refresh-running");
  writeFileSync(lock, "old");
  const old = new Date(Date.now() - 301_000);
  utimesSync(lock, old, old);
  const failed = spawnSync(process.execPath, ["-e", code], { env: { ...env, PATH: "" }, encoding: "utf8", timeout: 1000 });
  expect(failed.status).toBe(0);
  expect(failed.stdout.trim()).toBe("null");
  expect(existsSync(lock)).toBe(false);
});
