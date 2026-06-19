/**
 * pi-fa-merge: Fast-apply merge tool for AI coding agents
 *
 * Merges partial code diffs (update_snippets) into original source code
 * using Morph or Fireworks fast-apply models.
 *
 * @package pi-fa-merge
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

// ============================================================================
// Types
// ============================================================================

interface MergeParams {
  original_code: string;
  update_snippet: string;
  provider?: "morph" | "fireworks";
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

const MORPH_API_URL = "https://api.morph.run/v1/chat/completions";
const FIREWORKS_API_URL = "https://api.fireworks.ai/inference/v1/chat/completions";
const DEFAULT_MORPH_MODEL = "morph-large-latest";
const DEFAULT_FIREWORKS_MODEL = "Kortix/FastApply-7B-v1.0";
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 1000;
const REQUEST_TIMEOUT_MS = 60000;

// ============================================================================
// Prompt Builder (Task 1)
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

Output format:
<updated-code>
[your complete merged code here]
</updated-code>
`;
}

// ============================================================================
// Output Parser (Task 3)
// ============================================================================

function parseOutput(rawResponse: string): MergeResult {
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

  return {
    success: true,
    updated_code: code,
  };
}

// ============================================================================
// Provider Client (Task 2)
// ============================================================================

async function callMorphApi(apiKey: string, prompt: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(MORPH_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: DEFAULT_MORPH_MODEL,
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
      throw new Error(`Morph API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
  } finally {
    clearTimeout(timeout);
  }
}

async function callFireworksApi(
  apiKey: string,
  modelName: string,
  prompt: string
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(FIREWORKS_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: `accounts/fireworks/models/${modelName}`,
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
      throw new Error(`Fireworks API error: ${response.status} ${response.statusText}`);
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
  const provider = params.provider || "morph";
  const modelName = params.model_name || DEFAULT_FIREWORKS_MODEL;

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
  let apiKey: string | undefined;
  if (provider === "morph") {
    apiKey = process.env.MORPH_API_KEY;
    if (!apiKey) {
      return {
        success: false,
        error: "PROVIDER_AUTH_FAILED",
        details: "MORPH_API_KEY environment variable is not set.",
      };
    }
  } else {
    apiKey = process.env.FIREWORKS_API_KEY;
    if (!apiKey) {
      return {
        success: false,
        error: "PROVIDER_AUTH_FAILED",
        details: "FIREWORKS_API_KEY environment variable is not set.",
      };
    }
  }

  // Build prompt
  const prompt = buildPrompt(params.original_code, params.update_snippet);

  // Call API with retry
  let rawResponse: string;
  try {
    rawResponse = await withRetry(async () => {
      if (provider === "morph") {
        return callMorphApi(apiKey, prompt);
      } else {
        return callFireworksApi(apiKey, modelName, prompt);
      }
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

  // Parse output
  return parseOutput(rawResponse);
}

// ============================================================================
// Extension Definition
// ============================================================================

export default function (pi: ExtensionAPI) {
  // Register the merge tool
  pi.registerTool({
    name: "fast-apply-merge",
    label: "Fast-Apply Merge",
    description: "Merge code diffs using fast-apply models (Morph or Fireworks)",
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
      provider: Type.Optional(
        Type.String({
          description: "The API provider to use",
          default: "morph",
        })
      ),
      model_name: Type.Optional(
        Type.String({
          description: "Model name (required for fireworks provider)",
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
