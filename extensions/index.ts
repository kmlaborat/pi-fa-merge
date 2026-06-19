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
// Constants
// ============================================================================

const DEFAULT_ENDPOINT_URL = "https://api.fireworks.ai/inference/v1";
const DEFAULT_MODEL_NAME = "fast-apply-7b";
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 1000;
const REQUEST_TIMEOUT_MS = 60000;
const MAX_CONTEXT_TOKENS = 8192;

// ============================================================================
// Prompt Builder (Task 1)
//
// Constructs the ChatML-format prompt following the kortix-ai/fast-apply
// specification's recommended tag-based structure.
// See: https://github.com/kortix-ai/fast-apply
//
// The prompt uses the fast-apply tag structure: <original-code>,
// <update-snippet>, and expects output wrapped in <updated-code> tags.
// ============================================================================

function buildPrompt(originalCode: string, updateSnippet: string): string {
  return `You are a code merge assistant. Your job is to merge the update snippet into the original code.

Original code:
<original-code>
${originalCode}
</original-code>

Update snippet (the changes to apply):
<update-snippet>
${updateSnippet}
</update-snippet>

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
  const originalLinesList = originalCode.split('\n');
  const prefixLength = Math.max(5, Math.floor(originalLinesList.length * 0.2));
  const originalPrefix = originalLinesList.slice(0, prefixLength).join('\n').trim();
  
  if (originalPrefix && !updatedCode.startsWith(originalPrefix.split('\n')[0].trim())) {
    return {
      valid: false,
      details: "Critical error: Original code prefix was lost. The merged code does not start with the original content."
    };
  }
  
  return { valid: true };
}

// ============================================================================
// Output Parser (Task 3)
// ============================================================================

function parseOutput(rawResponse: string, originalCode: string): MergeResult {
  const openTag = "<updated-code>";
  const closeTag = "</updated-code>";

  // Debug logging
  console.log(`[pi-fa-merge] Raw response length: ${rawResponse.length}`);
  console.log(`[pi-fa-merge] Raw response preview: ${rawResponse.substring(0, 200)}`);

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
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const url = `${endpointUrl}/chat/completions`;

  try {
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

  // Validate inputs
  if (!params.original_code || !params.original_code.trim()) {
    return {
      success: false,
      error: "VALIDATION_ERROR",
      details: "original_code is required and cannot be empty.",
    };
  }

  if (!params.update_snippet || !params.update_snippet.trim()) {
    return {
      success: false,
      error: "VALIDATION_ERROR",
      details: "update_snippet is required and cannot be empty.",
    };
  }

  // Get API key from environment
  const apiKey = process.env.FAST_APPLY_API_KEY;
  if (!apiKey) {
    return {
      success: false,
      error: "PROVIDER_AUTH_FAILED",
      details: "FAST_APPLY_API_KEY environment variable is not set.",
    };
  }

  // Validate context length (estimated tokens = total chars / 4)
  const estimatedTokens = Math.floor((params.original_code.length + params.update_snippet.length) / 4);
  if (estimatedTokens > MAX_CONTEXT_TOKENS) {
    return {
      success: false,
      error: "CONTEXT_EXCEEDED",
      details: `Input exceeds maximum context length. Estimated tokens: ${estimatedTokens}`,
    };
  }

  // Build prompt using kortix-ai/fast-apply tag structure
  const prompt = buildPrompt(params.original_code, params.update_snippet);

  // Call API with retry
  let rawResponse: string;
  try {
    rawResponse = await withRetry(async () => {
      return callOpenAiCompatibleApi(endpointUrl, apiKey, modelName, prompt);
    });
  } catch (error) {
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
  return parseOutput(rawResponse, params.original_code);
}

// ============================================================================
// Extension Definition
// ============================================================================

export default function (pi: ExtensionAPI) {
  // Register the merge tool
  pi.registerTool({
    name: "fast-apply-merge",
    label: "Fast-Apply Merge",
    description: "Merge code diffs using fast-apply models via OpenAI-compatible endpoints",
    promptSnippet: "Merge update snippets into original code using AI models",
    promptGuidelines: [
      "Use fast-apply-merge when you need to merge code changes into an existing file efficiently",
    ],
    parameters: Type.Object({
      original_code: Type.String({
        description: "The complete original source code",
      }),
      update_snippet: Type.String({
        description: "The code changes to apply",
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
      try {
        const result = await performMerge(params as MergeParams, ctx as ExtensionContext);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          details: result,
        };
      } catch (error) {
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
