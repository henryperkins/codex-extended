import { describe, expect, test } from "vitest";
import { 
  countTokensInText, 
  countTokensUsed,
  wouldExceedTokenLimit,
  getTokenStats
} from "../src/utils/token-counter.js";
import type { ResponseItem } from "openai/resources/responses/responses.mjs";

describe("Token Counter", () => {
  test("countTokensInText should count tokens in simple text", () => {
    const text = "Hello, world!";
    const tokens = countTokensInText(text);
    // "Hello, world!" typically tokenizes to ~4 tokens
    expect(tokens).toBeGreaterThan(0);
    expect(tokens).toBeLessThan(10);
  });

  test("countTokensInText should handle empty text", () => {
    const tokens = countTokensInText("");
    expect(tokens).toBe(0);
  });

  test("countTokensUsed should count tokens in messages", () => {
    const items: ResponseItem[] = [
      {
        type: "message",
        role: "user",
        content: [
          { type: "input_text", text: "What is the weather today?" }
        ]
      },
      {
        type: "message", 
        role: "assistant",
        content: [
          { type: "output_text", text: "I don't have access to real-time weather data." }
        ]
      }
    ];
    
    const tokens = countTokensUsed(items, "gpt-4");
    expect(tokens).toBeGreaterThan(0);
    expect(tokens).toBeLessThan(100);
  });

  test("countTokensUsed should count function call tokens", () => {
    const items: ResponseItem[] = [
      {
        type: "function_call",
        name: "get_weather",
        arguments: '{"location": "New York"}'
      },
      {
        type: "function_call_output",
        output: "Temperature: 72°F, Sunny"
      }
    ];
    
    const tokens = countTokensUsed(items, "gpt-4");
    expect(tokens).toBeGreaterThan(10); // Function calls have overhead
  });

  test("wouldExceedTokenLimit should check if content exceeds limit", () => {
    const items: ResponseItem[] = [
      {
        type: "message",
        role: "user", 
        content: [{ type: "input_text", text: "Hello" }]
      }
    ];
    
    const shortText = "World";
    const longText = "A".repeat(10000);
    
    expect(wouldExceedTokenLimit(items, shortText, "gpt-4", 1000)).toBe(false);
    expect(wouldExceedTokenLimit(items, longText, "gpt-4", 100)).toBe(true);
  });

  test("getTokenStats should return correct statistics", () => {
    const items: ResponseItem[] = [
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "Test message" }]
      }
    ];
    
    const stats = getTokenStats(items, "gpt-4", 1000);
    
    expect(stats.max).toBe(1000);
    expect(stats.used).toBeGreaterThan(0);
    expect(stats.remaining).toBeLessThan(1000);
    expect(stats.percentUsed).toBeGreaterThan(0);
    expect(stats.percentUsed).toBeLessThan(100);
    expect(stats.percentRemaining).toBeGreaterThan(0);
    expect(stats.percentRemaining).toBeLessThan(100);
    expect(stats.percentUsed + stats.percentRemaining).toBeCloseTo(100);
  });

  test("countTokensInText should fallback gracefully on encoding errors", () => {
    // Test with invalid unicode that might cause encoding issues
    const problematicText = "\uD800\uDC00"; // Invalid surrogate pair
    const tokens = countTokensInText(problematicText);
    expect(tokens).toBeGreaterThan(0); // Should fallback to char/4
  });
});