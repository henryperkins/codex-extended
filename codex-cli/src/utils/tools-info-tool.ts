import type { FunctionTool } from "openai/resources/responses/responses.mjs";

import { scratchpadTool } from "./scratchpad-tool.js";

/**
 * Tool discovery and information tool
 */
export const toolsInfoTool: FunctionTool = {
  type: "function",
  name: "tools_info",
  description:
    "Discover available tools and learn how to use them. Get tool lists, descriptions, and examples.",
  strict: false,
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["list", "describe", "examples"],
        description:
          "Action to perform: list all tools, describe a specific tool, or get examples",
      },
      tool_name: {
        type: "string",
        description:
          "Name of the tool (required for describe/examples actions)",
      },
    },
    required: ["action"],
    additionalProperties: false,
  },
};

interface ToolInfo {
  name: string;
  category: string;
  description: string;
  parameters?: string;
}

const TOOL_REGISTRY: Record<string, ToolInfo> = {
  shell: {
    name: "shell",
    category: "execution",
    description: "Execute shell commands in the working directory",
    parameters:
      '{"command": ["cmd", "arg1", "arg2"], "workdir"?: "path", "timeout"?: 60000}',
  },
  todo_list: {
    name: "todo_list",
    category: "organization",
    description:
      "Manage tasks with priorities, dependencies, and progress tracking. NOTE: This is a FUNCTION TOOL, not a shell command!",
    parameters:
      '{"action": "add|list|complete|start|...", "content"?: "task", "id"?: "task-id", "priority"?: "low|medium|high"}',
  },
  scratchpad: {
    name: scratchpadTool.name,
    category: "memory",
    description: scratchpadTool.description ?? "Scratchpad tool",
    parameters: scratchpadTool.parameters
      ? JSON.stringify(scratchpadTool.parameters)
      : undefined,
  },
  fetch_url: {
    name: "fetch_url",
    category: "web",
    description:
      "Fetch and process content from URLs with optional synopsis generation",
    parameters: '{"url": "https://example.com"}',
  },
  web_search: {
    name: "web_search",
    category: "web",
    description:
      "Search the web and get structured results with URLs, titles, and snippets",
    parameters: '{"query": "search terms"}',
  },
  tools_info: {
    name: "tools_info",
    category: "discovery",
    description: "Get information about available tools (this tool)",
    parameters:
      '{"action": "list|describe|examples", "tool_name"?: "tool_name"}',
  },
};

const TOOL_EXAMPLES: Record<
  string,
  Array<{ description: string; example: unknown }>
> = {
  todo_list: [
    {
      description: "Add a new high-priority task",
      example: {
        action: "add",
        content: "Fix critical bug in authentication",
        priority: "high",
      },
    },
    {
      description: "List all pending tasks",
      example: { action: "list", status: "pending" },
    },
    {
      description: "Complete a task",
      example: {
        action: "complete",
        id: "task-123",
        notes: "Fixed by updating dependencies",
      },
    },
    {
      description: "Get next actionable tasks",
      example: { action: "next" },
    },
  ],
  scratchpad: [
    {
      description: "Save a note",
      example: {
        action: "write",
        content: "Found issue in line 42 of auth.js",
        category: "note",
      },
    },
    {
      description: "Save analysis results",
      example: {
        action: "write",
        content: "Performance bottleneck: database queries",
        category: "result",
      },
    },
    {
      description: "Read all entries",
      example: { action: "read" },
    },
    {
      description: "Get summary of scratchpad",
      example: { action: "summarize" },
    },
  ],
  shell: [
    {
      description: "List files in current directory",
      example: { command: ["ls", "-la"] },
    },
    {
      description: "Run tests",
      example: { command: ["npm", "test"] },
    },
    {
      description: "Search for text in files",
      example: { command: ["rg", "-F", "searchterm"] },
    },
  ],
  fetch_url: [
    {
      description: "Fetch a webpage",
      example: { url: "https://docs.openai.com/api-reference" },
    },
  ],
  web_search: [
    {
      description: "Search for documentation",
      example: { query: "OpenAI function calling documentation" },
    },
  ],
};

/**
 * Handle tools_info tool calls
 */
export interface ToolsInfoArgs {
  action: "list" | "describe" | "examples";
  tool_name?: string;
}

export async function handleToolsInfo(args: ToolsInfoArgs): Promise<string> {
  const { action, tool_name } = args;

  switch (action) {
    case "list": {
      const tools = Object.values(TOOL_REGISTRY).map((tool) => ({
        name: tool.name,
        category: tool.category,
        description: tool.description,
      }));

      return JSON.stringify(
        {
          tools,
          total: tools.length,
          categories: [...new Set(tools.map((t) => t.category))],
          hint: "Use action='describe' with tool_name to get detailed info",
        },
        null,
        2,
      );
    }

    case "describe": {
      if (!tool_name) {
        return JSON.stringify({
          error: "tool_name is required for 'describe' action",
          available_tools: Object.keys(TOOL_REGISTRY),
        });
      }

      const tool = TOOL_REGISTRY[tool_name];
      if (!tool) {
        return JSON.stringify({
          error: `Tool '${tool_name}' not found`,
          available_tools: Object.keys(TOOL_REGISTRY),
          suggestion: "Use action='list' to see all available tools",
        });
      }

      return JSON.stringify(
        {
          ...tool,
          examples_available: !!TOOL_EXAMPLES[tool_name],
          hint:
            tool_name in TOOL_EXAMPLES
              ? "Use action='examples' to see usage examples"
              : undefined,
        },
        null,
        2,
      );
    }

    case "examples": {
      if (!tool_name) {
        return JSON.stringify({
          error: "tool_name is required for 'examples' action",
          available_tools: Object.keys(TOOL_EXAMPLES),
        });
      }

      const examples = TOOL_EXAMPLES[tool_name];
      if (!examples) {
        return JSON.stringify({
          error: `No examples available for '${tool_name}'`,
          available_tools: Object.keys(TOOL_EXAMPLES),
        });
      }

      return JSON.stringify(
        {
          tool: tool_name,
          examples,
          total_examples: examples.length,
        },
        null,
        2,
      );
    }
  }
}
