/**
 * pi-fa-merge: Fast-apply merge tool for AI coding agents
 *
 * Merges an update snippet (code) into original code using any
 * OpenAI-compatible endpoint serving fast-apply models, and writes the
 * merged result to the file with hash-verified scope matching.
 *
 * This package implements the **kortix-ai/fast-apply** specification
 * (https://github.com/kortix-ai/fast-apply), which defines the tag-based
 * prompt format (`<code>`, `<update>`, `<updated-code>`) and dedicated
 * model interfaces for efficient code merging.
 *
 * @package pi-fa-merge
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import * as fs from "fs";
import * as os from "os";
import * as crypto from "crypto";
import * as path from "path";
import { loadEnvFile, reloadEnvFile } from "./env";
import {
  log,
  buildPrompt,
  parseOutput,
  callOpenAiCompatibleApi,
  withRetry,
  getMaxCodeLines,
  type MergeResult,
} from "./core";

// Re-export the pure fast-apply core (extensions/core.ts) from the entry
// point so tests and existing imports keep working unchanged.
export {
  log,
  buildPrompt,
  parseOutput,
  validateStructure,
  ApiError,
  callOpenAiCompatibleApi,
  isRetryable,
  withRetry,
  getMaxCodeLines,
  getRequestTimeoutMs,
} from "./core";
export type { PromptMessage, MergeResult } from "./core";

// ============================================================================
// .env Loader (see env.ts — aligned with pi-fc-search's design)
//
// Only FAST_APPLY_* / ANCHOREDIT_* keys are loaded, and the package .env
// overrides the process environment (single source of truth). Re-apply at
// runtime with the /reload-fa-env command (registered in the factory below).
// ============================================================================

// Load environment variables from the package .env at module initialization
loadEnvFile();

// ============================================================================
// Types
// ============================================================================

interface MergeParams {
  file: string;                 // Path to the file to edit
  original_code: string;        // The complete original code (must be exact)
  update_snippet: string;       // Code snippet containing the changes to apply
  anchor?: string;              // Exact text for scope matching (defaults to original_code)
  endpoint_url?: string;
  model_name?: string;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_ENDPOINT_URL = "https://api.fireworks.ai/inference/v1";
const DEFAULT_MODEL_NAME = "fast-apply-7b";
const MAX_CONTEXT_TOKENS = 8192;

// ============================================================================
// AnchorEdit Binary Resolution
// ============================================================================

function getAnchorEditBin(): string {
  return process.env.ANCHOREDIT_BIN ?? "anchoredit";
}

// ============================================================================
// Large Payload Handling (Windows command-line limit)
//
// Windows limits command lines to ~8191 characters. Anchor and replacement
// payloads can exceed that (up to MAX_LINES of transformed code), so large
// payloads are written to temporary files and passed via --anchor-file /
// --replacement-file instead of command-line arguments.
// ============================================================================

export const MAX_ARGV_PAYLOAD_CHARS = 1000;

export interface BuildApplyArgsOptions {
  anchorFile?: string;
  replacementFile?: string;
}

/**
 * Builds the `anchoredit apply` argument list. Payloads longer than
 * MAX_ARGV_PAYLOAD_CHARS are referenced via *-file arguments; the caller
 * must have written the corresponding temp file and pass its path.
 */
export function buildApplyArgs(
  file: string,
  anchor: string,
  replacement: string,
  opts?: BuildApplyArgsOptions
): string[] {
  const args = ["apply", "--file", file];

  if (anchor.length > MAX_ARGV_PAYLOAD_CHARS) {
    if (!opts?.anchorFile) {
      throw new Error("anchorFile is required for large anchor payloads");
    }
    args.push("--anchor-file", opts.anchorFile);
  } else {
    args.push("--anchor", anchor);
  }

  if (replacement.length > MAX_ARGV_PAYLOAD_CHARS) {
    if (!opts?.replacementFile) {
      throw new Error(
        "replacementFile is required for large replacement payloads"
      );
    }
    args.push("--replacement-file", opts.replacementFile);
  } else {
    args.push("--replacement", replacement);
  }

  return args;
}

