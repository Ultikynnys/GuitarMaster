import { spawnSync } from "node:child_process";

export function getVersion(): string {
  const result = spawnSync("git", ["rev-list", "--count", "HEAD"], {
    encoding: "utf8",
  });
  const count = result.status === 0 ? Number.parseInt(result.stdout.trim(), 10) : 0;
  return `${Number.isFinite(count) ? count : 0}`;
}

if (import.meta.main) {
  process.stdout.write(getVersion());
}
