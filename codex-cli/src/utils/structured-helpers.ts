import type OpenAI from "openai";
import type {
  ChatCompletionCreateParams,
  ChatCompletion,
} from "openai/resources/chat/completions.mjs";

import { fetchUrl, searchWeb } from "./fetch-url.js";

// Token estimation for chunking (roughly 4 chars per token)
const CHARS_PER_TOKEN = 4;
const DEFAULT_CHUNK_SIZE_TOKENS = 6000;
const SYNOPSIS_MODEL = "gpt-35-turbo"; // Cheap model for synopsis generation

interface StructuredWebSearchResult {
  id: string;
  url: string;
  title: string;
  snippet: string;
  score?: number;
}

interface StructuredFetchResult {
  summary?: string;
  chunks?: Array<string>;
  raw?: string;
  metadata: {
    ok: boolean;
    url: string;
    title?: string;
    site?: string;
    status_code?: number;
    content_type?: string;
    error?: boolean;
    chunked?: boolean;
    total_chunks?: number;
  };
}

interface StructuredWebSearchOutput {
  results: Array<StructuredWebSearchResult>;
  metadata: {
    ok: boolean;
    query: string;
    total_results?: number;
  };
}

/**
 * Chunks text into approximately N-token pieces
 */
export function chunkText(
  text: string,
  maxTokens: number = DEFAULT_CHUNK_SIZE_TOKENS,
): Array<string> {
  const maxChars = maxTokens * CHARS_PER_TOKEN;
  const chunks: Array<string> = [];

  // Simple chunking by character count
  // TODO: Could be improved to chunk by paragraph/sentence boundaries
  for (let i = 0; i < text.length; i += maxChars) {
    chunks.push(text.slice(i, i + maxChars));
  }

  return chunks;
}

/**
 * Generate a synopsis of content using a cheap model
 */
export async function generateSynopsis(
  content: string,
  openaiClient: OpenAI,
  maxTokens: number = 150,
): Promise<string> {
  try {
    // Only summarize if content is substantial
    if (content.length < 500) {
      return content;
    }

    // Truncate very long content for synopsis generation
    const truncatedContent = content.slice(0, 8000);

    const response = await openaiClient.chat.completions.create({
      model: SYNOPSIS_MODEL,
      messages: [
        {
          role: "system",
          content:
            "You are a helpful assistant that creates concise 1-3 sentence summaries of web content. Focus on the main topic and key information.",
        },
        {
          role: "user",
          content: `Summarize this content in 1-3 sentences:\n\n${truncatedContent}`,
        },
      ],
      max_tokens: maxTokens,
      temperature: 0.3,
      stream: false,
    } as ChatCompletionCreateParams);

    return (
      (response as ChatCompletion).choices[0]?.message?.content ||
      content.slice(0, 200) + "..."
    );
  } catch (error) {
    // Fallback to simple truncation if synopsis generation fails
    // Synopsis generation failed, fall back to truncation
    return content.slice(0, 200) + "...";
  }
}

/**
 * Parse web search results into structured format
 */
export function parseWebSearchResults(
  rawResults: string,
): StructuredWebSearchOutput {
  const results: Array<StructuredWebSearchResult> = [];

  // Parse the text-based search results
  const lines = rawResults.split("\n");
  let currentResult: Partial<StructuredWebSearchResult> | null = null;
  let resultId = 0;

  for (const line of lines) {
    const trimmed = line.trim();

    // Match numbered results (e.g., "1. **Title**")
    const numberMatch = trimmed.match(/^(\d+)\.\s+\*\*(.*?)\*\*$/);
    if (numberMatch) {
      // Save previous result if exists
      if (currentResult && currentResult.title && currentResult.url) {
        results.push({
          id: `res_${resultId++}`,
          title: currentResult.title,
          url: currentResult.url,
          snippet: currentResult.snippet?.trim() || "",
          score: 1 - resultId * 0.1, // Simple scoring based on order
        });
      }

      currentResult = {
        title: numberMatch[2],
      };
    }

    // Match URL line
    else if (trimmed.startsWith("URL:") && currentResult) {
      currentResult.url = trimmed.replace("URL:", "").trim();
    }

    // Everything else is snippet
    else if (trimmed && currentResult && currentResult.title) {
      currentResult.snippet = (currentResult.snippet || "") + " " + trimmed;
    }
  }

  // Don't forget the last result
  if (currentResult && currentResult.title && currentResult.url) {
    results.push({
      id: `res_${resultId}`,
      title: currentResult.title,
      url: currentResult.url,
      snippet: currentResult.snippet?.trim() || "",
      score: 1 - resultId * 0.1,
    });
  }

  // Extract query from the first line
  const queryMatch = rawResults.match(/Search results for:\s*"(.+?)"/);
  const query = queryMatch?.[1] || "";

  return {
    results,
    metadata: {
      ok: results.length > 0,
      query,
      total_results: results.length,
    },
  };
}

/**
 * Enhanced fetch URL with structured output
 */
export async function fetchUrlStructured(
  url: string,
  openaiClient?: OpenAI,
  enableSynopsis: boolean = true,
): Promise<StructuredFetchResult> {
  try {
    const content = await fetchUrl(url);

    // Extract metadata from content if possible
    const titleMatch = content.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch?.[1]?.trim();

    // Determine if we need to chunk
    const estimatedTokens = content.length / CHARS_PER_TOKEN;
    const needsChunking = estimatedTokens > DEFAULT_CHUNK_SIZE_TOKENS;

    let synopsis: string | undefined;
    let chunks: Array<string> | undefined;

    if (needsChunking) {
      chunks = chunkText(content);

      // Generate synopsis if we have an OpenAI client and it's enabled
      if (openaiClient && enableSynopsis) {
        synopsis = await generateSynopsis(content, openaiClient);
      }
    }

    return {
      summary: synopsis,
      chunks: chunks,
      raw: content.slice(0, 16 * 1024), // Cap at 16KB as before
      metadata: {
        ok: true,
        url,
        title: title || undefined,
        chunked: needsChunking,
        total_chunks: chunks?.length,
      },
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error ?? "unknown");
    return {
      raw: `Error fetching URL: ${message}`,
      metadata: {
        ok: false,
        url,
        error: true,
      },
    };
  }
}

/**
 * Enhanced web search with structured output
 */
export async function searchWebStructured(
  query: string,
): Promise<StructuredWebSearchOutput> {
  try {
    const rawResults = await searchWeb(query);
    return parseWebSearchResults(rawResults);
  } catch (error) {
    // Return empty results on error
    return {
      results: [],
      metadata: {
        ok: false,
        query,
      },
    };
  }
}

/**
 * Truncate function descriptions for Azure OpenAI (1024 char limit)
 */
export function truncateForAzure(
  description: string,
  maxLength: number = 1024,
): string {
  if (description.length <= maxLength) {
    return description;
  }

  // Try to truncate at a sentence boundary
  const truncated = description.slice(0, maxLength - 3);
  const lastPeriod = truncated.lastIndexOf(".");

  if (lastPeriod > maxLength * 0.7) {
    return truncated.slice(0, lastPeriod + 1);
  }

  return truncated + "...";
}
