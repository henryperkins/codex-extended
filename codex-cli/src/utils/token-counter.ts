import type { ResponseItem } from "openai/resources/responses/responses.mjs";
import { encode, encodeChat } from "gpt-tokenizer";

// Define ChatMessage type based on gpt-tokenizer expectations
interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}


/**
 * Count tokens in a simple text string
 */
export function countTokensInText(text: string): number {
  try {
    const tokens = encode(text);
    return tokens.length;
  } catch (error) {
    console.warn(`Failed to encode text with gpt-tokenizer: ${error}`);
    // Fallback to character-based approximation
    return Math.ceil(text.length / 4);
  }
}

/**
 * Convert ResponseItem to ChatMessage format for encodeChat
 */
function responseItemToChatMessage(item: ResponseItem): ChatMessage | null {
  if (item.type !== "message") {
    return null;
  }
  
  const messageItem = item as ResponseItem & { 
    role: string; 
    content: Array<{ type: string; text?: string; refusal?: string }> 
  };
  
  // Extract text content from the message
  let text = "";
  for (const c of messageItem.content || []) {
    if (c.type === "input_text" || c.type === "output_text") {
      text += c.text || "";
    } else if (c.type === "refusal") {
      text += c.refusal || "";
    }
  }
  
  // Map roles to ChatMessage format
  const role = messageItem.role === "assistant" ? "assistant" : 
               messageItem.role === "system" ? "system" : "user";
  
  return {
    role,
    content: text,
  };
}

/**
 * Count tokens for function/tool calls
 */
function countFunctionCallTokens(item: ResponseItem): number {
  if (item.type === "function_call") {
    const nameTokens = item.name ? countTokensInText(item.name) : 0;
    const argsTokens = item.arguments ? countTokensInText(item.arguments) : 0;
    // Add overhead for function call structure (approximately 7 tokens)
    return nameTokens + argsTokens + 7;
  }
  
  if (item.type === "function_call_output") {
    return countTokensInText(item.output || "") + 3;
  }
  
  return 0;
}

/**
 * Accurately count tokens used by a list of ResponseItems
 * Uses gpt-tokenizer for precise token counting based on the model
 */
export function countTokensUsed(items: Array<ResponseItem>, model: string): number {
  // Separate messages from function calls
  const messages: ChatMessage[] = [];
  let functionCallTokens = 0;
  
  for (const item of items) {
    const chatMessage = responseItemToChatMessage(item);
    if (chatMessage && chatMessage.content) {
      messages.push(chatMessage);
    } else if (item.type === "function_call" || item.type === "function_call_output") {
      functionCallTokens += countFunctionCallTokens(item);
    }
  }
  
  // Use encodeChat for messages if available
  try {
    if (messages.length > 0) {
      // Map model names to what gpt-tokenizer expects
      let gptModel = model;
      const modelLower = model.toLowerCase();
      
      if (modelLower.includes("o3")) {
        gptModel = "o3";
      } else if (modelLower.includes("gpt-4.1")) {
        gptModel = "gpt-4.1";
      } else if (modelLower.includes("gpt-4o")) {
        gptModel = "gpt-4o";
      } else if (modelLower.includes("gpt-4")) {
        gptModel = "gpt-4";
      } else if (modelLower.includes("gpt-3.5")) {
        gptModel = "gpt-3.5-turbo";
      }
      
      const messageTokens = encodeChat(messages, gptModel as any);
      return messageTokens.length + functionCallTokens;
    }
    return functionCallTokens;
  } catch (error) {
    console.warn(`Failed to encode chat with model ${model}: ${error}`);
    // Fallback to individual message encoding
    let totalTokens = functionCallTokens;
    for (const msg of messages) {
      totalTokens += countTokensInText(msg.content);
      // Add message overhead (role, etc.)
      totalTokens += 4;
    }
    return totalTokens;
  }
}

/**
 * Check if adding new content would exceed token limit
 */
export function wouldExceedTokenLimit(
  currentItems: Array<ResponseItem>,
  newContent: string,
  model: string,
  maxTokens: number,
): boolean {
  const currentTokens = countTokensUsed(currentItems, model);
  const newTokens = countTokensInText(newContent);
  return (currentTokens + newTokens) > maxTokens;
}

/**
 * Get token usage statistics
 */
export interface TokenStats {
  used: number;
  max: number;
  remaining: number;
  percentUsed: number;
  percentRemaining: number;
}

export function getTokenStats(
  items: Array<ResponseItem>,
  model: string,
  maxTokens: number,
): TokenStats {
  const used = countTokensUsed(items, model);
  const remaining = Math.max(0, maxTokens - used);
  const percentUsed = (used / maxTokens) * 100;
  const percentRemaining = (remaining / maxTokens) * 100;
  
  return {
    used,
    max: maxTokens,
    remaining,
    percentUsed,
    percentRemaining,
  };
}