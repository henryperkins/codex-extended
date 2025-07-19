# Web Fetch Content Optimization

## Problem

When the model fetches content from search results, large web pages quickly consume context window space, limiting the model's ability to process multiple sources or maintain conversation history.

## Solution

Implemented intelligent content extraction and size management with the following features:

### 1. Smart Content Extraction

- For content larger than the configured limit (default 4KB), the system uses AI to extract the most relevant information
- The extraction considers the user's original query to focus on pertinent content
- Samples are taken from beginning, middle, and end of documents to capture key information

### 2. Content Size Management

- **Small content** (< 4KB): Returned as-is
- **Large content** (> 4KB): Intelligently extracted or truncated
- **Very large content**: Chunked for optional retrieval

### 3. Configuration Options

Environment variables to control behavior:

- `CODEX_MAX_FETCH_SIZE`: Maximum raw content size in bytes (default: 4096)
- `CODEX_SMART_EXTRACTION`: Enable/disable AI extraction (default: true)
- `CODEX_EXTRACTION_MODEL`: Model for content extraction (default: auto-selected based on provider)

### 4. Enhanced Metadata

The fetch_url tool now returns:

- Original content size
- Processed content size
- Content type (full/extracted)
- Synopsis when available

## Usage Example

```bash
# Set custom content limit
export CODEX_MAX_FETCH_SIZE=8192

# Disable smart extraction for faster fetching
export CODEX_SMART_EXTRACTION=false

# Run codex
codex
```

## Benefits

1. **Efficient Context Usage**: Reduces fetched content from 16KB to 4KB by default
2. **Intelligent Extraction**: AI extracts relevant information instead of blind truncation
3. **Query-Aware**: Extraction focuses on content related to the user's search query
4. **Configurable**: Admins can adjust limits based on their needs
5. **Cost Effective**: Automatically selects cheaper models for extraction based on provider
6. **Azure Compatible**: Properly handles Azure OpenAI's model naming conventions (gpt-35-turbo)

## Implementation Details

- Strategic sampling from different document sections
- Fallback to simple truncation if AI extraction fails
- Maintains backward compatibility with existing code
- Clear indication when content has been extracted vs truncated
- Provider-aware model selection:
  - Azure: Uses gpt-4.1-mini for extraction (unless already using mini/nano variant)
  - OpenAI: Uses gpt-3.5-turbo for extraction when main model is gpt-4
  - Falls back to current model for cheaper models
- Compatible with Azure OpenAI Responses API
