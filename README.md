# pi-fa-merge

Fast-apply merge tool for AI coding agents, based on the [**kortix-ai/fast-apply**](https://github.com/kortix-ai/fast-apply) specification developed by [Kortix](https://kortix.ai). Merges partial code diffs into original source code at high speed with low token cost, and writes the result directly to a file using hash-verified scope matching.

This tool supports **any OpenAI-compatible endpoint** serving fast-apply models, making it portable across different hosting environments.

## Features

- **fast-apply compliant**: Optimized for the `kortix-ai/fast-apply` prompt format and dedicated models, maximizing LLM performance.
- **OpenAI-compatible**: Connects to any OpenAI-compatible API endpoint serving fast-apply models.
- **High speed**: Uses fast-apply models for rapid code merging
- **Low token cost**: Avoids full file regeneration
- **Deterministic**: Temperature 0 ensures consistent results
- **Retry support**: Automatic exponential backoff for rate limits
- **Direct file write**: Writes merged code directly to target file with hash-verified scope matching
- **Atomic operations**: Uses file mutation queue for safe concurrent access
- **Cross-platform support**: Works on Windows, macOS, and Linux
- **Configurable**: Timeout, max lines, and other parameters configurable via environment variables
- **Logging**: Built-in logging for debugging and monitoring

## Prerequisites

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

# Optional: Maximum number of lines allowed for input files (default: 500)
# FAST_APPLY_MAX_LINES=500

# Optional: Request timeout in milliseconds (default: 60000)
# FAST_APPLY_TIMEOUT=60000
```

**Note**: The `.env` file is not included in the repository. A template file `.env.example` is provided for reference.


## Usage

### Using the Tool

```typescript
fast-apply-merge({
  original_code: "// original code here",
  update_snippet: "// changes to apply",
  file: "/path/to/target/file.py",
  anchor: "Exact text to match in the file",
  endpoint_url: "https://api.fireworks.ai/inference/v1", // optional
  model_name: "fast-apply-7b" // optional
})
```

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `original_code` | String | Yes | The complete original source code |
| `update_snippet` | String | Yes | The code changes to apply |
| `file` | String | **Yes** | **Path to the file to edit (relative or absolute)** |
| `anchor` | String | **Yes** | **Exact text in the file for scope matching (must appear exactly once)** |
| `endpoint_url` | String | Optional | The base URL of the OpenAI-compatible endpoint |
| `model_name` | String | Optional | Model name to use (defaults to `fast-apply-7b`) |

### Using the Skill

```bash
/skill:pi-fa-merge
```

## Example

### Basic File Edit

```python
# Original code in file
original = """
def calculate_total(price, tax):
    return price * (1 + tax)
"""

# Update snippet
update = """
def get_version():
    return "1.0.0"
"""

# Result - file is directly updated
result = fast-apply-merge({
    "original_code": original,
    "update_snippet": update,
    "file": "/path/to/calculator.py",
    "anchor": "def calculate_total"
})

# Output:
# {
#   "success": true,
#   "updated_code": "def calculate_total(price, tax):\n    return price * (1 + tax)\n\ndef get_version():\n    return \"1.0.0\""
# }
```

### Complete File Replacement

```python
# Replace entire file content
result = fast-apply-merge({
    "original_code": entire_file_content,
    "update_snippet": new_functionality,
    "file": "/path/to/file.py",
    "anchor": entire_file_content  # Use full content as anchor for complete replacement
})
```

## Error Types

| Error | Description |
|-------|-------------|
| `VALIDATION_ERROR` | Input validation failed (empty or invalid parameters, file too large) |
| `PROVIDER_AUTH_FAILED` | API authentication failed or API key not configured |
| `TIMEOUT` | Request timed out waiting for response (default: 60 seconds) |
| `MALFORMED_OUTPUT` | Model output couldn't be parsed or missing required tags |
| `CONTEXT_EXCEEDED` | Input exceeds maximum context length (8192 estimated tokens) |
| `FILE_TOO_LARGE` | Input file exceeds maximum line count (default: 500 lines) |
| `STRUCTURE_MANGLE_ERROR` | Merged code lost critical structure from original code (possible prompt injection) |
| **`ANCHOREDIT_NO_MATCH`** | **Anchor was not found in the file** |
| **`ANCHOREDIT_MULTIPLE`** | **Anchor matched more than once in the file** |
| **`ANCHOREDIT_HASH_MISMATCH`** | **Hash mismatch detected (file changed externally)** |
| **`ANCHOREDIT_ERROR`** | **Other AnchorEdit binary errors** |
| `API_ERROR` | General API error (non-authentication, non-timeout) |
| `EXECUTION_ERROR` | Unexpected error during tool execution |
| `UNKNOWN_ERROR` | Error with unknown cause |

**Note**: The `details` field in error responses contains specific information about what validation failed (e.g., "Prefix was lost", "Function X was lost", "File too large").

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
- Linting

## License

MIT
