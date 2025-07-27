/**
 * Custom error class for tool validation failures
 */
export class ToolValidationError extends Error {
  constructor(
    message: string,
    public toolName: string,
    public action?: string,
    public suggestedFix?: string,
  ) {
    super(message);
    this.name = "ToolValidationError";
  }

  toJSON(): {
    error: string;
    tool: string;
    action?: string;
    suggestedFix?: string;
    retry_required: boolean;
  } {
    return {
      error: this.message,
      tool: this.toolName,
      action: this.action,
      suggestedFix: this.suggestedFix,
      retry_required: true,
    };
  }
}

/**
 * Helper function to get correct tool usage examples
 */
export function getToolExample(toolName: string, action?: string): string {
  const examples: Record<string, Record<string, string>> = {
    todo_list: {
      add: '{"action":"add","content":"Clear task description","priority":"high"}',
      complete:
        '{"action":"complete","id":"task-id","notes":"Implementation details"}',
      list: '{"action":"list"}',
      next: '{"action":"next"}',
      start: '{"action":"start","id":"task-id"}',
    },
    scratchpad: {
      write:
        '{"action":"write","content":"Important finding","category":"note"}',
      read: '{"action":"read"}',
      update: '{"action":"update","id":"entry-id","content":"Updated content"}',
      summarize: '{"action":"summarize"}',
    },
  };

  if (action && examples[toolName]?.[action]) {
    return examples[toolName][action];
  }

  // Return first example if no specific action
  const toolExamples = examples[toolName];
  if (toolExamples) {
    return Object.values(toolExamples)[0] || "{}";
  }

  return "{}";
}
