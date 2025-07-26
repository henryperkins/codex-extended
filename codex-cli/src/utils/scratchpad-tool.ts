import type { FunctionTool } from "openai/resources/responses/responses.mjs";
import { Scratchpad } from "./scratchpad.js";

/**
 * Create the scratchpad tool definition
 */
export const scratchpadTool: FunctionTool = {
  type: "function",
  name: "scratchpad",
  description: `Read and write to a persistent scratchpad for storing notes, plans, intermediate results, and state during task execution. Use this to remember important information across multiple steps.
Examples:
• Save note: {"action":"write","content":"Found bug in auth.js:42","category":"note"}
• Save plan: {"action":"write","content":"1. Fix auth 2. Test 3. Deploy","category":"plan"}
• Read all: {"action":"read"}
• Read category: {"action":"read","options":{"category":"result"}}
• Update: {"action":"update","id":"entry-id","content":"Updated info"}
• Summarize: {"action":"summarize"}`,
  strict: false,
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["write", "read", "update", "delete", "clear", "summarize"],
        description: "The action to perform on the scratchpad"
      },
      content: {
        type: "string",
        description: "Content to write or update (required for write/update actions)"
      },
      category: {
        type: "string",
        enum: ["note", "plan", "result", "error", "state"],
        description: "Category of the entry (default: note)"
      },
      id: {
        type: "string",
        description: "Entry ID (required for update/delete actions)"
      },
      options: {
        type: "object",
        properties: {
          category: {
            type: "string",
            enum: ["note", "plan", "result", "error", "state"],
            description: "Filter by category (for read action)"
          },
          limit: {
            type: "number",
            description: "Maximum number of entries to return (for read action)"
          },
          search: {
            type: "string",
            description: "Search term to filter entries (for read action)"
          }
        },
        additionalProperties: false,
        description: "Options for read action"
      }
    },
    required: ["action"],
    additionalProperties: false
  }
};

/**
 * Handle scratchpad tool calls
 */
export async function handleScratchpadTool(
  args: any,
  scratchpad: Scratchpad
): Promise<string> {
  const { action, content, category, id, options } = args;

  switch (action) {
    case "write": {
      if (!content) {
        return "Error: content is required for write action";
      }
      const entryId = await scratchpad.write(content, category || "note");
      return `Saved to scratchpad with ID: ${entryId}`;
    }

    case "read": {
      const entries = scratchpad.read(options);
      if (entries.length === 0) {
        return "No entries found in scratchpad";
      }
      
      const formatted = entries.map(entry => {
        const timestamp = new Date(entry.timestamp).toLocaleString();
        return `[${entry.category}] ${entry.id} (${timestamp})\n${entry.content}`;
      }).join('\n\n---\n\n');
      
      return `Found ${entries.length} entries:\n\n${formatted}`;
    }

    case "update": {
      if (!id || !content) {
        return "Error: id and content are required for update action";
      }
      const success = await scratchpad.update(id, content);
      return success ? `Updated entry ${id}` : `Entry ${id} not found`;
    }

    case "delete": {
      if (!id) {
        return "Error: id is required for delete action";
      }
      const success = await scratchpad.delete(id);
      return success ? `Deleted entry ${id}` : `Entry ${id} not found`;
    }

    case "clear": {
      await scratchpad.clear();
      return "Scratchpad cleared";
    }

    case "summarize": {
      return scratchpad.summarize();
    }

    default:
      return `Error: Unknown action '${action}'`;
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

  async saveResult(result: string, metadata?: Record<string, any>): Promise<string> {
    return this.scratchpad.write(result, "result", metadata);
  }

  async saveError(error: string, metadata?: Record<string, any>): Promise<string> {
    return this.scratchpad.write(error, "error", metadata);
  }

  async saveState(state: any): Promise<string> {
    return this.scratchpad.write(
      typeof state === 'string' ? state : JSON.stringify(state, null, 2),
      "state"
    );
  }

  getPlans(limit?: number): string[] {
    return this.scratchpad.read({ category: "plan", limit }).map(e => e.content);
  }

  getNotes(limit?: number): string[] {
    return this.scratchpad.read({ category: "note", limit }).map(e => e.content);
  }

  getErrors(limit?: number): Array<{ content: string; metadata?: any }> {
    return this.scratchpad.read({ category: "error", limit }).map(e => ({
      content: e.content,
      metadata: e.metadata
    }));
  }

  getRecentActivity(minutes: number = 10): string {
    const since = Date.now() - (minutes * 60 * 1000);
    const recent = this.scratchpad.read({ since });
    
    if (recent.length === 0) {
      return `No activity in the last ${minutes} minutes`;
    }

    return recent.map(e => `[${e.category}] ${e.content.substring(0, 100)}...`).join('\n');
  }
}