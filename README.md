# pi-fa-merge

Fast-apply merge tool for AI coding agents. Merges partial code diffs into original source code at high speed with low token cost.

## Features

- **High speed**: Uses fast-apply models for rapid code merging
- **Low token cost**: Avoids full file regeneration
- **Deterministic**: Temperature 0 ensures consistent results
- **Retry support**: Automatic exponential backoff for rate limits
- **Multiple providers**: Supports both Morph and Fireworks APIs

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

### API Keys

Set the appropriate environment variable:

```bash
# For Morph (default)
export MORPH_API_KEY="your-key-here"

# For Fireworks
export FIREWORKS_API_KEY="your-key-here"
```

## Usage

### Using the Tool

```typescript
fast-apply-merge({
  original_code: "// original code here",
  update_snippet: "// changes to apply",
  provider: "morph", // or "fireworks"
  model_name: "Kortix/FastApply-7B-v1.0" // for fireworks
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

## Development

```bash
# Install dependencies
npm install

# Test locally
pi -e ./extensions/index.ts
```

## License

MIT
