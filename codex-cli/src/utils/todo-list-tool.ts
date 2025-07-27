import type { TodoList } from "./todo-list.js";
import type { FunctionTool } from "openai/resources/responses/responses.mjs";

import {
  ToolValidationError,
  getToolExample,
} from "./tool-validation-error.js";

/**
 * Create the todo list tool definition
 */
export const todoListTool: FunctionTool = {
  type: "function",
  name: "todo_list",
  description: `ESSENTIAL tool for professional task management. USE IMMEDIATELY when starting any multi-step task!
Purpose: Ensure nothing is missed, track progress systematically, manage dependencies.
MANDATORY for: implementations, bug fixes, features, refactoring, multi-file changes, analysis tasks.

Key Actions:
• {"action":"add","content":"Clear task description","priority":"high"} - Add new task
• {"action":"list"} - View all tasks with status
• {"action":"next"} - Get actionable tasks to work on
• {"action":"start","id":"task-id"} - Mark task as in progress
• {"action":"complete","id":"task-id","notes":"Implementation details"} - Complete task

ALWAYS start complex tasks by creating a todo list. Professional developers plan before coding!

REMINDER: This is a TOOL, not a shell command. Use through function calls, NOT as '$ todo_list' in bash!`,
  strict: true,
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: [
          "add",
          "update",
          "list",
          "summary",
          "next",
          "complete",
          "block",
          "start",
          "add_dependency",
          "clear_completed",
        ],
        description: "The action to perform on the todo list",
      },
      content: {
        type: "string",
        description: "Task description (required for add action)",
      },
      id: {
        type: "string",
        description:
          "Task ID (required for update/complete/block/start/add_dependency)",
      },
      priority: {
        type: "string",
        enum: ["low", "medium", "high", "critical"],
        description: "Task priority (default: medium)",
      },
      parentId: {
        type: "string",
        description: "Parent task ID for creating subtasks",
      },
      dependsOnId: {
        type: "string",
        description:
          "ID of task that must be completed first (for add_dependency)",
      },
      status: {
        type: "string",
        enum: ["pending", "in_progress", "completed", "blocked"],
        description: "Filter by status (for list action)",
      },
      notes: {
        type: "string",
        description: "Additional notes when updating task status",
      },
    },
    required: ["action"],
    additionalProperties: false,
  },
};

/**
 * Handle todo list tool calls
 */
export interface TodoListArgs {
  action: string;
  content?: string;
  id?: string;
  priority?: "low" | "medium" | "high" | "critical";
  parentId?: string;
  dependsOnId?: string;
  status?: "pending" | "in_progress" | "completed" | "blocked";
  notes?: string;
}

/**
 * Validate todo list arguments
 */
function validateTodoArgs(args: TodoListArgs): void {
  const validActions = [
    "add",
    "update",
    "list",
    "summary",
    "next",
    "complete",
    "block",
    "start",
    "add_dependency",
    "clear_completed",
  ];

  if (!args.action) {
    throw new ToolValidationError(
      "Action is required",
      "todo_list",
      undefined,
      `Valid actions: ${validActions.join(", ")}`,
    );
  }

  if (!validActions.includes(args.action)) {
    throw new ToolValidationError(
      `Invalid action: ${args.action}`,
      "todo_list",
      args.action,
      `Valid actions: ${validActions.join(", ")}`,
    );
  }

  // Action-specific validation
  if (args.action === "add" && !args.content?.trim()) {
    throw new ToolValidationError(
      "Content cannot be empty for add action",
      "todo_list",
      "add",
      getToolExample("todo_list", "add"),
    );
  }

  if (
    ["update", "complete", "block", "start"].includes(args.action) &&
    !args.id
  ) {
    throw new ToolValidationError(
      `ID is required for ${args.action} action`,
      "todo_list",
      args.action,
      getToolExample("todo_list", args.action),
    );
  }

  if (args.action === "update" && !args.status) {
    throw new ToolValidationError(
      "Status is required for update action",
      "todo_list",
      "update",
      "Status must be one of: pending, in_progress, completed, blocked",
    );
  }

  if (args.action === "add_dependency" && (!args.id || !args.dependsOnId)) {
    throw new ToolValidationError(
      "Both id and dependsOnId are required for add_dependency action",
      "todo_list",
      "add_dependency",
      getToolExample("todo_list", "add_dependency"),
    );
  }

  if (
    args.priority &&
    !["low", "medium", "high", "critical"].includes(args.priority)
  ) {
    throw new ToolValidationError(
      `Invalid priority: ${args.priority}`,
      "todo_list",
      args.action,
      "Priority must be one of: low, medium, high, critical",
    );
  }

  if (
    args.status &&
    !["pending", "in_progress", "completed", "blocked"].includes(args.status)
  ) {
    throw new ToolValidationError(
      `Invalid status: ${args.status}`,
      "todo_list",
      args.action,
      "Status must be one of: pending, in_progress, completed, blocked",
    );
  }
}