/**
 * Writes a payload to a unique temp file in os.tmpdir() and returns its path.
 * The content is written verbatim (no trailing newline is added).
 * The caller is responsible for deleting the file when done.
 */
export async function writePayloadTempFile(payload: string): Promise<string> {
  const fileName = `fa-merge-${crypto.randomBytes(8).toString("hex")}.tmp`;
  const filePath = path.join(os.tmpdir(), fileName);
  await fs.promises.writeFile(filePath, payload, "utf-8");
  return filePath;
}

/**
 * Deletes a temp file, ignoring errors (e.g. already deleted).
 */
export async function removeTempFile(filePath: string): Promise<void> {
  await fs.promises.unlink(filePath).catch(() => {
    /* ignore */
  });
}

// ============================================================================
// File Path Resolution
// ============================================================================

export function resolveFilePath(filePath: string, cwd: string): string {
  // Windows absolute path (e.g. C:\foo\bar.rs) — pass through
  if (path.isAbsolute(filePath) && /^[a-zA-Z]:\\/.test(filePath)) {
    return filePath;
  }

  // Non-Windows platforms: standard path resolution
  if (process.platform !== 'win32') {
    const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);
    if (fs.existsSync(resolved)) {
      return resolved;
    }
    return filePath;
  }

  // Windows-specific path resolution
  let resolved: string;

  // Looks like a Unix-style absolute path (/tmp/..., /home/..., etc.)
  if (filePath.startsWith("/")) {
    try {
      // Use cygpath -w to translate mount-aware paths to Windows native format.
      const shellPath: string = process.env.ComSpec ?? "/bin/sh";
      const { execSync } = require("node:child_process");
      resolved = execSync(
        "cygpath -w '" + filePath.replace(/'/g, "'\"'\"'") + "'",
        { shell: shellPath },
      )
        .toString()
        .trim();
    } catch {
      // cygpath not available — fall through to relative resolution
      resolved = path.resolve(cwd, filePath);
    }
  } else {
    // Relative path — resolve against cwd
    resolved = path.resolve(cwd, filePath);
  }

  // Verify the file exists at the resolved location
  if (fs.existsSync(resolved)) {
    return resolved;
  }

  // Fall back to the original path so anchoredit can report its own error
  return filePath;
}

// ============================================================================
// Merge Operation
// ============================================================================

