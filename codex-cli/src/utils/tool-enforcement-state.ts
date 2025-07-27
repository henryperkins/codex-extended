/**
 * State machine for tracking and enforcing tool usage requirements
 */
export class ToolEnforcementState {
  private requiredTools: Set<string> = new Set();
  private recommendedTools: Set<string> = new Set();
  private usedTools: Map<string, number> = new Map();
  private taskStartTime: number = Date.now();
  private taskDescription: string = "";
  private enforcementEnabled: boolean = true;
  private toolCallHistory: Array<{
    tool: string;
    action?: string;
    timestamp: number;
    success: boolean;
  }> = [];

  constructor(
    taskDescription: string = "",
    enforcementEnabled: boolean = true,
  ) {
    this.taskDescription = taskDescription;
    this.enforcementEnabled = enforcementEnabled;
  }

  /**
   * Mark a tool as required for the current task
   */
  requireTool(toolName: string): void {
    this.requiredTools.add(toolName);
  }

  /**
   * Mark multiple tools as required
   */
  requireTools(toolNames: Array<string>): void {
    toolNames.forEach((tool) => this.requiredTools.add(tool));
  }

  /**
   * Mark a tool as recommended (not enforced)
   */
  recommendTool(toolName: string): void {
    this.recommendedTools.add(toolName);
  }

  /**
   * Record that a tool was used
   */
  recordToolUse(
    toolName: string,
    action?: string,
    success: boolean = true,
  ): void {
    const currentCount = this.usedTools.get(toolName) || 0;
    this.usedTools.set(toolName, currentCount + 1);

    this.toolCallHistory.push({
      tool: toolName,
      action,
      timestamp: Date.now(),
      success,
    });
  }

  /**
   * Check if all required tools have been used
   */
  validateProgress(): {
    valid: boolean;
    missing: Array<string>;
    used: Array<string>;
    recommendations: Array<string>;
  } {
    const missing = Array.from(this.requiredTools).filter(
      (tool) => !this.usedTools.has(tool),
    );

    const unusedRecommendations = Array.from(this.recommendedTools).filter(
      (tool) => !this.usedTools.has(tool),
    );

    return {
      valid: missing.length === 0 || !this.enforcementEnabled,
      missing,
      used: Array.from(this.usedTools.keys()),
      recommendations: unusedRecommendations,
    };
  }

  /**
   * Get a summary of tool usage
   */
  getSummary(): {
    taskDescription: string;
    duration: number;
    requiredTools: Array<string>;
    usedTools: Map<string, number>;
    completionRate: number;
    history: Array<{
      tool: string;
      action?: string;
      timestamp: number;
      success: boolean;
    }>;
  } {
    const duration = Date.now() - this.taskStartTime;
    const requiredCount = this.requiredTools.size;
    const usedRequiredCount = Array.from(this.requiredTools).filter((tool) =>
      this.usedTools.has(tool),
    ).length;

    return {
      taskDescription: this.taskDescription,
      duration,
      requiredTools: Array.from(this.requiredTools),
      usedTools: this.usedTools,
      completionRate: requiredCount > 0 ? usedRequiredCount / requiredCount : 1,
      history: this.toolCallHistory,
    };
  }

  /**
   * Check if a specific tool is required
   */
  isToolRequired(toolName: string): boolean {
    return this.requiredTools.has(toolName);
  }

  /**
   * Check if a specific tool has been used
   */
  hasUsedTool(toolName: string): boolean {
    return this.usedTools.has(toolName);
  }

  /**
   * Get the number of times a tool has been used
   */
  getToolUseCount(toolName: string): number {
    return this.usedTools.get(toolName) || 0;
  }

  /**
   * Reset the state for a new task
   */
  reset(taskDescription: string = ""): void {
    this.requiredTools.clear();
    this.recommendedTools.clear();
    this.usedTools.clear();
    this.toolCallHistory = [];
    this.taskStartTime = Date.now();
    this.taskDescription = taskDescription;
  }

  /**
   * Enable or disable enforcement
   */
  setEnforcementEnabled(enabled: boolean): void {
    this.enforcementEnabled = enabled;
  }

  /**
   * Check if enforcement is enabled
   */
  isEnforcementEnabled(): boolean {
    return this.enforcementEnabled;
  }

  /**
   * Generate a helpful message about missing tools
   */
  getMissingToolsMessage(): string {
    const validation = this.validateProgress();

    if (validation.valid) {
      return "";
    }

    const messages: Array<string> = [];

    if (validation.missing.length > 0) {
      messages.push(
        `⚠️ Required tools not yet used: ${validation.missing.join(", ")}. ` +
          `You must use these tools before proceeding with the task.`,
      );

      // Add specific guidance for each missing tool
      for (const tool of validation.missing) {
        if (tool === "todo_list") {
          messages.push(
            "📋 Use the todo_list tool to create and organize your tasks. " +
              'Example: {"action":"add","content":"Task description","priority":"high"}',
          );
        } else if (tool === "scratchpad") {
          messages.push(
            "📝 Use the scratchpad tool to track findings and maintain context. " +
              'Example: {"action":"write","content":"Important finding","category":"note"}',
          );
        }
      }
    }

    if (
      validation.recommendations.length > 0 &&
      validation.missing.length === 0
    ) {
      messages.push(
        `💡 Consider using these recommended tools: ${validation.recommendations.join(", ")}`,
      );
    }

    return messages.join("\n");
  }
}
