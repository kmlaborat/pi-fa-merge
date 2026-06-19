---
name: pi-fa-merge
description: Fast-apply merge tool for AI coding agents. Merges partial code diffs (update_snippets) into original source code using Morph or Fireworks fast-apply models. Use when you need to efficiently merge code changes without regenerating entire files, reducing token consumption and response time.
---

# pi-fa-merge: Fast-Apply Merge Skill

## Overview

pi-fa-merge provides a high-speed, low-cost code merge capability for AI coding agents. It merges update snippets into original source code using fast-apply models, avoiding full file regeneration.

## Setup

No additional setup required. The skill is automatically loaded when the pi-fa-merge package is installed.

### API Keys

Set the appropriate environment variable for your chosen provider:

```bash
# For Morph provider (default)
export MORPH_API_KEY="your-morph-api-key"

# For Fireworks provider
export FIREWORKS_API_KEY="your-fireworks-api-key"
```

## Usage

### Using the Fast-Apply Merge Tool

The package provides a `fast-apply-merge` tool that can be called directly:

```
fast-apply-merge({
  original_code: "def hello():\n    return 'world'",
  update_snippet: "def hello():\n    return 'universe'",
  provider: "morph",  // or "fireworks"
  model_name: "Kortix/FastApply-7B-v1.0"  // required for fireworks
})
```

### Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `original_code` | Yes | The complete original source code |
| `update_snippet` | Yes | The code changes to apply |
| `provider` | No | API provider: "morph" (default) or "fireworks" |
| `model_name` | No | Model name (required for fireworks) |

### Response Format

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

```python
# Original code
original = """
class Calculator:
    def add(self, a, b):
        return a + b
"""

# Update snippet (adding new method)
update = """
    def subtract(self, a, b):
        return a - b
"""

# Call fast-apply-merge
result = fast-apply-merge({
    "original_code": original,
    "update_snippet": update,
    "provider": "morph"
})
```

## Providers

### Morph (Default)
- Uses Morph API at `api.morph.run`
- Default model: `morph-large-latest`
- Requires `MORPH_API_KEY` environment variable

### Fireworks
- Uses Fireworks API at `api.fireworks.ai`
- Default model: `Kortix/FastApply-7B-v1.0`
- Requires `FIREWORKS_API_KEY` environment variable

## Features

- **Deterministic output**: Temperature fixed at 0 for consistent results
- **Automatic retry**: Exponential backoff with max 3 retries for rate limits
- **Clean extraction**: Automatically strips XML tags and markdown formatting
- **Error handling**: Comprehensive error reporting with specific error types

## Error Types

| Error | Description |
|-------|-------------|
| `VALIDATION_ERROR` | Input validation failed |
| `PROVIDER_AUTH_FAILED` | API authentication failed |
| `TIMEOUT` | Request timed out |
| `MALFORMED_OUTPUT` | Model output couldn't be parsed |
| `API_ERROR` | General API error |
| `UNKNOWN_ERROR` | Unexpected error |
