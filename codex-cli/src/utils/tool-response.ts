/**
 * Unified tool response format with metadata
 */

export interface ToolResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, any>;
  };
  metadata: {
    tool: string;
    executionTime: number;
    timestamp: string;
    version: string;
  };
  suggestions?: string[];
}

/**
 * Wrapper for all tool handlers to provide consistent response format
 */
export async function executeToolWithMetrics<T>(
  toolName: string,
  handler: () => Promise<T>
): Promise<ToolResponse<T>> {
  const startTime = Date.now();
  
  try {
    const data = await handler();
    return {
      success: true,
      data,
      metadata: {
        tool: toolName,
        executionTime: Date.now() - startTime,
        timestamp: new Date().toISOString(),
        version: "1.0.0"
      }
    };
  } catch (error: any) {
    return {
      success: false,
      error: {
        code: error.code || 'UNKNOWN_ERROR',
        message: error.message || 'An unknown error occurred',
        details: error.details
      },
      metadata: {
        tool: toolName,
        executionTime: Date.now() - startTime,
        timestamp: new Date().toISOString(),
        version: "1.0.0"
      },
      suggestions: error.suggestions
    };
  }
}

/**
 * Convert legacy tool output to structured response
 */
export function wrapLegacyResponse(
  toolName: string,
  output: string,
  executionTime: number,
  error?: boolean
): ToolResponse<string> {
  if (error) {
    return {
      success: false,
      error: {
        code: 'TOOL_ERROR',
        message: output
      },
      metadata: {
        tool: toolName,
        executionTime,
        timestamp: new Date().toISOString(),
        version: "1.0.0"
      }
    };
  }
  
  return {
    success: true,
    data: output,
    metadata: {
      tool: toolName,
      executionTime,
      timestamp: new Date().toISOString(),
      version: "1.0.0"
    }
  };
}

/**
 * Format tool response for output
 */
export function formatToolResponse(response: ToolResponse): string {
  if (response.success) {
    return JSON.stringify({
      output: response.data,
      metadata: {
        ...response.metadata,
        success: true
      }
    });
  } else {
    return JSON.stringify({
      error: true,
      ...response.error,
      metadata: response.metadata,
      suggestions: response.suggestions
    });
  }
}