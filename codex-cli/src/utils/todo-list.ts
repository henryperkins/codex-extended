import { randomUUID } from "node:crypto";
import { writeFileSync, readFileSync, existsSync } from "node:fs";

export interface TodoItem {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed" | "blocked";
  priority: "low" | "medium" | "high" | "critical";
  createdAt: number;
  updatedAt: number;
  parentId?: string; // For subtasks
  dependencies?: Array<string>; // IDs of tasks that must be completed first
  notes?: string;
  completedAt?: number;
}

export interface TodoListOptions {
  filePath?: string;
  autoSave?: boolean;
  maxItems?: number;
}

/**
 * TodoList manager for helping AI models track tasks during complex operations
 */
export class TodoList {
  private todos: Map<string, TodoItem> = new Map();
  private filePath?: string;
  private autoSaveEnabled: boolean;
  private maxItems: number;

  constructor(options: TodoListOptions = {}) {
    this.filePath = options.filePath;
    this.autoSaveEnabled = options.autoSave ?? true;
    this.maxItems = options.maxItems ?? 100;

    if (this.filePath && existsSync(this.filePath)) {
      this.load();
    }
  }

  /**
   * Add a new todo item
   */
  async add(
    content: string,
    priority: TodoItem["priority"] = "medium",
    parentId?: string,
  ): Promise<string> {
    if (this.todos.size >= this.maxItems) {
      throw new Error(`Maximum number of todos (${this.maxItems}) reached`);
    }

    const id = randomUUID();
    const now = Date.now();

    const todo: TodoItem = {
      id,
      content,
      status: "pending",
      priority,
      createdAt: now,
      updatedAt: now,
      parentId,
    };

    this.todos.set(id, todo);

    if (this.autoSaveEnabled) {
      await this.save();
    }

    return id;
  }

  /**
   * Update todo status
   */
  async updateStatus(
    id: string,
    status: TodoItem["status"],
    notes?: string,
  ): Promise<boolean> {
    const todo = this.todos.get(id);
    if (!todo) {
      return false;
    }

    // Check dependencies before marking as in_progress or completed
    if (
      (status === "in_progress" || status === "completed") &&
      todo.dependencies
    ) {
      const blockers = this.getBlockingDependencies(id);
      if (blockers.length > 0) {
        throw new Error(
          `Cannot update status. Task is blocked by: ${blockers.map((b) => b.content).join(", ")}`,
        );
      }
    }

    todo.status = status;
    todo.updatedAt = Date.now();

    if (notes) {
      todo.notes = (todo.notes ? todo.notes + "\n" : "") + notes;
    }

    if (status === "completed") {
      todo.completedAt = Date.now();
    }

    if (this.autoSaveEnabled) {
      await this.save();
    }

    return true;
  }

  /**
   * Get tasks by status
   */
  getByStatus(status: TodoItem["status"]): Array<TodoItem> {
    return Array.from(this.todos.values())
      .filter((todo) => todo.status === status)
      .sort((a, b) => {
        // Sort by priority first, then by creation time
        const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
        const priorityDiff =
          priorityOrder[a.priority] - priorityOrder[b.priority];
        return priorityDiff !== 0 ? priorityDiff : a.createdAt - b.createdAt;
      });
  }

  /**
   * Get next actionable tasks (not blocked by dependencies)
   */
  getActionableTasks(): Array<TodoItem> {
    return Array.from(this.todos.values())
      .filter((todo) => {
        if (todo.status !== "pending") {
          return false;
        }
        if (!todo.dependencies || todo.dependencies.length === 0) {
          return true;
        }

        // Check if all dependencies are completed
        return todo.dependencies.every((depId) => {
          const dep = this.todos.get(depId);
          return dep && dep.status === "completed";
        });
      })
      .sort((a, b) => {
        const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      });
  }

  /**
   * Get blocking dependencies for a task
   */
  getBlockingDependencies(id: string): Array<TodoItem> {
    const todo = this.todos.get(id);
    if (!todo || !todo.dependencies) {
      return [];
    }

    return todo.dependencies
      .map((depId) => this.todos.get(depId))
      .filter((dep) => dep && dep.status !== "completed") as Array<TodoItem>;
  }

  /**
   * Add dependency between tasks
   */
  async addDependency(taskId: string, dependsOnId: string): Promise<boolean> {
    const task = this.todos.get(taskId);
    const dependency = this.todos.get(dependsOnId);

    if (!task || !dependency) {
      return false;
    }

    // Prevent circular dependencies
    if (this.wouldCreateCircularDependency(taskId, dependsOnId)) {
      throw new Error(
        "Cannot add dependency: would create circular dependency",
      );
    }

    if (!task.dependencies) {
      task.dependencies = [];
    }

    if (!task.dependencies.includes(dependsOnId)) {
      task.dependencies.push(dependsOnId);
      task.updatedAt = Date.now();

      if (this.autoSaveEnabled) {
        await this.save();
      }
    }

    return true;
  }

