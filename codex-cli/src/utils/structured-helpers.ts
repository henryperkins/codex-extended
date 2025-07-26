import type OpenAI from "openai";
import type {
  ChatCompletionCreateParams,
  ChatCompletion,
} from "openai/resources/chat/completions.mjs";

import { fetchUrl, searchWeb } from "./fetch-url.js";

// Token estimation for chunking (roughly 4 chars per token)
const CHARS_PER_TOKEN = 4;
const DEFAULT_CHUNK_SIZE_TOKENS = 6000;

// Content size limits - can be overridden via environment variables
const MAX_RAW_CONTENT_SIZE = parseInt(
  process.env["CODEX_MAX_FETCH_SIZE"] || String(4 * 1024),
); // Default 4KB
const ENABLE_SMART_EXTRACTION = process.env["CODEX_SMART_EXTRACTION"] !== "false"; // Default true

// Model configuration for content processing
export interface ModelConfig {
  provider?: string;
  model?: string;
}

// Get the appropriate model for content extraction based on provider
function getExtractionModel(config?: ModelConfig): string {
  // Check environment variable first
  if (process.env["CODEX_EXTRACTION_MODEL"]) {
    return process.env["CODEX_EXTRACTION_MODEL"];
  }

  // Use provider-specific model naming
  const provider = config?.provider?.toLowerCase();
  const currentModel = config?.model?.toLowerCase();

  if (provider === "azure") {
    // Azure: Use deployment-specific names
    // Check for Azure-specific extraction deployment
    if (process.env["AZURE_EXTRACTION_DEPLOYMENT"]) {
      return process.env["AZURE_EXTRACTION_DEPLOYMENT"];
    }
    
    // Falls back to current model/deployment if it's already a mini/nano variant
    if (currentModel?.includes("mini") || currentModel?.includes("nano")) {
      return config?.model || currentModel;
    }
    
    // Default to the current deployment name (not hardcoded model)
    return config?.model || "gpt-4o-mini";
  }

  // For other providers (OpenAI, etc.)
  if (currentModel?.includes("gpt-4")) {
    return "gpt-3.5-turbo";
  }

  return currentModel || "gpt-3.5-turbo";
}

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
    original_size?: number;
    processed_size?: number;
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
 * Extract the most relevant content based on context or user query
 */
export async function extractRelevantContent(
  content: string,
  openaiClient: OpenAI,
  userQuery?: string,
  maxTokens: number = 800,
  modelConfig?: ModelConfig,
): Promise<string> {
  try {
    // If content is already small, return as-is
    if (content.length < MAX_RAW_CONTENT_SIZE) {
      return content;
    }

    // For very large content, take strategic samples
    const contentLength = content.length;
    const sampleSize = Math.min(12000, contentLength); // Max 12KB for extraction

    // Take beginning, middle, and end samples
    const samples: Array<string> = [];

    // Beginning (usually has important metadata/intro)
    samples.push(content.slice(0, sampleSize / 3));

    // Middle section
    const middleStart = Math.floor((contentLength - sampleSize / 3) / 2);
    samples.push(content.slice(middleStart, middleStart + sampleSize / 3));

    // End section (often has conclusions/summaries)
    samples.push(content.slice(-sampleSize / 3));

    const sampledContent = samples.join("\n\n[...]\n\n");

    const systemPrompt = userQuery
      ? `Extract the most relevant information from this content that relates to: "${userQuery}". Focus on key facts, data, and insights.`
      : "Extract the most important and relevant information from this content. Focus on main topics, key facts, and essential details.";

    const response = await openaiClient.chat.completions.create({
      model: getExtractionModel(modelConfig),
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: `Extract relevant content from:\n\n${sampledContent}`,
        },
      ],
      max_tokens: maxTokens,
      temperature: 0.3,
      stream: false,
    } as ChatCompletionCreateParams);

    const extracted = (response as ChatCompletion).choices[0]?.message?.content;
    return extracted || content.slice(0, MAX_RAW_CONTENT_SIZE);
  } catch (error) {
    // Provide Azure-specific guidance if applicable
    if (modelConfig?.provider === "azure") {
      console.error(
        "Content extraction failed. For Azure OpenAI:\n" +
        "- Ensure your deployment supports the model: " + getExtractionModel(modelConfig) + "\n" +
        "- Set AZURE_EXTRACTION_DEPLOYMENT to specify a valid deployment name\n" +
        "- Check that your Azure OpenAI resource has the required model deployed"
      );
    }
    // Fallback to simple truncation if extraction fails
    return content.slice(0, MAX_RAW_CONTENT_SIZE);
  }
}

/**
 * Generate a synopsis of content using a cheap model
 */
