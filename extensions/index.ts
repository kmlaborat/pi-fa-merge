/**
 * pi-fa-merge: Fast-apply merge tool for AI coding agents
 *
 * Merges partial code diffs (update_snippets) into original source code
 * using any OpenAI-compatible endpoint serving fast-apply models.
 *
 * This package implements the **kortix-ai/fast-apply** specification
 * (https://github.com/kortix-ai/fast-apply), which defines the tag-based
 * prompt format (`<original-code>`, `<update-snippet>`, `<updated-code>`)
 * and dedicated model interfaces for efficient code merging.
 *
 * @package pi-fa-merge
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import * as fs from "fs";
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
          
          process.env[key] = value;
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
  original_code: string;
  update_snippet: string;
  file: string;                // Path to the file to edit
  anchor: string;              // Exact text for scope matching and hash verification
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
const REQUEST_TIMEOUT_MS = 60000;
const MAX_CONTEXT_TOKENS = 8192;

// Configurable via environment variables
function getMaxCodeLines(): number {
  return parseInt(process.env.FAST_APPLY_MAX_LINES ?? '500', 10);
}

function getRequestTimeoutMs(): number {
  return parseInt(process.env.FAST_APPLY_TIMEOUT ?? '60000', 10);
}

// ============================================================================
// AnchorEdit Binary Resolution (Task 2)
// ============================================================================

function getAnchorEditBin(): string {
  return process.env.ANCHOREDIT_BIN ?? "anchoredit";
}

// ============================================================================
// File Path Resolution (Task 3)
// ============================================================================

function resolveFilePath(filePath: string, cwd: string): string {
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
// Prompt Builder (Task 1)
//
// Constructs the ChatML-format prompt following the kortix-ai/fast-apply
// specification's recommended tag-based structure.
// See: https://github.com/kortix-ai/fast-apply
//
// The prompt uses the fast-apply tag structure: <code>,
// <update>, and expects output wrapped in <updated-code> tags.
// ============================================================================

function buildPrompt(originalCode: string, updateSnippet: string): string {
  return `You are a code merge assistant. Your job is to merge the update snippet into the original code.

Original code:
<code>
${originalCode}
</code>

Update snippet (the changes to apply):
<update>
${updateSnippet}
</update>

Instructions:
1. Analyze the original code and the update snippet
2. Determine where the changes should be applied
3. Merge the changes into the original code while preserving all other content
4. Maintain proper indentation, comments, and code structure
5. Output ONLY the complete merged code wrapped in <updated-code> tags

CRITICAL REQUIREMENTS:
- Do NOT omit any part of the original code
- Do NOT use ellipsis (...) or any abbreviation to skip code
- Output MUST include ALL lines from the original code, from line 1 to the last line
- The merged code must be COMPLETE and SELF-CONTAINED
- Do NOT truncate the beginning or end of the code
- If the original code has 100 lines, your output should have at least 100 lines (plus any additions)

Output format:
<updated-code>
[your complete merged code here - include EVERY line]
</updated-code>
`;
}

// ============================================================================
// Structure Validation (Task 3.5)
// Validates that the merged code maintains the original code structure
// ============================================================================

interface StructureValidationResult {
  valid: boolean;
  details?: string;
}

function validateStructure(originalCode: string, updatedCode: string): StructureValidationResult {
  // Extract important elements from original code
  const originalFunctions = originalCode.match(/\b(?:function|def|class)\s+(\w+)/g);
  const originalImports = originalCode.match(/\b(?:import|require)\s+/g);
  
  // Check function/class preservation
  if (originalFunctions) {
    for (const fn of originalFunctions) {
      const fnName = fn.split(/\s+/).pop();
      if (!updatedCode.includes(fnName)) {
        return {
          valid: false,
          details: `Critical error: Original function/class "${fnName}" was lost during merge.`
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
        details: "Critical error: All imports/require statements were lost during merge."
      };
    }
  }
  
  // Check code line count decrease (50%+ decrease is suspicious)
  const originalLines = originalCode.split('\n').filter(l => l.trim()).length;
  const updatedLines = updatedCode.split('\n').filter(l => l.trim()).length;
  
  if (originalLines > 0 && updatedLines < originalLines * 0.5) {
    return {
      valid: false,
      details: `Critical error: Code lost too many lines (${originalLines} -> ${updatedLines}).`
    };
  }
  
  // Check prefix preservation (first 20% of original code should be present)
  // Skip for very small files (5 lines or less) to avoid false positives
  const originalLinesList = originalCode.split('\n');
  
  if (originalLinesList.length > 5) {
    const prefixLength = Math.max(5, Math.floor(originalLinesList.length * 0.2));
    const originalPrefix = originalLinesList.slice(0, prefixLength).join('\n').trim();
    
    if (originalPrefix && !updatedCode.startsWith(originalPrefix)) {
      return {
        valid: false,
        details: `Critical error: Original code prefix was lost. Expected first ${prefixLength} lines to be preserved but they were not found in the merged code.`
      };
    }
  }
  
  return { valid: true };
}

// ============================================================================
// Output Parser (Task 3)
// ============================================================================

function parseOutput(rawResponse: string, originalCode: string): MergeResult {
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

  const extracted = rawResponse.substring(contentStart, closeIndex).trim();

  // Remove markdown code block markers if present
  let code = extracted;
  const codeBlockMatch = code.match(/^```[^\n]*\n?([\s\S]*?)\n?```$/);
  if (codeBlockMatch) {
    code = codeBlockMatch[1].trim();
  }

  // Structure validation
  const validation = validateStructure(originalCode, code);
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
// OpenAI-Compatible API Client (Task 2)
//
// Generic client for any OpenAI-compatible endpoint serving fast-apply models.
// Uses the standard Chat Completions API format.
// ============================================================================

async function callOpenAiCompatibleApi(
  endpointUrl: string,
  apiKey: string,
  modelName: string,
  prompt: string
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
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    log('debug', "API response received");
    return data.choices[0].message.content;
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

function isRetryable(error: unknown): boolean {
  if (error instanceof Error) {
    return (
      error.message.includes("429") ||
      error.message.includes("500") ||
      error.message.includes("502") ||
      error.message.includes("503") ||
      error.message.includes("504")
    );
  }
  return false;
}

// ============================================================================
// Merge Operation
// ============================================================================

async function performMerge(params: MergeParams, ctx: ExtensionContext): Promise<MergeResult> {
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
    log('warn', `File too large: ${lineCount} lines exceeds maximum of ${maxLines} lines`);
    return {
      success: false,
      error: "VALIDATION_ERROR",
      details: `File too large: ${lineCount} lines exceeds maximum of ${maxLines} lines. Please split the file or process in smaller chunks.`,
    };
  }

  log('debug', `Processing file with ${lineCount} lines, estimated ${estimatedTokens} tokens`);

  // Build prompt using kortix-ai/fast-apply tag structure
  const prompt = buildPrompt(params.original_code, params.update_snippet);

  // Call API with retry
  let rawResponse: string;
  try {
    log('info', "Calling API endpoint");
    rawResponse = await withRetry(async () => {
      return callOpenAiCompatibleApi(endpointUrl, apiKey, modelName, prompt);
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
  const bin = getAnchorEditBin();

  // Register the merge tool
  pi.registerTool({
    name: "fa_merge",
    label: "Fast-Apply Merge",
    description: "Merge code diffs using fast-apply models via OpenAI-compatible endpoints",
    promptSnippet: "Merge update snippets into original code using AI models",
    promptGuidelines: [
      "Use fa_merge when you need to merge code changes into an existing file efficiently",
    ],
    parameters: Type.Object({
      original_code: Type.String({
        description: "The complete original source code",
      }),
      update_snippet: Type.String({
        description: "The code changes to apply",
      }),
      file: Type.String({
        description: "Path to the file to edit",
      }),
      anchor: Type.String({
        description: "Exact text to match in the file. Must appear exactly once.",
      }),
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
        // Validate file and anchor parameters (these are required for file operation)
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

        if (!params.anchor || !params.anchor.trim()) {
          log('warn', "Validation failed: anchor parameter is missing");
          return {
            content: [{ type: "text", text: JSON.stringify({
              success: false,
              error: "VALIDATION_ERROR",
              details: "anchor parameter is required.",
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

        // Perform merge (validation of original_code and update_snippet is handled there)
        const mergeResult = await performMerge(params as MergeParams, ctx as ExtensionContext);
        if (!mergeResult.success) {
          return {
            content: [{ type: "text", text: JSON.stringify(mergeResult, null, 2) }],
            isError: true,
            details: {}
          };
        }

        // Apply edit using AnchorEdit with file mutation queue
        log('info', "Applying changes to file with AnchorEdit");
        return await withFileMutationQueue(resolvedFilePath, async () => {
          const execResult = await pi.exec(
            bin,
            [
              "apply",
              "--file", resolvedFilePath,
              "--anchor", params.anchor,
              "--replacement", mergeResult.updated_code
            ],
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
            content: [{ type: "text", text: execResult.stdout.trim() }],
            details: {}
          };
        });
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

  pi.on("session_shutdown", async (_event, _ctx) => {
    // Cleanup if needed
  });
}
