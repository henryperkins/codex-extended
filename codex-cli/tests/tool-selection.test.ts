import { describe, expect, test } from "vitest";
import { 
  selectToolsForQuery, 
  getToolSelectionStats, 
  shouldIncludeTool 
} from "../src/utils/tool-selection.js";

describe("Tool Selection with RAG", () => {
  test("should select shell tool for code-related queries", () => {
    const queries = [
      "run npm install",
      "create a new python file",
      "execute the test suite",
      "list all JavaScript files",
      "check git status"
    ];
    
    for (const query of queries) {
      const tools = selectToolsForQuery(query);
      const toolNames = tools.map(t => t.name);
      expect(toolNames).toContain("shell");
    }
  });

  test("should select web_search tool for search queries", () => {
    const queries = [
      "search for information about React hooks",
      "find the latest news on AI",
      "look up how to use TypeScript generics",
      "what is quantum computing"
    ];
    
    for (const query of queries) {
      const tools = selectToolsForQuery(query);
      const toolNames = tools.map(t => t.name);
      expect(toolNames).toContain("web_search");
    }
  });

  test("should select fetch_url tool for URL-related queries", () => {
    const queries = [
      "fetch the content from https://example.com",
      "get the documentation at https://docs.python.org",
      "read this URL: https://github.com/readme.md",
      "access the page at example.com"
    ];
    
    for (const query of queries) {
      const tools = selectToolsForQuery(query);
      const toolNames = tools.map(t => t.name);
      expect(toolNames).toContain("fetch_url");
    }
  });

  test("should limit tools to maxTools parameter", () => {
    const query = "search for Python tutorials and then create a new python file";
    
    const tools1 = selectToolsForQuery(query, 1);
    expect(tools1).toHaveLength(1);
    
    const tools2 = selectToolsForQuery(query, 2);
    expect(tools2).toHaveLength(2);
    
    const tools3 = selectToolsForQuery(query, 3);
    expect(tools3.length).toBeLessThanOrEqual(3);
  });

  test("should respect threshold parameter", () => {
    const query = "hello";
    
    // High threshold should return fewer or no tools
    const toolsHighThreshold = selectToolsForQuery(query, 3, 10);
    expect(toolsHighThreshold.length).toBeLessThanOrEqual(1); // Only fallback
    
    // Low threshold should return more tools
    const toolsLowThreshold = selectToolsForQuery(query, 3, 0);
    expect(toolsLowThreshold.length).toBeGreaterThan(0);
  });

  test("should always include shell tool as fallback", () => {
    const query = "xyzabc123"; // Nonsense query
    const tools = selectToolsForQuery(query);
    
    expect(tools.length).toBeGreaterThan(0);
    const toolNames = tools.map(t => t.name);
    expect(toolNames).toContain("shell");
  });

  test("getToolSelectionStats should return scores for all tools", () => {
    const query = "search for Python tutorials and create a file";
    const stats = getToolSelectionStats(query);
    
    expect(stats).toHaveProperty("shell");
    expect(stats).toHaveProperty("fetch_url");
    expect(stats).toHaveProperty("web_search");
    
    // Shell and web_search should have positive scores
    expect(stats.shell).toBeGreaterThan(0);
    expect(stats.web_search).toBeGreaterThan(0);
  });

  test("shouldIncludeTool should correctly identify relevant tools", () => {
    expect(shouldIncludeTool("run npm install", "shell")).toBe(true);
    expect(shouldIncludeTool("run npm install", "web_search")).toBe(false);
    
    expect(shouldIncludeTool("search for React tutorials", "web_search")).toBe(true);
    expect(shouldIncludeTool("search for React tutorials", "fetch_url")).toBe(false);
    
    expect(shouldIncludeTool("fetch https://example.com", "fetch_url")).toBe(true);
  });

  test("should handle mixed queries intelligently", () => {
    const query = "search for Python documentation then create a hello.py file";
    const tools = selectToolsForQuery(query, 3);
    const toolNames = tools.map(t => t.name);
    
    // Should include both web_search and shell
    expect(toolNames).toContain("shell");
    expect(toolNames).toContain("web_search");
  });

  test("should boost scores for explicit tool mentions", () => {
    const stats1 = getToolSelectionStats("use shell to run a command");
    const stats2 = getToolSelectionStats("run a command");
    
    // Explicit mention should have higher score
    expect(stats1.shell).toBeGreaterThan(stats2.shell);
  });
});