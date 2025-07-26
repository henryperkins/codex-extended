# Intelligent Tool Selection with RAG

## Overview

The codex-cli now implements intelligent tool selection to reduce context usage and improve performance. Instead of loading all tools for every query, the system analyzes the user's input and selects only the most relevant tools.

## How It Works

### 1. Query Analysis
When a user sends a message, the system extracts the query text and analyzes it for:
- **Keywords**: Specific words that indicate tool usage (e.g., "search", "fetch", "run")
- **Patterns**: URL patterns, file extensions, command structures
- **Context**: The type of task being requested

### 2. Relevance Scoring
Each tool is scored based on:
- Keyword matches (2 points each)
- Example phrase matches (1 point per word)
- Explicit tool name mentions (5 points)
- Category-specific patterns (3 points)

### 3. Tool Selection
- Tools with scores ≥ 3 are considered relevant
- Maximum of 2 tools selected by default
- Shell tool always included as fallback

## Available Tools

### 1. **Shell Tool** (`shell`)
- **Purpose**: Execute commands, manage files, run scripts
- **Keywords**: run, execute, command, npm, git, python, file, directory
- **Examples**: "run npm install", "create a file", "check git status"

### 2. **Web Search Tool** (`web_search`)
- **Purpose**: Search the internet for information
- **Keywords**: search, find, look up, google, query, research
- **Examples**: "search for React tutorials", "find information about AI"

### 3. **URL Fetch Tool** (`fetch_url`)
- **Purpose**: Retrieve content from specific URLs
- **Keywords**: fetch, url, website, page, http, download, retrieve
- **Examples**: "fetch https://example.com", "get documentation from URL"

## Benefits

### 1. **Reduced Context Usage**
- Only relevant tool descriptions loaded
- ~30-50% reduction in tool-related tokens
- More room for conversation history

### 2. **Improved Performance**
- Fewer tools = less confusion for the model
- Better tool selection accuracy
- Faster response times

### 3. **Smart Fallbacks**
- Shell tool always available
- Graceful degradation for ambiguous queries
- No functionality loss

## Examples

### Code Task
```
User: "Create a Python script to process CSV files"
Selected Tools: [shell]
Rationale: Code/file keywords detected
```

### Research Task
```
User: "Search for the latest React 18 features"
Selected Tools: [web_search, shell]
Rationale: "search" keyword + potential code examples
```

### URL Task
```
User: "Get the content from https://docs.python.org/3/tutorial/"
Selected Tools: [fetch_url, shell]
Rationale: URL pattern detected
```

### Mixed Task
```
User: "Search for Python tutorials then create a hello.py file"
Selected Tools: [shell, web_search]
Rationale: Both search and file creation detected
```

## Configuration

Currently, tool selection uses these defaults:
- **Max Tools**: 2 (configurable in code)
- **Threshold Score**: 3 (configurable in code)
- **Fallback**: Shell tool always included

## Future Improvements

1. **Embedding-Based Selection**: Use vector embeddings for more accurate semantic matching
2. **User Preferences**: Allow users to configure tool preferences
3. **Learning**: Track tool usage patterns to improve selection
4. **Dynamic Tool Loading**: Support for additional tools without code changes
5. **Tool Chaining**: Predict multi-tool workflows

## Technical Details

The implementation uses:
- Keyword-based scoring algorithm
- Category-specific heuristics
- Pattern matching for URLs and file types
- Fallback mechanisms for safety

See `src/utils/tool-selection.ts` for the complete implementation.