export async function performMerge(params: MergeParams): Promise<MergeResult> {
  const endpointUrl = params.endpoint_url || process.env.FAST_APPLY_ENDPOINT_URL || DEFAULT_ENDPOINT_URL;
  const modelName = params.model_name || process.env.FAST_APPLY_MODEL_NAME || DEFAULT_MODEL_NAME;

  log('info', "Starting merge operation", {
    file: params.file,
    endpoint: endpointUrl,
    model: modelName,
  });

  // Validate inputs
  if (!params.original_code || !params.original_code.trim()) {
    log('warn', "Validation failed: original_code is empty");
    return {
      success: false,
      error: "VALIDATION_ERROR",
      details: "original_code is required and cannot be empty.",
    };
  }

  if (!params.update_snippet || !params.update_snippet.trim()) {
    log('warn', "Validation failed: update_snippet is empty");
    return {
      success: false,
      error: "VALIDATION_ERROR",
      details: "update_snippet is required and cannot be empty.",
    };
  }

  // Get API key from environment
  const apiKey = process.env.FAST_APPLY_API_KEY;
  if (!apiKey) {
    log('warn', "FAST_APPLY_API_KEY environment variable is not set");
    return {
      success: false,
      error: "PROVIDER_AUTH_FAILED",
      details: "FAST_APPLY_API_KEY environment variable is not set.",
    };
  }

  // Validate context length (estimated tokens = total chars / 4)
  const estimatedTokens = Math.floor((params.original_code.length + params.update_snippet.length) / 4);
  if (estimatedTokens > MAX_CONTEXT_TOKENS) {
    log('warn', `Context length exceeded: ${estimatedTokens} tokens`);
    return {
      success: false,
      error: "CONTEXT_EXCEEDED",
      details: `Input exceeds maximum context length. Estimated tokens: ${estimatedTokens}`,
    };
  }

  // Validate file size (line count)
  const lineCount = params.original_code.split('\n').length;
  const maxLines = getMaxCodeLines();
  if (lineCount > maxLines) {
    log('warn', `Source too large: ${lineCount} lines exceeds maximum of ${maxLines} lines`);
    return {
      success: false,
      error: "FILE_TOO_LARGE",
      details: `Source too large: ${lineCount} lines exceeds maximum of ${maxLines} lines. Please split the source or process in smaller chunks.`,
    };
  }

  log('debug', `Processing source with ${lineCount} lines, estimated ${estimatedTokens} tokens`);

  // Build prompt using the kortix-ai/fast-apply inference prompt structure
  const messages = buildPrompt(params.original_code, params.update_snippet);

  // Call API with retry
  let rawResponse: string;
  try {
    log('info', "Calling API endpoint");
    rawResponse = await withRetry(async () => {
      return callOpenAiCompatibleApi(endpointUrl, apiKey, modelName, messages);
    });
    log('info', "API call successful");
  } catch (error) {
    log('error', "API call failed", error);
    if (error instanceof Error) {
      if (error.name === "AbortError") {
        return {
          success: false,
          error: "TIMEOUT",
          details: "Request timed out.",
        };
      }
      if (error.message.includes("401") || error.message.includes("403")) {
        return {
          success: false,
          error: "PROVIDER_AUTH_FAILED",
          details: "Authentication failed. Check your API key.",
        };
      }
      return {
        success: false,
        error: "API_ERROR",
        details: error.message,
      };
    }
    return {
      success: false,
      error: "UNKNOWN_ERROR",
      details: "An unknown error occurred.",
    };
  }

  // Parse output with structure validation
  log('debug', "Parsing API response");
  const result = parseOutput(rawResponse, params.original_code);
  
  if (result.success) {
    log('info', "Merge operation completed successfully");
  } else {
    log('error', `Merge operation failed: ${result.error}`);
  }
  
  return result;
}

// ============================================================================
// Extension Definition
// ============================================================================

