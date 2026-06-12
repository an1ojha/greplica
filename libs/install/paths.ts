import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type InstallPlatform = "codex" | "claude" | "opencode";
export type InstallEmbedding = "local" | "openai";

export const skillNames = ["greplica-bootstrap", "greplica-update-working-memory"] as const;
export type SkillName = (typeof skillNames)[number];

export interface PlatformPaths {
  skillsRoot: string;
}

export function packageRoot(): string {
  let current = dirname(fileURLToPath(import.meta.url));
  while (current !== dirname(current)) {
    if (existsSync(join(current, "package.json")) && existsSync(join(current, "skills"))) return current;
    current = dirname(current);
  }
  throw new Error("Could not locate Greplica package root with bundled skills.");
}

export function platformPaths(platform: InstallPlatform): PlatformPaths {
  if (platform === "codex") {
    const codexHome = process.env.CODEX_HOME ?? join(homedir(), ".codex");
    return {
      skillsRoot: join(codexHome, "skills"),
    };
  }

  if (platform === "opencode") {
    const configHome = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
    return {
      skillsRoot: join(configHome, "opencode", "skills"),
    };
  }

  const claudeHome = join(homedir(), ".claude");
  return {
    skillsRoot: join(claudeHome, "skills"),
  };
}