export async function generateSynopsis(
  content: string,
  openaiClient: OpenAI,
  maxTokens: number = 150,
  modelConfig?: ModelConfig,
): Promise<string> {
  try {
    // Only summarize if content is substantial
    if (content.length < 500) {
      return content;
    }

    // Truncate very long content for synopsis generation
    const truncatedContent = content.slice(0, 8000);

    const response = await openaiClient.chat.completions.create({
      model: getExtractionModel(modelConfig),
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
    // Provide Azure-specific guidance if applicable
    if (modelConfig?.provider === "azure") {
      console.error(
        "Synopsis generation failed. For Azure OpenAI:\n" +
        "- Verify your deployment '" + getExtractionModel(modelConfig) + "' is accessible\n" +
        "- Check API key and endpoint configuration\n" +
        "- Ensure the deployment has sufficient quota"
      );
    }
    // Fallback to simple truncation if synopsis generation fails
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
  userQuery?: string,
  modelConfig?: ModelConfig,
): Promise<StructuredFetchResult> {
  try {
    const content = await fetchUrl(url);

    // Extract metadata from content if possible
    const titleMatch = content.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch?.[1]?.trim();

    // Determine content handling strategy
    const estimatedTokens = content.length / CHARS_PER_TOKEN;
    const isLargeContent = content.length > MAX_RAW_CONTENT_SIZE;
    const needsChunking = estimatedTokens > DEFAULT_CHUNK_SIZE_TOKENS;

    let synopsis: string | undefined;
    let chunks: Array<string> | undefined;
    let processedContent: string;

    if (isLargeContent && openaiClient && ENABLE_SMART_EXTRACTION) {
      // For large content, use intelligent extraction
      processedContent = await extractRelevantContent(
        content,
        openaiClient,
        userQuery,
        800,
        modelConfig,
      );

      // Generate synopsis of the extracted content
      if (enableSynopsis) {
        synopsis = await generateSynopsis(
          processedContent,
          openaiClient,
          150,
          modelConfig,
        );
      }
    } else if (isLargeContent) {
      // If smart extraction is disabled or no OpenAI client, just truncate
      processedContent = content.slice(0, MAX_RAW_CONTENT_SIZE);

      if (openaiClient && enableSynopsis) {
        synopsis = await generateSynopsis(
          processedContent,
          openaiClient,
          150,
          modelConfig,
        );
      }
    } else if (needsChunking) {
      // For medium content, provide chunks
      chunks = chunkText(content);
      processedContent = content.slice(0, MAX_RAW_CONTENT_SIZE);

      // Generate synopsis if we have an OpenAI client and it's enabled
      if (openaiClient && enableSynopsis) {
        synopsis = await generateSynopsis(
          content,
          openaiClient,
          150,
          modelConfig,
        );
      }
    } else {
      // Small content - return as-is
      processedContent = content;
    }

    return {
      summary: synopsis,
      chunks: chunks,
      raw: processedContent,
      metadata: {
        ok: true,
        url,
        title: title || undefined,
        chunked: needsChunking,
        total_chunks: chunks?.length,
        content_type: isLargeContent ? "extracted" : "full",
        original_size: content.length,
        processed_size: processedContent.length,
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

  // Key patterns to preserve in tool descriptions
  const keyPatterns = [
    /returns? structured (?:data|results?)/i,
    /with optional synopsis/i,
    /chunking for large/i,
    /URLs?, titles?, and snippets?/i,
    /structured format/i,
    /metadata/i,
  ];

  // Extract key phrases that should be preserved
  const keyPhrases: string[] = [];
  for (const pattern of keyPatterns) {
    const match = description.match(pattern);
    if (match) {
      keyPhrases.push(match[0]);
    }
  }

  // Calculate space needed for key features
  const keyFeaturesText = keyPhrases.length > 0 
    ? ` Key features: ${keyPhrases.join(", ")}.`
    : "";
  const keyFeaturesLength = keyFeaturesText.length;

  // Truncate main description to leave room for key features
  const mainDescMaxLength = maxLength - keyFeaturesLength - 10; // 10 char buffer
  let truncated = description.slice(0, mainDescMaxLength);

  // Try to truncate at a sentence boundary
  const lastPeriod = truncated.lastIndexOf(".");
  const lastComma = truncated.lastIndexOf(",");
  const lastSpace = truncated.lastIndexOf(" ");

  // Prefer sentence boundary, then comma, then space
  if (lastPeriod > mainDescMaxLength * 0.7) {
    truncated = truncated.slice(0, lastPeriod + 1);
  } else if (lastComma > mainDescMaxLength * 0.8) {
    truncated = truncated.slice(0, lastComma) + ".";
  } else if (lastSpace > mainDescMaxLength * 0.9) {
    truncated = truncated.slice(0, lastSpace) + "...";
  } else {
    truncated = truncated + "...";
  }

  // Append key features if we extracted any
  const result = truncated + keyFeaturesText;
  
  // Final safety check
  return result.slice(0, maxLength);
}
