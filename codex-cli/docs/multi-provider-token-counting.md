# Multi-Provider Token Counting Support

## Current Implementation

The token counting and auto-compaction features work with all providers, but with varying levels of accuracy:

### Fully Supported Providers

| Provider | Token Counting | Auto-Compaction | Notes |
|----------|---------------|-----------------|-------|
| OpenAI | ✅ Accurate | ✅ Works | Uses gpt-tokenizer with exact BPE encoding |
| Azure OpenAI | ✅ Accurate | ✅ Works | Same as OpenAI (uses OpenAI models) |

### Partially Supported Providers

| Provider | Token Counting | Auto-Compaction | Notes |
|----------|---------------|-----------------|-------|
| Anthropic (Claude) | ⚠️ Approximate | ✅ Works | Falls back to 4 chars/token |
| Google (Gemini) | ⚠️ Approximate | ✅ Works | Falls back to 4 chars/token |
| Custom Providers | ⚠️ Approximate | ✅ Works | Falls back to 4 chars/token |

## How It Works

### 1. Token Counting Fallback
When using non-OpenAI models, the system:
```typescript
try {
  // Try to use gpt-tokenizer
  const messageTokens = encodeChat(messages, gptModel);
} catch (error) {
  // Fallback for unsupported models
  console.warn(`Failed to encode chat with model ${model}: ${error}`);
  // Use character-based approximation
  totalTokens += countTokensInText(msg.content); // Uses 4 chars/token
}
```

### 2. Context Limit Detection
The system uses smart heuristics:
- Checks model registry first
- Looks for context size in model name (e.g., "claude-3-opus-100k" → 100,000 tokens)
- Defaults to 128k for unknown models

### 3. Auto-Compaction
Works for all providers because it's based on percentage:
- Triggers at 90% usage regardless of provider
- Less accurate for non-OpenAI but still prevents overflow

## Limitations

### Token Count Accuracy
- OpenAI models: ~100% accurate
- Other models: ~70-85% accurate (character-based approximation)

### Why Different?
Each LLM provider uses different tokenization:
- OpenAI: BPE with cl100k_base or o200k_base
- Anthropic: Custom tokenizer (not publicly available)
- Google: SentencePiece tokenizer
- Meta (LLaMA): SentencePiece with different vocabulary

## Improving Support

To add accurate tokenization for other providers:

### 1. Add Provider-Specific Tokenizers
```typescript
// Example: Add Claude tokenizer when available
if (modelLower.includes("claude")) {
  // Use claude-tokenizer library (hypothetical)
  return claudeTokenizer.encode(text).length;
}
```

### 2. Adjust Character Ratios
Different models have different average tokens/character ratios:
- GPT models: ~4 characters/token
- Claude models: ~3.5 characters/token (estimated)
- LLaMA models: ~4.5 characters/token (estimated)

### 3. Configure Model Registry
Add non-OpenAI models to model-info.ts:
```typescript
export const anthropicModelInfo = {
  "claude-3-opus": {
    label: "Claude 3 Opus",
    maxContextLength: 200000,
  },
  // ... more models
};
```

## Best Practices

1. **Monitor Usage**: Keep an eye on context usage indicators
2. **Manual Compaction**: Use `/compact` more frequently with non-OpenAI models
3. **Buffer Space**: Leave extra buffer (e.g., compact at 85% instead of 90%)
4. **Test Your Models**: Verify token counting accuracy for your specific use case

## Future Improvements

1. **Multi-Provider Tokenizer Library**: Create or integrate a library that supports multiple providers
2. **Provider-Specific Ratios**: Fine-tune character/token ratios per provider
3. **Dynamic Detection**: Detect tokenizer type from API responses
4. **User Configuration**: Allow users to configure token ratios in settings