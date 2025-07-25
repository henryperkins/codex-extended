import type { AppConfig } from "./config.js";
import type { ResponseItem } from "openai/resources/responses/responses.mjs";

import { createOpenAIClient } from "./openai-client.js";

/**
 * Generate a condensed summary of the conversation items.
 * @param items The list of conversation items to summarize
 * @param model The model to use for generating the summary
 * @param flexMode Whether to use the flex-mode service tier
 * @param config The configuration object
 * @returns A concise structured summary string
 */
/**
 * Generate a condensed summary of the conversation items.
 * @param items The list of conversation items to summarize
 * @param model The model to use for generating the summary
 * @param flexMode Whether to use the flex-mode service tier
 * @param config The configuration object
 * @returns A concise structured summary string
 */
export async function generateCompactSummary(
  items: Array<ResponseItem>,
  model: string,
  flexMode = false,
  config: AppConfig,
  customInstructions?: string,
): Promise<string> {
  const oai = createOpenAIClient(config);

  const conversationText = items
    .filter(
      (
        item,
      ): item is ResponseItem & { content: Array<unknown>; role: string } =>
        item.type === "message" &&
        (item.role === "user" || item.role === "assistant") &&
        Array.isArray(item.content),
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

  const response = await oai.chat.completions.create({
    model,
    ...(flexMode ? { service_tier: "flex" } : {}),
    messages: [
      {
        role: "assistant",
        content:
          "You are an expert coding assistant. Your goal is to generate a concise, structured summary of the conversation below that captures all essential information needed to continue development after context replacement. Include tasks performed, code areas modified or reviewed, key decisions or assumptions, test results or errors, and outstanding tasks or next steps.",
      },
      {
        role: "user",
        content: customInstructions 
          ? `Here is the conversation so far:\n${conversationText}\n\n${customInstructions}`
          : `Here is the conversation so far:\n${conversationText}\n\nPlease summarize this conversation, covering:\n1. Tasks performed and outcomes\n2. Code files, modules, or functions modified or examined\n3. Important decisions or assumptions made\n4. Errors encountered and test or build results\n5. Remaining tasks, open questions, or next steps\nProvide the summary in a clear, concise format.`,
      },
    ],
  });
  return response.choices[0]?.message.content ?? "Unable to generate summary.";
}
