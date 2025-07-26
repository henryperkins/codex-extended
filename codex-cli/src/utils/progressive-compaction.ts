import type { AppConfig } from "./config.js";
import type { ResponseItem } from "openai/resources/responses/responses.mjs";

import { log } from "./logger/log.js";
import { openAiModelInfo } from "./model-info.js";
import { createOpenAIClient } from "./openai-client.js";
import { countTokensUsed } from "./token-counter.js";

/**
 * Compaction levels with increasing aggressiveness
 */
export enum CompactionLevel {
  NONE = 0,
  LIGHT = 1, // Keep recent messages, summarize older ones
  MEDIUM = 2, // More aggressive summarization, drop tool outputs
  HEAVY = 3, // Keep only essential context
  CRITICAL = 4, // Emergency compaction, bare minimum
}

/**
 * Determine the appropriate compaction level based on context usage
 */
export function getCompactionLevel(
  contextUsagePercent: number,
): CompactionLevel {
  if (contextUsagePercent < 70) {
    return CompactionLevel.NONE;
  }
  if (contextUsagePercent < 80) {
    return CompactionLevel.LIGHT;
  }
  if (contextUsagePercent < 90) {
    return CompactionLevel.MEDIUM;
  }
  if (contextUsagePercent < 95) {
    return CompactionLevel.HEAVY;
  }
  return CompactionLevel.CRITICAL;
}

/**
 * Configuration for progressive compaction
 */
export interface CompactionConfig {
  level: CompactionLevel;
  keepRecentMessages: number;
  summarizeOlderThan: number; // messages older than this index
  dropToolOutputs: boolean;
  dropSystemMessages: boolean;
  aggressiveSummarization: boolean;
}

/**
 * Get compaction configuration based on level
 */
export function getCompactionConfig(level: CompactionLevel): CompactionConfig {
  switch (level) {
    case CompactionLevel.LIGHT:
      return {
        level,
        keepRecentMessages: 10,
        summarizeOlderThan: 20,
        dropToolOutputs: false,
        dropSystemMessages: false,
        aggressiveSummarization: false,
      };

    case CompactionLevel.MEDIUM:
      return {
        level,
        keepRecentMessages: 6,
        summarizeOlderThan: 10,
        dropToolOutputs: true,
        dropSystemMessages: false,
        aggressiveSummarization: true,
      };

    case CompactionLevel.HEAVY:
      return {
        level,
        keepRecentMessages: 4,
        summarizeOlderThan: 6,
        dropToolOutputs: true,
        dropSystemMessages: true,
        aggressiveSummarization: true,
      };

    case CompactionLevel.CRITICAL:
      return {
        level,
        keepRecentMessages: 2,
        summarizeOlderThan: 3,
        dropToolOutputs: true,
        dropSystemMessages: true,
        aggressiveSummarization: true,
      };

    default:
      return {
        level: CompactionLevel.NONE,
        keepRecentMessages: Number.MAX_SAFE_INTEGER,
        summarizeOlderThan: Number.MAX_SAFE_INTEGER,
        dropToolOutputs: false,
        dropSystemMessages: false,
        aggressiveSummarization: false,
      };
  }
}

/**
 * Filter and prepare items for compaction
 */
export function prepareItemsForCompaction(
  items: Array<ResponseItem>,
  config: CompactionConfig,
): {
  toSummarize: Array<ResponseItem>;
  toKeep: Array<ResponseItem>;
  toDropInfo: Array<string>;
} {
  const messageItems = items.filter((item) => item.type === "message");
  const toolCalls = items.filter((item) => item.type === "function_call");

  // Keep recent messages
  const recentMessages = messageItems.slice(-config.keepRecentMessages);
  const olderMessages = messageItems.slice(0, -config.keepRecentMessages);

  // Items to summarize
  const toSummarize: Array<ResponseItem> = [];
  let toKeep: Array<ResponseItem> = [...recentMessages];
  const toDropInfo: Array<string> = [];

  // Process older messages
  olderMessages.forEach((item, index) => {
    if (index < messageItems.length - config.summarizeOlderThan) {
      toSummarize.push(item);
    } else {
      toKeep.unshift(item);
    }
  });

  // Handle tool outputs based on config
  if (!config.dropToolOutputs) {
    // Keep recent tool calls with recent messages
    const recentToolCalls = toolCalls.slice(
      -Math.floor(config.keepRecentMessages / 2),
    );
    toKeep.push(...recentToolCalls);
  } else {
    toDropInfo.push(`Dropped ${toolCalls.length} tool call outputs`);
  }

  // Drop system messages if configured
  if (config.dropSystemMessages) {
    const systemCount = toKeep.filter(
      (item) => item.type === "message" && item.role === "system",
    ).length;
    toKeep = toKeep.filter(
      (item) => !(item.type === "message" && item.role === "system"),
    );
    if (systemCount > 0) {
      toDropInfo.push(`Dropped ${systemCount} system messages`);
    }
  }

  return { toSummarize, toKeep, toDropInfo };
}

/**
 * Generate a progressive summary based on compaction level
 */
