import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

export function getVersion(): string {
  const result = spawnSync("git", ["rev-list", "--count", "HEAD"], {
    encoding: "utf8",
  });
  const count = result.status === 0 ? Number.parseInt(result.stdout.trim(), 10) : NaN;
  if (Number.isFinite(count) && count > 0) return `${count}`;
  // No usable git history (shallow clone without depth, non-git build):
  // fall back to the package version instead of pretending there are 0 commits.
  try {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version?: string };
    return pkg.version ?? "0";
  } catch {
    return "0";
  }
}

if (import.meta.main) {
  process.stdout.write(getVersion());
}
