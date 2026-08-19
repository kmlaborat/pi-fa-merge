/**
 * Shared .env loader for the package (aligned with pi-fc-search's design).
 *
 * Single source of truth for loading FAST_APPLY_* / ANCHOREDIT_* variables
 * from the package-root `.env` file. Idempotent — safe to call at module
 * init, and re-runnable at runtime via the /reload-env command.
 */

import { existsSync, readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

// Only keys with one of these prefixes are applied. Writing ANY `KEY=VALUE`
// line into process.env (the old loader's behavior) would let a .env line
// such as `PATH=...` or `NODE_ENV=...` silently hijack the host pi process.
// Non-prefixed keys are ignored with a warning.
export const ENV_KEY_PREFIXES = ["FAST_APPLY_", "ANCHOREDIT_"];

function hasAllowedPrefix(key: string): boolean {
  return ENV_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/**
 * Parse .env content and apply FAST_APPLY_* / ANCHOREDIT_* keys into `env`.
 *
 * Pure function (no fs / no global state) so the parsing rules — quoting,
 * comments, prefix filtering, overwrite precedence — are unit-testable
 * without touching the real process environment.
 *
 * Precedence: the installed package .env is the single source of truth:
 * values here OVERRIDE variables already present in the process
 * environment (the reverse of standard dotenv precedence). Stale
 * shell/CI exports — or environment mutations made by mistake — must not
 * silently shadow what the user configured in the package .env. The
 * /reload-env command re-applies the file, which is also the recovery
 * path when the environment has been clobbered.
 *
 * Returns the list of ignored (non-prefixed) keys, for callers that want
 * to warn.
 */
export function applyEnvContent(
  content: string,
  env: NodeJS.ProcessEnv
): string[] {
  const ignoredKeys: string[] = [];
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith("#")) continue;

    // Parse KEY=VALUE format
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex <= 0) continue;

    const key = trimmed.substring(0, eqIndex).trim();
    let value = trimmed.substring(eqIndex + 1).trim();

    // Remove surrounding quotes if present
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (!hasAllowedPrefix(key)) {
      ignoredKeys.push(key);
      continue;
    }

    // Package .env overrides existing process.env entries (see above).
    env[key] = value;
  }
  return ignoredKeys;
}

/**
 * Result of a .env (re)load. Lets the /reload-env command report exactly
 * what happened without re-parsing the file itself.
 */
export interface ReloadEnvResult {
  /** The resolved package-root .env path. */
  envPath: string;
  /** Whether the .env file exists. */
  found: boolean;
  /** FAST_APPLY_* / ANCHOREDIT_* keys written into process.env by this load. */
  appliedKeys: string[];
  /** Non-prefixed keys that were ignored. */
  ignoredKeys: string[];
}

/**
 * Resolve the package-root .env path (one level up from this file:
 * extensions/env.ts → <package root>/.env).
 */
export function getEnvPath(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", ".env");
}

/**
 * Read the package .env and apply its FAST_APPLY_* / ANCHOREDIT_* keys into
 * process.env.
 *
 * Re-runnable: this performs the file read on EVERY call, so editing the
 * .env file and re-invoking (via /reload-env) picks up new values without
 * a pi restart. Configuration is resolved per fa_merge call from
 * process.env, so the next call uses the corrected configuration.
 *
 * Semantics:
 * - Only FAST_APPLY_* / ANCHOREDIT_* keys are applied; others are reported
 *   in ignoredKeys with a warning.
 * - Applied values override existing process.env entries.
 * - Keys REMOVED from the .env file are NOT removed from process.env: this
 *   function only ever writes (an intentional stale key can be cleaned by
 *   restarting pi).
 * - A missing or unreadable .env never throws; it is reported in the result.
 */
export function reloadEnvFile(): ReloadEnvResult {
  const envPath = getEnvPath();

  if (!existsSync(envPath)) {
    return { envPath, found: false, appliedKeys: [], ignoredKeys: [] };
  }

  let content: string;
  try {
    content = readFileSync(envPath, "utf-8");
  } catch (error) {
    // Warn but continue — a broken .env must not break the command.
    console.error(
      `[pi-fa-merge] Warning: Failed to load .env file: ${error instanceof Error ? error.message : String(error)}. API key and configuration may not be available.`
    );
    return { envPath, found: true, appliedKeys: [], ignoredKeys: [] };
  }

  const ignoredKeys = applyEnvContent(content, process.env);
  if (ignoredKeys.length > 0) {
    console.warn(
      `[pi-fa-merge] Ignored non-FAST_APPLY_*/ANCHOREDIT_* key(s) in .env: ${ignoredKeys.join(", ")} ` +
      "(only FAST_APPLY_* and ANCHOREDIT_* variables are loaded from the package .env)"
    );
  }

  // Derive the applied keys with the same parsing rules as applyEnvContent()
  // (trim, skip blanks/comments, first '=' split, prefix filter).
  const appliedKeys: string[] = [];
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex <= 0) continue;
    const key = trimmed.substring(0, eqIndex).trim();
    if (hasAllowedPrefix(key)) appliedKeys.push(key);
  }

  return { envPath, found: true, appliedKeys, ignoredKeys };
}

let loaded = false;

/**
 * Initial module-init load. Shares the same code path as runtime reloads;
 * only the once-guard differs.
 */
export function loadEnvFile(): void {
  if (loaded) return;
  loaded = true;
  reloadEnvFile();
}
