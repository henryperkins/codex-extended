```typescript
import fetch from "node-fetch";

export async function fetchUrl(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`GET ${url} → ${res.status} ${res.statusText}`);
  }
  return await res.text();
}

// For Azure OpenAI - implement custom web search using external APIs
export async function searchWeb(query: string): Promise<string> {
  // Option 1: Use Brave Search API (recommended for Azure)
  const braveApiKey = process.env.BRAVE_SEARCH_API_KEY;
  if (braveApiKey) {
    return searchWebBrave(query, braveApiKey);
  }

  // Option 2: Use SerpAPI
  const serpApiKey = process.env.SERP_API_KEY;
  if (serpApiKey) {
    return searchWebSerp(query, serpApiKey);
  }

  // Option 3: Use Bing Search API (until August 2025)
  const bingApiKey = process.env.BING_SEARCH_API_KEY;
  if (bingApiKey) {
    return searchWebBing(query, bingApiKey);
  }

  throw new Error(
    "No search API configured. Please set BRAVE_SEARCH_API_KEY, SERP_API_KEY, or BING_SEARCH_API_KEY",
  );
}

async function searchWebBrave(query: string, apiKey: string): Promise<string> {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}`;

  const res = await fetch(url, {
    headers: {
      "X-Subscription-Token": apiKey,
      "Accept": "application/json",
    },
  });

  if (!res.ok) {
    throw new Error(`Brave Search API error: ${res.status}`);
  }

  const data = await res.json();
  let results = `Search results for: "${query}"\n\n`;

  if (data.web?.results) {
    data.web.results.slice(0, 5).forEach((result: any, i: number) => {
      results += `${i + 1}. **${result.title}**\n`;
      results += `   URL: ${result.url}\n`;
      results += `   ${result.description}\n\n`;
    });
  }

  return results || "No results found.";
}

