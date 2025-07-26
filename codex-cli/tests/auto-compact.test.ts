import { describe, expect, test } from "vitest";
import { calculateContextPercentRemaining } from "../src/utils/model-utils.js";
import type { ResponseItem } from "openai/resources/responses/responses.mjs";

describe("Auto Compaction Threshold", () => {
  test("should trigger at 90% context usage (10% remaining)", () => {
    // Create messages of different sizes
    const smallText = "Hello world";
    const mediumText = "This is a test message. ".repeat(100);
    const largeText = "This is a test message. ".repeat(500);
    
    const items: ResponseItem[] = [];
    
    // Add a few large messages to approach the limit
    for (let i = 0; i < 3; i++) {
      items.push({
        type: "message",
        role: i % 2 === 0 ? "user" : "assistant",
        content: [{ type: i % 2 === 0 ? "input_text" : "output_text", text: largeText }]
      });
    }
    
    // Test with a model that has limited context
    const percentRemaining = calculateContextPercentRemaining(items, "gpt-3.5-turbo-16k");
    
    // With 3 large messages, we should be using significant context
    expect(percentRemaining).toBeLessThan(50);
    
    // Add more messages to exceed 90%
    for (let i = 0; i < 10; i++) {
      items.push({
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: mediumText }]
      });
    }
    
    const percentRemainingHigh = calculateContextPercentRemaining(items, "gpt-3.5-turbo-16k");
    
    // Now should be below 10% remaining
    expect(percentRemainingHigh).toBeLessThan(10);
  });
  
  test("should show context usage increases with more messages", () => {
    const message = "This is a test message. ".repeat(50);
    const items: ResponseItem[] = [];
    
    // Add messages incrementally
    for (let i = 0; i < 5; i++) {
      items.push({
        type: "message",
        role: i % 2 === 0 ? "user" : "assistant",
        content: [{ type: i % 2 === 0 ? "input_text" : "output_text", text: message }]
      });
    }
    
    const percentAfter5 = calculateContextPercentRemaining(items, "gpt-3.5-turbo-16k");
    
    // Add 5 more messages
    for (let i = 0; i < 5; i++) {
      items.push({
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: message }]
      });
    }
    
    const percentAfter10 = calculateContextPercentRemaining(items, "gpt-3.5-turbo-16k");
    
    // More messages should mean less context remaining
    expect(percentAfter10).toBeLessThan(percentAfter5);
    
    // Both should still be above 0
    expect(percentAfter5).toBeGreaterThan(0);
    expect(percentAfter10).toBeGreaterThan(0);
  });
});