export default function (pi: ExtensionAPI) {
  // Re-read the package .env at runtime. Configuration is resolved per
  // fa_merge call from process.env, so re-applying the file's
  // FAST_APPLY_*/ANCHOREDIT_* keys makes edits take effect on the NEXT
  // call — no pi restart needed. This is also the recovery path when the
  // process environment has been modified by mistake.
  // (Aligned with pi-fc-search's /reload-env command; named reload-fa-env
  // to make the target explicit and avoid a name collision when both
  // packages are installed.)
  pi.registerCommand("reload-fa-env", {
    description: "Re-read pi-fa-merge/.env without restarting pi (applies FAST_APPLY_* / ANCHOREDIT_* to the next fa_merge call)",
    handler: async (_args, ctx) => {
      const result = reloadEnvFile();

      if (!result.found) {
        ctx.ui.notify(
          `pi-fa-merge: no .env found at ${result.envPath} — nothing reloaded. ` +
          `Shell FAST_APPLY_* variables (if any) remain in effect.`,
          "warning"
        );
        return;
      }

      if (result.appliedKeys.length === 0) {
        ctx.ui.notify(
          `pi-fa-merge: .env reloaded (${result.envPath}) but contains no FAST_APPLY_* / ANCHOREDIT_* keys.`,
          "info"
        );
      } else {
        ctx.ui.notify(
          `pi-fa-merge: .env reloaded — applied ${result.appliedKeys.join(", ")}. ` +
          `Now effective: endpoint=${process.env.FAST_APPLY_ENDPOINT_URL || "(default)"} ` +
          `model=${process.env.FAST_APPLY_MODEL_NAME || "(default)"} ` +
          `maxLines=${process.env.FAST_APPLY_MAX_LINES || "(500)"} ` +
          `timeout=${process.env.FAST_APPLY_TIMEOUT || "(60000)"}ms. ` +
          `Takes effect on the next fa_merge call (no restart needed).`,
          "info"
        );
      }

      if (result.ignoredKeys.length > 0) {
        ctx.ui.notify(
          `pi-fa-merge: ignored non-FAST_APPLY_*/ANCHOREDIT_* key(s) in .env: ${result.ignoredKeys.join(", ")}`,
          "warning"
        );
      }
    },
  });

  // Register the merge tool
  pi.registerTool({
    name: "fa_merge",
    label: "Fast-Apply Merge",
    description: "Merge an update snippet into original code using fast-apply models, then write the result to a file with hash verification",
    promptSnippet: "Merge a code update snippet into a file using a fast-apply model",
    promptGuidelines: [
      "Use fa_merge to apply a code change: pass the exact original code and an update snippet; a fast-apply model merges them and the result is written to the file.",
      "original_code must be the exact current content you want to transform (read it first).",
      "update_snippet contains only the new/modified code, with at least one context line before and after, and '... existing code ...' markers for omitted parts. It must be an exact subset of the final code.",
      "For a complete file replacement, pass the full new file as update_snippet (no ellipsis markers).",
      "anchor defaults to original_code — typically you don't need to specify it unless you want a different scope.",
    ],
    parameters: Type.Object({
      file: Type.String({
        description: "Path to the file to edit",
      }),
      original_code: Type.String({
        description: "The complete original code to modify (must be exact)",
      }),
      update_snippet: Type.String({
        description: "Code snippet with the changes to apply (new/modified code with context lines and ellipsis markers for omissions)",
      }),
      anchor: Type.Optional(Type.String({
        description: "Exact text to match in the file (defaults to original_code). Must appear exactly once.",
      })),
      endpoint_url: Type.Optional(
        Type.String({
          description: "The base URL of the OpenAI-compatible endpoint",
        })
      ),
      model_name: Type.Optional(
        Type.String({
          description: "Model name to use (defaults to fast-apply-7b)",
        })
      ),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      log('info', "Tool execution started", {
        file: params.file,
        model: params.model_name,
      });
      
      try {
        // Resolve the anchoredit binary per call so /reload-fa-env changes apply
        const bin = getAnchorEditBin();

        // Validate file and source parameters
        if (!params.file || !params.file.trim()) {
          log('warn', "Validation failed: file parameter is missing");
          return {
            content: [{ type: "text", text: JSON.stringify({
              success: false,
              error: "VALIDATION_ERROR",
              details: "file parameter is required.",
            }, null, 2) }],
            isError: true,
            details: {}
          };
        }

        if (!params.original_code || !params.original_code.trim()) {
          log('warn', "Validation failed: original_code parameter is missing");
          return {
            content: [{ type: "text", text: JSON.stringify({
              success: false,
              error: "VALIDATION_ERROR",
              details: "original_code parameter is required.",
            }, null, 2) }],
            isError: true,
            details: {}
          };
        }

        if (!params.update_snippet || !params.update_snippet.trim()) {
          log('warn', "Validation failed: update_snippet parameter is missing");
          return {
            content: [{ type: "text", text: JSON.stringify({
              success: false,
              error: "VALIDATION_ERROR",
              details: "update_snippet parameter is required.",
            }, null, 2) }],
            isError: true,
            details: {}
          };
        }

        // Resolve file path
        const resolvedFilePath = resolveFilePath(params.file || '', ctx.cwd);
        log('debug', `Resolved file path: ${resolvedFilePath}`);

        // Check file exists
        if (!fs.existsSync(resolvedFilePath)) {
          log('warn', `File not found: ${resolvedFilePath}`);
          return {
            content: [{ type: "text", text: JSON.stringify({
              success: false,
              error: "VALIDATION_ERROR",
              details: `File not found: ${resolvedFilePath}`,
            }, null, 2) }],
            isError: true,
            details: {}
          };
        }

        // Use original_code as anchor if not specified
        const anchor = params.anchor || params.original_code;
        log('debug', `Using anchor: ${anchor.substring(0, 50)}...`);

        // Perform merge (validation of inputs is handled there)
        const mergeParams: MergeParams = {
          file: params.file,
          original_code: params.original_code,
          update_snippet: params.update_snippet,
          anchor: anchor,
          endpoint_url: params.endpoint_url,
          model_name: params.model_name,
        };
        const mergeResult = await performMerge(mergeParams);
        if (!mergeResult.success) {
          return {
            content: [{ type: "text", text: JSON.stringify(mergeResult, null, 2) }],
            isError: true,
            details: {}
          };
        }

        // Apply edit using AnchorEdit with file mutation queue
        log('info', "Applying changes to file with AnchorEdit");
        const updatedCode = mergeResult.updated_code ?? "";
        const tempFiles: string[] = [];
        try {
          // Large payloads go via temp files (Windows command-line limit)
          const anchorFile =
            anchor.length > MAX_ARGV_PAYLOAD_CHARS
              ? await writePayloadTempFile(anchor)
              : undefined;
          if (anchorFile) tempFiles.push(anchorFile);

          const replacementFile =
            updatedCode.length > MAX_ARGV_PAYLOAD_CHARS
              ? await writePayloadTempFile(updatedCode)
              : undefined;
          if (replacementFile) tempFiles.push(replacementFile);

          const execArgs = buildApplyArgs(
            resolvedFilePath,
            anchor,
            updatedCode,
            { anchorFile, replacementFile },
          );

          return await withFileMutationQueue(resolvedFilePath, async () => {
            const execResult = await pi.exec(
              bin,
              execArgs,
              { signal: _signal },
            );

          if (execResult.code !== 0) {
            const output = execResult.stderr || execResult.stdout || "";
            log('error', `AnchorEdit failed: ${output}`);
            
            if (output.includes("NO_MATCH")) {
              return {
                content: [{ type: "text", text: JSON.stringify({
                  success: false,
                  error: "ANCHOREDIT_NO_MATCH",
                  details: "The anchor was not found in the file. Please read the file and revise the anchor.",
                }, null, 2) }],
                isError: true,
                details: {}
              };
            }
            
            if (output.includes("MULTIPLE_MATCHES")) {
              return {
                content: [{ type: "text", text: JSON.stringify({
                  success: false,
                  error: "ANCHOREDIT_MULTIPLE",
                  details: "The anchor matched more than once. Use a more specific anchor.",
                }, null, 2) }],
                isError: true,
                details: {}
              };
            }
            
            if (output.includes("HASH_MISMATCH")) {
              return {
                content: [{ type: "text", text: JSON.stringify({
                  success: false,
                  error: "ANCHOREDIT_HASH_MISMATCH",
                  details: "Hash mismatch detected. The file has been changed externally. Please re-read the file and try again.",
                }, null, 2) }],
                isError: true,
                details: {}
              };
            }
            
            return {
              content: [{ type: "text", text: JSON.stringify({
                success: false,
                error: "ANCHOREDIT_ERROR",
                details: output.trim(),
              }, null, 2) }],
              isError: true,
              details: {}
            };
          }

            log('info', "File updated successfully");
            return {
              content: [{
                type: "text",
                text: JSON.stringify({ success: true, updated_code: updatedCode }, null, 2),
              }],
              details: { success: true, updated_code: updatedCode },
            };
          });
        } finally {
          // Always clean up temp files (success, failure, or abort)
          await Promise.all(tempFiles.map((f) => removeTempFile(f)));
        }
      } catch (error) {
        log('error', "Tool execution failed", error);
        const errorResult: MergeResult = {
          success: false,
          error: "EXECUTION_ERROR",
          details: (error as Error).message,
        };
        return {
          content: [{ type: "text", text: JSON.stringify(errorResult, null, 2) }],
          details: errorResult,
          isError: true,
        };
      }
    },
  });

  // Session lifecycle
  pi.on("session_start", async (_event, ctx) => {
    // Extension loaded successfully
    ctx.ui.notify("pi-fa-merge: Fast-apply merge tool loaded", "info");
  });

}