export async function handleTodoListTool(
  args: TodoListArgs,
  todoList: TodoList,
): Promise<string> {
  // Validate arguments first
  validateTodoArgs(args);

  const {
    action,
    content,
    id,
    priority,
    parentId,
    dependsOnId,
    status,
    notes,
  } = args;

  switch (action) {
    case "add": {
      // Validation already done in validateTodoArgs
      try {
        const taskId = await todoList.add(
          content as string,
          priority || "medium",
          parentId,
        );
        const progress = todoList.getProgress();
        return `✅ Added task: ${taskId}\n${content}\nTotal tasks: ${progress.total} (${progress.pending} pending)`;
      } catch (error) {
        return `Error adding task: ${error instanceof Error ? error.message : String(error)}`;
      }
    }

    case "update": {
      // Validation already done in validateTodoArgs
      try {
        const success = await todoList.updateStatus(
          id as string,
          status as "pending" | "in_progress" | "completed" | "blocked",
          notes,
        );
        if (!success) {
          return `Task ${id} not found`;
        }
        const task = todoList.get(id as string);
        return `Updated task ${id} to ${status}: ${task?.content}`;
      } catch (error) {
        return `Error updating task: ${error instanceof Error ? error.message : String(error)}`;
      }
    }

    case "complete": {
      // Validation already done in validateTodoArgs
      try {
        const success = await todoList.updateStatus(
          id as string,
          "completed",
          notes,
        );
        if (!success) {
          return `Task ${id} not found`;
        }
        const task = todoList.get(id as string);
        const progress = todoList.getProgress();
        return `✅ Completed: ${task?.content}\nProgress: ${progress.completed}/${progress.total} (${progress.completionRate.toFixed(1)}%)`;
      } catch (error) {
        return `Error completing task: ${error instanceof Error ? error.message : String(error)}`;
      }
    }

    case "start": {
      // Validation already done in validateTodoArgs
      try {
        const success = await todoList.updateStatus(
          id as string,
          "in_progress",
          notes,
        );
        if (!success) {
          return `Task ${id} not found`;
        }
        const task = todoList.get(id as string);
        return `🔄 Started: ${task?.content}`;
      } catch (error) {
        return `Error starting task: ${error instanceof Error ? error.message : String(error)}`;
      }
    }

    case "block": {
      // Validation already done in validateTodoArgs
      const success = await todoList.updateStatus(
        id as string,
        "blocked",
        notes,
      );
      if (!success) {
        return `Task ${id} not found`;
      }
      const task = todoList.get(id);
      return `🚫 Blocked: ${task?.content}${notes ? `\nReason: ${notes}` : ""}`;
    }

    case "list": {
      let tasks: Array<{
        id: string;
        content: string;
        status: string;
        priority: string;
        parentId?: string;
        dependencies?: Array<string>;
        notes?: string;
      }> = [];

      if (status) {
        tasks = todoList.getByStatus(status);
      } else {
        tasks = todoList.getAll();
      }

      if (tasks.length === 0) {
        return status
          ? `No tasks with status: ${status}`
          : "No tasks in the list";
      }

      const formatTask = (
        task: {
          id: string;
          content: string;
          status: string;
          priority: string;
          dependencies?: Array<string>;
          notes?: string;
        },
        indent = "",
      ) => {
        const statusEmoji = {
          pending: "⏳",
          in_progress: "🔄",
          completed: "✅",
          blocked: "🚫",
        }[task.status];

        const priorityEmoji = {
          critical: "🔴",
          high: "🟠",
          medium: "🟡",
          low: "🟢",
        }[task.priority];

        let line = `${indent}${statusEmoji} ${priorityEmoji} [${task.id.slice(0, 8)}] ${task.content}`;

        if (task.dependencies && task.dependencies.length > 0) {
          const blockers = todoList.getBlockingDependencies(task.id);
          if (blockers.length > 0) {
            line += ` (blocked by: ${blockers.map((b) => b.content).join(", ")})`;
          }
        }

        if (task.notes) {
          line += `\n${indent}   📝 ${task.notes.replace(/\n/g, `\n${indent}   `)}`;
        }

        return line;
      };

      // Group by parent
      const rootTasks = tasks.filter((t) => !t.parentId);
      const subtasks = tasks.filter((t) => t.parentId);

      let output = "";
      rootTasks.forEach((task) => {
        output += formatTask(task) + "\n";
        const children = subtasks.filter((t) => t.parentId === task.id);
        children.forEach((child) => {
          output += formatTask(child, "  ") + "\n";
        });
      });

      const progress = todoList.getProgress();
      output += `\n📊 Total: ${progress.total} | ✅ Done: ${progress.completed} | 🔄 Active: ${progress.inProgress} | ⏳ Pending: ${progress.pending}`;

      return output.trim();
    }

    case "summary": {
      return todoList.getSummary();
    }

    case "next": {
      const actionable = todoList.getActionableTasks();

      if (actionable.length === 0) {
        const inProgress = todoList.getByStatus("in_progress");
        if (inProgress.length > 0) {
          return `No new tasks available. Current tasks in progress:\n${inProgress
            .map((t) => `🔄 ${t.content}`)
            .join("\n")}`;
        }
        return "No actionable tasks available. All tasks are either completed, in progress, or blocked.";
      }

      const formatTask = (task: {
        content: string;
        priority: string;
        id: string;
      }) => {
        const priorityEmoji = {
          critical: "🔴",
          high: "🟠",
          medium: "🟡",
          low: "🟢",
        }[task.priority];

        return `${priorityEmoji} [${task.id.slice(0, 8)}] ${task.content}`;
      };

      return `🎯 Next actionable tasks:\n${actionable.slice(0, 5).map(formatTask).join("\n")}`;
    }

    case "add_dependency": {
      // Validation already done in validateTodoArgs
      try {
        const success = await todoList.addDependency(
          id as string,
          dependsOnId as string,
        );
        if (!success) {
          return "One or both tasks not found";
        }
        const task = todoList.get(id as string);
        const dependency = todoList.get(dependsOnId as string);
        return `Added dependency: "${task?.content}" now depends on "${dependency?.content}"`;
      } catch (error) {
        return `Error adding dependency: ${error instanceof Error ? error.message : String(error)}`;
      }
    }

    case "clear_completed": {
      const cleared = await todoList.clearCompleted();
      return `Cleared ${cleared} completed tasks`;
    }

    default:
      return `Unknown action: ${action}`;
  }
}