async function searchWebSerp(query: string, apiKey: string): Promise<string> {
  const url = `https://serpapi.com/search.json?q=${encodeURIComponent(query)}&api_key=${apiKey}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`SerpAPI error: ${res.status}`);
  }

  const data = await res.json();
  let results = `Search results for: "${query}"\n\n`;

  if (data.organic_results) {
    data.organic_results.slice(0, 5).forEach((result: any, i: number) => {
      results += `${i + 1}. **${result.title}**\n`;
      results += `   URL: ${result.link}\n`;
      results += `   ${result.snippet}\n\n`;
    });
  }

  return results || "No results found.";
}

async function searchWebBing(query: string, apiKey: string): Promise<string> {
  const endpoint = "https://api.bing.microsoft.com/v7.0/search";
  const url = `${endpoint}?q=${encodeURIComponent(query)}&count=5`;

  const res = await fetch(url, {
    headers: {
      "Ocp-Apim-Subscription-Key": apiKey,
    },
  });

  if (!res.ok) {
    throw new Error(`Bing Search API error: ${res.status}`);
  }

  const data = await res.json();
  let results = `Search results for: "${query}"\n\n`;

  if (data.webPages?.value) {
    data.webPages.value.forEach((result: any, i: number) => {
      results += `${i + 1}. **${result.name}**\n`;
      results += `   URL: ${result.url}\n`;
      results += `   ${result.snippet}\n\n`;
    });
  }

  return results || "No results found.";
}
```

---

### **`agent-loop.ts`** updates

```typescript
// In agent-loop.ts, add these imports
import { fetchUrl, searchWeb } from "../fetch-url.js";

// Add tool definitions after shellFunctionTool
const fetchUrlTool: FunctionTool = {
  type: "function",
  name: "fetch_url",
  description: "Fetches the content of a URL and returns it as text.",
  strict: false,
  parameters: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "The URL to fetch",
      },
    },
    required: ["url"],
    additionalProperties: false,
  },
};

const webSearchTool: FunctionTool = {
  type: "function",
  name: "web_search",
  description: "Searches the web for information and returns relevant results.",
  strict: false,
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "The search query",
      },
    },
    required: ["query"],
    additionalProperties: false,
  },
};

// In the run() method, update the tools array based on provider
const isAzure = this.provider?.toLowerCase() === "azure";

// For Azure, we use function tools since web_search_preview is not supported
const tools: Array<Tool> = isAzure
  ? [shellFunctionTool, fetchUrlTool, webSearchTool]
  : (maybeLocalShell && [localShellTool]) || [
      shellFunctionTool,
      fetchUrlTool,
      webSearchTool,
      // For standard OpenAI, you could also add:
      // { type: "web_search" } // native web search tool
    ];

// In handleFunctionCall method, add these cases:
if (name === "fetch_url") {
  // Check approval for web requests
  if (this.approvalPolicy.mode !== "full-auto") {
    const url = args.url as string;
    console.log(`\n${chalk.yellow("Request to fetch URL:")}`);
    console.log(`URL: ${chalk.cyan(url)}`);

    const approval = await this.getCommandConfirmation(
      ["fetch_url", url],
      undefined,
    );

    if (approval.review !== "yes") {
      outputItem.output = JSON.stringify({
        output: "Request denied by user",
        metadata: { denied: true },
      });
      return [outputItem, ...additionalItems];
    }
  }

  try {
    const url = args.url as string;
    if (!url) {
      outputItem.output = JSON.stringify({
        output: "Error: URL is required",
        metadata: { error: true },
      });
    } else {
      const content = await fetchUrl(url);
      outputItem.output = JSON.stringify({
        output: content.slice(0, 16 * 1024), // Limit to 16KB
        metadata: { ok: true, url },
      });
    }
  } catch (error) {
    outputItem.output = JSON.stringify({
      output: `Error fetching URL: ${error.message}`,
      metadata: { error: true },
    });
  }
}

if (name === "web_search") {
  // Check approval for web searches
  if (this.approvalPolicy.mode !== "full-auto") {
    const query = args.query as string;
    console.log(`\n${chalk.yellow("Request to search web:")}`);
    console.log(`Query: ${chalk.cyan(query)}`);

    const approval = await this.getCommandConfirmation(
      ["web_search", query],
      undefined,
    );

    if (approval.review !== "yes") {
      outputItem.output = JSON.stringify({
        output: "Request denied by user",
        metadata: { denied: true },
      });
      return [outputItem, ...additionalItems];
    }
  }

  try {
    const query = args.query as string;
    if (!query) {
      outputItem.output = JSON.stringify({
        output: "Error: Search query is required",
        metadata: { error: true },
      });
    } else {
      const results = await searchWeb(query);
      outputItem.output = JSON.stringify({
        output: results,
        metadata: { ok: true, query },
      });
    }
  } catch (error) {
    outputItem.output = JSON.stringify({
      output: `Error searching web: ${error.message}`,
      metadata: { error: true },
    });
  }
}
```

---

# Implementing Web Search with Azure OpenAI o3 and Responses API

## Overview

Azure OpenAI's Responses API currently **does not support** the native `web_search_preview` tool that's available in the standard OpenAI API. This guide shows how to implement web search functionality for Codex-CLI when using Azure OpenAI.

## Key Differences: Azure vs Standard OpenAI

| Feature                | Standard OpenAI   | Azure OpenAI               |
| ---------------------- | ----------------- | -------------------------- |
| Native web_search tool | ✅ Supported      | ❌ Not supported           |
| Custom function tools  | ✅ Supported      | ✅ Supported               |
| Responses API          | ✅ Available      | ✅ Available (preview)     |
| Required approach      | Use built-in tool | Implement custom functions |

## Implementation Steps

### 1. Install Dependencies

```bash
cd codex-cli
pnpm add node-fetch
```

### 2. Configure Search API

Choose and configure one of these search providers:

#### Option A: Brave Search (Recommended)

```bash
# Add to ~/.codex.env
BRAVE_SEARCH_API_KEY=your-brave-api-key-here
```

Get API key from: https://brave.com/search/api/

#### Option B: SerpAPI

```bash
# Add to ~/.codex.env
SERP_API_KEY=your-serp-api-key-here
```

Get API key from: https://serpapi.com/

#### Option C: Bing Search (Until August 2025)

```bash
# Add to ~/.codex.env
BING_SEARCH_API_KEY=your-bing-key-here
```

### 3. Update Configuration

In your `~/.codex/config.json`, ensure Azure provider is configured:

```json
{
  "model": "o3",
  "provider": "azure",
  "providers": {
    "azure": {
      "name": "Azure OpenAI",
      "baseURL": "https://YOUR-RESOURCE.openai.azure.com/openai/v1/",
      "envKey": "AZURE_OPENAI_API_KEY"
    }
  }
}
```

### 4. Usage Examples

Once implemented, you can use web search naturally:

```bash
# Search for current information
codex "Search for the latest Next.js 15 features and summarize them"

# Fetch specific URLs
codex "Fetch the React documentation from https://react.dev and explain hooks"

# Research tasks
codex "Research current best practices for TypeScript configuration in 2025"
```

## Azure-Specific Considerations

### API Version

Use the latest preview API version for Azure OpenAI Responses API:

```typescript
api_version: "2025-03-01-preview";
```

### Authentication

Azure supports multiple authentication methods:

1. API Key (simplest)
2. Azure AD with DefaultAzureCredential
3. Managed Identity

### Using o3 Model

When using o3 with Azure OpenAI:

- Supports tool calling within chain-of-thought
- Preserves reasoning tokens across tool calls
- Better performance with integrated tools

### Example Azure OpenAI Client Setup

```typescript
import { AzureOpenAI } from "openai";
import {
  DefaultAzureCredential,
  getBearerTokenProvider,
} from "@azure/identity";

const credential = new DefaultAzureCredential();
const azureADTokenProvider = getBearerTokenProvider(
  credential,
  "https://cognitiveservices.azure.com/.default",
);

const client = new AzureOpenAI({
  azureADTokenProvider,
  apiVersion: "2025-03-01-preview",
  // OR use API key:
  // apiKey: process.env.AZURE_OPENAI_API_KEY,
  // baseURL: "https://YOUR-RESOURCE.openai.azure.com/openai/v1/"
});
```

## Alternative: Use Standard OpenAI API

If you need native web search support, consider using the standard OpenAI API instead of Azure:

```json
{
  "model": "o3",
  "provider": "openai" // Use standard OpenAI instead of Azure
}
```

With standard OpenAI, you can use the native web search tool:

```typescript
const tools: Array<Tool> = [
  { type: "web_search" }, // Native support
  shellFunctionTool,
];
```

## Testing the Implementation

Create a test script to verify everything works:

```typescript
// test-azure-web.ts
import { fetchUrl, searchWeb } from "./src/utils/fetch-url.js";

async function test() {
  console.log("Testing with Azure OpenAI configuration...");

  // Test URL fetching
  try {
    const content = await fetchUrl("https://api.github.com");
    console.log("✅ URL fetch works");
  } catch (e) {
    console.error("❌ URL fetch failed:", e);
  }

  // Test web search
  try {
    const results = await searchWeb("Azure OpenAI o3 model");
    console.log("✅ Web search works");
    console.log("Results preview:", results.slice(0, 200));
  } catch (e) {
    console.error("❌ Web search failed:", e);
  }
}

test();
```

## Benefits of This Approach

1. **Works with Azure OpenAI** - Overcomes the limitation of missing web_search_preview
2. **Provider flexibility** - Choose from multiple search APIs
3. **Same UX** - Model uses tools naturally, just like standard OpenAI
4. **Approval flow** - Integrates with existing Codex approval system
5. **No sandbox flags needed** - Works without special configuration

## Limitations

- Requires external search API subscription
- Not as seamless as native OpenAI web_search tool
- Search quality depends on chosen provider
- Additional API costs for search provider

## Future Considerations

Microsoft may add native web search support to Azure OpenAI Responses API in future updates. Monitor:

- [Azure OpenAI Service updates](https://learn.microsoft.com/en-us/azure/ai-services/openai/whats-new)
- [Azure updates](https://azure.microsoft.com/en-us/updates/)

Until then, this custom implementation provides full web search functionality for Azure OpenAI users.

```typescript
// src/utils/web-search-adapter.ts
// Adapter pattern to handle differences between Azure and standard OpenAI

import { fetchUrl, searchWeb } from "./fetch-url.js";
import type {
  Tool,
  FunctionTool,
} from "openai/resources/responses/responses.mjs";

export interface WebSearchAdapter {
  getTools(): Array<Tool>;
  handleWebSearch(query: string): Promise<string>;
  handleUrlFetch(url: string): Promise<string>;
}

// Azure implementation using custom functions
export class AzureWebSearchAdapter implements WebSearchAdapter {
  private fetchUrlTool: FunctionTool = {
    type: "function",
    name: "fetch_url",
    description: "Fetches the content of a URL and returns it as text.",
    strict: false,
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "The URL to fetch",
        },
      },
      required: ["url"],
      additionalProperties: false,
    },
  };

  private webSearchTool: FunctionTool = {
    type: "function",
    name: "web_search",
    description:
      "Searches the web for information and returns relevant results.",
    strict: false,
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search query",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  };

  getTools(): Array<Tool> {
    return [this.fetchUrlTool, this.webSearchTool];
  }

  async handleWebSearch(query: string): Promise<string> {
    return searchWeb(query);
  }

  async handleUrlFetch(url: string): Promise<string> {
    return fetchUrl(url);
  }
}

// Standard OpenAI implementation using native tools
export class OpenAIWebSearchAdapter implements WebSearchAdapter {
  getTools(): Array<Tool> {
    // Use native web_search tool when available
    return [
      { type: "web_search" as any }, // Native OpenAI tool
      // Still include fetch_url as a custom function
      {
        type: "function",
        name: "fetch_url",
        description: "Fetches the content of a URL and returns it as text.",
        strict: false,
        parameters: {
          type: "object",
          properties: {
            url: {
              type: "string",
              description: "The URL to fetch",
            },
          },
          required: ["url"],
          additionalProperties: false,
        },
      },
    ];
  }

  async handleWebSearch(query: string): Promise<string> {
    // For standard OpenAI, the web_search tool is handled natively
    // This method is only called for custom implementations
    return searchWeb(query);
  }

  async handleUrlFetch(url: string): Promise<string> {
    return fetchUrl(url);
  }
}

// Factory function to get the right adapter
export function createWebSearchAdapter(provider: string): WebSearchAdapter {
  const normalizedProvider = provider?.toLowerCase() || "openai";

  if (normalizedProvider === "azure") {
    return new AzureWebSearchAdapter();
  }

  return new OpenAIWebSearchAdapter();
}

// Usage in agent-loop.ts:
/*
// At the top of the class
private webSearchAdapter: WebSearchAdapter;

// In constructor
this.webSearchAdapter = createWebSearchAdapter(this.provider);

// In run() method
const webTools = this.webSearchAdapter.getTools();
const tools: Array<Tool> = [
  shellFunctionTool,
  ...webTools,
];

// In handleFunctionCall
if (name === "web_search") {
  const query = args.query as string;
  const results = await this.webSearchAdapter.handleWebSearch(query);
  outputItem.output = JSON.stringify({
    output: results,
    metadata: { ok: true, query },
  });
}

if (name === "fetch_url") {
  const url = args.url as string;
  const content = await this.webSearchAdapter.handleUrlFetch(url);
  outputItem.output = JSON.stringify({
    output: content.slice(0, 16 * 1024),
    metadata: { ok: true, url },
  });
}
*/
```

---

# Web Access Tools Instructions

You have access to tools for retrieving information from the web. The available tools depend on the provider:

## Standard OpenAI

When using standard OpenAI, you have access to:

- Native `web_search` tool for searching
- `fetch_url` function for downloading specific URLs

## Azure OpenAI

When using Azure OpenAI, you have access to:

- `web_search` function for searching (custom implementation)
- `fetch_url` function for downloading specific URLs

## Using fetch_url

Downloads the content of any public URL. Use this for:

- Fetching raw files from GitHub: `{"name": "fetch_url", "arguments": {"url": "https://raw.githubusercontent.com/owner/repo/main/file.js"}}`
- Getting API responses: `{"name": "fetch_url", "arguments": {"url": "https://api.example.com/data"}}`
- Downloading web pages: `{"name": "fetch_url", "arguments": {"url": "https://docs.example.com/guide"}}`
- Retrieving patches or diffs: `{"name": "fetch_url", "arguments": {"url": "https://github.com/owner/repo/commit/abc123.patch"}}`

## Using web_search

Searches the web for current information. Use this for:

- Finding recent news or updates: `{"name": "web_search", "arguments": {"query": "latest React 19 features"}}`
- Researching technical topics: `{"name": "web_search", "arguments": {"query": "best practices TypeScript 2025"}}`
- Looking up documentation: `{"name": "web_search", "arguments": {"query": "Azure OpenAI Responses API guide"}}`
- Finding solutions to problems: `{"name": "web_search", "arguments": {"query": "fix npm peer dependency conflicts"}}`

## Best Practices

1. **Always search first** for current information about rapidly changing topics
2. **Use specific queries** to get better search results
3. **Fetch URLs directly** when you know the exact source
4. **Cite sources** when using information from web searches
5. **Handle errors gracefully** - network requests can fail

## Examples

### Research Task

User: "What are the latest features in Next.js 15?"

1. Use web_search: `{"name": "web_search", "arguments": {"query": "Next.js 15 new features changelog"}}`
2. If you find the changelog URL, fetch it: `{"name": "fetch_url", "arguments": {"url": "https://nextjs.org/blog/next-15"}}`

### Code Analysis

User: "Analyze this GitHub repository: https://github.com/example/project"

1. Fetch README: `{"name": "fetch_url", "arguments": {"url": "https://raw.githubusercontent.com/example/project/main/README.md"}}`
2. Fetch package.json: `{"name": "fetch_url", "arguments": {"url": "https://raw.githubusercontent.com/example/project/main/package.json"}}`
3. Search for additional context if needed: `{"name": "web_search", "arguments": {"query": "example/project GitHub issues"}}`

These tools work seamlessly with your other capabilities. Use them whenever you need current information or specific web content.

---

I'll search for information about implementing web search with Azure OpenAI's o3 model and their Responses API.Based on my research, here's what I found about implementing web search with Azure OpenAI's o3 model and the Responses API:

## Key Findings

Azure OpenAI's Responses API currently does **not** support the `web_search_preview` tool, even though the standard OpenAI API does. The error occurs because the web_search_preview tool is not supported in the 2025-03-01-preview version of the Responses API.

Microsoft recommends implementing your own web search grounding layer using external services like SerpAPI, Brave, etc., and injecting results into the prompt sent to Azure OpenAI.

## Updated Implementation for Codex-CLI with Azure OpenAI

Here's how to properly implement web search and URL fetching for Azure OpenAI's o3 model:

### 1. Create the Enhanced Fetch Utility:

### 2. Update agent-loop.ts for Azure OpenAI Compatibility:

### 3. Complete Azure OpenAI Implementation Guide:

### 4. Provider-Aware Implementation:

### 5. Updated System Instructions:

### 6. Summary and Key Takeaways:

## Summary

Based on my research, Azure OpenAI's Responses API currently does not support the native `web_search_preview` tool, unlike the standard OpenAI API. However, I've provided a complete solution that implements web search and URL fetching as custom function tools that work naturally with Azure OpenAI's o3 model.

The key points:

1. **Azure Limitation**: The web_search_preview tool is not supported in the 2025-03-01-preview version of Azure's Responses API

2. **Recommended Solution**: Implement your own web search grounding layer using external services like SerpAPI, Brave, etc., and inject results into the prompt

3. **Benefits**: The implementation I provided:

   - Works without special sandbox flags
   - Integrates naturally with the model's tool usage
   - Maintains the same user experience as native tools
   - Supports multiple search providers

4. **Alternative**: If you need native web search support, you can use the standard OpenAI API instead of Azure OpenAI

This solution gives Codex-CLI the same natural web search capabilities you see in Claude Code, while working within Azure's current limitations.
