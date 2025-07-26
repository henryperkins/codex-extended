import { describe, expect, test } from "vitest";
import { countTokensUsed, getTokenStats } from "../src/utils/token-counter.js";
import { maxTokensForModel } from "../src/utils/model-utils.js";
import type { ResponseItem } from "openai/resources/responses/responses.mjs";

describe("New Models Support (o3, gpt-4.1)", () => {
  const testMessages: ResponseItem[] = [
    {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "What is quantum computing?" }]
    },
    {
      type: "message",
      role: "assistant",
      content: [{ 
        type: "output_text", 
        text: "Quantum computing is a type of computation that leverages quantum mechanical phenomena..."
      }]
    }
  ];

  test("should correctly count tokens for o3 models", () => {
    const tokens = countTokensUsed(testMessages, "o3");
    expect(tokens).toBeGreaterThan(0);
    expect(tokens).toBeLessThan(100);
    
    // Test variant names
    const tokensVariant = countTokensUsed(testMessages, "o3-2025-04-16");
    expect(tokensVariant).toBeGreaterThan(0);
    
    const tokensMini = countTokensUsed(testMessages, "o3-mini");
    expect(tokensMini).toBeGreaterThan(0);
  });

  test("should correctly count tokens for gpt-4.1 models", () => {
    const tokens = countTokensUsed(testMessages, "gpt-4.1");
    expect(tokens).toBeGreaterThan(0);
    expect(tokens).toBeLessThan(100);
    
    // Test variant names
    const tokensMini = countTokensUsed(testMessages, "gpt-4.1-mini");
    expect(tokensMini).toBeGreaterThan(0);
    
    const tokensNano = countTokensUsed(testMessages, "gpt-4.1-nano");
    expect(tokensNano).toBeGreaterThan(0);
  });

  test("should return correct context limits for new models", () => {
    // o3 has 200k context
    expect(maxTokensForModel("o3")).toBe(200000);
    expect(maxTokensForModel("o3-2025-04-16")).toBe(200000);
    
    // gpt-4.1 has 1M context
    expect(maxTokensForModel("gpt-4.1")).toBe(1000000);
    expect(maxTokensForModel("gpt-4.1-mini")).toBe(1000000);
    expect(maxTokensForModel("gpt-4.1-nano")).toBe(1000000);
  });

  test("should calculate token stats correctly for large context models", () => {
    // Create a larger conversation
    const largeConversation: ResponseItem[] = [];
    for (let i = 0; i < 100; i++) {
      largeConversation.push({
        type: "message",
        role: i % 2 === 0 ? "user" : "assistant",
        content: [{ 
          type: i % 2 === 0 ? "input_text" : "output_text", 
          text: `Message ${i}: This is a test message with some content to simulate a real conversation.`
        }]
      });
    }
    
    // Test with o3 (200k context)
    const statsO3 = getTokenStats(largeConversation, "o3", 200000);
    expect(statsO3.max).toBe(200000);
    expect(statsO3.percentRemaining).toBeGreaterThan(95); // Should have lots of room
    
    // Test with gpt-4.1 (1M context)
    const statsGPT41 = getTokenStats(largeConversation, "gpt-4.1", 1000000);
    expect(statsGPT41.max).toBe(1000000);
    expect(statsGPT41.percentRemaining).toBeGreaterThan(99); // Should have even more room
  });

  test("auto-compaction should work with new models", () => {
    // Create messages to fill most of the context
    const manyMessages: ResponseItem[] = [];
    const longText = "This is a very long message. ".repeat(1000);
    
    // For o3 with 200k context, add enough to trigger auto-compact
    for (let i = 0; i < 50; i++) {
      manyMessages.push({
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: longText }]
      });
    }
    
    const stats = getTokenStats(manyMessages, "o3", 200000);
    
    // Should be using significant context
    expect(stats.percentUsed).toBeGreaterThan(50);
  });
});