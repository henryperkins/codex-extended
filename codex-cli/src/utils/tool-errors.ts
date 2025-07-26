/**
 * Enhanced error handling for tool execution
 */

export interface ToolErrorDetails {
  tool: string;
  expectedFormat?: string;
  receivedValue?: unknown;
  validationErrors?: Array<string>;
  suggestion?: string;
  example?: unknown;
}

export class ToolExecutionError extends Error {
  constructor(
    public code: string,
    message: string,
    public details: ToolErrorDetails,
  ) {
    super(message);
    this.name = "ToolExecutionError";
  }

  toJSON(): Record<string, unknown> {
    return {
      error: true,
      code: this.code,
      message: this.message,
      details: this.details,
      suggestion: this.details.suggestion,
      example: this.details.example,
    };
  }
}

export const ERROR_CODES = {
  INVALID_ARGUMENTS: "INVALID_ARGUMENTS",
  MISSING_REQUIRED_FIELD: "MISSING_REQUIRED_FIELD",
  INVALID_JSON: "INVALID_JSON",
  TOOL_NOT_FOUND: "TOOL_NOT_FOUND",
  EXECUTION_FAILED: "EXECUTION_FAILED",
  TIMEOUT: "TIMEOUT",
  VALIDATION_ERROR: "VALIDATION_ERROR",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/**
 * Get a helpful error message based on the error code
 */
export function getErrorMessage(code: ErrorCode, toolName: string): string {
  switch (code) {
    case ERROR_CODES.INVALID_ARGUMENTS:
      return `Invalid arguments provided for ${toolName} tool`;
    case ERROR_CODES.MISSING_REQUIRED_FIELD:
      return `Missing required field for ${toolName} tool`;
    case ERROR_CODES.INVALID_JSON:
      return `Failed to parse JSON arguments for ${toolName} tool`;
    case ERROR_CODES.TOOL_NOT_FOUND:
      return `Tool ${toolName} not found`;
    case ERROR_CODES.EXECUTION_FAILED:
      return `Failed to execute ${toolName} tool`;
    case ERROR_CODES.TIMEOUT:
      return `${toolName} tool execution timed out`;
    case ERROR_CODES.VALIDATION_ERROR:
      return `Validation failed for ${toolName} tool parameters`;
  }
}

/**
 * Get tool-specific examples
 */
export function getToolExample(toolName: string): unknown {
  const examples: Record<string, unknown> = {
    todo_list: {
      action: "add",
      content: "Implement new feature",
      priority: "high",
    },
    scratchpad: {
      action: "write",
      content: "Important note",
      category: "note",
    },
    shell: { command: ["ls", "-la"] },
    fetch_url: { url: "https://example.com" },
    web_search: { query: "OpenAI documentation" },
  };

  return examples[toolName] || null;
}

/**
 * Get expected format for a tool
 */
export function getExpectedFormat(toolName: string): string {
  const formats: Record<string, string> = {
    todo_list:
      '{"action": "add|update|list|complete|start|block|next|summary", "content"?: string, "id"?: string, "priority"?: "low|medium|high", "status"?: string}',
    scratchpad:
      '{"action": "write|read|update|delete|clear|summarize", "content"?: string, "category"?: "note|plan|result|error|state", "id"?: string}',
    shell: '{"command": string[]}',
    fetch_url: '{"url": string}',
    web_search: '{"query": string}',
  };

  return formats[toolName] || "Unknown format";
}
