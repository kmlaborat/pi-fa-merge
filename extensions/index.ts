/**
 * pi-fa-merge: Fast-apply merge tool for AI coding agents
 *
 * Transforms source code based on natural language instructions using any
 * OpenAI-compatible endpoint serving fast-apply models, and writes the
 * transformed code to the file with hash-verified scope matching.
 *
 * This package implements the **kortix-ai/fast-apply** specification
 * (https://github.com/kortix-ai/fast-apply), which defines the tag-based
 * prompt format (`<original-code>`, `<update-snippet>`, `<updated-code>`)
 * and dedicated model interfaces for efficient code merging.
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

// ============================================================================
// .env File Loader
// ============================================================================

function loadEnvFile(): void {
  try {
    // Try to find .env file in package directory
    const possiblePaths = [
      path.join(process.cwd(), '.env'),
      path.join(__dirname, '..', '.env'),
      path.join(__dirname, '.env'),
    ];

    for (const envPath of possiblePaths) {
      if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, 'utf-8');
        const lines = content.split('\n');
        
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          
          const eqIndex = trimmed.indexOf('=');
          if (eqIndex === -1) continue;
          
          const key = trimmed.substring(0, eqIndex).trim();
          let value = trimmed.substring(eqIndex + 1).trim();
          
          // Remove surrounding quotes if present
          if ((value.startsWith('"') && value.endsWith('"')) || 
              (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
          }
          
          // Do not override variables already set in the environment
          if (process.env[key] === undefined) {
            process.env[key] = value;
          }
        }
        
        return; // Found and loaded .env file
      }
    }
  } catch (error) {
    // Silently fail - environment variables might be set externally
    console.log(`[pi-fa-merge] Warning: Could not load .env file: ${error}`);
  }
}

// Load environment variables from .env file at module initialization
loadEnvFile();

// ============================================================================
// Types
// ============================================================================

interface MergeParams {
  file: string;                // Path to the file to edit
  source: string;              // Current content to transform (must be exact)
  instruction: string;         // Natural language instruction for the change
  anchor?: string;             // Exact text for scope matching (defaults to source)
  endpoint_url?: string;
  model_name?: string;
}

interface MergeResult {
  success: boolean;
  updated_code?: string;
  error?: string;
  details?: string;
}

// ============================================================================
// Logging
// ============================================================================

function log(level: 'debug' | 'info' | 'warn' | 'error', message: string, ...args: any[]): void {
  const prefix = `[pi-fa-merge:${level.toUpperCase()}]`;
  switch (level) {
    case 'debug':
      console.log(`${prefix} ${message}`, ...args);
      break;
    case 'info':
      console.log(`${prefix} ${message}`, ...args);
      break;
    case 'warn':
      console.warn(`${prefix} ${message}`, ...args);
      break;
    case 'error':
      console.error(`${prefix} ${message}`, ...args);
      break;
  }
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_ENDPOINT_URL = "https://api.fireworks.ai/inference/v1";
const DEFAULT_MODEL_NAME = "fast-apply-7b";
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 1000;
const MAX_CONTEXT_TOKENS = 8192;

// Configurable via environment variables
export function getMaxCodeLines(): number {
  const value = parseInt(process.env.FAST_APPLY_MAX_LINES ?? '500', 10);
  return Number.isFinite(value) && value > 0 ? value : 500;
}

export function getRequestTimeoutMs(): number {
  const value = parseInt(process.env.FAST_APPLY_TIMEOUT ?? '60000', 10);
  return Number.isFinite(value) && value > 0 ? value : 60000;
}

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
// Prompt Builder
//
// Constructs the ChatML-format prompt following the kortix-ai/fast-apply
// specification's recommended tag-based structure.
// See: https://github.com/kortix-ai/fast-apply
//
// The prompt uses the fast-apply tag structure: <code>,
// <update>, and expects output wrapped in <updated-code> tags.
//
// NOTE: This prompt intentionally follows the kortix-ai/fast-apply
// inference prompt structure (system + user messages) because the
// fast-apply models are fine-tuned on exactly this format.
// ============================================================================

export interface PromptMessage {
  role: "system" | "user";
  content: string;
}

export function buildPrompt(source: string, instruction: string): PromptMessage[] {
  return [
    {
      role: "system",
      content:
        "You are a coding assistant that helps merge code updates, ensuring every modification is fully integrated.",
    },
    {
      role: "user",
      content: `Merge all changes from the <update> snippet into the <code> below.
- Preserve the code's structure, order, comments, and indentation exactly.
- Output only the updated code, enclosed within <updated-code> and </updated-code> tags.
- Do not include any additional text, explanations, placeholders, ellipses, or code fences.

<code>
${source}
</code>

<update>
${instruction}
</update>

Provide the complete updated code.`,
    },
  ];
}

// ============================================================================
// Structure Validation
// Validates that the transformed code maintains the source code structure
// ============================================================================

interface StructureValidationResult {
  valid: boolean;
  details?: string;
}

export function validateStructure(source: string, updatedCode: string): StructureValidationResult {
  // Extract important elements from source code
  const originalFunctions = source.match(/\b(?:function|def|class)\s+(\w+)/g);
  const originalImports = source.match(/\b(?:import|require)\s+/g);
  
  // Check function/class preservation
  if (originalFunctions) {
    for (const fn of originalFunctions) {
      const fnName = fn.split(/\s+/).pop() ?? fn;
      if (!updatedCode.includes(fnName)) {
        return {
          valid: false,
          details: `Critical error: Original function/class "${fnName}" was lost during transformation.`
        };
      }
    }
  }
  
  // Check import preservation (imports should generally be preserved)
  if (originalImports && originalImports.length > 0) {
    const updatedImports = updatedCode.match(/\b(?:import|require)\s+/g);
    if (!updatedImports || updatedImports.length === 0) {
      return {
        valid: false,
        details: "Critical error: All imports/require statements were lost during transformation."
      };
    }
  }
  
  // Check code line count decrease (50%+ decrease is suspicious)
  const sourceLines = source.split('\n').filter(l => l.trim()).length;
  const updatedLines = updatedCode.split('\n').filter(l => l.trim()).length;
  
  if (sourceLines > 0 && updatedLines < sourceLines * 0.5) {
    return {
      valid: false,
      details: `Critical error: Code lost too many lines (${sourceLines} -> ${updatedLines}).`
    };
  }
  
  // Check prefix preservation (first 20% of source code should be present)
  // Skip for very small files (5 lines or less) to avoid false positives
  const sourceLinesList = source.split('\n');
  
  if (sourceLinesList.length > 5) {
    const prefixLength = Math.max(5, Math.floor(sourceLinesList.length * 0.2));
    const sourcePrefix = sourceLinesList.slice(0, prefixLength).join('\n').trim();
    
    if (sourcePrefix && !updatedCode.startsWith(sourcePrefix)) {
      return {
        valid: false,
        details: `Critical error: Source code prefix was lost. Expected first ${prefixLength} lines to be preserved but they were not found in the transformed code.`
      };
    }
  }
  
  return { valid: true };
}

// ============================================================================
// Output Parser
// ============================================================================

export function parseOutput(rawResponse: string, source: string): MergeResult {
  const openTag = "<updated-code>";
  const closeTag = "</updated-code>";

  const openIndex = rawResponse.indexOf(openTag);
  if (openIndex === -1) {
    return {
      success: false,
      error: "MALFORMED_OUTPUT",
      details: "Opening tag <updated-code> was not found.",
    };
  }

  const contentStart = openIndex + openTag.length;
  const closeIndex = rawResponse.indexOf(closeTag, contentStart);
  if (closeIndex === -1) {
    return {
      success: false,
      error: "MALFORMED_OUTPUT",
      details: "Closing tag </updated-code> was not found.",
    };
  }

  // Remove exactly one leading/trailing newline (common LLM output
  // artifacts) while preserving any additional blank lines verbatim.
  let code = rawResponse.substring(contentStart, closeIndex);
  if (code.startsWith("\n")) code = code.slice(1);
  if (code.endsWith("\n")) code = code.slice(0, -1);

  // Remove markdown code block markers if present
  const codeBlockMatch = code.match(/^```[^\n]*\n?([\s\S]*?)\n?```$/);
  if (codeBlockMatch) {
    code = codeBlockMatch[1];
  }

  // Structure validation
  const validation = validateStructure(source, code);
  if (!validation.valid) {
    return {
      success: false,
      error: "STRUCTURE_MANGLE_ERROR",
      details: validation.details,
    };
  }

  return {
    success: true,
    updated_code: code,
  };
}

// ============================================================================
// OpenAI-Compatible API Client
//
// Generic client for any OpenAI-compatible endpoint serving fast-apply models.
// Uses the standard Chat Completions API format.
// ============================================================================

/**
 * Error for non-2xx API responses, carrying the HTTP status code so retry
 * logic can decide based on the status instead of message text matching.
 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(`API error: ${message}`);
    this.name = "ApiError";
  }
}

export async function callOpenAiCompatibleApi(
  endpointUrl: string,
  apiKey: string,
  modelName: string,
  messages: PromptMessage[]
): Promise<string> {
  const controller = new AbortController();
  const timeoutMs = getRequestTimeoutMs();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const url = `${endpointUrl}/chat/completions`;

  try {
    log('debug', `Calling API: ${endpointUrl}, model: ${modelName}, timeout: ${timeoutMs}ms`);
    
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: modelName,
        messages,
        temperature: 0,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new ApiError(response.status, `${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      throw new Error(
        "API error: malformed response (missing choices[0].message.content)"
      );
    }
    log('debug', "API response received");
    return content;
  } finally {
    clearTimeout(timeout);
  }
}

// ============================================================================
// Exponential Backoff Retry
// ============================================================================

async function withRetry<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;

      if (attempt < MAX_RETRIES && isRetryable(error)) {
        const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        throw lastError;
      }
    }
  }

  throw lastError;
}

export function isRetryable(error: unknown): boolean {
  if (error instanceof Error) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === "number") {
      return status === 429 || (status >= 500 && status <= 599);
    }
  }
  return false;
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
  if (!params.source || !params.source.trim()) {
    log('warn', "Validation failed: source is empty");
    return {
      success: false,
      error: "VALIDATION_ERROR",
      details: "source is required and cannot be empty.",
    };
  }

  if (!params.instruction || !params.instruction.trim()) {
    log('warn', "Validation failed: instruction is empty");
    return {
      success: false,
      error: "VALIDATION_ERROR",
      details: "instruction is required and cannot be empty.",
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
  const estimatedTokens = Math.floor((params.source.length + params.instruction.length) / 4);
  if (estimatedTokens > MAX_CONTEXT_TOKENS) {
    log('warn', `Context length exceeded: ${estimatedTokens} tokens`);
    return {
      success: false,
      error: "CONTEXT_EXCEEDED",
      details: `Input exceeds maximum context length. Estimated tokens: ${estimatedTokens}`,
    };
  }

  // Validate file size (line count)
  const lineCount = params.source.split('\n').length;
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
  const messages = buildPrompt(params.source, params.instruction);

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
  const result = parseOutput(rawResponse, params.source);
  
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
  const bin = getAnchorEditBin();

  // Register the merge tool
  pi.registerTool({
    name: "fa_merge",
    label: "Fast-Apply Merge",
    description: "Transform source code based on an instruction using fast-apply models, then apply it to a file with hash verification",
    promptSnippet: "Generate and apply a code transformation based on a natural language instruction",
    promptGuidelines: [
      "Use fa_merge when you want to describe a change in natural language and let the tool generate the replacement.",
      "source must be the exact current content you want to transform (read it first).",
      "instruction is a natural language description of the desired change.",
      "anchor defaults to source — typically you don't need to specify it unless you want a different scope.",
    ],
    parameters: Type.Object({
      file: Type.String({
        description: "Path to the file to edit",
      }),
      source: Type.String({
        description: "Current content to transform (must be exact)",
      }),
      instruction: Type.String({
        description: "Natural language description of the desired change",
      }),
      anchor: Type.Optional(Type.String({
        description: "Exact text to match in the file (defaults to source). Must appear exactly once.",
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

        if (!params.source || !params.source.trim()) {
          log('warn', "Validation failed: source parameter is missing");
          return {
            content: [{ type: "text", text: JSON.stringify({
              success: false,
              error: "VALIDATION_ERROR",
              details: "source parameter is required.",
            }, null, 2) }],
            isError: true,
            details: {}
          };
        }

        if (!params.instruction || !params.instruction.trim()) {
          log('warn', "Validation failed: instruction parameter is missing");
          return {
            content: [{ type: "text", text: JSON.stringify({
              success: false,
              error: "VALIDATION_ERROR",
              details: "instruction parameter is required.",
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

        // Use source as anchor if not specified
        const anchor = params.anchor || params.source;
        log('debug', `Using anchor: ${anchor.substring(0, 50)}...`);

        // Perform merge (validation of source and instruction is handled there)
        const mergeParams: MergeParams = {
          file: params.file,
          source: params.source,
          instruction: params.instruction,
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
