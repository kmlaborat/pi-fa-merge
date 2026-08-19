---
name: pi-fa-merge
description: Fast-apply merge tool for AI coding agents, based on the kortix-ai/fast-apply specification. Transforms source code based on natural language instructions using OpenAI-compatible endpoints. Use when you need to efficiently transform code by describing changes in natural language.
---

# pi-fa-merge: Fast-Apply Merge Skill

## Overview

pi-fa-merge provides a high-speed, low-cost code transformation capability for AI coding agents. It transforms source code based on natural language instructions using fast-apply models, and writes the transformed result directly to a target file using hash-verified scope matching. This avoids full file regeneration and provides atomic, safe file updates.

This skill implements the [**kortix-ai/fast-apply**](https://github.com/kortix-ai/fast-apply) specification developed by [Kortix](https://kortix.ai), which defines the tag-based prompt format (`<code>`, `<update>`, `<updated-code>`) and dedicated model interfaces for efficient code transformation.

## Prerequisites

- [pi-anchoredit](https://github.com/kmlaborat/pi-anchoredit) - Required for file write operations
- `anchoredit` binary must be accessible in PATH or configured via `ANCHOREDIT_BIN` environment variable

## Setup

No additional setup required. The skill is automatically loaded when the pi-fa-merge package is installed.

### Environment Variables

Set the following environment variables:

```bash
# Required: API key for authentication
export FAST_APPLY_API_KEY="your-api-key"

# Optional: Base URL of the OpenAI-compatible endpoint
export FAST_APPLY_ENDPOINT_URL="https://api.fireworks.ai/inference/v1"

# Optional: Model name to use
export FAST_APPLY_MODEL_NAME="fast-apply-7b"

# Optional: Path to the anchoredit binary
export ANCHOREDIT_BIN="anchoredit"

# Optional: Maximum number of lines allowed for source (default: 500)
# export FAST_APPLY_MAX_LINES=500

# Optional: Request timeout in milliseconds (default: 60000)
# export FAST_APPLY_TIMEOUT=60000
```

## Usage

### Using the Fast-Apply Merge Tool

The package provides a `fa_merge` tool that can be called directly:

```
fa_merge({
  file: "/path/to/target/file.py",
  source: "def hello():\n    return 'world'",
  instruction: "Change the return value to 'universe'",
  endpoint_url: "https://api.fireworks.ai/inference/v1",  // optional
  model_name: "fast-apply-7b"  // optional
})
```

### Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `file` | **Yes** | **Path to the file to edit (relative or absolute)** |
| `source` | **Yes** | **Current content to transform (must be exact)** |
| `instruction` | **Yes** | **Natural language description of the desired change** |
| `anchor` | No | Exact text to match in the file (defaults to source) |
| `endpoint_url` | No | Base URL of the OpenAI-compatible endpoint |
| `model_name` | No | Model name to use (defaults to `fast-apply-7b`) |

### Response Format

On success (file updated):

```json
{
  "success": true,
  "updated_code": "def hello():\n    return 'universe'"
}
```

On error:

```json
{
  "success": false,
  "error": "ERROR_TYPE",
  "details": "Error description"
}
```

## Example

### Basic File Edit

```python
# Source code to transform (exact content from the file)
source = """
class Calculator:
    def add(self, a, b):
        return a + b
"""

# Natural language instruction
instruction = "Add a subtract method that returns a - b"

# Call fa_merge - file is directly updated
result = fa_merge({
    "file": "/path/to/calculator.py",
    "source": source,
    "instruction": instruction
})
```

### Complete File Replacement

For complete file replacement, use the entire file content as the source:

```python
result = fa_merge({
    "file": "/path/to/file.py",
    "source": entire_file_content,
    "instruction": "Rewrite the entire file to implement new functionality"
})
```

## Endpoints

### OpenAI-Compatible Endpoints

This tool works with **any OpenAI-compatible API server** hosting fast-apply models. The default configuration points to Fireworks:

- **Default endpoint**: `https://api.fireworks.ai/inference/v1`
- **Default model**: `fast-apply-7b`

You can override these by setting environment variables or passing parameters directly.

## Features

- **Deterministic output**: Temperature fixed at 0 for consistent results
- **Automatic retry**: Exponential backoff with max 3 retries for rate limits
- **Clean extraction**: Automatically strips XML tags and markdown formatting
- **Error handling**: Comprehensive error reporting with specific error types
- **Portable**: Works with any OpenAI-compatible endpoint
- **Direct file write**: Writes transformed code directly to target file
- **Hash-verified scope matching**: Ensures exact location matching before write
- **Atomic operations**: Uses file mutation queue for safe concurrent access
- **Cross-platform support**: Works on Windows, macOS, and Linux
- **Configurable**: Timeout, max lines, and other parameters configurable via environment variables
- **Logging**: Built-in logging for debugging and monitoring

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