export async function generateProgressiveSummary(
  items: Array<ResponseItem>,
  model: string,
  config: AppConfig,
  compactionConfig: CompactionConfig,
): Promise<string> {
  const oai = createOpenAIClient(config);

  // Convert items to text for summarization
  const conversationText = items
    .filter(
      (
        item,
      ): item is ResponseItem & { content: Array<unknown>; role: string } =>
        item.type === "message" && Array.isArray(item.content),
    )
    .map((item) => {
      const text = item.content
        .filter(
          (part): part is { text: string } =>
            typeof part === "object" &&
            part != null &&
            "text" in part &&
            typeof (part as { text: unknown }).text === "string",
        )
        .map((part) => part.text)
        .join("");
      return `${item.role}: ${text}`;
    })
    .join("\n");

  // Different prompts based on compaction level
  const summaryPrompt = compactionConfig.aggressiveSummarization
    ? "Create an extremely concise summary focusing ONLY on: current task status, critical code changes, and immediate next steps. Maximum 5 sentences."
    : "Create a concise summary covering: tasks completed, code modifications, key decisions, and next steps. Be thorough but concise.";

  const response = await oai.chat.completions.create({
    model,
    messages: [
      {
        role: "system",
        content: `You are summarizing a coding conversation. Compaction level: ${CompactionLevel[compactionConfig.level]}. ${summaryPrompt}`,
      },
      {
        role: "user",
        content: conversationText,
      },
    ],
    max_tokens: compactionConfig.aggressiveSummarization ? 200 : 500,
    temperature: 0.3,
  });

  return response.choices[0]?.message.content ?? "Unable to generate summary.";
}

/**
 * Perform progressive compaction on conversation items
 */
export async function performProgressiveCompaction(
  items: Array<ResponseItem>,
  model: string,
  config: AppConfig,
  contextUsagePercent: number,
  maxTokens: number,
): Promise<{
  compactedItems: Array<ResponseItem>;
  level: CompactionLevel;
  tokensFreed: number;
}> {
  const originalTokens = countTokensUsed(items, model);
  const level = getCompactionLevel(contextUsagePercent);

  log(
    `Progressive compaction: Level ${CompactionLevel[level]} at ${contextUsagePercent.toFixed(1)}% usage`,
  );

  if (level === CompactionLevel.NONE) {
    return { compactedItems: items, level, tokensFreed: 0 };
  }

  const compactionConfig = getCompactionConfig(level);
  const { toSummarize, toKeep, toDropInfo } = prepareItemsForCompaction(
    items,
    compactionConfig,
  );

  // Generate summary if there are items to summarize
  let summary = "";
  if (toSummarize.length > 0) {
    summary = await generateProgressiveSummary(
      toSummarize,
      model,
      config,
      compactionConfig,
    );
  }

  // Build compacted items
  const compactedItems: Array<ResponseItem> = [];

  // Add summary as first item
  if (summary) {
    const levelIndicator = level >= CompactionLevel.HEAVY ? "⚠️" : "📝";
    const dropInfo =
      toDropInfo.length > 0 ? `\n\n_${toDropInfo.join(", ")}_` : "";

    compactedItems.push({
      id: `progressive-compact-${Date.now()}`,
      type: "message",
      role: "assistant",
      content: [
        {
          type: "output_text",
          text: `${levelIndicator} **[Level ${CompactionLevel[level]} Compaction]**\n\n${summary}${dropInfo}`,
        },
      ],
    } as ResponseItem);
  }

  // Add kept items
  compactedItems.push(...toKeep);

  // Calculate tokens freed
  const newTokens = countTokensUsed(compactedItems, model);
  const tokensFreed = originalTokens - newTokens;

  log(
    `Compaction complete: ${originalTokens} → ${newTokens} tokens (freed ${tokensFreed})`,
  );

  // If still over threshold after compaction, try next level
  const newUsagePercent = (newTokens / maxTokens) * 100;
  if (newUsagePercent > 90 && level < CompactionLevel.CRITICAL) {
    log("Still over threshold, attempting higher compaction level");
    return performProgressiveCompaction(
      compactedItems,
      model,
      config,
      newUsagePercent,
      maxTokens,
    );
  }

  return { compactedItems, level, tokensFreed };
}

/**
 * Estimate tokens that would be freed by compaction
 */
export function estimateCompactionSavings(
  items: Array<ResponseItem>,
  model: string,
  level: CompactionLevel,
): number {
  const config = getCompactionConfig(level);
  const { toKeep } = prepareItemsForCompaction(items, config);

  const originalTokens = countTokensUsed(items, model);
  const keptTokens = countTokensUsed(toKeep, model);
  const summaryTokens = config.aggressiveSummarization ? 200 : 500; // Estimate

  return Math.max(0, originalTokens - keptTokens - summaryTokens);
}

/**
 * Get the maximum token limit for a model
 */
export function getModelMaxTokens(model: string): number {
  // Check if model exists in our info
  const modelInfo = openAiModelInfo[model as keyof typeof openAiModelInfo];
  if (modelInfo) {
    return modelInfo.maxContextLength;
  }

  // Default fallbacks based on common patterns
  if (model.includes("gpt-4")) {
    return model.includes("turbo") ? 128000 : 8192;
  }
  if (model.includes("o1") || model.includes("o3")) {
    return 128000;
  }
  if (model.includes("gpt-3.5")) {
    return 4096;
  }

  // Conservative default
  return 8192;
}
