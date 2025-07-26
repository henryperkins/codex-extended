import type {
  Tool,
  FunctionTool,
} from "openai/resources/responses/responses.mjs";

import { todoListTool } from "./todo-list-tool.js";

/**
 * Tool metadata for RAG-based selection
 */
interface ToolMetadata {
  tool: Tool;
  keywords: Array<string>;
  examples: Array<string>;
  category: string;
}

/**
 * Define metadata for each tool to help with selection
 */
const TOOL_METADATA: Record<string, ToolMetadata> = {
  todo_list: {
    tool: todoListTool,
    keywords: [
      "todo",
      "task",
      "tasks",
      "checklist",
      "plan",
      "track",
      "progress",
      "steps",
      "complete",
      "pending",
      "blocked",
      "dependencies",
      "subtasks",
      "organize",
      "manage",
      "workflow",
      "status",
      "priority",
      "next",
    ],
    examples: [
      "create a todo list",
      "add this to my tasks",
      "mark task as complete",
      "what's next on the list",
      "show my progress",
      "track these steps",
      "manage the workflow",
      "check task status",
      "set high priority",
      "add subtask",
      "this depends on",
      "show pending tasks",
    ],
    category: "organization",
  },

  scratchpad: {
    tool: {
      type: "function",
      name: "scratchpad",
      description:
        "Read and write to a persistent scratchpad for storing notes, plans, intermediate results, and state during task execution.",
      strict: false,
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["write", "read", "update", "delete", "clear", "summarize"],
            description: "The action to perform on the scratchpad",
          },
          content: {
            type: "string",
            description: "Content to write or update",
          },
          category: {
            type: "string",
            enum: ["note", "plan", "result", "error", "state"],
            description: "Category of the entry",
          },
          id: {
            type: "string",
            description: "Entry ID for update/delete",
          },
          options: {
            type: "object",
            properties: {
              category: { type: "string" },
              limit: { type: "number" },
              search: { type: "string" },
            },
            additionalProperties: false,
          },
        },
        required: ["action"],
        additionalProperties: false,
      },
    } as FunctionTool,
    keywords: [
      "remember",
      "save",
      "store",
      "persist",
      "note",
      "plan",
      "track",
      "scratchpad",
      "memory",
      "recall",
      "retrieve",
      "state",
      "intermediate",
      "progress",
      "checkpoint",
      "record",
      "log",
      "history",
      "context",
    ],
    examples: [
      "remember this for later",
      "save the current progress",
      "store intermediate results",
      "make a note about",
      "track the plan",
      "save state",
      "recall what we did",
      "check previous notes",
    ],
    category: "memory",
  },

  shell: {
    tool: {
      type: "function",
      name: "shell",
      description: "Runs a shell command, and returns its output.",
      strict: false,
      parameters: {
        type: "object",
        properties: {
          command: { type: "array", items: { type: "string" } },
          workdir: {
            type: "string",
            description: "The working directory for the command.",
          },
          timeout: {
            type: "number",
            description:
              "The maximum time to wait for the command to complete in milliseconds.",
          },
        },
        required: ["command"],
        additionalProperties: false,
      },
    } as FunctionTool,
    keywords: [
      "run",
      "execute",
      "command",
      "shell",
      "bash",
      "terminal",
      "script",
      "npm",
      "yarn",
      "git",
      "build",
      "test",
      "install",
      "compile",
      "make",
      "python",
      "node",
      "file",
      "directory",
      "ls",
      "cd",
      "mkdir",
      "rm",
      "cat",
      "grep",
      "find",
      "code",
      "program",
      "process",
      "system",
    ],
    examples: [
      "run npm install",
      "execute python script",
      "list files in directory",
      "create a new folder",
      "check git status",
      "run tests",
      "build the project",
      "install dependencies",
    ],
    category: "execution",
  },

  fetch_url: {
    tool: {
      type: "function",
      name: "fetch_url",
      description:
        "Fetches the content of a URL and returns structured data with optional synopsis and chunking for large pages.",
      strict: false,
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "The URL to fetch",
          },
        },
        required: ["url"],
        additionalProperties: false,
      },
    } as FunctionTool,
    keywords: [
      "fetch",
      "url",
      "website",
      "page",
      "http",
      "https",
      "download",
      "read",
      "get",
      "retrieve",
      "access",
      "load",
      "open",
      "browse",
      "documentation",
      "api",
      "content",
      "web page",
      "link",
    ],
    examples: [
      "fetch this URL",
      "get content from website",
      "read the documentation at",
      "access the API docs",
      "download page content",
      "retrieve information from link",
    ],
    category: "web",
  },

  web_search: {
    tool: {
      type: "function",
      name: "web_search",
      description:
        "Searches the web and returns structured results with URLs, titles, and snippets.",
      strict: false,
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The search query",
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
    } as FunctionTool,
    keywords: [
      "search",
      "find",
      "look up",
      "google",
      "query",
      "discover",
      "research",
      "information",
      "web",
      "internet",
      "online",
      "results",
      "explore",
      "investigate",
      "learn about",
      "what is",
      "how to",
    ],
    examples: [
      "search for information about",
      "find resources on",
      "look up how to",
      "what is the latest on",
      "search the web for",
      "find examples of",
      "research about",
    ],
    category: "web",
  },
};

