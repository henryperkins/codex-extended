import { describe, expect, test, vi } from "vitest";
import {
  getCompactionLevel,
  CompactionLevel,
  getCompactionConfig,
  prepareItemsForCompaction,
  estimateCompactionSavings,
} from "../src/utils/progressive-compaction.js";
import type { ResponseItem } from "openai/resources/responses/responses.mjs";

describe("Progressive Compaction", () => {
  describe("getCompactionLevel", () => {
    test("should return correct compaction levels", () => {
      expect(getCompactionLevel(50)).toBe(CompactionLevel.NONE);
      expect(getCompactionLevel(69)).toBe(CompactionLevel.NONE);
      expect(getCompactionLevel(70)).toBe(CompactionLevel.LIGHT);
      expect(getCompactionLevel(75)).toBe(CompactionLevel.LIGHT);
      expect(getCompactionLevel(80)).toBe(CompactionLevel.MEDIUM);
      expect(getCompactionLevel(85)).toBe(CompactionLevel.MEDIUM);
      expect(getCompactionLevel(90)).toBe(CompactionLevel.HEAVY);
      expect(getCompactionLevel(94)).toBe(CompactionLevel.HEAVY);
      expect(getCompactionLevel(95)).toBe(CompactionLevel.CRITICAL);
      expect(getCompactionLevel(99)).toBe(CompactionLevel.CRITICAL);
    });
  });

  describe("getCompactionConfig", () => {
    test("should return correct config for LIGHT level", () => {
      const config = getCompactionConfig(CompactionLevel.LIGHT);
      expect(config.keepRecentMessages).toBe(10);
      expect(config.summarizeOlderThan).toBe(20);
      expect(config.dropToolOutputs).toBe(false);
      expect(config.dropSystemMessages).toBe(false);
      expect(config.aggressiveSummarization).toBe(false);
    });

    test("should return correct config for MEDIUM level", () => {
      const config = getCompactionConfig(CompactionLevel.MEDIUM);
      expect(config.keepRecentMessages).toBe(6);
      expect(config.summarizeOlderThan).toBe(10);
      expect(config.dropToolOutputs).toBe(true);
      expect(config.dropSystemMessages).toBe(false);
      expect(config.aggressiveSummarization).toBe(true);
    });

    test("should return correct config for HEAVY level", () => {
      const config = getCompactionConfig(CompactionLevel.HEAVY);
      expect(config.keepRecentMessages).toBe(4);
      expect(config.summarizeOlderThan).toBe(6);
      expect(config.dropToolOutputs).toBe(true);
      expect(config.dropSystemMessages).toBe(true);
      expect(config.aggressiveSummarization).toBe(true);
    });

    test("should return correct config for CRITICAL level", () => {
      const config = getCompactionConfig(CompactionLevel.CRITICAL);
      expect(config.keepRecentMessages).toBe(2);
      expect(config.summarizeOlderThan).toBe(3);
      expect(config.dropToolOutputs).toBe(true);
      expect(config.dropSystemMessages).toBe(true);
      expect(config.aggressiveSummarization).toBe(true);
    });
  });

  describe("prepareItemsForCompaction", () => {
    const createMessage = (role: string, text: string): ResponseItem => ({
      id: `msg-${Date.now()}-${Math.random()}`,
      type: "message",
      role,
      content: [{ type: "input_text", text }],
    });

    const createToolCall = (): ResponseItem => ({
      id: `tool-${Date.now()}`,
      type: "function_call",
      name: "shell",
      arguments: "{}",
    });

    test("should handle LIGHT compaction correctly", () => {
      const items: ResponseItem[] = [
        ...Array(25).fill(null).map((_, i) => createMessage("user", `Old message ${i}`)),
        ...Array(5).fill(null).map((_, i) => createMessage("assistant", `Recent message ${i}`)),
        createToolCall(),
      ];

      const config = getCompactionConfig(CompactionLevel.LIGHT);
      const { toSummarize, toKeep, toDropInfo } = prepareItemsForCompaction(items, config);

      // With LIGHT config: keepRecentMessages=10, summarizeOlderThan=20
      // Total 30 messages + 1 tool
      // Recent 10 messages are kept
      // Messages older than position 20 from end are summarized
      // So positions 0-9 are summarized (30-20=10)
      // Positions 10-29 are kept (20 messages) + 5 tool calls (10/2)
      expect(toKeep.length).toBe(21); // 20 messages + 1 tool call (recent 5)
      expect(toSummarize.length).toBe(10); // First 10 messages
      expect(toDropInfo).toHaveLength(0);
    });

    test("should drop tool outputs in MEDIUM compaction", () => {
      const items: ResponseItem[] = [
        ...Array(10).fill(null).map((_, i) => createMessage("user", `Message ${i}`)),
        ...Array(5).fill(null).map(() => createToolCall()),
      ];

      const config = getCompactionConfig(CompactionLevel.MEDIUM);
      const { toKeep, toDropInfo } = prepareItemsForCompaction(items, config);

      expect(toKeep.filter(item => item.type === "function_call")).toHaveLength(0);
      expect(toDropInfo).toContain("Dropped 5 tool call outputs");
    });

    test("should drop system messages in HEAVY compaction", () => {
      const items: ResponseItem[] = [
        createMessage("system", "System message 1"),
        createMessage("user", "User message"),
        createMessage("system", "System message 2"),
        createMessage("assistant", "Assistant message"),
      ];

      const config = getCompactionConfig(CompactionLevel.HEAVY);
      const { toKeep, toDropInfo } = prepareItemsForCompaction(items, config);

      expect(toKeep.filter(item => item.role === "system")).toHaveLength(0);
      expect(toDropInfo).toContain("Dropped 2 system messages");
    });
  });

  describe("estimateCompactionSavings", () => {
    test("should estimate savings for different levels", () => {
      // Create enough messages to trigger summarization
      const items: ResponseItem[] = Array(100).fill(null).map((_, i) => ({
        id: `msg-${i}`,
        type: "message",
        role: i % 2 === 0 ? "user" : "assistant",
        content: [{ type: "input_text", text: "This is a test message that should count as tokens when we have enough content to summarize" }],
      }));

      const model = "gpt-4";
      
      const lightSavings = estimateCompactionSavings(items, model, CompactionLevel.LIGHT);
      const mediumSavings = estimateCompactionSavings(items, model, CompactionLevel.MEDIUM);
      const heavySavings = estimateCompactionSavings(items, model, CompactionLevel.HEAVY);
      
      // Each level should save more tokens
      expect(lightSavings).toBeGreaterThan(0);
      expect(mediumSavings).toBeGreaterThan(lightSavings);
      expect(heavySavings).toBeGreaterThan(mediumSavings);
    });
  });
});