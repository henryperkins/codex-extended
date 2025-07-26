# Support for O3 and GPT-4.1 Models

## Overview

The codex-cli fully supports OpenAI's latest models including the O3 series and GPT-4.1 family. This document outlines the implementation details and capabilities.

## Supported Models

### O3 Series
- **o3** - 200k context window
- **o3-2025-04-16** - 200k context window  
- **o3-mini** - 200k context window
- **o3-mini-2025-01-31** - 200k context window

### GPT-4.1 Family
- **gpt-4.1** - 1M context window
- **gpt-4.1-mini** - 1M context window
- **gpt-4.1-nano** - 1M context window
- **gpt-4.1-2025-04-14** - 1M context window
- **gpt-4.1-mini-2025-04-14** - 1M context window
- **gpt-4.1-nano-2025-04-14** - 1M context window

## Token Counting

### Implementation
We use the `gpt-tokenizer` npm package (v3.0.1) which explicitly supports:
- O-series models (o1, o3, o4) using o200k_base encoding
- GPT-4.1 models using o200k_base encoding
- All modern OpenAI models

### Accuracy
- Exact BPE tokenization matching OpenAI's official tokenizer
- Proper handling of chat messages with role overhead
- Function call token counting with appropriate overhead

## Context Management

### Auto-Compaction
Auto-compaction works seamlessly with the new models:
- **O3 models**: Triggers at 180k tokens used (90% of 200k)
- **GPT-4.1 models**: Triggers at 900k tokens used (90% of 1M)

### Benefits of Large Context Windows
- GPT-4.1's 1M token context allows for extremely long conversations
- O3's 200k context is suitable for most use cases with good performance
- Auto-compaction may rarely trigger with GPT-4.1 models due to the massive context

## Usage Examples

```typescript
// Token counting works automatically
const tokens = countTokensUsed(messages, "gpt-4.1");
const tokensO3 = countTokensUsed(messages, "o3");

// Context limits are properly detected
maxTokensForModel("gpt-4.1"); // Returns 1000000
maxTokensForModel("o3"); // Returns 200000

// Auto-compaction thresholds adjust automatically
// For gpt-4.1: triggers at <100k tokens remaining
// For o3: triggers at <20k tokens remaining
```

## Technical Details

### Model Detection
The token counter maps model names intelligently:
```typescript
if (modelLower.includes("o3")) {
  gptModel = "o3";
} else if (modelLower.includes("gpt-4.1")) {
  gptModel = "gpt-4.1";
}
```

### Encoding
All these models use the modern `o200k_base` encoding by default in gpt-tokenizer, ensuring accurate token counts.

## Recommendations

1. **For most users**: O3 models provide excellent balance of capability and context
2. **For long documents**: GPT-4.1 models with 1M context are ideal
3. **For cost optimization**: GPT-4.1-nano offers massive context at lower cost

## Testing

Comprehensive tests verify:
- Token counting accuracy for all model variants
- Context limit detection
- Auto-compaction triggers
- Token statistics calculation

Run tests with: `npm test -- tests/new-models-support.test.ts`