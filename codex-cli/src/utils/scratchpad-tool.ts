import type { Scratchpad } from "./scratchpad.js";
import type { FunctionTool } from "openai/resources/responses/responses.mjs";

import {
  ToolValidationError,
  getToolExample,
} from "./tool-validation-error.js";

/**
 * Create the scratchpad tool definition
 */
export const scratchpadTool: FunctionTool = {
  type: "function",
  name: "scratchpad",
  description: `CRITICAL tool for maintaining context and tracking discoveries. USE FREQUENTLY during analysis and debugging!
Purpose: Never lose important findings, track hypotheses, maintain state across operations.
MANDATORY for: debugging sessions, multi-file analysis, error investigation, complex reasoning.

Key Actions:
• {"action":"write","content":"Important discovery or finding","category":"note"} - Save findings
• {"action":"write","content":"Error details and stack trace","category":"error"} - Track errors
• {"action":"write","content":"Strategy or approach","category":"plan"} - Document plans
• {"action":"read"} - Review all saved information
• {"action":"summarize"} - Get overview of scratchpad contents

ALWAYS use scratchpad when you discover something important or need to track state. Your future self will thank you!`,
  strict: true,
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
        description:
          "Content to write or update (required for write/update actions)",
      },
      category: {
        type: "string",
        enum: ["note", "plan", "result", "error", "state"],
        description: "Category of the entry (default: note)",
      },
      id: {
        type: "string",
        description: "Entry ID (required for update/delete actions)",
      },
      options: {
        type: "object",
        properties: {
          category: {
            type: "string",
            enum: ["note", "plan", "result", "error", "state"],
            description: "Filter by category (for read action)",
          },
          limit: {
            type: "number",
            description:
              "Maximum number of entries to return (for read action)",
          },
          search: {
            type: "string",
            description: "Search term to filter entries (for read action)",
          },
        },
        additionalProperties: false,
        description: "Options for read action",
      },
    },
    required: ["action"],
    additionalProperties: false,
  },
};

/**
 * Handle scratchpad tool calls
 */
export interface ScratchpadArgs {
  action: "write" | "read" | "update" | "delete" | "clear" | "summarize";
  content?: string;
  category?: "note" | "plan" | "result" | "error" | "state";
  id?: string;
  options?: {
    category?: "note" | "plan" | "result" | "error" | "state";
    limit?: number;
    search?: string;
  };
}

/**
 * Validate scratchpad arguments
 */
function validateScratchpadArgs(args: ScratchpadArgs): void {
  const validActions = [
    "write",
    "read",
    "update",
    "delete",
    "clear",
    "summarize",
  ];

  if (!args.action) {
    throw new ToolValidationError(
      "Action is required",
      "scratchpad",
      undefined,
      `Valid actions: ${validActions.join(", ")}`,
    );
  }

  if (!validActions.includes(args.action)) {
    throw new ToolValidationError(
      `Invalid action: ${args.action}`,
      "scratchpad",
      args.action,
      `Valid actions: ${validActions.join(", ")}`,
    );
  }

  // Action-specific validation
  if (args.action === "write" && !args.content?.trim()) {
    throw new ToolValidationError(
      "Content cannot be empty for write action",
      "scratchpad",
      "write",
      getToolExample("scratchpad", "write"),
    );
  }

  if (["update", "delete"].includes(args.action) && !args.id) {
    throw new ToolValidationError(
      `ID is required for ${args.action} action`,
      "scratchpad",
      args.action,
      getToolExample("scratchpad", args.action),
    );
  }

  if (args.action === "update" && !args.content?.trim()) {
    throw new ToolValidationError(
      "Content cannot be empty for update action",
      "scratchpad",
      "update",
      getToolExample("scratchpad", "update"),
    );
  }

  if (
    args.category &&
    !["note", "plan", "result", "error", "state"].includes(args.category)
  ) {
    throw new ToolValidationError(
      `Invalid category: ${args.category}`,
      "scratchpad",
      args.action,
      "Category must be one of: note, plan, result, error, state",
    );
  }

  if (
    args.options?.category &&
    !["note", "plan", "result", "error", "state"].includes(
      args.options.category,
    )
  ) {
    throw new ToolValidationError(
      `Invalid filter category: ${args.options.category}`,
      "scratchpad",
      args.action,
      "Category must be one of: note, plan, result, error, state",
    );
  }
}

export async function handleScratchpadTool(
  args: ScratchpadArgs,
  scratchpad: Scratchpad,
): Promise<string> {
  // Validate arguments first
  validateScratchpadArgs(args);

  const { action, content, category, id, options } = args;

  switch (action) {
    case "write": {
      // Validation already done in validateScratchpadArgs
      const entryId = await scratchpad.write(
        content as string,
        category || "note",
      );
      return `Saved to scratchpad with ID: ${entryId}`;
    }

    case "read": {
      const entries = scratchpad.read(options);
      if (entries.length === 0) {
        return "No entries found in scratchpad";
      }

      const formatted = entries
        .map((entry) => {
          const timestamp = new Date(entry.timestamp).toLocaleString();
          return `[${entry.category}] ${entry.id} (${timestamp})\n${entry.content}`;
        })
        .join("\n\n---\n\n");

      return `Found ${entries.length} entries:\n\n${formatted}`;
    }

    case "update": {
      // Validation already done in validateScratchpadArgs
      const success = await scratchpad.update(id as string, content as string);
      return success ? `Updated entry ${id}` : `Entry ${id} not found`;
    }

    case "delete": {
      // Validation already done in validateScratchpadArgs
      const success = await scratchpad.delete(id as string);
      return success ? `Deleted entry ${id}` : `Entry ${id} not found`;
    }

    case "clear": {
      await scratchpad.clear();
      return "Scratchpad cleared";
    }

    case "summarize": {
      return scratchpad.summarize();
    }
  }
}

/**
 * Create a simplified scratchpad interface for common operations
 */
export class ScratchpadInterface {
  constructor(private scratchpad: Scratchpad) {}

  async savePlan(plan: string): Promise<string> {
    return this.scratchpad.write(plan, "plan");
  }

  async saveNote(note: string): Promise<string> {
    return this.scratchpad.write(note, "note");
  }

  async saveResult(
    result: string,
    metadata?: Record<string, unknown>,
  ): Promise<string> {
    return this.scratchpad.write(result, "result", metadata);
  }

  async saveError(
    error: string,
    metadata?: Record<string, unknown>,
  ): Promise<string> {
    return this.scratchpad.write(error, "error", metadata);
  }

  async saveState(state: unknown): Promise<string> {
    return this.scratchpad.write(
      typeof state === "string" ? state : JSON.stringify(state, null, 2),
      "state",
    );
  }

  getPlans(limit?: number): Array<string> {
    return this.scratchpad
      .read({ category: "plan", limit })
      .map((e) => e.content);
  }

  getNotes(limit?: number): Array<string> {
    return this.scratchpad
      .read({ category: "note", limit })
      .map((e) => e.content);
  }

  getErrors(limit?: number): Array<{ content: string; metadata?: unknown }> {
    return this.scratchpad.read({ category: "error", limit }).map((e) => ({
      content: e.content,
      metadata: e.metadata,
    }));
  }

  getRecentActivity(minutes: number = 10): string {
    const since = Date.now() - minutes * 60 * 1000;
    const recent = this.scratchpad.read({ since });

    if (recent.length === 0) {
      return `No activity in the last ${minutes} minutes`;
    }

    return recent
      .map((e) => `[${e.category}] ${e.content.substring(0, 100)}...`)
      .join("\n");
  }
}
