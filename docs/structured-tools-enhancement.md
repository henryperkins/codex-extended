# Structured Tools Enhancement for Azure OpenAI

This document outlines the enhancements made to the `fetch_url` and `web_search` tools to provide better structured data and improved compatibility with Azure OpenAI deployments.

## Overview

The enhancements focus on providing structured JSON output instead of plain text, automatic content chunking for large pages, synopsis generation, and Azure-specific optimizations.

## Key Improvements

### 1. Structured JSON Output

#### Before (Plain Text)

```json
{
  "output": "Raw HTML content as string...",
  "metadata": { "ok": true, "url": "https://example.com" }
}
```

#### After (Structured Data)

```json
{
  "summary": "Brief 1-3 sentence summary of the content",
  "chunks": ["First chunk of content...", "Second chunk..."],
  "raw": "Raw content (capped at 16KB)",
  "metadata": {
    "ok": true,
    "url": "https://example.com",
    "title": "Page Title",
    "chunked": true,
    "total_chunks": 3
  }
}
```

### 2. Web Search Results Structure

#### Before (Plain Text)

```
Search results for: "OpenAI"

1. **OpenAI**
   URL: https://openai.com
   OpenAI is an AI research and deployment company...
```

#### After (Structured Array)

```json
{
  "results": [
    {
      "id": "res_0",
      "url": "https://openai.com",
      "title": "OpenAI",
      "snippet": "OpenAI is an AI research and deployment company...",
      "score": 1.0
    }
  ],
  "metadata": {
    "ok": true,
    "query": "OpenAI",
    "total_results": 5
  }
}
```

### 3. Content Chunking

Large pages are automatically chunked into ~6,000 token pieces to prevent context overflow:

- **Automatic Detection**: Pages exceeding 6,000 tokens are automatically chunked
- **Token Estimation**: Uses 4 characters ≈ 1 token heuristic
- **Metadata Tracking**: Includes `chunked` flag and `total_chunks` count

### 4. Synopsis Generation

For large pages, an automatic synopsis is generated using a cheap model (gpt-35-turbo):

- **Conditional**: Only generated for substantial content (>500 chars)
- **Concise**: 1-3 sentence summaries
- **Fallback**: Graceful degradation if synopsis generation fails

### 5. Azure OpenAI Compatibility

#### Description Truncation

Azure OpenAI has a 1,024 character limit on function descriptions. The enhancement automatically truncates descriptions while preserving sentence boundaries:

```typescript
// Before: Long description might cause 400 errors
description: "Very long description that exceeds 1024 characters...";

// After: Automatically truncated for Azure
description: truncateForAzure(longDescription); // ≤ 1024 chars
```

#### Provider Detection

```typescript
const isAzure = this.provider.toLowerCase() === "azure";
```

## Implementation Details

### New Files Added

1. **`src/utils/structured-helpers.ts`** - Core enhancement functions
2. **`docs/structured-tools-enhancement.md`** - This documentation

### Modified Files

1. **`src/utils/agent/agent-loop.ts`** - Updated to use structured outputs

### Key Functions

#### `fetchUrlStructured(url, openaiClient?, enableSynopsis?)`

- Fetches URL with structured output
- Automatic chunking for large content
- Optional synopsis generation
- Rich metadata extraction

#### `searchWebStructured(query)`

- Parses existing search results into structured format
- Assigns unique IDs to results
- Calculates relevance scores
- Extracts query metadata

#### `truncateForAzure(description, maxLength?)`

- Truncates descriptions to Azure's 1,024 character limit
- Preserves sentence boundaries when possible
- Graceful fallback for edge cases

#### `chunkText(text, maxTokens?)`

- Splits text into token-sized chunks
- Configurable chunk size (default 6,000 tokens)
- Simple character-based splitting

#### `generateSynopsis(content, openaiClient, maxTokens?)`

- Generates concise summaries using gpt-35-turbo
- Handles errors gracefully
- Optimized for cost and speed

## Benefits for Azure OpenAI

1. **Compliance**: Automatic description truncation prevents 400 errors
2. **Efficiency**: Chunked content prevents context overflow
3. **Usability**: Structured data is easier for models to process
4. **Performance**: Synopsis allows quick content understanding
5. **Cost**: Reduced token usage through intelligent chunking

## Usage Examples

### Model Reasoning with Structured Data

The model can now easily process search results:

```typescript
// Model can iterate through structured results
for (const result of searchResults.results) {
  console.log(`${result.title}: ${result.snippet}`);
  // Decide which URLs to fetch based on structured data
}
```

### Content Processing

```typescript
// Check if content needs chunking
if (fetchResult.metadata.chunked) {
  // Process summary first
  analyzeContent(fetchResult.summary);

  // Then process chunks as needed
  for (const chunk of fetchResult.chunks) {
    processChunk(chunk);
  }
}
```

## Testing

The implementation includes comprehensive error handling and fallbacks:

- **Network errors**: Graceful degradation with error metadata
- **Synopsis failures**: Falls back to content truncation
- **Chunking edge cases**: Handles empty/small content appropriately
- **Azure compatibility**: Automatic provider detection and adaptation

## Future Enhancements

1. **Caching**: Add LRU cache for frequently accessed URLs
2. **Robots.txt**: Respect robots.txt for ethical web scraping
3. **Content-Type**: Enhanced metadata extraction for different file types
4. **Parallel Processing**: Concurrent synopsis generation and chunking
5. **Advanced Chunking**: Sentence/paragraph boundary awareness

## Configuration

The enhancement works with existing configuration:

```typescript
// Existing usage - no changes needed
const result = await fetchUrlStructured(url, this.oai);
```

All enhancements are backward compatible and require no configuration changes.
