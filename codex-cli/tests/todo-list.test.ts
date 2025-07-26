import { describe, it, expect, beforeEach } from "vitest";
import { TodoList } from "../src/utils/todo-list.js";

describe("TodoList", () => {
  let todoList: TodoList;

  beforeEach(() => {
    todoList = new TodoList({ autoSave: false });
  });

  describe("Basic Operations", () => {
    it("should add a new todo", async () => {
      const id = await todoList.add("Write unit tests", "high");
      expect(id).toBeTruthy();
      
      const todo = todoList.get(id);
      expect(todo).toBeDefined();
      expect(todo?.content).toBe("Write unit tests");
      expect(todo?.priority).toBe("high");
      expect(todo?.status).toBe("pending");
    });

    it("should update todo status", async () => {
      const id = await todoList.add("Implement feature", "medium");
      
      await todoList.updateStatus(id, "in_progress");
      let todo = todoList.get(id);
      expect(todo?.status).toBe("in_progress");
      
      await todoList.updateStatus(id, "completed", "Feature implemented successfully");
      todo = todoList.get(id);
      expect(todo?.status).toBe("completed");
      expect(todo?.notes).toContain("Feature implemented successfully");
      expect(todo?.completedAt).toBeDefined();
    });

    it("should get tasks by status", async () => {
      await todoList.add("Task 1", "high");
      await todoList.add("Task 2", "low");
      const id3 = await todoList.add("Task 3", "medium");
      
      await todoList.updateStatus(id3, "in_progress");
      
      const pending = todoList.getByStatus("pending");
      const inProgress = todoList.getByStatus("in_progress");
      
      expect(pending).toHaveLength(2);
      expect(inProgress).toHaveLength(1);
      expect(inProgress[0].content).toBe("Task 3");
    });
  });

  describe("Dependencies", () => {
    it("should add dependencies between tasks", async () => {
      const id1 = await todoList.add("Setup database", "high");
      const id2 = await todoList.add("Create API", "high");
      
      await todoList.addDependency(id2, id1);
      
      const blockers = todoList.getBlockingDependencies(id2);
      expect(blockers).toHaveLength(1);
      expect(blockers[0].content).toBe("Setup database");
    });

    it("should prevent completing blocked tasks", async () => {
      const id1 = await todoList.add("Write tests", "high");
      const id2 = await todoList.add("Deploy to production", "high");
      
      await todoList.addDependency(id2, id1);
      
      await expect(
        todoList.updateStatus(id2, "completed")
      ).rejects.toThrow("Cannot update status. Task is blocked by");
    });

    it("should detect circular dependencies", async () => {
      const id1 = await todoList.add("Task A", "medium");
      const id2 = await todoList.add("Task B", "medium");
      const id3 = await todoList.add("Task C", "medium");
      
      await todoList.addDependency(id2, id1);
      await todoList.addDependency(id3, id2);
      
      await expect(
        todoList.addDependency(id1, id3)
      ).rejects.toThrow("Cannot add dependency: would create circular dependency");
    });
  });

  describe("Progress Tracking", () => {
    it("should calculate progress correctly", async () => {
      const id1 = await todoList.add("Task 1", "high");
      const id2 = await todoList.add("Task 2", "medium");
      const id3 = await todoList.add("Task 3", "low");
      
      await todoList.updateStatus(id1, "completed");
      await todoList.updateStatus(id2, "in_progress");
      
      const progress = todoList.getProgress();
      
      expect(progress.total).toBe(3);
      expect(progress.completed).toBe(1);
      expect(progress.inProgress).toBe(1);
      expect(progress.pending).toBe(1);
      expect(progress.completionRate).toBeCloseTo(33.33, 1);
    });

    it("should get actionable tasks", async () => {
      const id1 = await todoList.add("Prerequisite", "high");
      const id2 = await todoList.add("Dependent task", "high");
      const id3 = await todoList.add("Independent task", "medium");
      
      await todoList.addDependency(id2, id1);
      
      let actionable = todoList.getActionableTasks();
      expect(actionable).toHaveLength(2);
      expect(actionable.map(t => t.content)).toContain("Prerequisite");
      expect(actionable.map(t => t.content)).toContain("Independent task");
      
      // Complete prerequisite
      await todoList.updateStatus(id1, "completed");
      
      actionable = todoList.getActionableTasks();
      expect(actionable).toHaveLength(2);
      expect(actionable.map(t => t.content)).toContain("Dependent task");
    });
  });

  describe("Summary Generation", () => {
    it("should generate formatted summary", async () => {
      await todoList.add("High priority task", "high");
      await todoList.add("Medium priority task", "medium");
      const id3 = await todoList.add("Completed task", "low");
      
      await todoList.updateStatus(id3, "completed");
      
      const summary = todoList.getSummary();
      
      expect(summary).toContain("Task Progress: 1/3");
      expect(summary).toContain("33.3%");
      expect(summary).toContain("✅ Completed: 1");
      expect(summary).toContain("🟠 High: 1");
      expect(summary).toContain("🟡 Medium: 1");
    });
  });

  describe("Cleanup", () => {
    it("should clear completed tasks", async () => {
      const id1 = await todoList.add("Task 1", "high");
      const id2 = await todoList.add("Task 2", "medium");
      const id3 = await todoList.add("Task 3", "low");
      
      await todoList.updateStatus(id1, "completed");
      await todoList.updateStatus(id3, "completed");
      
      const cleared = await todoList.clearCompleted();
      
      expect(cleared).toBe(2);
      expect(todoList.getAll()).toHaveLength(1);
      expect(todoList.get(id2)).toBeDefined();
    });
  });
});