/**
 * Simple keyword-based scoring for tool relevance
 * In a production system, this could use embeddings for better accuracy
 */
function scoreToolRelevance(query: string, metadata: ToolMetadata): number {
  const queryLower = query.toLowerCase();
  let score = 0;

  // Check keywords
  for (const keyword of metadata.keywords) {
    if (queryLower.includes(keyword)) {
      score += 2;
    }
  }

  // Check examples
  for (const example of metadata.examples) {
    const exampleLower = example.toLowerCase();
    const words = exampleLower.split(" ");
    for (const word of words) {
      if (queryLower.includes(word) && word.length > 3) {
        score += 1;
      }
    }
  }

  // Boost score if tool name is mentioned (for function tools)
  if ("name" in metadata.tool && queryLower.includes(metadata.tool.name)) {
    score += 5;
  }

  // Category-based heuristics
  if (metadata.category === "execution") {
    // Boost shell tool for code/file operations
    if (queryLower.match(/\.(py|js|ts|java|cpp|c|go|rs|rb|php|sh)(\s|$)/)) {
      score += 3;
    }
    if (
      queryLower.match(
        /(create|write|edit|modify|delete|remove)\s+(file|folder|directory)/,
      )
    ) {
      score += 3;
    }
  }

  if (metadata.category === "web") {
    // Boost web tools for URL patterns
    if (
      queryLower.match(/https?:\/\//) ||
      queryLower.includes(".com") ||
      queryLower.includes(".org")
    ) {
      score +=
        "name" in metadata.tool && metadata.tool.name === "fetch_url" ? 5 : 2;
    }
  }

  if (metadata.category === "organization") {
    // Boost todo tool for task-related patterns
    if (
      queryLower.match(
        /(implement|build|create|develop|fix|refactor|analyze)\s+.*(feature|function|component|system|bug)/,
      )
    ) {
      score += 3;
    }
    if (queryLower.match(/(step|phase|stage|part|section)\s*\d+/)) {
      score += 2;
    }
    if (
      queryLower.includes("let's") ||
      queryLower.includes("we need to") ||
      queryLower.includes("first")
    ) {
      score += 1;
    }
  }

  return score;
}

/**
 * Select the most relevant tools for a given query
 * @param query The user's input/query
 * @param maxTools Maximum number of tools to return (default: 2)
 * @param threshold Minimum relevance score to include a tool (default: 3)
 * @returns Array of selected tools
 */
export function selectToolsForQuery(
  query: string,
  maxTools: number = 2,
  threshold: number = 3,
): Array<FunctionTool> {
  const scores: Array<{ tool: FunctionTool; score: number; name: string }> = [];

  // Score each tool
  for (const [name, metadata] of Object.entries(TOOL_METADATA)) {
    const score = scoreToolRelevance(query, metadata);
    if (score >= threshold) {
      scores.push({ tool: metadata.tool as FunctionTool, score, name });
    }
  }

  // Sort by score (highest first) and take top N
  scores.sort((a, b) => b.score - a.score);
  const selected = scores.slice(0, maxTools).map((s) => s.tool);

  // Always include shell tool if no tools were selected (fallback)
  if (selected.length === 0) {
    return [TOOL_METADATA["shell"]?.tool as FunctionTool].filter(Boolean);
  }

  return selected;
}

/**
 * Get tool usage statistics for a query
 * Useful for debugging and monitoring
 */
export function getToolSelectionStats(query: string): Record<string, number> {
  const stats: Record<string, number> = {};

  for (const [name, metadata] of Object.entries(TOOL_METADATA)) {
    stats[name] = scoreToolRelevance(query, metadata);
  }

  return stats;
}

/**
 * Check if a specific tool should be included based on the query
 */
export function shouldIncludeTool(query: string, toolName: string): boolean {
  const metadata = TOOL_METADATA[toolName];
  if (!metadata) {
    return false;
  }

  const score = scoreToolRelevance(query, metadata);
  return score >= 3;
}
