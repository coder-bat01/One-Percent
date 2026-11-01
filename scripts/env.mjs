import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Load shell-independent settings for source deployments.
 *
 * Precedence matches common Node tooling: real process environment, then
 * .env.local, then .env. process.loadEnvFile() does not overwrite variables
 * that are already set, so loading .env.local first gives it priority.
 */
export function loadEnvironment() {
  for (const file of [".env.local", ".env"]) {
    const path = resolve(process.cwd(), file);
    if (existsSync(path)) process.loadEnvFile(path);
  }
}
