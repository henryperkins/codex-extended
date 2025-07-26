import type { TodoList } from "./todo-list.js";
import type { FunctionTool } from "openai/resources/responses/responses.mjs";

/**
 * Create the todo list tool definition
 */
export const todoListTool: FunctionTool = {
  type: "function",
  name: "todo_list",
  description: `Manage a structured TODO list to track tasks, subtasks, and dependencies during complex multi-step operations. Helps maintain focus and ensure all steps are completed.
Examples:
• Add task: {"action":"add","content":"Implement feature X","priority":"high"}
• List tasks: {"action":"list"} or {"action":"list","status":"pending"}
• Start task: {"action":"start","id":"task-id"}
• Complete: {"action":"complete","id":"task-id","notes":"Fixed by..."}
• Next tasks: {"action":"next"}`,
  strict: false,
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["add", "update", "list", "summary", "next", "complete", "block", "start", "add_dependency", "clear_completed"],
        description: "The action to perform on the todo list"
      },
      content: {
        type: "string",
        description: "Task description (required for add action)"
      },
      id: {
        type: "string",
        description: "Task ID (required for update/complete/block/start/add_dependency)"
      },
      priority: {
        type: "string",
        enum: ["low", "medium", "high", "critical"],
        description: "Task priority (default: medium)"
      },
      parentId: {
        type: "string",
        description: "Parent task ID for creating subtasks"
      },
      dependsOnId: {
        type: "string",
        description: "ID of task that must be completed first (for add_dependency)"
      },
      status: {
        type: "string",
        enum: ["pending", "in_progress", "completed", "blocked"],
        description: "Filter by status (for list action)"
      },
      notes: {
        type: "string",
        description: "Additional notes when updating task status"
      }
    },
    required: ["action"],
    additionalProperties: false
  }
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

export async function handleTodoListTool(
  args: TodoListArgs,
  todoList: TodoList
): Promise<string> {
  const { action, content, id, priority, parentId, dependsOnId, status, notes } = args;

  switch (action) {
    case "add": {
      if (!content) {
        return "Error: content is required for add action";
      }
      try {
        const taskId = await todoList.add(content, priority || "medium", parentId);
        const progress = todoList.getProgress();
        return `✅ Added task: ${taskId}\n${content}\nTotal tasks: ${progress.total} (${progress.pending} pending)`;
      } catch (error) {
        return `Error adding task: ${error instanceof Error ? error.message : String(error)}`;
      }
    }

    case "update": {
      if (!id || !status) {
        return "Error: id and status are required for update action";
      }
      try {
        const success = await todoList.updateStatus(id, status, notes);
        if (!success) {
          return `Task ${id} not found`;
        }
        const task = todoList.get(id);
        return `Updated task ${id} to ${status}: ${task?.content}`;
      } catch (error) {
        return `Error updating task: ${error instanceof Error ? error.message : String(error)}`;
      }
    }

    case "complete": {
      if (!id) {
        return "Error: id is required for complete action";
      }
      try {
        const success = await todoList.updateStatus(id, "completed", notes);
        if (!success) {
          return `Task ${id} not found`;
        }
        const task = todoList.get(id);
        const progress = todoList.getProgress();
        return `✅ Completed: ${task?.content}\nProgress: ${progress.completed}/${progress.total} (${progress.completionRate.toFixed(1)}%)`;
      } catch (error) {
        return `Error completing task: ${error instanceof Error ? error.message : String(error)}`;
      }
    }

    case "start": {
      if (!id) {
        return "Error: id is required for start action";
      }
      try {
        const success = await todoList.updateStatus(id, "in_progress", notes);
        if (!success) {
          return `Task ${id} not found`;
        }
        const task = todoList.get(id);
        return `🔄 Started: ${task?.content}`;
      } catch (error) {
        return `Error starting task: ${error instanceof Error ? error.message : String(error)}`;
      }
    }

    case "block": {
      if (!id) {
        return "Error: id is required for block action";
      }
      const success = await todoList.updateStatus(id, "blocked", notes);
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
        return status ? `No tasks with status: ${status}` : "No tasks in the list";
      }

      const formatTask = (task: {
        id: string;
        content: string;
        status: string;
        priority: string;
        dependencies?: Array<string>;
        notes?: string;
      }, indent = "") => {
        const statusEmoji = {
          pending: "⏳",
          in_progress: "🔄",
          completed: "✅",
          blocked: "🚫"
        }[task.status];

        const priorityEmoji = {
          critical: "🔴",
          high: "🟠",
          medium: "🟡",
          low: "🟢"
        }[task.priority];

        let line = `${indent}${statusEmoji} ${priorityEmoji} [${task.id.slice(0, 8)}] ${task.content}`;
        
        if (task.dependencies && task.dependencies.length > 0) {
          const blockers = todoList.getBlockingDependencies(task.id);
          if (blockers.length > 0) {
            line += ` (blocked by: ${blockers.map(b => b.content).join(", ")})`;
          }
        }
        
        if (task.notes) {
          line += `\n${indent}   📝 ${task.notes.replace(/\n/g, `\n${indent}   `)}`;
        }

        return line;
      };

      // Group by parent
      const rootTasks = tasks.filter(t => !t.parentId);
      const subtasks = tasks.filter(t => t.parentId);

      let output = "";
      rootTasks.forEach(task => {
        output += formatTask(task) + "\n";
        const children = subtasks.filter(t => t.parentId === task.id);
        children.forEach(child => {
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
          return `No new tasks available. Current tasks in progress:\n${
            inProgress.map(t => `🔄 ${t.content}`).join("\n")
          }`;
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
          low: "🟢"
        }[task.priority];
        
        return `${priorityEmoji} [${task.id.slice(0, 8)}] ${task.content}`;
      };

      return `🎯 Next actionable tasks:\n${actionable.slice(0, 5).map(formatTask).join("\n")}`;
    }

    case "add_dependency": {
      if (!id || !dependsOnId) {
        return "Error: id and dependsOnId are required for add_dependency action";
      }
      try {
        const success = await todoList.addDependency(id, dependsOnId);
        if (!success) {
          return "One or both tasks not found";
        }
        const task = todoList.get(id);
        const dependency = todoList.get(dependsOnId);
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