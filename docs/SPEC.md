## Implementation Specification: pi-fa-merge

### 1. Purpose

Provide a pi.dev-compliant package (Tool/Skill) that transforms source code based on natural language instructions using fast-apply models at high speed and low cost, and **writes the transformed code directly to a target file using hash-verified scope matching**. Because the agent describes the change instead of regenerating the code itself, token consumption and response latency are reduced.

This package communicates with **custom OpenAI-compatible endpoints** serving `fast-apply` models that conform to the [**kortix-ai/fast-apply**](https://github.com/kortix-ai/fast-apply) specification. It uses the tag-based prompt format (`<original-code>`, `<update-snippet>`, `<updated-code>`) defined by the specification and can connect to any OpenAI-compatible API server hosting compatible models.

### 2. Inputs & Environment

This package (Skill name: `pi-fa-merge`) accepts the following input parameters. For security, API keys must be obtained via environment variables and must not be passed as arguments.

| Parameter | Type | Required/Optional | Description |
| --- | --- | --- | --- |
| `source` | String | Required | The current content to transform (entire file or a partial scope). Must exactly match the file content. Must not be empty. |
| `instruction` | String | Required | Natural language description of the change to apply. Must not be empty. |
| `file` | String | **Required** | **Path to the file to edit (relative or absolute). Required for file write operation.** |
| `anchor` | String | Optional | Exact text in the file for scope matching and hash verification. Must appear exactly once in the file. Defaults to `source`. |
| `endpoint_url` | String | Optional | The base URL of the OpenAI-compatible endpoint. Falls back to `FAST_APPLY_ENDPOINT_URL` environment variable. |
| `model_name` | String | Optional | The model identifier to use. Falls back to `FAST_APPLY_MODEL_NAME` environment variable or `fast-apply-7b`. |

**Environment Variables (Secrets)**

* `FAST_APPLY_API_KEY`: Required. The API key for authentication with the endpoint.
* `FAST_APPLY_ENDPOINT_URL`: Optional. Default endpoint URL for the OpenAI-compatible API.
* `FAST_APPLY_MODEL_NAME`: Optional. Default model name to use (defaults to `fast-apply-7b`).
* `ANCHOREDIT_BIN`: Optional. Path to the `anchoredit` binary. Defaults to `anchoredit` (searched in PATH).
* `FAST_APPLY_MAX_LINES`: Optional. Maximum number of lines allowed for input files. Defaults to `500`.
* `FAST_APPLY_TIMEOUT`: Optional. Request timeout in milliseconds. Defaults to `60000` (60 seconds).

### 3. Outputs

On success, the package guarantees a JSON object or serialized output with the following structure:

```json
{
  "success": true,
  "updated_code": "String (the fully merged source code)"
}
```

**Output Guarantees**

* **Raw code return:** `updated_code` must contain only pure code, with no metadata such as model output tags (`<updated-code>` and `</updated-code>`), Markdown code blocks (```), or other wrappers.
* **Structural preservation:** Indentation, comments, blank lines, and function ordering outside the diff-applied regions must be completely preserved.
* **Structure validation:** The system validates that critical symbols from the original code are preserved in the transformed output. The validation checks:
  * Function/class names are preserved
  * Import/require statements are preserved
  * Code line count does not decrease by more than 50%
  * The first 20% of the original code prefix is preserved (for files > 5 lines)
  * If validation fails, the operation returns `success: false` with error `STRUCTURE_MANGLE_ERROR`

### 4. Constraints & Invariants

Conditions that must always be maintained during system operation.

* **Zero external dependencies (Node.js standard library only):**
* To prevent dependency bloat and future specification-related breakage, **the addition or use of external npm modules (`axios`, `lodash`, `zod`, `p-retry`, etc.) is strictly prohibited**.
* All input/output validation, parsing, HTTP requests, and retry backoff logic must be implemented exclusively using Node.js standard libraries (`node:util`, `node:crypto`, `node:string_decoder`, etc.) and the built-in **`fetch`**.
* Input and output must conform to the harness I/O specification (JSON), using only standard `JSON.parse` / `JSON.stringify` and pure JavaScript/TypeScript logic.
* **TypeBox** is permitted as it is provided by the pi-coding-agent framework.


* **Idempotency (LLM parameters):** Given identical input code and diff, the same `updated_code` must be produced on every execution. To guarantee this at the system level, API inference parameters must always include **`temperature: 0`**.
* **Strict tag isolation:** Control XML tags from fast-apply model output (`<updated-code>`, `<original-code>`, `<update-snippet>`) — as defined by the [kortix-ai/fast-apply specification](https://github.com/kortix-ai/fast-apply) — must never appear in the agent's final output source code.

### Default Values & Constraints

| Parameter | Value | Description |
| --- | --- | --- |
| Request Timeout | 60 seconds (configurable via FAST_APPLY_TIMEOUT) | Maximum time to wait for API response |
| Initial Retry Delay | 1 second | Starting delay for exponential backoff |
| Maximum Context Tokens | 8192 | Maximum estimated tokens allowed for input |

### Error Types

| Error Type | Description |
| --- | --- |
| `VALIDATION_ERROR` | Input validation failed (empty or invalid parameters) |
| `PROVIDER_AUTH_FAILED` | API authentication failed or API key not configured |
| `TIMEOUT` | Request timed out waiting for response |
| `MALFORMED_OUTPUT` | Model output couldn't be parsed or missing required tags |
| `CONTEXT_EXCEEDED` | Input exceeds maximum context length (8192 estimated tokens) |
| `FILE_TOO_LARGE` | Input file exceeds maximum line count (default: 500 lines) |
| `STRUCTURE_MANGLE_ERROR` | Merged code lost critical structure from original code (function names, imports, or excessive line loss) |
| **`ANCHOREDIT_NO_MATCH`** | **Anchor was not found in the file** |
| **`ANCHOREDIT_MULTIPLE`** | **Anchor matched more than once in the file** |
| **`ANCHOREDIT_HASH_MISMATCH`** | **Hash mismatch detected (file changed externally)** |
| **`ANCHOREDIT_ERROR`** | **Other AnchorEdit binary errors** |
| `API_ERROR` | General API error (non-authentication, non-timeout) |
| `EXECUTION_ERROR` | Unexpected error during tool execution |
| `UNKNOWN_ERROR` | Error with unknown cause |

### 5. Failure Cases

Expected failure patterns and system behavior.

| Failure Scenario | Expected Behavior / Error Response |
| --- | --- |
| **API Rate Limit (429) / Server Error (5xx)** | Retry up to **3 times** with exponential backoff using standard `setTimeout`. If all retries fail, return `success: false` with an error. |
| **API Authentication Error / Timeout** | Return `success: false` with a clear error reason (e.g., `"PROVIDER_AUTH_FAILED"`, `"TIMEOUT"`). |
| **Tag Not Found Error** | Return `success: false, error: "MALFORMED_OUTPUT"`. Prevents the critical bug of overwriting files with raw output. |
| **Context Length Exceeded** | If the estimated token count (calculated from total character count divided by 4) exceeds 8192 tokens, immediately raise a `CONTEXT_EXCEEDED` error. |
| **File Too Large** | If the input file exceeds the maximum line count (default: 500 lines), immediately raise a `FILE_TOO_LARGE` error. |
| **Structure Mangle Error** | If the transformed code loses critical structure (function names, imports, >50% lines lost, or prefix lost), return `success: false, error: "STRUCTURE_MANGLE_ERROR"` with details indicating what was lost. |
| **Anchor Not Found** | Return `success: false, error: "ANCHOREDIT_NO_MATCH"`. Indicates the anchor text doesn't exist in the file. |
| **Multiple Anchor Matches** | Return `success: false, error: "ANCHOREDIT_MULTIPLE"`. Indicates the anchor text appears more than once. |
| **Hash Mismatch** | Return `success: false, error: "ANCHOREDIT_HASH_MISMATCH"`. Indicates the file was modified externally. |

### 6. Acceptance Tests

Specific test cases that must pass before implementation, based on TDD rules.

**Test Case 1: Normal case (Adding a function to Python code)**

* **Input:**
* `source`:
```python
def calculate_total(price, tax):
    return price * (1 + tax)
```
* `instruction`: "Add a get_version function that returns '1.0.0'"
* `file`: "/path/to/test.py"
* `anchor`: "def calculate_total"


* **Expected Output:**
```json
{
  "success": true,
  "updated_code": "def calculate_total(price, tax):\n    return price * (1 + tax)\n\ndef get_version():\n    return \"1.0.0\""
}
```


**Test Case 2: Normal case (Partial rewrite of existing logic with indentation preservation)**

* **Input:**
* `source`:
```python
class User:
    def greet(self):
        print("Hello")
        return False
```
* `instruction`: "Change greet to print 'Hello World' and return True"
* `file`: "/path/to/test.py"
* `anchor`: "class User:"


* **Expected Output:**
```json
{
  "success": true,
  "updated_code": "class User:\n    def greet(self):\n        print(\"Hello World\")\n        return True"
}
```


**Test Case 3: Error case (Malformed output tags)**

* **Input:**
* Raw model response: `<updated-code>def incomplete():`


* **Expected Output:**
```json
{
  "success": false,
  "error": "MALFORMED_OUTPUT",
  "details": "Closing tag </updated-code> was not found."
}
```


**Test Case 4: Error case (Anchor not found)**

* **Input:**
* `file`: "/path/to/test.py"
* `anchor`: "nonexistent text"


* **Expected Output:**
```json
{
  "success": false,
  "error": "ANCHOREDIT_NO_MATCH",
  "details": "The anchor was not found in the file."
}
```


### 7. Non-goals (Out of Scope)

* **Deciding what to change:** Deciding which files to modify and formulating the change instruction is the responsibility of the agent that calls this package.
* **AnchorEdit binary distribution:** The `anchoredit` binary must be installed separately (via pi-anchoredit package or manual installation).

### 8. CI/CD Requirements

* **Cross-platform testing:** Tests must run on Ubuntu, macOS, and Windows
* **SPEC compliance verification:** Verify zero external dependencies and no Python dependencies
* **Type checking:** TypeScript type checking must pass
* **Linting:** Code quality checks (non-blocking)

### 8. TDD Task Breakdown

Tasks decomposed while strictly adhering to the standard-library-only constraint.

* **[Task 1: Prompt Builder]** Create and test a string processing function that strictly assembles the input `source` and `instruction` into the fast-apply prompt using the `<original-code>` and `<update-snippet>` tags. External template engines are prohibited.
* **[Task 2: OpenAI-Compatible Client]** Implement a generic request client for OpenAI-compatible endpoints using the built-in **`fetch`**. Include fixed injection of `temperature: 0` and implement **custom exponential backoff retry logic (up to 3 times) using `setTimeout`** for 429/5xx errors, along with mock tests.
* **[Task 3: Output Parser]** Implement and test logic to safely extract and trim content from `<updated-code>...</updated-code>` in model output using standard string methods (`indexOf`, `substring`) or regular expressions, without external parsing libraries (Zod or third-party XML parsers).
* **[Task 4: pi.dev Skill Wrapper]** Integrate Tasks 1–3 and define an entry point conforming to the pi.dev package manifest. Include safe key retrieval from environment variables via `process.env`.
* **[Task 5: AnchorEdit Binary Resolution]** Implement and test logic to locate the `anchoredit` binary from environment variables or PATH.
* **[Task 6: File Path Resolution]** Implement and test path resolution logic, including Windows mount path translation via `cygpath`.
* **[Task 7: File Mutation Integration]** Integrate with `withFileMutationQueue` and `pi.exec` for atomic file write operations.
