import { describe, expect, test, beforeEach, afterEach } from "vitest";
import { Scratchpad } from "../src/utils/scratchpad.js";
import { handleScratchpadTool } from "../src/utils/scratchpad-tool.js";
import fs from "fs/promises";
import path from "path";
import os from "os";

describe("Scratchpad System", () => {
  let scratchpad: Scratchpad;
  const testSessionId = "test-session-123";
  const testDir = path.join(os.tmpdir(), "codex-test-scratchpads");

  beforeEach(async () => {
    scratchpad = new Scratchpad(testSessionId, testDir);
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  test("should write and read entries", async () => {
    const id1 = await scratchpad.write("Test note", "note");
    const id2 = await scratchpad.write("Test plan", "plan");

    expect(id1).toBeTruthy();
    expect(id2).toBeTruthy();

    const entries = scratchpad.read();
    expect(entries).toHaveLength(2);
    expect(entries[0].content).toBe("Test note");
    expect(entries[1].content).toBe("Test plan");
  });

  test("should filter entries by category", async () => {
    await scratchpad.write("Note 1", "note");
    await scratchpad.write("Plan 1", "plan");
    await scratchpad.write("Note 2", "note");

    const notes = scratchpad.read({ category: "note" });
    expect(notes).toHaveLength(2);
    expect(notes.every((e) => e.category === "note")).toBe(true);

    const plans = scratchpad.read({ category: "plan" });
    expect(plans).toHaveLength(1);
    expect(plans[0].content).toBe("Plan 1");
  });

  test("should limit results", async () => {
    for (let i = 0; i < 5; i++) {
      await scratchpad.write(`Entry ${i}`, "note");
    }

    const limited = scratchpad.read({ limit: 3 });
    expect(limited).toHaveLength(3);
    // Should return the last 3 entries
    expect(limited[0].content).toBe("Entry 2");
    expect(limited[2].content).toBe("Entry 4");
  });

  test("should search entries", async () => {
    await scratchpad.write("Python implementation", "note");
    await scratchpad.write("JavaScript code", "note");
    await scratchpad.write("Python tutorial", "note");

    const results = scratchpad.read({ search: "Python" });
    expect(results).toHaveLength(2);
    expect(results.every((e) => e.content.includes("Python"))).toBe(true);
  });

  test("should update entries", async () => {
    const id = await scratchpad.write("Original content", "note");
    const success = await scratchpad.update(id, "Updated content");

    expect(success).toBe(true);

    const entries = scratchpad.read();
    expect(entries[0].content).toBe("Updated content");
  });

  test("should delete entries", async () => {
    const id1 = await scratchpad.write("Entry 1", "note");
    const id2 = await scratchpad.write("Entry 2", "note");

    const success = await scratchpad.delete(id1);
    expect(success).toBe(true);

    const entries = scratchpad.read();
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe(id2);
  });

  test("should save and load from disk", async () => {
    await scratchpad.write("Persistent note", "note");
    await scratchpad.write("Persistent plan", "plan");

    // Save to disk
    await scratchpad.save();

    // Create new instance and load
    const newScratchpad = new Scratchpad(testSessionId, testDir);
    const loaded = await newScratchpad.load();

    expect(loaded).toBe(true);

    const entries = newScratchpad.read();
    expect(entries).toHaveLength(2);
    expect(entries[0].content).toBe("Persistent note");
    expect(entries[1].content).toBe("Persistent plan");
  });

  test("should generate summary", () => {
    scratchpad.write("Note 1", "note");
    scratchpad.write("Plan 1", "plan");
    scratchpad.write("Error 1", "error");

    const summary = scratchpad.summarize();
    expect(summary).toContain("3 entries");
    expect(summary).toContain("note: 1");
    expect(summary).toContain("plan: 1");
    expect(summary).toContain("error: 1");
  });

  test("handleScratchpadTool should handle all actions", async () => {
    // Write
    const writeResult = await handleScratchpadTool(
      {
        action: "write",
        content: "Test content",
        category: "note",
      },
      scratchpad,
    );
    expect(writeResult).toContain("Saved to scratchpad");

    // Read
    const readResult = await handleScratchpadTool(
      {
        action: "read",
      },
      scratchpad,
    );
    expect(readResult).toContain("Test content");

    // Summarize
    const summaryResult = await handleScratchpadTool(
      {
        action: "summarize",
      },
      scratchpad,
    );
    expect(summaryResult).toContain("1 entries");

    // Clear
    const clearResult = await handleScratchpadTool(
      {
        action: "clear",
      },
      scratchpad,
    );
    expect(clearResult).toBe("Scratchpad cleared");

    const afterClear = scratchpad.read();
    expect(afterClear).toHaveLength(0);
  });

  test("should enforce max entries limit", async () => {
    // Create a scratchpad with low limit for testing
    const limitedScratchpad = new Scratchpad(testSessionId, testDir);
    limitedScratchpad["maxEntries"] = 3;

    for (let i = 0; i < 5; i++) {
      await limitedScratchpad.write(`Entry ${i}`, "note");
    }

    const entries = limitedScratchpad.read();
    expect(entries).toHaveLength(3);
    // Should keep the last 3 entries
    expect(entries[0].content).toBe("Entry 2");
    expect(entries[2].content).toBe("Entry 4");
  });
});
