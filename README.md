# pi-fa-merge

Fast-apply merge tool for AI coding agents, based on the [**kortix-ai/fast-apply**](https://github.com/kortix-ai/fast-apply) specification developed by [Kortix](https://kortix.ai). Merges partial code diffs into original source code at high speed with low token cost.

This tool supports **any OpenAI-compatible endpoint** serving fast-apply models, making it portable across different hosting environments.

## Features

- **fast-apply compliant**: Optimized for the `kortix-ai/fast-apply` prompt format and dedicated models, maximizing LLM performance.
- **OpenAI-compatible**: Connects to any OpenAI-compatible API endpoint serving fast-apply models.
- **High speed**: Uses fast-apply models for rapid code merging
- **Low token cost**: Avoids full file regeneration
- **Deterministic**: Temperature 0 ensures consistent results
- **Retry support**: Automatic exponential backoff for rate limits

## Installation

### From npm

```bash
pi install npm:pi-fa-merge
```

### From git

```bash
pi install git:github.com/user/pi-fa-merge@v1.0.0
```

### Local development

```bash
pi install /path/to/pi-fa-merge
```

## Configuration

### Environment Variables

Set the following environment variables:

```bash
# Required: API key for authentication
export FAST_APPLY_API_KEY="your-api-key"

# Optional: Base URL of the OpenAI-compatible endpoint
export FAST_APPLY_ENDPOINT_URL="https://api.fireworks.ai/inference/v1"

# Optional: Model name to use
export FAST_APPLY_MODEL_NAME="fast-apply-7b"
```

## Usage

### Using the Tool

```typescript
fast-apply-merge({
  original_code: "// original code here",
  update_snippet: "// changes to apply",
  endpoint_url: "https://api.fireworks.ai/inference/v1", // optional
  model_name: "fast-apply-7b" // optional
})
```

### Using the Skill

```bash
/skill:pi-fa-merge
```

## Example

```python
# Original code
original = """
def calculate_total(price, tax):
    return price * (1 + tax)
"""

# Update snippet
update = """
def get_version():
    return "1.0.0"
"""

# Result
result = fast-apply-merge({
    "original_code": original,
    "update_snippet": update
})

# Output:
# {
#   "success": true,
#   "updated_code": "def calculate_total(price, tax):\n    return price * (1 + tax)\n\ndef get_version():\n    return \"1.0.0\""
# }
```

## Error Types

| Error | Description |
|-------|-------------|
| `VALIDATION_ERROR` | Input validation failed (empty or invalid parameters) |
| `PROVIDER_AUTH_FAILED` | API authentication failed or API key not configured |
| `TIMEOUT` | Request timed out waiting for response |
| `MALFORMED_OUTPUT` | Model output couldn't be parsed or missing required tags |
| `CONTEXT_EXCEEDED` | Input exceeds maximum context length (8192 estimated tokens) |
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

## License

MIT
