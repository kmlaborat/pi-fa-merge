# pi-fa-merge

Fast-apply merge tool for AI coding agents, based on the [**kortix-ai/fast-apply**](https://github.com/kortix-ai/fast-apply) specification developed by [Kortix](https://kortix.ai). Merges an update snippet (code) into original code using fast-apply models, and writes the result directly to a file using hash-verified scope matching.

This tool supports **any OpenAI-compatible endpoint** serving fast-apply models, making it portable across different hosting environments.

## Features

- **fast-apply compliant**: Optimized for the `kortix-ai/fast-apply` prompt format and dedicated models, maximizing LLM performance.
- **OpenAI-compatible**: Connects to any OpenAI-compatible API endpoint serving fast-apply models.
- **High speed**: Uses fast-apply models for rapid code transformation
- **Low token cost**: The agent supplies only the changed code instead of regenerating the whole file
- **Deterministic**: Temperature 0 ensures consistent results
- **Retry support**: Automatic exponential backoff for rate limits
- **Direct file write**: Writes transformed code directly to target file with hash-verified scope matching
- **Atomic operations**: Uses file mutation queue for safe concurrent access
- **Cross-platform support**: Works on Windows, macOS, and Linux
- **Configurable**: Timeout, max lines, and other parameters configurable via environment variables
- **Logging**: Built-in logging for debugging and monitoring

## Prerequisites

- Node.js >= 22.19.0 (required by `@earendil-works/pi-coding-agent`)
- [pi-anchoredit](https://github.com/kmlaborat/pi-anchoredit) - Required for file write operations
- `anchoredit` binary must be accessible in PATH or configured via `ANCHOREDIT_BIN` environment variable

## Installation

### From git

```bash
pi install git:github.com/kmlaborat/pi-fa-merge
```

### Local development

```bash
pi install /path/to/pi-fa-merge
```

## Configuration

### Setup `.env` File

After installing the extension, create a `.env` file in the pi-fa-merge package directory:

```bash
# Copy the template
# On Windows:
copy .env.example .env

# On macOS/Linux:
cp .env.example .env
```

Then edit `.env` with your settings:

```env
# Required: API key for authentication
FAST_APPLY_API_KEY="your-api-key"

# Optional: Base URL of the OpenAI-compatible endpoint
FAST_APPLY_ENDPOINT_URL="https://api.fireworks.ai/inference/v1"

# Optional: Model name to use
FAST_APPLY_MODEL_NAME="fast-apply-7b"

# Optional: Path to the anchoredit binary
ANCHOREDIT_BIN="anchoredit"

# Optional: Maximum number of lines allowed for original_code (default: 500)
# FAST_APPLY_MAX_LINES=500

# Optional: Request timeout in milliseconds (default: 60000)
# FAST_APPLY_TIMEOUT=60000
```

> **Local-model note:** a local `fast-apply-7b` (e.g. served over a tailnet) can take 60–130s for inputs of 4k+ tokens, so the default 60s timeout will report `TIMEOUT` on large sources. Set `FAST_APPLY_TIMEOUT=180000` (or higher) when running against a local/slow endpoint. Cloud endpoints are fast enough to keep the default.

**Note**: The `.env` file is not included in the repository. A template file `.env.example` is provided for reference.

**`.env` loading rules**

- Only `FAST_APPLY_*` and `ANCHOREDIT_*` keys are loaded from `.env` (other keys are ignored with a warning).
- The package `.env` is the **single source of truth**: its values override variables already set in the environment.
- Use the **`/reload-fa-env`** slash command to re-read `.env` without restarting pi. Changes take effect on the next `fa_merge` call — it is also the recovery path if the process environment was modified by mistake.

## Usage

### Using the Tool

```typescript
fa_merge({
  file: "/path/to/target/file.py",
  original_code: "def hello():\n    return 'world'",
  update_snippet: "def hello():\n    return 'universe'",
  endpoint_url: "https://api.fireworks.ai/inference/v1", // optional
  model_name: "fast-apply-7b" // optional
})
```

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `file` | String | **Yes** | **Path to the file to edit (relative or absolute)** |
| `original_code` | String | **Yes** | **The complete original code to modify (must be exact)** |
| `update_snippet` | String | **Yes** | **Code snippet with the changes to apply (see format below)** |
| `anchor` | String | Optional | Exact text to match in the file (defaults to `original_code`) |
| `endpoint_url` | String | Optional | The base URL of the OpenAI-compatible endpoint |
| `model_name` | String | Optional | Model name to use (defaults to `fast-apply-7b`) |

### Update Snippet Format

`update_snippet` follows the kortix-ai/fast-apply data format (what the models were fine-tuned on):

- Include **only the new or modified code** — do not repeat unchanged parts unnecessarily.
- Provide enough context to indicate placement: **at least one line before and after** the changed region, or a clear position marker.
- Use ellipsis comments (e.g. `// ... existing code ...`) **only** when significant portions are omitted. Do not use them for a complete file replacement.
- The snippet must be an **exact subset of the final code**.

### Using the Skill

```bash
/skill:pi-fa-merge
```

## Example

### Basic File Edit

```python
# Original code (exact content from the file)
original_code = """
def calculate_total(price, tax):
    return price * (1 + tax)
"""

# Update snippet: only the new code, appended at the end
update_snippet = """
def get_version():
    return '1.0.0'
"""

# Result - file is directly updated
result = fa_merge({
    "file": "/path/to/calculator.py",
    "original_code": original_code,
    "update_snippet": update_snippet
})

# Output:
# {
#   "success": true,
#   "updated_code": "def calculate_total(price, tax):\n    return price * (1 + tax)\n\ndef get_version():\n    return '1.0.0'"
# }
```

### Complete File Replacement

```python
# Replace entire file content
# (complete file replacement: pass the full new file, no ellipsis markers)
result = fa_merge({
    "file": "/path/to/file.py",
    "original_code": entire_file_content,
    "update_snippet": entire_new_file_content
})
```

## Error Types

| Error | Description |
|-------|-------------|
| `VALIDATION_ERROR` | Input validation failed (empty or invalid parameters) |
| `PROVIDER_AUTH_FAILED` | API authentication failed or API key not configured |
| `TIMEOUT` | Request timed out waiting for response (default: 60 seconds) |
| `MALFORMED_OUTPUT` | Model output couldn't be parsed or missing required tags |
| `CONTEXT_EXCEEDED` | Input exceeds maximum context length (8192 estimated tokens) |
| `FILE_TOO_LARGE` | Source exceeds maximum line count (default: 500 lines, configurable via `FAST_APPLY_MAX_LINES`) |
| `STRUCTURE_MANGLE_ERROR` | Transformed code lost critical structure from source code |
| **`ANCHOREDIT_NO_MATCH`** | **Anchor was not found in the file** |
| **`ANCHOREDIT_MULTIPLE`** | **Anchor matched more than once in the file** |
| **`ANCHOREDIT_HASH_MISMATCH`** | **Hash mismatch detected (file changed externally)** |
| **`ANCHOREDIT_ERROR`** | **Other AnchorEdit binary errors** |
| `API_ERROR` | General API error (non-authentication, non-timeout) |
| `EXECUTION_ERROR` | Unexpected error during tool execution |
| `UNKNOWN_ERROR` | Error with unknown cause |

## Development

```bash
# Install dependencies
npm install

# Test locally
pi -e ./extensions/index.ts
```

## CI/CD

This project uses GitHub Actions for continuous integration. The CI workflow runs on:

- Ubuntu (latest)
- macOS (latest)
- Windows (latest)

### CI Checks

- Type checking with TypeScript
- SPEC compliance verification
- Cross-platform testing
- Linting (placeholder, non-blocking)

## License

MIT