  /**
   * Check for circular dependencies
   */
  private wouldCreateCircularDependency(
    taskId: string,
    dependsOnId: string,
  ): boolean {
    const visited = new Set<string>();

    const hasCycle = (currentId: string): boolean => {
      if (currentId === taskId) {
        return true;
      }
      if (visited.has(currentId)) {
        return false;
      }

      visited.add(currentId);
      const current = this.todos.get(currentId);

      if (current?.dependencies) {
        for (const depId of current.dependencies) {
          if (hasCycle(depId)) {
            return true;
          }
        }
      }

      return false;
    };

    return hasCycle(dependsOnId);
  }

  /**
   * Get progress summary
   */
  getProgress(): {
    total: number;
    completed: number;
    inProgress: number;
    pending: number;
    blocked: number;
    completionRate: number;
    byPriority: Record<TodoItem["priority"], number>;
  } {
    const todos = Array.from(this.todos.values());
    const byStatus = todos.reduce(
      (acc, todo) => {
        acc[todo.status] = (acc[todo.status] || 0) + 1;
        return acc;
      },
      {} as Record<TodoItem["status"], number>,
    );

    const byPriority = todos.reduce(
      (acc, todo) => {
        if (todo.status !== "completed") {
          acc[todo.priority] = (acc[todo.priority] || 0) + 1;
        }
        return acc;
      },
      {} as Record<TodoItem["priority"], number>,
    );

    const total = todos.length;
    const completed = byStatus.completed || 0;

    return {
      total,
      completed,
      inProgress: byStatus.in_progress || 0,
      pending: byStatus.pending || 0,
      blocked: byStatus.blocked || 0,
      completionRate: total > 0 ? (completed / total) * 100 : 0,
      byPriority,
    };
  }

  /**
   * Get formatted summary
   */
  getSummary(): string {
    const progress = this.getProgress();
    const actionable = this.getActionableTasks();

    let summary = `📋 Task Progress: ${progress.completed}/${progress.total} (${progress.completionRate.toFixed(1)}%)\n`;
    summary += `   ✅ Completed: ${progress.completed}\n`;
    summary += `   🔄 In Progress: ${progress.inProgress}\n`;
    summary += `   ⏳ Pending: ${progress.pending}\n`;
    summary += `   🚫 Blocked: ${progress.blocked}\n`;

    if (Object.keys(progress.byPriority).length > 0) {
      summary += `\n📊 Remaining by Priority:\n`;
      if (progress.byPriority.critical) {
        summary += `   🔴 Critical: ${progress.byPriority.critical}\n`;
      }
      if (progress.byPriority.high) {
        summary += `   🟠 High: ${progress.byPriority.high}\n`;
      }
      if (progress.byPriority.medium) {
        summary += `   🟡 Medium: ${progress.byPriority.medium}\n`;
      }
      if (progress.byPriority.low) {
        summary += `   🟢 Low: ${progress.byPriority.low}\n`;
      }
    }

    if (actionable.length > 0) {
      summary += `\n🎯 Next actionable tasks:\n`;
      actionable.slice(0, 5).forEach((task) => {
        const priorityEmoji = {
          critical: "🔴",
          high: "🟠",
          medium: "🟡",
          low: "🟢",
        }[task.priority];
        summary += `   ${priorityEmoji} ${task.content}\n`;
      });
    }

    return summary;
  }

  /**
   * Clear completed tasks
   */
  async clearCompleted(): Promise<number> {
    const completed = Array.from(this.todos.entries())
      .filter(([_, todo]) => todo.status === "completed")
      .map(([id, _]) => id);

    for (const id of completed) {
      this.todos.delete(id);
    }

    if (this.autoSaveEnabled) {
      await this.save();
    }

    return completed.length;
  }

  /**
   * Save to file
   */
  async save(): Promise<void> {
    if (!this.filePath) {
      return;
    }

    const data = {
      version: 1,
      todos: Array.from(this.todos.entries()),
      savedAt: Date.now(),
    };

    writeFileSync(this.filePath, JSON.stringify(data, null, 2), "utf-8");
  }

  /**
   * Load from file
   */
  private load(): void {
    if (!this.filePath || !existsSync(this.filePath)) {
      return;
    }

    try {
      const content = readFileSync(this.filePath, "utf-8");
      const data = JSON.parse(content);

      if (
        data.version === 1 &&
        Array.isArray(data.todos) &&
        data.todos.every(
          (pair: unknown) =>
            Array.isArray(pair) &&
            pair.length === 2 &&
            typeof pair[0] === "string" &&
            typeof pair[1] === "object" &&
            pair[1] != null &&
            typeof (pair[1] as Record<string, unknown>)["content"] ===
              "string" &&
            typeof (pair[1] as Record<string, unknown>)["status"] === "string",
        )
      ) {
        this.todos = new Map(data.todos as Array<[string, TodoItem]>);
      } else {
        // Invalid format, skip loading
        return;
      }
    } catch (error) {
      // Failed to load todo list
    }
  }

  /**
   * Get all todos
   */
  getAll(): Array<TodoItem> {
    return Array.from(this.todos.values());
  }

  /**
   * Get a specific todo
   */
  get(id: string): TodoItem | undefined {
    return this.todos.get(id);
  }
}
