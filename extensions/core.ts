/**
 * pi-fa-merge: pure fast-apply pipeline core.
 *
 * Framework-free (no pi-coding-agent, no file-system writes) core of the
 * fa_merge tool, extracted so the pipeline can be driven directly by the
 * evaluation harness (harness/run.mts) and unit tests:
 *
 *   buildPrompt → callOpenAiCompatibleApi → parseOutput
 *
 * The extension entry point (index.ts) re-exports everything here.
 *
 * This package implements the **kortix-ai/fast-apply** specification
 * (https://github.com/kortix-ai/fast-apply), which defines the tag-based
 * prompt format (`<code>`, `<update>`, `<updated-code>`) and dedicated
 * model interfaces for efficient code merging.
 */

// ============================================================================
// Logging
// ============================================================================

export function log(
  level: 'debug' | 'info' | 'warn' | 'error',
  message: string,
  ...args: any[]
): void {
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
// Config getters (resolved from process.env per call)
// ============================================================================

const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 1000;

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
// Prompt Builder
//
// Constructs the ChatML-format prompt following the kortix-ai/fast-apply
// specification's recommended tag-based structure.
// See: https://github.com/kortix-ai/fast-apply
//
// The prompt uses the fast-apply tag structure: <code>,
// <update>, and expects output wrapped in <updated-code> tags.
//
// NOTE: This prompt is a BYTE-EXACT copy of the kortix-ai/fast-apply
// fine-tuning template (see the Fine-Tuning notebook in the upstream
// repository), including the "an coding assistant" typo, because the
// fast-apply models are fine-tuned on exactly this format.
// ============================================================================

export interface PromptMessage {
  role: "system" | "user";
  content: string;
}

export function buildPrompt(originalCode: string, updateSnippet: string): PromptMessage[] {
  return [
    {
      role: "system",
      content:
        "You are an coding assistant that helps merge code updates, ensuring every modification is fully integrated.",
    },
    {
      role: "user",
      content: `Merge all changes from the <update> snippet into the <code> below.
- Preserve the code's structure, order, comments, and indentation exactly.
- Output only the updated code, enclosed within <updated-code> and </updated-code> tags.
- Do not include any additional text, explanations, placeholders, ellipses, or code fences.

<code>${originalCode}</code>

<update>${updateSnippet}</update>

Provide the complete updated code.`,
    },
  ];
}

// ============================================================================
// Types
// ============================================================================

export interface MergeResult {
  success: boolean;
  updated_code?: string;
  error?: string;
  details?: string;
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
  
  // Check prefix preservation (first 20% of source code should be present).
  // Skip for very small files (5 lines or less) to avoid false positives.
  //
  // Presence-based (not startsWith): a legitimate update frequently touches
  // the file head (added imports, changed signatures, new shebang/docstring),
  // which made the byte-exact startsWith check reject byte-correct merges.
  // The measured baseline (harness/results/baseline-2026-08-19.md) showed a
  // 5/20 false-positive rate with startsWith while the genuine head-mangling
  // cases lost ~100% of the prefix lines. Requiring at least half of the
  // non-empty prefix lines to survive verbatim still catches catastrophic
  // head mangling without rejecting correct merges.
  const sourceLinesList = source.split('\n');

  if (sourceLinesList.length > 5) {
    const prefixLength = Math.max(5, Math.floor(sourceLinesList.length * 0.2));
    const prefixLines = sourceLinesList
      .slice(0, prefixLength)
      .map((line) => line.trim())
      .filter((line) => line !== '');

    if (prefixLines.length > 0) {
      const outputLines = new Set(
        updatedCode.split('\n').map((line) => line.trim())
      );
      let present = 0;
      for (const line of prefixLines) {
        if (outputLines.has(line)) present++;
      }
      if (present * 2 < prefixLines.length) {
        return {
          valid: false,
          details: `Critical error: Source code prefix was mostly lost. Only ${present} of the first ${prefixLines.length} non-empty lines are present in the transformed code.`
        };
      }
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

/**
 * Optional extra fields merged into the chat-completions request body
 * (e.g. `chat_template_kwargs: { enable_thinking: false }` for
 * reasoning-capable models served by llama.cpp-based endpoints).
 */
export type ExtraRequestBody = Record<string, unknown>;

export async function callOpenAiCompatibleApi(
  endpointUrl: string,
  apiKey: string,
  modelName: string,
  messages: PromptMessage[],
  extraBody?: ExtraRequestBody
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
        ...extraBody,
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

export async function withRetry<T>(operation: () => Promise<T>): Promise<T> {
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
