import type {
  Tool,
  FunctionTool,
} from "openai/resources/responses/responses.mjs";

import { scratchpadTool } from "./scratchpad-tool.js";
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
    tool: scratchpadTool,
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
 * Analyze semantic complexity of a query to determine tool requirements
 */
function analyzeSemanticComplexity(query: string): {
  score: number;
  requiresTodo: boolean;
  requiresScratchpad: boolean;
  patterns: Array<string>;
} {
  const patterns: Array<string> = [];
  let score = 0;

  // Sequential/procedural patterns
  const sequentialPatterns = [
    {
      pattern: /\b(and then|after that|next|finally|subsequently)\b/gi,
      weight: 3,
      name: "sequential",
    },
    {
      pattern: /\b(step \d+|first|second|third|fourth|lastly)\b/gi,
      weight: 5,
      name: "numbered_steps",
    },
    { pattern: /\b(phase|stage|part)\s+\d+\b/gi, weight: 4, name: "phases" },
  ];

  // Task complexity patterns
  const complexityPatterns = [
    {
      pattern:
        /\b(implement|build|create|develop|design|refactor)\b.*\b(feature|system|component|module|service|api)\b/gi,
      weight: 5,
      name: "implementation",
    },
    {
      pattern: /\b(ensure|verify|check|test|validate|confirm)\b/gi,
      weight: 2,
      name: "verification",
    },
    {
      pattern: /\b(track|monitor|observe|watch|maintain)\b/gi,
      weight: 3,
      name: "tracking",
    },
    {
      pattern: /\b(debug|investigate|analyze|diagnose|troubleshoot)\b/gi,
      weight: 4,
      name: "debugging",
    },
    {
      pattern:
        /\b(fix|solve|resolve|patch|repair)\s+\b(bug|issue|problem|error)\b/gi,
      weight: 4,
      name: "bug_fix",
    },
  ];

  // Multi-component patterns
  const multiComponentPatterns = [
    {
      pattern:
        /\b(multiple|several|various|all|each|every)\s+\b(files?|components?|modules?|functions?)\b/gi,
      weight: 4,
      name: "multiple_items",
    },
    {
      pattern:
        /\b(across|throughout|within)\s+\b(the\s+)?(codebase|project|repository|system)\b/gi,
      weight: 3,
      name: "codebase_wide",
    },
  ];

  // Check all patterns
  const allPatterns = [
    ...sequentialPatterns,
    ...complexityPatterns,
    ...multiComponentPatterns,
  ];

  for (const { pattern, weight, name } of allPatterns) {
    const matches = query.match(pattern);
    if (matches) {
      score += matches.length * weight;
      patterns.push(name);
    }
  }

  // Check for numbered lists or bullet points
  if (/\d+\.|\d+\)|•|-\s|\*\s/g.test(query)) {
    score += 5;
    patterns.push("list_format");
  }

  // Long queries likely indicate complexity
  const wordCount = query.split(/\s+/).length;
  if (wordCount > 30) {
    score += 5;
    patterns.push("long_query");
  } else if (wordCount > 20) {
    score += 3;
    patterns.push("medium_query");
  }

  // Determine tool requirements based on patterns
  const requiresTodo =
    score >= 10 ||
    patterns.includes("numbered_steps") ||
    patterns.includes("implementation") ||
    patterns.includes("multiple_items") ||
    patterns.includes("list_format");

  const requiresScratchpad =
    score >= 8 ||
    patterns.includes("debugging") ||
    patterns.includes("tracking") ||
    patterns.includes("codebase_wide");

  return { score, requiresTodo, requiresScratchpad, patterns };
}

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

  // ENHANCED: Use semantic complexity analysis
  const complexity = analyzeSemanticComplexity(query);

  // Force selection of required tools based on complexity
  if ("name" in metadata.tool) {
    if (metadata.tool.name === "todo_list" && complexity.requiresTodo) {
      score += 100; // Guarantee selection
    } else if (
      metadata.tool.name === "scratchpad" &&
      complexity.requiresScratchpad
    ) {
      score += 90; // Very high priority
    }
  }

  // Additional boost based on complexity score
  if (complexity.score >= 15) {
    if (metadata.category === "organization") {
      score += 20;
    }
    if (metadata.category === "memory") {
      score += 15;
    }
  } else if (complexity.score >= 10) {
    if (metadata.category === "organization") {
      score += 15;
    }
    if (metadata.category === "memory") {
      score += 10;
    }
  } else if (complexity.score >= 5) {
    if (metadata.category === "organization") {
      score += 10;
    }
    if (metadata.category === "memory") {
      score += 5;
    }
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
      score += 5;
    }
    if (queryLower.match(/(step|phase|stage|part|section)\s*\d+/)) {
      score += 3;
    }
    if (
      queryLower.includes("let's") ||
      queryLower.includes("we need to") ||
      queryLower.includes("first") ||
      queryLower.includes("help me")
    ) {
      score += 2;
    }
  }

  if (metadata.category === "memory") {
    // Boost scratchpad for debugging/analysis patterns
    if (queryLower.match(/debug|investigate|analyze|trace|track|find.*issue/)) {
      score += 5;
    }
    if (queryLower.match(/error|exception|crash|fail|broken|not work/)) {
      score += 4;
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
 * Analyze a query and determine which tools should be required
 */
export function getRequiredTools(query: string): {
  required: Array<string>;
  recommended: Array<string>;
  complexity: ReturnType<typeof analyzeSemanticComplexity>;
} {
  const complexity = analyzeSemanticComplexity(query);
  const required: Array<string> = [];
  const recommended: Array<string> = [];

  if (complexity.requiresTodo) {
    required.push("todo_list");
  }

  if (complexity.requiresScratchpad) {
    required.push("scratchpad");
  }

  // Always recommend shell for implementation tasks
  if (
    complexity.patterns.includes("implementation") ||
    complexity.patterns.includes("bug_fix")
  ) {
    recommended.push("shell");
  }

  return { required, recommended, complexity };
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
