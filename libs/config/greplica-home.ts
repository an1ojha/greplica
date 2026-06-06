import { homedir } from "node:os";
import { join } from "node:path";

export function greplicaHome(): string {
  return process.env.GREPLICA_HOME ?? process.env.ENGINEERING_CONTEXT_HOME ?? join(homedir(), ".greplica");
}
