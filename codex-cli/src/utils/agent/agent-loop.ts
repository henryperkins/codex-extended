import type { ReviewDecision } from "./review.js";
import type { ApplyPatchCommand, ApprovalPolicy } from "../../approvals.js";
import type { AppConfig } from "../config.js";
import type { ResponseEvent } from "../responses.js";
import type { ExecInput } from "./sandbox/interface.js";
import type {
  ResponseFunctionToolCall,
  ResponseInputItem,
  ResponseItem,
  ResponseCreateParams,
  FunctionTool,
  Tool,
} from "openai/resources/responses/responses.mjs";
import type { Reasoning } from "openai/resources.mjs";

import { CLI_VERSION } from "../../version.js";
import {
  OPENAI_TIMEOUT_MS,
  OPENAI_ORGANIZATION,
  OPENAI_PROJECT,
  getBaseUrl,
  getApiKey,
  AZURE_OPENAI_API_VERSION,
} from "../config.js";
import { log } from "../logger/log.js";
import { parseToolCallArguments } from "../parsers.js";
import { responsesCreateViaChatCompletions } from "../responses.js";
import {
  scratchpadTool,
  handleScratchpadTool,
  type ScratchpadArgs,
} from "../scratchpad-tool.js";
import { Scratchpad } from "../scratchpad.js";
import {
  ORIGIN,
  getSessionId,
  setCurrentModel,
  setSessionId,
} from "../session.js";
import {
  fetchUrlStructured,
  searchWebStructured,
  truncateForAzure,
} from "../structured-helpers.js";
import {
  todoListTool,
  handleTodoListTool,
  type TodoListArgs,
} from "../todo-list-tool.js";
import { TodoList } from "../todo-list.js";
import { ToolEnforcementState } from "../tool-enforcement-state.js";
import {
  ToolExecutionError,
  ERROR_CODES,
  getErrorMessage,
  getExpectedFormat,
  getToolExample,
} from "../tool-errors.js";
import { selectToolsForQuery, getRequiredTools } from "../tool-selection.js";
import {
  ToolValidationError,
  getToolExample as getToolValidationExample,
} from "../tool-validation-error.js";
import {
  toolsInfoTool,
  handleToolsInfo,
  type ToolsInfoArgs,
} from "../tools-info-tool.js";
import { applyPatchToolInstructions } from "./apply-patch.js";
import { handleExecCommand } from "./handle-exec-command.js";
import { HttpsProxyAgent } from "https-proxy-agent";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { join } from "node:path";
import OpenAI, { APIConnectionTimeoutError, AzureOpenAI } from "openai";
import os from "os";

// Helper to access the id of a tool-call independent of endpoint variant
type CallIdentifiable = { call_id?: string; id?: string };

// Wait time before retrying after rate limit errors (ms).
const RATE_LIMIT_RETRY_WAIT_MS = parseInt(
  process.env["OPENAI_RATE_LIMIT_RETRY_WAIT_MS"] || "500",
  10,
);

// See https://github.com/openai/openai-node/tree/v4?tab=readme-ov-file#configuring-an-https-agent-eg-for-proxies
const PROXY_URL = process.env["HTTPS_PROXY"];

export type CommandConfirmation = {
  review: ReviewDecision;
  applyPatch?: ApplyPatchCommand | undefined;
  customDenyMessage?: string;
  explanation?: string;
};

const alreadyProcessedResponses = new Set();
const alreadyStagedItemIds = new Set<string>();

type AgentLoopParams = {
  model: string;
  provider?: string;
  config?: AppConfig;
  instructions?: string;
  approvalPolicy: ApprovalPolicy;
  /**
   * Whether the model responses should be stored on the server side (allows
   * using `previous_response_id` to provide conversational context). Defaults
   * to `true` to preserve the current behaviour. When set to `false` the agent
   * will instead send the *full* conversation context as the `input` payload
   * on every request and omit the `previous_response_id` parameter.
   */
  disableResponseStorage?: boolean;
  onItem: (item: ResponseItem) => void;
  onLoading: (loading: boolean) => void;

  /** Extra writable roots to use with sandbox execution. */
  additionalWritableRoots: ReadonlyArray<string>;

  /** Called when the command is not auto-approved to request explicit user review. */
  getCommandConfirmation: (
    command: Array<string>,
    applyPatch: ApplyPatchCommand | undefined,
  ) => Promise<CommandConfirmation>;
  onLastResponseId: (lastResponseId: string) => void;
};

const shellFunctionTool: FunctionTool = {
  type: "function",
  name: "shell",
  description: `Runs a shell command, and returns its output.
Examples:
• List files: {"command":["ls","-la"]}
• Run tests: {"command":["npm","test"]}
• Search code: {"command":["rg","-F","searchterm"]}
• Check git: {"command":["git","status"]}`,
  strict: false,
  parameters: {
    type: "object",
    properties: {
      command: { type: "array", items: { type: "string" } },
      workdir: {
        type: "string",
        description: "The working directory for the command.",
      },
      timeout: {
        type: "number",
        description:
          "The maximum time to wait for the command to complete in milliseconds.",
      },
    },
    required: ["command"],
    additionalProperties: false,
  },
};

const localShellTool: Tool = {
  // @ts-expect-error – awaiting SDK update that includes `local_shell`
  type: "local_shell",
};

// ---------------------------------------------------------------------------
// Web access helper tools – available to both Azure and standard OpenAI
// accounts. They are implemented as regular function-tools so that they work
// even on providers that do not yet expose the native `web_search` capability
// via the Responses API (e.g. Azure OpenAI as of 2025-03-01-preview).
// ---------------------------------------------------------------------------

const fetchUrlTool: FunctionTool = {
  type: "function",
  name: "fetch_url",
  description: `Fetches the content of a URL and returns structured data with optional synopsis and chunking for large pages.
Examples:
• Fetch page: {"url":"https://example.com"}
• API docs: {"url":"https://api.example.com/docs"}`,
  strict: false,
  parameters: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "The URL to fetch",
      },
    },
    required: ["url"],
    additionalProperties: false,
  },
};

const webSearchTool: FunctionTool = {
  type: "function",
  name: "web_search",
  description: `Searches the web and returns structured results with URLs, titles, and snippets.
Examples:
• Search docs: {"query":"OpenAI function calling"}
• Find info: {"query":"TypeScript error handling best practices"}`,
  strict: false,
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "The search query",
      },
    },
    required: ["query"],
    additionalProperties: false,
  },
};

export class AgentLoop {
  private model: string;
  private provider: string;
  private instructions?: string;
  private approvalPolicy: ApprovalPolicy;
  private config: AppConfig;
  private additionalWritableRoots: ReadonlyArray<string>;
  /** Whether we ask the API to persist conversation state on the server */
  private readonly disableResponseStorage: boolean;

  // Using `InstanceType<typeof OpenAI>` sidesteps typing issues with the OpenAI package under
  // the TS 5+ `moduleResolution=bundler` setup. OpenAI client instance. We keep the concrete
  // type to avoid sprinkling `any` across the implementation while still allowing paths where
  // the OpenAI SDK types may not perfectly match. The `typeof OpenAI` pattern captures the
  // instance shape without resorting to `any`.
  private oai: OpenAI;

  private onItem: (item: ResponseItem) => void;
  private onLoading: (loading: boolean) => void;
  private getCommandConfirmation: (
    command: Array<string>,
    applyPatch: ApplyPatchCommand | undefined,
  ) => Promise<CommandConfirmation>;
  private onLastResponseId: (lastResponseId: string) => void;

  /**
   * A reference to the currently active stream returned from the OpenAI
   * client. We keep this so that we can abort the request if the user decides
   * to interrupt the current task (e.g. via the escape hot‑key).
   */
  private currentStream: unknown | null = null;
  /** Incremented with every call to `run()`. Allows us to ignore stray events
   * from streams that belong to a previous run which might still be emitting
   * after the user has canceled and issued a new command. */
  private generation = 0;
  /** AbortController for in‑progress tool calls (e.g. shell commands). */
  private execAbortController: AbortController | null = null;
  /** Set to true when `cancel()` is called so `run()` can exit early. */
  private canceled = false;

  /**
   * Local conversation transcript used when `disableResponseStorage === true`. Holds
   * all non‑system items exchanged so far so we can provide full context on
   * every request.
   */
  private transcript: Array<ResponseInputItem> = [];
  /** Function calls that were emitted by the model but never answered because
   *  the user cancelled the run.  We keep the `call_id`s around so the *next*
   *  request can send a dummy `function_call_output` that satisfies the
   *  contract and prevents the
   *    400 | No tool output found for function call …
   *  error from OpenAI. */
  private pendingAborts: Set<string> = new Set();
  /** Set to true by `terminate()` – prevents any further use of the instance. */
  private terminated = false;
  /** Master abort controller – fires when terminate() is invoked. */
  private readonly hardAbort = new AbortController();

  /** Scratchpad for persisting state during agent execution */
  private scratchpad: Scratchpad;

  /** TodoList for task tracking during agent execution */
  private todoList: TodoList;

  /** Tool enforcement state for tracking required tool usage */
  private toolEnforcementState: ToolEnforcementState;

  /**
   * Abort the ongoing request/stream, if any. This allows callers (typically
   * the UI layer) to interrupt the current agent step so the user can issue
   * new instructions without waiting for the model to finish.
   */
  public cancel(): void {
    if (this.terminated) {
      return;
    }

    // Capture reference to the active stream *before* clearing it so we can
    // properly abort the underlying network request.  Setting `currentStream`
    // to `null` first would lose the handle to the controller and therefore
    // leave the request running in the background.

    const activeStream = this.currentStream as {
      controller?: { abort?: () => void };
    } | null;

    log(
      `AgentLoop.cancel() invoked – currentStream=${Boolean(
        activeStream,
      )} execAbortController=${Boolean(this.execAbortController)} generation=${
        this.generation
      }`,
    );

    // Abort the in-flight OpenAI streaming request, if any.
    activeStream?.controller?.abort?.();

    // Now reset the reference so a subsequent call to run() starts fresh.
    this.currentStream = null;

    this.canceled = true;

    // Abort any in-progress tool calls
    this.execAbortController?.abort();

    // -------------------------------------------------------------------
    // Synthesise "aborted" outputs for any outstanding tool calls so the
    // OpenAI backend sees a matching *_output item and the next request does
    // not fail with
    //   400 | No tool output found for function call …
    // This is particularly important when `disableResponseStorage === true`
    // (e.g. when targeting Azure OpenAI) because the previous function_call
    // will *not* be persisted server-side.  Emitting the synthetic outputs
    // immediately ensures that the contract is fulfilled within the same
    // turn.
    // -------------------------------------------------------------------

    if (this.pendingAborts.size > 0) {
      for (const id of this.pendingAborts) {
        try {
          const abortItem: ResponseItem = {
            // Use a unique ID so the UI treats this as a fresh item.
            id: `abort-${id}`,
            type: "function_call_output",
            call_id: id,
            output: JSON.stringify({
              output: "Execution cancelled by user",
              metadata: { exit_code: -1, duration_seconds: 0, aborted: true },
            }),
          };

          this.onItem(abortItem);
        } catch (e) {
          log(`Failed to emit synthetic abort output for ${id}: ${e}`);
        }
      }
      // Clear so a follow-up run does not re-emit the same outputs.
      this.pendingAborts.clear();
    }

    // Create a new abort controller for future tool calls
    this.execAbortController = new AbortController();
    log("AgentLoop.cancel(): execAbortController.abort() called");

    this.onLoading(false);

    /* Inform the UI that the run was aborted by the user. */
    // const cancelNotice: ResponseItem = {
    //   id: `cancel-${Date.now()}`,
    //   type: "message",
    //   role: "system",
    //   content: [
    //     {
    //       type: "input_text",
    //       text: "⏹️  Execution canceled by user.",
    //     },
    //   ],
    // };
    // this.onItem(cancelNotice);

    this.generation += 1;
    log(`AgentLoop.cancel(): generation bumped to ${this.generation}`);
  }

  /**
   * Hard‑stop the agent loop. After calling this method the instance becomes
   * unusable: any in‑flight operations are aborted and subsequent invocations
   * of `run()` will throw.
   */
  public terminate(): void {
    if (this.terminated) {
      return;
    }
    this.terminated = true;

    this.hardAbort.abort();

    this.cancel();
  }

  public sessionId: string;
  /*
   * Cumulative thinking time across this AgentLoop instance (ms).
   * Currently not used anywhere – comment out to keep the strict compiler
   * happy under `noUnusedLocals`.  Restore when telemetry support lands.
   */
  // private cumulativeThinkingMs = 0;

  /**
   * Detect if a task is complex and needs organizational tools
   */
  private analyzeTaskComplexity(input: Array<ResponseInputItem>): {
    complexity: number;
    suggestTodo: boolean;
    suggestScratchpad: boolean;
    reason: string;
  } {
    let userMessage = "";

    // Extract user message content
    for (const item of input) {
      if (item.type === "message" && item.role === "user") {
        const content = item.content;
        if (Array.isArray(content)) {
          for (const c of content) {
            if (c.type === "input_text") {
              userMessage += c.text + " ";
            }
          }
        }
      }
    }

    let complexityScore = 0;
    const reasons: Array<string> = [];

    // Check message length
    const wordCount = userMessage.split(/\s+/).length;
    if (wordCount > 30) {
      complexityScore += 3;
      reasons.push("long request");
    } else if (wordCount > 15) {
      complexityScore += 2;
    }

    // Check for multiple files/components mentioned
    const fileMatches = userMessage.match(
      /\.(ts|js|py|java|cpp|go|rs|rb|php)\b/gi,
    );
    if (fileMatches && fileMatches.length > 1) {
      complexityScore += 3;
      reasons.push("multiple files");
    }

    // Check for task keywords
    const taskKeywords =
      /implement|create|build|fix|refactor|analyze|debug|design|update|migrate|develop/gi;
    const keywordMatches = userMessage.match(taskKeywords);
    if (keywordMatches && keywordMatches.length > 0) {
      complexityScore += 2 * keywordMatches.length;
      reasons.push("implementation task");
    }

    // Check for numbered steps or lists
    if (/\d+\.|•|-\s|\*\s|first.*then|step\s+\d+/i.test(userMessage)) {
      complexityScore += 3;
      reasons.push("multiple steps");
    }

    // Check for debugging/error patterns
    if (
      /error|bug|issue|crash|fail|broken|not work|debug|investigate/i.test(
        userMessage,
      )
    ) {
      complexityScore += 2;
      reasons.push("debugging required");
    }

    // Determine tool suggestions
    const suggestTodo =
      complexityScore >= 4 ||
      reasons.includes("multiple steps") ||
      reasons.includes("implementation task");
    const suggestScratchpad =
      complexityScore >= 3 ||
      reasons.includes("debugging required") ||
      reasons.includes("multiple files");

    return {
      complexity: complexityScore,
      suggestTodo,
      suggestScratchpad,
      reason: reasons.join(", "),
    };
  }

  /**
   * Inject tool state context to encourage proper tool usage
   */
  private async getToolStateContext(): Promise<Array<ResponseInputItem>> {
    const contextItems: Array<ResponseInputItem> = [];

    try {
      // Check todo list state
      const todos = this.todoList.getAll();
      const pendingTodos = todos.filter(
        (t) => t.status === "pending" || t.status === "in_progress",
      );

      if (todos.length === 0) {
        // No todos exist - remind to create them
        contextItems.push({
          type: "message",
          role: "system",
          content: [
            {
              type: "input_text",
              text: "📋 Reminder: Todo list is empty. For any multi-step task, start by using the todo_list tool to create and organize your tasks.",
            },
          ],
        });
      } else if (pendingTodos.length > 0) {
        // Show existing todos
        const inProgress = todos.filter((t) => t.status === "in_progress");
        const pending = todos.filter((t) => t.status === "pending");

        let todoContext = "📋 Current todo status:\n";
        if (inProgress.length > 0 && inProgress[0]) {
          todoContext += `In Progress (${inProgress.length}): ${inProgress[0].content}${inProgress.length > 1 ? " (+more)" : ""}\n`;
        }
        if (pending.length > 0) {
          todoContext += `Pending (${pending.length}): Use todo_list 'next' action to see actionable tasks\n`;
        }
        todoContext += "Remember to update task status as you work!";

        contextItems.push({
          type: "message",
          role: "system",
          content: [
            {
              type: "input_text",
              text: todoContext,
            },
          ],
        });
      }

      // Check scratchpad state
      const scratchpadSummary = this.scratchpad.summarize();
      if (scratchpadSummary && scratchpadSummary !== "Empty scratchpad") {
        // Scratchpad has content
        const recentEntries = this.scratchpad.read({ limit: 2 });
        if (recentEntries.length > 0) {
          contextItems.push({
            type: "message",
            role: "system",
            content: [
              {
                type: "input_text",
                text: `📝 Scratchpad contains ${this.scratchpad.read({}).length} entries. Recent: "${recentEntries[0]?.content.substring(0, 50) || "N/A"}...". Use scratchpad 'read' to review all saved context.`,
              },
            ],
          });
        }
      }
    } catch (error) {
      // Don't let context injection errors break the flow
      log(`Tool state context injection error: ${error}`);
    }

    return contextItems;
  }

  constructor({
    model,
    provider = "openai",
    instructions,
    approvalPolicy,
    disableResponseStorage,
    // `config` used to be required.  Some unit‑tests (and potentially other
    // callers) instantiate `AgentLoop` without passing it, so we make it
    // optional and fall back to sensible defaults.  This keeps the public
    // surface backwards‑compatible and prevents runtime errors like
    // "Cannot read properties of undefined (reading 'apiKey')" when accessing
    // `config.apiKey` below.
    config,
    onItem,
    onLoading,
    getCommandConfirmation,
    onLastResponseId,
    additionalWritableRoots,
  }: AgentLoopParams & { config?: AppConfig }) {
    this.model = model;
    this.provider = provider;
    this.instructions = instructions;
    this.approvalPolicy = approvalPolicy;

    // If no `config` has been provided we derive a minimal stub so that the
    // rest of the implementation can rely on `this.config` always being a
    // defined object.  We purposefully copy over the `model` and
    // `instructions` that have already been passed explicitly so that
    // downstream consumers (e.g. telemetry) still observe the correct values.
    this.config = config ?? {
      model,
      instructions: instructions ?? "",
    };
    this.additionalWritableRoots = additionalWritableRoots;
    this.onItem = onItem;
    this.onLoading = onLoading;
    this.getCommandConfirmation = getCommandConfirmation;
    this.onLastResponseId = onLastResponseId;

    this.disableResponseStorage = disableResponseStorage ?? false;
    this.sessionId = getSessionId() || randomUUID().replaceAll("-", "");

    // Initialize scratchpad for this session
    this.scratchpad = new Scratchpad(this.sessionId);
    this.scratchpad.load().catch(() => {
      // Ignore errors loading previous scratchpad
    });

    // Initialize todo list for this session (persist under ~/.codex/todos)
    const todoSaveDir = join(os.homedir(), ".codex", "todos");
    // Ensure directory exists (non-blocking, ignore errors)
    void fs.mkdir(todoSaveDir, { recursive: true }).catch(() => {
      /* ignore mkdir errors – fallback to tmp */
    });
    this.todoList = new TodoList({
      filePath: join(todoSaveDir, `codex-todo-${this.sessionId}.json`),
      autoSave: true,
    });

    // Initialize tool enforcement state
    this.toolEnforcementState = new ToolEnforcementState(
      "Current task",
      true, // Enable enforcement by default
    );

    // Configure OpenAI client with optional timeout (ms) from environment
    const timeoutMs = OPENAI_TIMEOUT_MS;
    const apiKey = getApiKey(this.provider) ?? "";
    const baseURL = getBaseUrl(this.provider);

    this.oai = new OpenAI({
      // The OpenAI JS SDK only requires `apiKey` when making requests against
      // the official API.  When running unit‑tests we stub out all network
      // calls so an undefined key is perfectly fine.  We therefore only set
      // the property if we actually have a value to avoid triggering runtime
      // errors inside the SDK (it validates that `apiKey` is a non‑empty
      // string when the field is present).
      ...(apiKey ? { apiKey } : {}),
      baseURL,
      defaultHeaders: {
        originator: ORIGIN,
        version: CLI_VERSION,
        session_id: this.sessionId,
        ...(OPENAI_ORGANIZATION
          ? { "OpenAI-Organization": OPENAI_ORGANIZATION }
          : {}),
        ...(OPENAI_PROJECT ? { "OpenAI-Project": OPENAI_PROJECT } : {}),
      },
      httpAgent: PROXY_URL ? new HttpsProxyAgent(PROXY_URL) : undefined,
      ...(timeoutMs !== undefined ? { timeout: timeoutMs } : {}),
    });

    if (this.provider.toLowerCase() === "azure") {
      this.oai = new AzureOpenAI({
        apiKey,
        baseURL,
        apiVersion: AZURE_OPENAI_API_VERSION,
        defaultHeaders: {
          originator: ORIGIN,
          version: CLI_VERSION,
          session_id: this.sessionId,
          ...(OPENAI_ORGANIZATION
            ? { "OpenAI-Organization": OPENAI_ORGANIZATION }
            : {}),
          ...(OPENAI_PROJECT ? { "OpenAI-Project": OPENAI_PROJECT } : {}),
        },
        httpAgent: PROXY_URL ? new HttpsProxyAgent(PROXY_URL) : undefined,
        ...(timeoutMs !== undefined ? { timeout: timeoutMs } : {}),
      });
    }

    setSessionId(this.sessionId);
    setCurrentModel(this.model);

    this.hardAbort = new AbortController();

    this.hardAbort.signal.addEventListener(
      "abort",
      () => this.execAbortController?.abort(),
      { once: true },
    );
  }

  private async handleFunctionCall(
    item: ResponseFunctionToolCall,
  ): Promise<Array<ResponseInputItem>> {
    // If the run has been canceled we still need to *reply* to the tool call
    // so the overall request/response contract expected by the OpenAI API is
    // satisfied.  We therefore immediately emit a synthetic "aborted" result
    // instead of executing the tool.
    if (this.canceled) {
      const callId: string =
        (item as CallIdentifiable).call_id ??
        (item as CallIdentifiable).id ??
        "";

      const abortedOutput: ResponseInputItem.FunctionCallOutput = {
        type: "function_call_output",
        call_id: callId,
        output: JSON.stringify({
          output: "Command execution was cancelled by user",
          metadata: { exit_code: -1, duration_seconds: 0, aborted: true },
        }),
      };

      // Ensure we do not emit a duplicate synthetic output in a follow-up run.
      this.pendingAborts.delete(callId);

      return [abortedOutput];
    }

    // Implement tool output limits to prevent excessive token usage
    const MAX_OUTPUT_LENGTH = 10000; // 10KB limit
    const TRUNCATION_MESSAGE =
      "\n\n[Output truncated from {originalLength} to {maxLength} characters]";

    // Tool-specific output limits
    const TOOL_OUTPUT_LIMITS: Record<string, number> = {
      "shell": 10000,
      "fetch_url": 20000,
      "web_search": 15000,
      "container.exec": 10000,
    };
    // ---------------------------------------------------------------------
    // Normalise the function‑call item into a consistent shape regardless of
    // whether it originated from the `/responses` or the `/chat/completions`
    // endpoint – their JSON differs slightly.
    // ---------------------------------------------------------------------

    type ChatVariant = {
      function?: { name?: string; arguments?: string };
      call_id?: string;
      id?: string;
      name?: string;
      arguments?: string;
    };
    const iv = item as ChatVariant;

    const isChatStyle = iv.function !== undefined;
    const name: string | undefined = isChatStyle ? iv.function?.name : iv.name;
    const rawArguments: string | undefined = isChatStyle
      ? iv.function?.arguments
      : iv.arguments;
    const callId: string = iv.call_id ?? iv.id ?? "";

    // Parse arguments based on function type
    let args: unknown = null;
    if (name === "container.exec" || name === "shell") {
      // Shell commands need special parsing for cmd/command properties
      args = parseToolCallArguments(rawArguments ?? "{}");
    } else if (
      name === "fetch_url" ||
      name === "web_search" ||
      name === "scratchpad" ||
      name === "todo_list" ||
      name === "tools_info"
    ) {
      // Web tools and other JSON-based tools use standard JSON arguments
      try {
        // First attempt with raw arguments
        args = JSON.parse(rawArguments ?? "{}");
      } catch (error) {
        // Try to fix common JSON issues
        try {
          const sanitized = (rawArguments ?? "{}")
            .replace(/\n/g, "\\n") // Escape newlines
            .replace(/\t/g, "\\t") // Escape tabs
            .replace(/\r/g, "\\r"); // Escape carriage returns
          args = JSON.parse(sanitized);
        } catch (secondError) {
          const toolError = new ToolExecutionError(
            ERROR_CODES.INVALID_JSON,
            getErrorMessage(ERROR_CODES.INVALID_JSON, name || "unknown"),
            {
              tool: name || "unknown",
              expectedFormat: getExpectedFormat(name || "unknown"),
              receivedValue: rawArguments,
              suggestion: `Check your JSON syntax. ${name === "todo_list" ? "Make sure multi-line content is properly escaped." : ""}`,
              example: getToolExample(name || "unknown"),
            },
          );

          const outputItem: ResponseInputItem.FunctionCallOutput = {
            type: "function_call_output",
            call_id: item.call_id,
            output: JSON.stringify(toolError.toJSON()),
          };
          return [outputItem];
        }
      }
    } else {
      // Default to shell command parsing for unknown functions
      args = parseToolCallArguments(rawArguments ?? "{}");
    }

    log(
      `handleFunctionCall(): name=${
        name ?? "undefined"
      } callId=${callId} args=${rawArguments}`,
    );

    if (args == null) {
      const outputItem: ResponseInputItem.FunctionCallOutput = {
        type: "function_call_output",
        call_id: item.call_id,
        output: `invalid arguments: ${rawArguments}`,
      };
      return [outputItem];
    }

    const outputItem: ResponseInputItem.FunctionCallOutput = {
      type: "function_call_output",
      // `call_id` is mandatory – ensure we never send `undefined` which would
      // trigger the "No tool output found…" 400 from the API.
      call_id: callId,
      output: "no function found",
    };

    // Helper function to truncate output if needed
    const truncateOutput = (text: string, maxLength: number): string => {
      if (text.length <= maxLength) {
        return text;
      }
      return (
        text.substring(0, maxLength) +
        TRUNCATION_MESSAGE.replace(
          "{originalLength}",
          text.length.toString(),
        ).replace("{maxLength}", maxLength.toString())
      );
    };

    // Get appropriate limit for the current tool
    const getOutputLimit = (toolName: string): number => {
      return TOOL_OUTPUT_LIMITS[toolName] || MAX_OUTPUT_LENGTH;
    };

    // We intentionally *do not* remove this `callId` from the `pendingAborts`
    // set right away.  The output produced below is only queued up for the
    // *next* request to the OpenAI API – it has not been delivered yet.  If
    // the user presses ESC‑ESC (i.e. invokes `cancel()`) in the small window
    // between queuing the result and the actual network call, we need to be
    // able to surface a synthetic `function_call_output` marked as
    // "aborted".  Keeping the ID in the set until the run concludes
    // successfully lets the next `run()` differentiate between an aborted
    // tool call (needs the synthetic output) and a completed one (cleared
    // below in the `flush()` helper).

    // used to tell model to stop if needed
    const additionalItems: Array<ResponseInputItem> = [];

    // TODO: allow arbitrary function calls (beyond shell/container.exec)
    if (name === "scratchpad") {
      try {
        const result = await handleScratchpadTool(
          args as ScratchpadArgs,
          this.scratchpad,
        );
        outputItem.output = JSON.stringify({
          output: result,
          metadata: { tool: "scratchpad" },
        });
        // Record successful tool use
        this.toolEnforcementState.recordToolUse(
          "scratchpad",
          (args as ScratchpadArgs).action,
          true,
        );
      } catch (error) {
        if (error instanceof ToolValidationError) {
          // Handle validation errors with retry guidance
          outputItem.output = JSON.stringify({
            error: error.message,
            retry_required: true,
            correct_usage:
              error.suggestedFix ||
              getToolValidationExample(error.toolName, error.action),
            metadata: { error: true, validation_error: true },
          });
          // Force re-prompting
          additionalItems.push({
            type: "message",
            role: "system",
            content: [
              {
                type: "input_text",
                text: `⚠️ Tool validation error. Please retry with correct format: ${error.suggestedFix || getToolValidationExample(error.toolName, error.action)}`,
              },
            ],
          });
        } else {
          outputItem.output = JSON.stringify({
            output: `Scratchpad error: ${error}`,
            metadata: { error: true },
          });
        }
        // Record failed tool use
        this.toolEnforcementState.recordToolUse(
          "scratchpad",
          (args as ScratchpadArgs)?.action,
          false,
        );
      }
    } else if (name === "todo_list") {
      try {
        const result = await handleTodoListTool(
          args as TodoListArgs,
          this.todoList,
        );
        outputItem.output = JSON.stringify({
          output: result,
          metadata: { tool: "todo_list" },
        });
        // Record successful tool use
        this.toolEnforcementState.recordToolUse(
          "todo_list",
          (args as TodoListArgs).action,
          true,
        );
      } catch (error) {
        if (error instanceof ToolValidationError) {
          // Handle validation errors with retry guidance
          outputItem.output = JSON.stringify({
            error: error.message,
            retry_required: true,
            correct_usage:
              error.suggestedFix ||
              getToolValidationExample(error.toolName, error.action),
            metadata: { error: true, validation_error: true },
          });
          // Force re-prompting
          additionalItems.push({
            type: "message",
            role: "system",
            content: [
              {
                type: "input_text",
                text: `⚠️ Tool validation error. Please retry with correct format: ${error.suggestedFix || getToolValidationExample(error.toolName, error.action)}`,
              },
            ],
          });
        } else {
          outputItem.output = JSON.stringify({
            output: `Todo list error: ${error}`,
            metadata: { error: true },
          });
        }
        // Record failed tool use
        this.toolEnforcementState.recordToolUse(
          "todo_list",
          (args as TodoListArgs)?.action,
          false,
        );
      }
    } else if (name === "tools_info") {
      try {
        const result = await handleToolsInfo(args as ToolsInfoArgs);
        outputItem.output = JSON.stringify({
          output: result,
          metadata: { tool: "tools_info" },
        });
      } catch (error) {
        outputItem.output = JSON.stringify({
          output: `Tools info error: ${error}`,
          metadata: { error: true },
        });
      }
    } else if (name === "container.exec" || name === "shell") {
      const {
        outputText,
        metadata,
        additionalItems: additionalItemsFromExec,
      } = await handleExecCommand(
        args as ExecInput,
        this.config,
        this.approvalPolicy,
        this.additionalWritableRoots,
        this.getCommandConfirmation,
        this.execAbortController?.signal,
      );
      // Apply output truncation with tool-specific limits to prevent excessive token usage
      const toolLimit = getOutputLimit(name || "shell");
      const truncatedOutput = truncateOutput(outputText, toolLimit);
      outputItem.output = JSON.stringify({ output: truncatedOutput, metadata });

      // Add metadata about truncation for monitoring purposes
      if (outputText.length > toolLimit) {
        log(
          `Truncated output for tool ${name} from ${outputText.length} to ${toolLimit} characters`,
        );
      }

      if (additionalItemsFromExec) {
        additionalItems.push(...additionalItemsFromExec);
      }
    } else if (name === "fetch_url") {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const url = (args as any).url as string | undefined;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const query = (args as any).query as string | undefined;

        if (!url) {
          outputItem.output = JSON.stringify({
            output: "Error: URL is required",
            metadata: { error: true },
          });
        } else {
          const result = await fetchUrlStructured(url, this.oai, true, query, {
            provider: this.provider,
            model: this.model,
          });

          // Format output based on what was returned
          let formattedOutput = "";
          if (result.summary) {
            formattedOutput += `Summary: ${result.summary}\n\n`;
          }
          if (result.metadata.content_type === "extracted") {
            formattedOutput += `[Content intelligently extracted from ${result.metadata.original_size} bytes to ${result.metadata.processed_size} bytes]\n\n`;
          }
          // Apply output truncation with tool-specific limits to prevent excessive token usage
          const toolLimit = getOutputLimit("fetch_url");
          const truncatedRaw = truncateOutput(result.raw || "", toolLimit);
          formattedOutput += truncatedRaw;

          // Add metadata about truncation for monitoring purposes
          if (result.raw && result.raw.length > toolLimit) {
            log(
              `Truncated fetch_url output from ${result.raw.length} to ${toolLimit} characters`,
            );
          }

          outputItem.output = JSON.stringify({
            output: formattedOutput,
            metadata: {
              error: false,
              ...result.metadata,
            },
          });
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error ?? "unknown");
        let errorOutput = `Error fetching URL: ${message}`;

        // Add Azure-specific guidance
        if (
          this.provider.toLowerCase() === "azure" &&
          message.includes("extraction failed")
        ) {
          errorOutput +=
            "\n\nFor Azure OpenAI: Check AZURE_EXTRACTION_DEPLOYMENT environment variable.";
        }

        outputItem.output = JSON.stringify({
          output: errorOutput,
          metadata: { error: true },
        });
      }
    } else if (name === "web_search") {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const query = (args as any).query as string | undefined;

        if (!query) {
          outputItem.output = JSON.stringify({
            output: "Error: Search query is required",
            metadata: { error: true },
          });
        } else {
          const result = await searchWebStructured(query);
          outputItem.output = JSON.stringify({
            output: JSON.stringify(result, null, 2),
            metadata: { error: false },
          });
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error ?? "unknown");
        outputItem.output = JSON.stringify({
          output: `Error searching web: ${message}`,
          metadata: { error: true },
        });
      }
    }

    return [outputItem, ...additionalItems];
  }

  private async handleLocalShellCall(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    item: any,
  ): Promise<Array<ResponseInputItem>> {
    // Similar to the remote function_call case above we must still answer the
    // tool call even when the user has cancelled.  Provide a synthetic result
    // so the backend sees a corresponding *_output item for the original
    // request.
    if (this.canceled) {
      const callId: string =
        (item as CallIdentifiable).call_id ??
        (item as CallIdentifiable).id ??
        "";

      // @ts-expect-error waiting on SDK to expose "local_shell_call_output"
      const abortedOutput = {
        type: "local_shell_call_output",
        call_id: callId,
        output: JSON.stringify({
          output: "Execution cancelled by user",
          metadata: { exit_code: -1, duration_seconds: 0, aborted: true },
        }),
      } as ResponseInputItem & { output: string };

      this.pendingAborts.delete(callId);

      return [abortedOutput];
    }

    // @ts-expect-error waiting on SDK to expose "local_shell_call_output"
    const outputItem = {
      type: "local_shell_call_output",
      // `call_id` is mandatory – ensure we never send `undefined` which would
      // trigger the "No tool output found…" 400 from the API.
      call_id: item.call_id,
      output: "no function found",
    } as ResponseInputItem & { output: string };

    // We intentionally *do not* remove this `callId` from the `pendingAborts`
    // set right away.  The output produced below is only queued up for the
    // *next* request to the OpenAI API – it has not been delivered yet.  If
    // the user presses ESC‑ESC (i.e. invokes `cancel()`) in the small window
    // between queuing the result and the actual network call, we need to be
    // able to surface a synthetic `function_call_output` marked as
    // "aborted".  Keeping the ID in the set until the run concludes
    // successfully lets the next `run()` differentiate between an aborted
    // tool call (needs the synthetic output) and a completed one (cleared
    // below in the `flush()` helper).

    // used to tell model to stop if needed
    const additionalItems: Array<ResponseInputItem> = [];

    if (item.action.type !== "exec") {
      throw new Error("Invalid action type");
    }

    const args = {
      cmd: item.action.command,
      workdir: item.action.working_directory,
      timeoutInMillis: item.action.timeout_ms,
    };

    const {
      outputText,
      metadata,
      additionalItems: additionalItemsFromExec,
    } = await handleExecCommand(
      args,
      this.config,
      this.approvalPolicy,
      this.additionalWritableRoots,
      this.getCommandConfirmation,
      this.execAbortController?.signal,
    );
    outputItem.output = JSON.stringify({ output: outputText, metadata });

    if (additionalItemsFromExec) {
      additionalItems.push(...additionalItemsFromExec);
    }

    return [outputItem, ...additionalItems];
  }

  public async run(
    input: Array<ResponseInputItem>,
    previousResponseId: string = "",
  ): Promise<void> {
    // ---------------------------------------------------------------------
    // Top‑level error wrapper so that known transient network issues like
    // `ERR_STREAM_PREMATURE_CLOSE` do not crash the entire CLI process.
    // Instead we surface the failure to the user as a regular system‑message
    // and terminate the current run gracefully. The calling UI can then let
    // the user retry the request if desired.
    // ---------------------------------------------------------------------

    try {
      if (this.terminated) {
        throw new Error("AgentLoop has been terminated");
      }
      // Record when we start "thinking" so we can report accurate elapsed time.
      const thinkingStart = Date.now();
      // Bump generation so that any late events from previous runs can be
      // identified and dropped.
      const thisGeneration = ++this.generation;

      // Reset cancellation flag and stream for a fresh run.
      this.canceled = false;
      this.currentStream = null;

      // Create a fresh AbortController for this run so that tool calls from a
      // previous run do not accidentally get signalled.
      this.execAbortController = new AbortController();
      log(
        `AgentLoop.run(): new execAbortController created (${this.execAbortController.signal}) for generation ${this.generation}`,
      );
      // NOTE: We no longer (re‑)attach an `abort` listener to `hardAbort` here.
      // A single listener that forwards the `abort` to the current
      // `execAbortController` is installed once in the constructor. Re‑adding a
      // new listener on every `run()` caused the same `AbortSignal` instance to
      // accumulate listeners which in turn triggered Node's
      // `MaxListenersExceededWarning` after ten invocations.

      // Track the response ID from the last *stored* response so we can use
      // `previous_response_id` when `disableResponseStorage` is enabled.  When storage
      // is disabled we deliberately ignore the caller‑supplied value because
      // the backend will not retain any state that could be referenced.
      // If the backend stores conversation state (`disableResponseStorage === false`) we
      // forward the caller‑supplied `previousResponseId` so that the model sees the
      // full context.  When storage is disabled we *must not* send any ID because the
      // server no longer retains the referenced response.
      let lastResponseId: string = this.disableResponseStorage
        ? ""
        : previousResponseId;

      // If there are unresolved function calls from a previously cancelled run
      // we have to emit dummy tool outputs so that the API no longer expects
      // them.  We prepend them to the user‑supplied input so they appear
      // first in the conversation turn.
      const abortOutputs: Array<ResponseInputItem> = [];
      if (this.pendingAborts.size > 0) {
        for (const id of this.pendingAborts) {
          abortOutputs.push({
            type: "function_call_output",
            call_id: id,
            output: JSON.stringify({
              output: "aborted",
              metadata: { exit_code: 1, duration_seconds: 0 },
            }),
          } as ResponseInputItem.FunctionCallOutput);
        }
        // Once converted the pending list can be cleared.
        this.pendingAborts.clear();
      }

      // Build the input list for this turn. When responses are stored on the
      // server we can simply send the *delta* (the new user input as well as
      // any pending abort outputs) and rely on `previous_response_id` for
      // context.  When storage is disabled the server has no memory of the
      // conversation, so we must include the *entire* transcript (minus system
      // messages) on every call.

      let turnInput: Array<ResponseInputItem> = [];

      // Inject tool state context at the beginning of the conversation
      if (!previousResponseId || previousResponseId === "") {
        const toolContext = await this.getToolStateContext();
        if (toolContext.length > 0) {
          // Add context before user input to encourage tool usage
          turnInput.push(...toolContext);
        }

        // Analyze task complexity and suggest tools if needed
        const complexity = this.analyzeTaskComplexity(input);
        if (complexity.suggestTodo || complexity.suggestScratchpad) {
          const suggestions: Array<string> = [];

          if (complexity.suggestTodo && this.todoList.getAll().length === 0) {
            suggestions.push(
              "📋 This appears to be a complex task. Start by creating a todo list to organize your approach.",
            );
          }

          if (complexity.suggestScratchpad) {
            suggestions.push(
              "📝 Use the scratchpad tool to track findings and maintain context as you work.",
            );
          }

          if (suggestions.length > 0) {
            turnInput.push({
              type: "message",
              role: "system",
              content: [
                {
                  type: "input_text",
                  text: `Task analysis (${complexity.reason}):\n${suggestions.join("\n")}`,
                },
              ],
            });
          }
        }
      }
      // Keeps track of how many items in `turnInput` stem from the existing
      // transcript so we can avoid re‑emitting them to the UI. Only used when
      // `disableResponseStorage === true`.
      let transcriptPrefixLen = 0;

      // -------------------------------------------------------------------
      // Expose tool set depending on the active model/provider.  For Codex
      // models we use the proprietary `local_shell` tool.  For all other
      // providers we rely on the standard `shell` function.  In both cases we
      // additionally expose the custom `fetch_url` and `web_search` helpers.
      // -------------------------------------------------------------------

      let tools: Array<Tool>;

      // Apply Azure-specific description truncation if needed
      const isAzure = this.provider.toLowerCase() === "azure";
      const azureFetchTool = isAzure
        ? {
            ...fetchUrlTool,
            description: truncateForAzure(fetchUrlTool.description || ""),
          }
        : fetchUrlTool;
      const azureSearchTool = isAzure
        ? {
            ...webSearchTool,
            description: truncateForAzure(webSearchTool.description || ""),
          }
        : webSearchTool;

      // Extract user query for tool selection
      let userQuery = "";
      for (const item of input) {
        if (item.type === "message" && item.role === "user") {
          const content = item.content;
          if (Array.isArray(content)) {
            for (const c of content) {
              if (c.type === "input_text") {
                userQuery += c.text + " ";
              }
            }
          }
        }
      }

      // Use intelligent tool selection if we have a user query
      if (userQuery.trim()) {
        // allTools is defined but not used in the current implementation
        // const allTools = this.model.startsWith("codex")
        //   ? [localShellTool, scratchpadTool, azureFetchTool, azureSearchTool]
        //   : [shellFunctionTool, scratchpadTool, azureFetchTool, azureSearchTool];

        // Map tool names to tools for selection
        const toolMap = new Map<string, Tool>();
        toolMap.set(
          "shell",
          this.model.startsWith("codex") ? localShellTool : shellFunctionTool,
        );
        toolMap.set("scratchpad", scratchpadTool);
        toolMap.set("todo_list", todoListTool);
        toolMap.set("fetch_url", azureFetchTool);
        toolMap.set("web_search", azureSearchTool);

        // Select relevant tools based on query (increased to 5 tools max to ensure organizational tools are included)
        const selectedTools = selectToolsForQuery(userQuery.trim(), 5, 2);
        const selectedNames = new Set(
          selectedTools.map((t) => (t as FunctionTool).name),
        );

        // Map selected tools back to our tool instances
        tools = [];
        for (const [name, tool] of toolMap.entries()) {
          if (selectedNames.has(name)) {
            tools.push(tool);
          }
        }

        // Always include shell tool as fallback
        if (tools.length === 0 || !selectedNames.has("shell")) {
          tools.unshift(
            this.model.startsWith("codex") ? localShellTool : shellFunctionTool,
          );
        }

        log(
          `Tool selection for query: "${userQuery.trim().substring(0, 100)}..."`,
        );
        log(
          `Selected tools: ${tools.map((t) => (t as FunctionTool).name || t.type).join(", ")}`,
        );

        // Analyze query and set up tool enforcement
        const { required, recommended, complexity } = getRequiredTools(
          userQuery.trim(),
        );

        // Reset enforcement state for new task
        this.toolEnforcementState.reset(userQuery.trim().substring(0, 100));

        // Log complexity analysis
        log(
          `Task complexity score: ${complexity.score}, patterns: ${complexity.patterns.join(", ")}`,
        );

        // Set required tools
        if (required.length > 0) {
          this.toolEnforcementState.requireTools(required);
          log(`Required tools for this task: ${required.join(", ")}`);

          // Ensure required tools are included in the tool list
          for (const reqTool of required) {
            if (!selectedNames.has(reqTool) && toolMap.has(reqTool)) {
              tools.push(toolMap.get(reqTool)!);
              selectedNames.add(reqTool);
            }
          }
        }

        // Set recommended tools
        if (recommended.length > 0) {
          recommended.forEach((tool) =>
            this.toolEnforcementState.recommendTool(tool),
          );
          log(`Recommended tools: ${recommended.join(", ")}`);
        }

        // If we detected required tools but they haven't been used yet, inject a reminder
        if (
          required.length > 0 &&
          (!previousResponseId || previousResponseId === "")
        ) {
          const missingToolsMsg =
            this.toolEnforcementState.getMissingToolsMessage();
          if (missingToolsMsg) {
            turnInput.push({
              type: "message",
              role: "system",
              content: [
                {
                  type: "input_text",
                  text: missingToolsMsg,
                },
              ],
            });
          }
        }
      } else {
        // No user query, use all tools
        if (this.model.startsWith("codex")) {
          tools = [
            localShellTool,
            scratchpadTool,
            todoListTool,
            toolsInfoTool,
            azureFetchTool,
            azureSearchTool,
          ];
        } else {
          tools = [
            shellFunctionTool,
            scratchpadTool,
            todoListTool,
            toolsInfoTool,
            azureFetchTool,
            azureSearchTool,
          ];
        }
      }

      const stripInternalFields = (
        item: ResponseInputItem,
      ): ResponseInputItem => {
        // Clone shallowly and remove fields that are not part of the public
        // schema expected by the OpenAI Responses API.
        // We shallow‑clone the item so that subsequent mutations (deleting
        // internal fields) do not affect the original object which may still
        // be referenced elsewhere (e.g. UI components).
        const clean = { ...item } as Record<string, unknown>;
        delete clean["duration_ms"];
        // Remove OpenAI-assigned identifiers and transient status so the
        // backend does not reject items that were never persisted because we
        // use `store: false`.
        delete clean["id"];
        delete clean["status"];
        return clean as unknown as ResponseInputItem;
      };

      if (this.disableResponseStorage) {
        // Remember where the existing transcript ends – everything after this
        // index in the upcoming `turnInput` list will be *new* for this turn
        // and therefore needs to be surfaced to the UI.
        transcriptPrefixLen = this.transcript.length;

        // Ensure the transcript is up‑to‑date with the latest user input so
        // that subsequent iterations see a complete history.
        // `turnInput` is still empty at this point (it will be filled later).
        // We need to look at the *input* items the user just supplied.
        this.transcript.push(...filterToApiMessages(input));

        turnInput = [...this.transcript, ...abortOutputs].map(
          stripInternalFields,
        );
      } else {
        turnInput = [...abortOutputs, ...input].map(stripInternalFields);
      }

      this.onLoading(true);

      const staged: Array<ResponseItem | undefined> = [];
      const stageItem = (item: ResponseItem) => {
        // Ignore any stray events that belong to older generations.
        if (thisGeneration !== this.generation) {
          return;
        }

        // Skip items we've already processed to avoid staging duplicates
        if (item.id && alreadyStagedItemIds.has(item.id)) {
          return;
        }
        alreadyStagedItemIds.add(item.id);

        // Store the item so the final flush can still operate on a complete list.
        // We'll nil out entries once they're delivered.
        const idx = staged.push(item) - 1;

        // Instead of emitting synchronously we schedule a short‑delay delivery.
        //
        // This accomplishes two things:
        //   1. The UI still sees new messages almost immediately, creating the
        //      perception of real‑time updates.
        //   2. If the user calls `cancel()` in the small window right after the
        //      item was staged we can still abort the delivery because the
        //      generation counter will have been bumped by `cancel()`.
        //
        // Use a minimal 3ms delay for terminal rendering to maintain readable
        // streaming.
        setTimeout(() => {
          if (
            thisGeneration === this.generation &&
            !this.canceled &&
            !this.hardAbort.signal.aborted
          ) {
            this.onItem(item);
            // Mark as delivered so flush won't re-emit it
            staged[idx] = undefined;

            // Handle transcript updates to maintain consistency. When we
            // operate without server‑side storage we keep our own transcript
            // so we can provide full context on subsequent calls.
            if (this.disableResponseStorage) {
              // Exclude system messages from transcript as they do not form
              // part of the assistant/user dialogue that the model needs.
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const role = (item as any).role;
              if (role !== "system") {
                // Clone the item to avoid mutating the object that is also
                // rendered in the UI. We need to strip auxiliary metadata
                // such as `duration_ms` which is not part of the Responses
                // API schema and therefore causes a 400 error when included
                // in subsequent requests whose context is sent verbatim.

                // Skip items that we have already inserted earlier or that the
                // model does not need to see again in the next turn.
                //   • function_call   – superseded by the forthcoming
                //     function_call_output.
                //   • reasoning       – internal only, never sent back.
                //   • user messages   – we added these to the transcript when
                //     building the first turnInput; stageItem would add a
                //     duplicate.
                if (
                  (item as ResponseInputItem).type === "function_call" ||
                  (item as ResponseInputItem).type === "reasoning" ||
                  // @ts-expect-error – `local_shell_call` missing in SDK union
                  (item as ResponseInputItem).type === "local_shell_call" ||
                  ((item as ResponseInputItem).type === "message" &&
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    (item as any).role === "user")
                ) {
                  return;
                }

                const clone: ResponseInputItem = {
                  ...(item as unknown as ResponseInputItem),
                } as ResponseInputItem;
                // The `duration_ms` field is only added to reasoning items to
                // show elapsed time in the UI. It must not be forwarded back
                // to the server.
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                delete (clone as any).duration_ms;

                this.transcript.push(clone);
              }
            }
          }
        }, 3); // Small 3ms delay for readable streaming.
      };

      while (turnInput.length > 0) {
        if (this.canceled || this.hardAbort.signal.aborted) {
          this.onLoading(false);
          return;
        }
        // send request to openAI
        // Only surface the *new* input items to the UI – replaying the entire
        // transcript would duplicate messages that have already been shown in
        // earlier turns.
        // `turnInput` holds the *new* items that will be sent to the API in
        // this iteration.  Surface exactly these to the UI so that we do not
        // re‑emit messages from previous turns (which would duplicate user
        // prompts) and so that freshly generated `function_call_output`s are
        // shown immediately.
        // Figure out what subset of `turnInput` constitutes *new* information
        // for the UI so that we don't spam the interface with repeats of the
        // entire transcript on every iteration when response storage is
        // disabled.
        const deltaInput = this.disableResponseStorage
          ? turnInput.slice(transcriptPrefixLen)
          : [...turnInput];
        for (const item of deltaInput) {
          stageItem(item as ResponseItem);
        }
        // Send request to OpenAI with retry on timeout.
        let stream;

        // Retry loop for transient errors. Up to MAX_RETRIES attempts.
        const MAX_RETRIES = 8;
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
          try {
            let reasoning: Reasoning | undefined;
            let modelSpecificInstructions: string | undefined;
            if (this.model.startsWith("o") || this.model.startsWith("codex")) {
              reasoning = { effort: this.config.reasoningEffort ?? "medium" };
              reasoning.summary = "auto";
            }
            if (this.model.startsWith("gpt-4.1")) {
              modelSpecificInstructions = applyPatchToolInstructions;
            }
            const mergedInstructions = [
              prefix,
              modelSpecificInstructions,
              this.instructions,
            ]
              .filter(Boolean)
              .join("\n");

            const responseCall =
              !this.config.provider ||
              this.config.provider?.toLowerCase() === "openai" ||
              this.config.provider?.toLowerCase() === "azure"
                ? (params: ResponseCreateParams) =>
                    this.oai.responses.create(params)
                : (params: ResponseCreateParams) =>
                    responsesCreateViaChatCompletions(
                      this.oai,
                      params as ResponseCreateParams & { stream: true },
                    );
            log(
              `instructions (length ${mergedInstructions.length}): ${mergedInstructions}`,
            );

            // eslint-disable-next-line no-await-in-loop
            stream = await responseCall({
              model: this.model,
              instructions: mergedInstructions,
              input: turnInput,
              stream: true,
              // Default to true when >1 tool is defined.
              parallel_tool_calls: tools.length > 1,
              reasoning,
              ...(this.config.flexMode ? { service_tier: "flex" } : {}),
              ...(this.disableResponseStorage
                ? { store: false }
                : {
                    store: true,
                    previous_response_id: lastResponseId || undefined,
                  }),
              tools: tools,
              // Explicitly tell the model it is allowed to pick whatever
              // tool it deems appropriate.  Omitting this sometimes leads to
              // the model ignoring the available tools and responding with
              // plain text instead (resulting in a missing tool‑call).
              tool_choice: "auto",
            });
            break;
          } catch (error) {
            const isTimeout = error instanceof APIConnectionTimeoutError;
            // Lazily look up the APIConnectionError class at runtime to
            // accommodate the test environment's minimal OpenAI mocks which
            // do not define the class.  Falling back to `false` when the
            // export is absent ensures the check never throws.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const ApiConnErrCtor = (OpenAI as any).APIConnectionError as  // eslint-disable-next-line @typescript-eslint/no-explicit-any
              | (new (...args: any) => Error)
              | undefined;
            const isConnectionError = ApiConnErrCtor
              ? error instanceof ApiConnErrCtor
              : false;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const errCtx = error as any;
            const status =
              errCtx?.status ?? errCtx?.httpStatus ?? errCtx?.statusCode;
            // Treat classical 5xx *and* explicit OpenAI `server_error` types
            // as transient server-side failures that qualify for a retry. The
            // SDK often omits the numeric status for these, reporting only
            // the `type` field.
            const isServerError =
              (typeof status === "number" && status >= 500) ||
              errCtx?.type === "server_error";
            if (
              (isTimeout || isServerError || isConnectionError) &&
              attempt < MAX_RETRIES
            ) {
              log(
                `OpenAI request failed (attempt ${attempt}/${MAX_RETRIES}), retrying...`,
              );
              continue;
            }

            const isTooManyTokensError =
              (errCtx.param === "max_tokens" ||
                (typeof errCtx.message === "string" &&
                  /max_tokens is too large/i.test(errCtx.message))) &&
              errCtx.type === "invalid_request_error";

            if (isTooManyTokensError) {
              this.onItem({
                id: `error-${Date.now()}`,
                type: "message",
                role: "system",
                content: [
                  {
                    type: "input_text",
                    text: "⚠️  The current request exceeds the maximum context length supported by the chosen model. Please shorten the conversation, run /clear, or switch to a model with a larger context window and try again.",
                  },
                ],
              });
              this.onLoading(false);
              return;
            }

            const isRateLimit =
              status === 429 ||
              errCtx.code === "rate_limit_exceeded" ||
              errCtx.type === "rate_limit_exceeded" ||
              /rate limit/i.test(errCtx.message ?? "");
            if (isRateLimit) {
              if (attempt < MAX_RETRIES) {
                // Exponential backoff: base wait * 2^(attempt-1), or use suggested retry time
                // if provided.
                let delayMs = RATE_LIMIT_RETRY_WAIT_MS * 2 ** (attempt - 1);

                // Parse suggested retry time from error message, e.g., "Please try again in 1.3s" or "5 seconds"
                const msg = errCtx?.message ?? "";
                const m =
                  /(?:retry|try) again in ([\d.]+)\s*(?:s|seconds?)/i.exec(msg);
                if (m && m[1]) {
                  const suggested = parseFloat(m[1]) * 1000;
                  if (!Number.isNaN(suggested)) {
                    delayMs = suggested;
                  }
                }
                log(
                  `OpenAI rate limit exceeded (attempt ${attempt}/${MAX_RETRIES}), retrying in ${Math.round(
                    delayMs,
                  )} ms...`,
                );
                // eslint-disable-next-line no-await-in-loop
                await new Promise((resolve) => setTimeout(resolve, delayMs));
                continue;
              } else {
                // We have exhausted all retry attempts. Surface a message so the user understands
                // why the request failed and can decide how to proceed (e.g. wait and retry later
                // or switch to a different model / account).

                const errorDetails = [
                  `Status: ${status || "unknown"}`,
                  `Code: ${errCtx.code || "unknown"}`,
                  `Type: ${errCtx.type || "unknown"}`,
                  `Message: ${errCtx.message || "unknown"}`,
                ].join(", ");

                this.onItem({
                  id: `error-${Date.now()}`,
                  type: "message",
                  role: "system",
                  content: [
                    {
                      type: "input_text",
                      text: `⚠️  Rate limit reached. Error details: ${errorDetails}. Please try again later.`,
                    },
                  ],
                });

                this.onLoading(false);
                return;
              }
            }

            const isClientError =
              (typeof status === "number" &&
                status >= 400 &&
                status < 500 &&
                status !== 429) ||
              errCtx.code === "invalid_request_error" ||
              errCtx.type === "invalid_request_error";
            if (isClientError) {
              this.onItem({
                id: `error-${Date.now()}`,
                type: "message",
                role: "system",
                content: [
                  {
                    type: "input_text",
                    // Surface the request ID when it is present on the error so users
                    // can reference it when contacting support or inspecting logs.
                    text: (() => {
                      const reqId =
                        (
                          errCtx as Partial<{
                            request_id?: string;
                            requestId?: string;
                          }>
                        )?.request_id ??
                        (
                          errCtx as Partial<{
                            request_id?: string;
                            requestId?: string;
                          }>
                        )?.requestId;

                      const errorDetails = [
                        `Status: ${status || "unknown"}`,
                        `Code: ${errCtx.code || "unknown"}`,
                        `Type: ${errCtx.type || "unknown"}`,
                        `Message: ${errCtx.message || "unknown"}`,
                      ].join(", ");

                      return `⚠️  OpenAI rejected the request${
                        reqId ? ` (request ID: ${reqId})` : ""
                      }. Error details: ${errorDetails}. Please verify your settings and try again.`;
                    })(),
                  },
                ],
              });
              this.onLoading(false);
              return;
            }
            throw error;
          }
        }

        // If the user requested cancellation while we were awaiting the network
        // request, abort immediately before we start handling the stream.
        if (this.canceled || this.hardAbort.signal.aborted) {
          // `stream` is defined; abort to avoid wasting tokens/server work
          try {
            (
              stream as { controller?: { abort?: () => void } }
            )?.controller?.abort?.();
          } catch {
            /* ignore */
          }
          this.onLoading(false);
          return;
        }

        // Keep track of the active stream so it can be aborted on demand.
        this.currentStream = stream;

        // Guard against an undefined stream before iterating.
        if (!stream) {
          this.onLoading(false);
          log("AgentLoop.run(): stream is undefined");
          return;
        }

        const MAX_STREAM_RETRIES = 5;
        let streamRetryAttempt = 0;

        // eslint-disable-next-line no-constant-condition
        while (true) {
          try {
            let newTurnInput: Array<ResponseInputItem> = [];

            // eslint-disable-next-line no-await-in-loop
            for await (const event of stream as AsyncIterable<ResponseEvent>) {
              log(`AgentLoop.run(): response event ${event.type}`);

              // process and surface each item (no-op until we can depend on streaming events)
              if (event.type === "response.output_item.done") {
                const item = event.item;
                // 1) if it's a reasoning item, annotate it
                type ReasoningItem = { type?: string; duration_ms?: number };
                const maybeReasoning = item as ReasoningItem;
                if (maybeReasoning.type === "reasoning") {
                  maybeReasoning.duration_ms = Date.now() - thinkingStart;
                }
                if (
                  item.type === "function_call" ||
                  item.type === "local_shell_call"
                ) {
                  // Track outstanding tool call so we can abort later if needed.
                  // The item comes from the streaming response, therefore it has
                  // either `id` (chat) or `call_id` (responses) – we normalise
                  // by reading both.
                  const callId =
                    (item as { call_id?: string; id?: string }).call_id ??
                    (item as { id?: string }).id;
                  if (callId) {
                    this.pendingAborts.add(callId);
                  }
                } else {
                  stageItem(item as ResponseItem);
                }
              }

              if (event.type === "response.completed") {
                if (thisGeneration === this.generation && !this.canceled) {
                  for (const item of event.response.output) {
                    stageItem(item as ResponseItem);
                  }
                }
                if (
                  event.response.status === "completed" ||
                  (event.response.status as unknown as string) ===
                    "requires_action"
                ) {
                  // TODO: remove this once we can depend on streaming events
                  newTurnInput = await this.processEventsWithoutStreaming(
                    event.response.output,
                    stageItem,
                  );

                  // When we do not use server‑side storage we maintain our
                  // own transcript so that *future* turns still contain full
                  // conversational context. However, whether we advance to
                  // another loop iteration should depend solely on the
                  // presence of *new* input items (i.e. items that were not
                  // part of the previous request). Re‑sending the transcript
                  // by itself would create an infinite request loop because
                  // `turnInput.length` would never reach zero.

                  if (this.disableResponseStorage) {
                    // 1) Append the freshly emitted output to our local
                    //    transcript (minus non‑message items the model does
                    //    not need to see again).
                    const cleaned = filterToApiMessages(
                      event.response.output.map(stripInternalFields),
                    );
                    this.transcript.push(...cleaned);

                    // 2) Determine the *delta* (newTurnInput) that must be
                    //    sent in the next iteration. If there is none we can
                    //    safely terminate the loop – the transcript alone
                    //    does not constitute new information for the
                    //    assistant to act upon.

                    const delta = filterToApiMessages(
                      newTurnInput.map(stripInternalFields),
                    );

                    if (delta.length === 0) {
                      // No new input => end conversation.
                      newTurnInput = [];
                    } else {
                      // Re‑send full transcript *plus* the new delta so the
                      // stateless backend receives complete context.
                      newTurnInput = [...this.transcript, ...delta];
                      // The prefix ends at the current transcript length –
                      // everything after this index is new for the next
                      // iteration.
                      transcriptPrefixLen = this.transcript.length;
                    }
                  }
                }
                lastResponseId = event.response.id;
                this.onLastResponseId(event.response.id);
              }
            }

            // Set after we have consumed all stream events in case the stream wasn't
            // complete or we missed events for whatever reason. That way, we will set
            // the next turn to an empty array to prevent an infinite loop.
            // And don't update the turn input too early otherwise we won't have the
            // current turn inputs available for retries.
            turnInput = newTurnInput;

            // Validate tool usage requirements after processing the response
            const validation = this.toolEnforcementState.validateProgress();
            if (!validation.valid && validation.missing.length > 0) {
              log(
                `Tool enforcement: Missing required tools: ${validation.missing.join(", ")}`,
              );

              // Inject enforcement message to prompt the model to use required tools
              const enforcementMsg =
                this.toolEnforcementState.getMissingToolsMessage();
              if (enforcementMsg) {
                // Add enforcement message to the turn input for the next iteration
                turnInput.push({
                  type: "message",
                  role: "system",
                  content: [
                    {
                      type: "input_text",
                      text: enforcementMsg,
                    },
                  ],
                });

                // Continue the loop to force tool usage
                log("Continuing conversation to enforce tool usage...");
                continue; // Don't break, continue the main while loop
              }
            }

            // Stream finished successfully – leave the retry loop.
            break;
          } catch (err: unknown) {
            const isRateLimitError = (e: unknown): boolean => {
              if (!e || typeof e !== "object") {
                return false;
              }
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const ex: any = e;
              return (
                ex.status === 429 ||
                ex.code === "rate_limit_exceeded" ||
                ex.type === "rate_limit_exceeded"
              );
            };

            if (
              isRateLimitError(err) &&
              streamRetryAttempt < MAX_STREAM_RETRIES
            ) {
              streamRetryAttempt += 1;

              // Exponential backoff: base wait * 2^(attempt-1), or use suggested retry time if provided.
              let waitMs =
                RATE_LIMIT_RETRY_WAIT_MS * 2 ** (streamRetryAttempt - 1);
              // Parse suggested retry time from error message (e.g., "please try again in X seconds").
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const streamMsg = (err as any).message ?? "";
              const m2 =
                /(?:retry|try) again in ([\d.]+)\s*(?:s|seconds?)/i.exec(
                  streamMsg,
                );
              if (m2 && m2[1]) {
                const suggested = parseFloat(m2[1]) * 1000;
                if (!Number.isNaN(suggested)) {
                  waitMs = suggested;
                }
              }
              log(
                `OpenAI stream rate‑limited – retry ${streamRetryAttempt}/${MAX_STREAM_RETRIES} in ${waitMs} ms`,
              );

              // Give the server a breather before retrying.
              // eslint-disable-next-line no-await-in-loop
              await new Promise((res) => setTimeout(res, waitMs));

              // Re‑create the stream with the *same* parameters.
              let reasoning: Reasoning | undefined;
              if (this.model.startsWith("o")) {
                reasoning = { effort: "high" };
                if (
                  this.model === "o3" ||
                  this.model === "o4-mini" ||
                  this.model === "codex-mini-latest"
                ) {
                  reasoning.summary = "auto";
                }
              }

              const mergedInstructions = [prefix, this.instructions]
                .filter(Boolean)
                .join("\n");

              const responseCall =
                !this.config.provider ||
                this.config.provider?.toLowerCase() === "openai" ||
                this.config.provider?.toLowerCase() === "azure"
                  ? (params: ResponseCreateParams) =>
                      this.oai.responses.create(params)
                  : (params: ResponseCreateParams) =>
                      responsesCreateViaChatCompletions(
                        this.oai,
                        params as ResponseCreateParams & { stream: true },
                      );

              log(
                "agentLoop.run(): responseCall(1): turnInput: " +
                  JSON.stringify(turnInput),
              );
              // eslint-disable-next-line no-await-in-loop
              stream = await responseCall({
                model: this.model,
                instructions: mergedInstructions,
                input: turnInput,
                stream: true,
                // Default to true when >1 tool is defined.
                parallel_tool_calls: tools.length > 1,
                reasoning,
                ...(this.config.flexMode ? { service_tier: "flex" } : {}),
                ...(this.disableResponseStorage
                  ? { store: false }
                  : {
                      store: true,
                      previous_response_id: lastResponseId || undefined,
                    }),
                tools: tools,
                tool_choice: "auto",
              });

              this.currentStream = stream;
              // Continue to outer while to consume new stream.
              continue;
            }

            // Gracefully handle an abort triggered via `cancel()` so that the
            // consumer does not see an unhandled exception.
            if (err instanceof Error && err.name === "AbortError") {
              if (!this.canceled) {
                // It was aborted for some other reason; surface the error.
                throw err;
              }
              this.onLoading(false);
              return;
            }
            // Suppress internal stack on JSON parse failures
            if (err instanceof SyntaxError) {
              this.onItem({
                id: `error-${Date.now()}`,
                type: "message",
                role: "system",
                content: [
                  {
                    type: "input_text",
                    text: "⚠️ Failed to parse streaming response (invalid JSON). Please `/clear` to reset.",
                  },
                ],
              });
              this.onLoading(false);
              return;
            }
            // Handle OpenAI API quota errors
            if (
              err instanceof Error &&
              (err as { code?: string }).code === "insufficient_quota"
            ) {
              this.onItem({
                id: `error-${Date.now()}`,
                type: "message",
                role: "system",
                content: [
                  {
                    type: "input_text",
                    text: `\u26a0 Insufficient quota: ${err instanceof Error && err.message ? err.message.trim() : "No remaining quota."} Manage or purchase credits at https://platform.openai.com/account/billing.`,
                  },
                ],
              });
              this.onLoading(false);
              return;
            }
            throw err;
          } finally {
            this.currentStream = null;
          }
        } // end while retry loop

        log(
          `Turn inputs (${turnInput.length}) - ${turnInput
            .map((i) => i.type)
            .join(", ")}`,
        );
      }

      // Flush staged items if the run concluded successfully (i.e. the user did
      // not invoke cancel() or terminate() during the turn).
      const flush = () => {
        if (
          !this.canceled &&
          !this.hardAbort.signal.aborted &&
          thisGeneration === this.generation
        ) {
          // Only emit items that weren't already delivered above
          for (const item of staged) {
            if (item) {
              this.onItem(item);
            }
          }
        }

        // At this point the turn finished without the user invoking
        // `cancel()`.  Any outstanding function‑calls must therefore have been
        // satisfied, so we can safely clear the set that tracks pending aborts
        // to avoid emitting duplicate synthetic outputs in subsequent runs.
        this.pendingAborts.clear();
        // Now emit system messages recording the per‑turn *and* cumulative
        // thinking times so UIs and tests can surface/verify them.
        // const thinkingEnd = Date.now();

        // 1) Per‑turn measurement – exact time spent between request and
        //    response for *this* command.
        // this.onItem({
        //   id: `thinking-${thinkingEnd}`,
        //   type: "message",
        //   role: "system",
        //   content: [
        //     {
        //       type: "input_text",
        //       text: `🤔  Thinking time: ${Math.round(
        //         (thinkingEnd - thinkingStart) / 1000
        //       )} s`,
        //     },
        //   ],
        // });

        // 2) Session‑wide cumulative counter so users can track overall wait
        //    time across multiple turns.
        // this.cumulativeThinkingMs += thinkingEnd - thinkingStart;
        // this.onItem({
        //   id: `thinking-total-${thinkingEnd}`,
        //   type: "message",
        //   role: "system",
        //   content: [
        //     {
        //       type: "input_text",
        //       text: `⏱  Total thinking time: ${Math.round(
        //         this.cumulativeThinkingMs / 1000
        //       )} s`,
        //     },
        //   ],
        // });

        this.onLoading(false);
      };

      // Use a small delay to make sure UI rendering is smooth. Double-check
      // cancellation state right before flushing to avoid race conditions.
      setTimeout(() => {
        if (
          !this.canceled &&
          !this.hardAbort.signal.aborted &&
          thisGeneration === this.generation
        ) {
          flush();
        }
      }, 3);

      // End of main logic. The corresponding catch block for the wrapper at the
      // start of this method follows next.
    } catch (err) {
      // Handle known transient network/streaming issues so they do not crash the
      // CLI. We currently match Node/undici's `ERR_STREAM_PREMATURE_CLOSE`
      // error which manifests when the HTTP/2 stream terminates unexpectedly
      // (e.g. during brief network hiccups).

      const isPrematureClose =
        err instanceof Error &&
        // eslint-disable-next-line
        ((err as any).code === "ERR_STREAM_PREMATURE_CLOSE" ||
          err.message?.includes("Premature close"));

      if (isPrematureClose) {
        try {
          this.onItem({
            id: `error-${Date.now()}`,
            type: "message",
            role: "system",
            content: [
              {
                type: "input_text",
                text: "⚠️  Connection closed prematurely while waiting for the model. Please try again.",
              },
            ],
          });
        } catch {
          /* no-op – emitting the error message is best‑effort */
        }
        this.onLoading(false);
        return;
      }

      // -------------------------------------------------------------------
      // Catch‑all handling for other network or server‑side issues so that
      // transient failures do not crash the CLI. We intentionally keep the
      // detection logic conservative to avoid masking programming errors. A
      // failure is treated as retry‑worthy/user‑visible when any of the
      // following apply:
      //   • the error carries a recognised Node.js network errno ‑ style code
      //     (e.g. ECONNRESET, ETIMEDOUT …)
      //   • the OpenAI SDK attached an HTTP `status` >= 500 indicating a
      //     server‑side problem.
      //   • the error is model specific and detected in stream.
      // If matched we emit a single system message to inform the user and
      // resolve gracefully so callers can choose to retry.
      // -------------------------------------------------------------------

      const NETWORK_ERRNOS = new Set([
        "ECONNRESET",
        "ECONNREFUSED",
        "EPIPE",
        "ENOTFOUND",
        "ETIMEDOUT",
        "EAI_AGAIN",
      ]);

      const isNetworkOrServerError = (() => {
        if (!err || typeof err !== "object") {
          return false;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const e: any = err;

        // Direct instance check for connection errors thrown by the OpenAI SDK.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ApiConnErrCtor = (OpenAI as any).APIConnectionError as  // eslint-disable-next-line @typescript-eslint/no-explicit-any
          | (new (...args: any) => Error)
          | undefined;
        if (ApiConnErrCtor && e instanceof ApiConnErrCtor) {
          return true;
        }

        if (typeof e.code === "string" && NETWORK_ERRNOS.has(e.code)) {
          return true;
        }

        // When the OpenAI SDK nests the underlying network failure inside the
        // `cause` property we surface it as well so callers do not see an
        // unhandled exception for errors like ENOTFOUND, ECONNRESET …
        if (
          e.cause &&
          typeof e.cause === "object" &&
          NETWORK_ERRNOS.has((e.cause as { code?: string }).code ?? "")
        ) {
          return true;
        }

        if (typeof e.status === "number" && e.status >= 500) {
          return true;
        }

        // Fallback to a heuristic string match so we still catch future SDK
        // variations without enumerating every errno.
        if (
          typeof e.message === "string" &&
          /network|socket|stream/i.test(e.message)
        ) {
          return true;
        }

        return false;
      })();

      if (isNetworkOrServerError) {
        try {
          const msgText =
            "⚠️  Network error while contacting OpenAI. Please check your connection and try again.";
          this.onItem({
            id: `error-${Date.now()}`,
            type: "message",
            role: "system",
            content: [
              {
                type: "input_text",
                text: msgText,
              },
            ],
          });
        } catch {
          /* best‑effort */
        }
        this.onLoading(false);
        return;
      }

      const isInvalidRequestError = () => {
        if (!err || typeof err !== "object") {
          return false;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const e: any = err;

        if (
          e.type === "invalid_request_error" &&
          e.code === "model_not_found"
        ) {
          return true;
        }

        if (
          e.cause &&
          e.cause.type === "invalid_request_error" &&
          e.cause.code === "model_not_found"
        ) {
          return true;
        }

        return false;
      };

      if (isInvalidRequestError()) {
        try {
          // Extract request ID and error details from the error object

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const e: any = err;

          const reqId =
            e.request_id ??
            (e.cause && e.cause.request_id) ??
            (e.cause && e.cause.requestId);

          const errorDetails = [
            `Status: ${e.status || (e.cause && e.cause.status) || "unknown"}`,
            `Code: ${e.code || (e.cause && e.cause.code) || "unknown"}`,
            `Type: ${e.type || (e.cause && e.cause.type) || "unknown"}`,
            `Message: ${
              e.message || (e.cause && e.cause.message) || "unknown"
            }`,
          ].join(", ");

          const msgText = `⚠️  OpenAI rejected the request${
            reqId ? ` (request ID: ${reqId})` : ""
          }. Error details: ${errorDetails}. Please verify your settings and try again.`;

          this.onItem({
            id: `error-${Date.now()}`,
            type: "message",
            role: "system",
            content: [
              {
                type: "input_text",
                text: msgText,
              },
            ],
          });
        } catch {
          /* best-effort */
        }
        this.onLoading(false);
        return;
      }

      // Re‑throw all other errors so upstream handlers can decide what to do.
      throw err;
    }
  }

  // we need until we can depend on streaming events
  private async processEventsWithoutStreaming(
    output: Array<ResponseInputItem>,
    emitItem: (item: ResponseItem) => void,
  ): Promise<Array<ResponseInputItem>> {
    // When a cancellation is in progress we *still* loop through the output
    // items so we can emit synthetic "cancelled" responses for any pending
    // tool calls.  Skipping processing altogether would leave the OpenAI API
    // waiting for a corresponding *_output item and result in the dreaded
    // "No tool output found for function call …" error – especially when
    // `disableResponseStorage` is enabled and the backend does not persist
    // conversation state between requests.
    const turnInput: Array<ResponseInputItem> = [];
    for (const item of output) {
      if (item.type === "function_call") {
        if (alreadyProcessedResponses.has(item.id)) {
          continue;
        }
        alreadyProcessedResponses.add(item.id);
        // eslint-disable-next-line no-await-in-loop
        const result = await this.handleFunctionCall(item);
        turnInput.push(...result);
        // @ts-expect-error – `local_shell_call` missing in SDK union
      } else if (item.type === "local_shell_call") {
        // @ts-expect-error – `local_shell_call` missing in SDK union
        if (alreadyProcessedResponses.has(item.id)) {
          continue;
        }
        // @ts-expect-error – `local_shell_call` missing in SDK union
        alreadyProcessedResponses.add(item.id);
        // eslint-disable-next-line no-await-in-loop
        const result = await this.handleLocalShellCall(item);
        turnInput.push(...result);
      }
      emitItem(item as ResponseItem);
    }
    return turnInput;
  }
}

// Dynamic developer message prefix: includes user, workdir, and rg suggestion.
const userName = os.userInfo().username;
const workdir = process.cwd();
const dynamicLines: Array<string> = [
  `User: ${userName}`,
  `Workdir: ${workdir}`,
];
if (spawnSync("rg", ["--version"], { stdio: "ignore" }).status === 0) {
  dynamicLines.push(
    "- Always use rg instead of grep/ls -R because it is much faster and respects gitignore",
  );
}
const dynamicPrefix = dynamicLines.join("\n");
const prefix = `You are operating as and within the Codex CLI, a terminal-based agentic coding assistant built by OpenAI. It wraps OpenAI models to enable natural language interaction with a local codebase. You are expected to be precise, safe, and helpful.

You can:
- Receive user prompts, project context, and files.
- Stream responses and emit function calls (e.g., shell commands, code edits).
- Apply patches, run commands, and manage user approvals based on policy.
- Work inside a sandboxed, git-backed workspace with rollback support.
- Log telemetry so sessions can be replayed or inspected later.
- More details on your functionality are available at \`codex --help\`

The Codex CLI is open-sourced. Don't confuse yourself with the old Codex language model built by OpenAI many moons ago (this is understandably top of mind for you!). Within this context, Codex refers to the open-source agentic coding interface.

MANDATORY WORKFLOW TOOLS:
1. Todo List (todo_list) - REQUIRED for multi-step tasks:
   - ALWAYS create a todo list FIRST when given any task with multiple steps
   - Break down complex requests into clear, actionable subtasks
   - Mark items as 'in_progress' when starting, 'completed' when done
   - Use 'next' action to identify what to work on
   - This ensures nothing is missed and provides clear progress tracking

2. Scratchpad (scratchpad) - REQUIRED for analysis and state tracking:
   - Save important findings, errors, and intermediate results immediately
   - Track your reasoning, hypotheses, and discoveries
   - Store code snippets, file paths, and command outputs for reference
   - Use categories: 'note' for findings, 'error' for issues, 'plan' for strategies
   - This maintains context and helps with complex debugging

3. When these tools are MANDATORY:
   - Todo: Any task with words like "implement", "create", "fix", "build", "refactor", "analyze"
   - Todo: Whenever the user lists multiple requirements or steps
   - Scratchpad: During debugging sessions or when investigating errors
   - Scratchpad: When analyzing multiple files or tracking state across operations
   - Both: Any task that will require more than 2-3 tool calls

Using these organizational tools demonstrates professionalism and ensures reliable, complete solutions.

EXAMPLE TOOL USAGE PATTERNS:

Feature Implementation:
1. Start: {"tool":"todo_list","action":"add","content":"Research existing authentication system","priority":"high"}
2. Plan: {"tool":"todo_list","action":"add","content":"Implement JWT token generation","priority":"high"}
3. Track: {"tool":"scratchpad","action":"write","content":"Found auth middleware in src/middleware/auth.ts","category":"note"}
4. Progress: {"tool":"todo_list","action":"start","id":"task-123"}
5. Save findings: {"tool":"scratchpad","action":"write","content":"JWT secret stored in process.env.JWT_SECRET","category":"note"}

IMPORTANT DISTINCTION:
- Todo and scratchpad are TOOLS (function calls), NOT shell commands
- Use them through the tool interface: {"action":"complete","id":"task-id"}
- NEVER try "$ todo_list" or "$ scratchpad" in the shell - these are not CLI commands

Debugging Session:
1. Record: {"tool":"scratchpad","action":"write","content":"Error: Cannot read property 'id' of undefined at line 42","category":"error"}
2. Hypothesis: {"tool":"scratchpad","action":"write","content":"Possible cause: async operation not awaited","category":"plan"}
3. Track fix: {"tool":"todo_list","action":"add","content":"Add await to database query in getUser()","priority":"high"}

Multi-file Refactoring:
1. Plan: {"tool":"todo_list","action":"add","content":"Identify all files using old API format","priority":"high"}
2. Document: {"tool":"scratchpad","action":"write","content":"Files to update: api/users.ts, api/posts.ts, api/comments.ts","category":"plan"}
3. Track each: {"tool":"todo_list","action":"add","content":"Update api/users.ts to new format","parentId":"parent-task-id"}

ERROR RECOVERY:
If you see "bash: todo_list: command not found" or similar errors:
- This means you tried to use a TOOL as a shell command
- Stop and use the proper tool interface instead
- Example: To complete a task, use the todo_list tool with {"action":"complete","id":"task-id","notes":"your notes"}

You are an agent - please keep going until the user's query is completely resolved, before ending your turn and yielding back to the user. Only terminate your turn when you are sure that the problem is solved. If you are not sure about file content or codebase structure pertaining to the user's request, use your tools to read files and gather the relevant information: do NOT guess or make up an answer.

Please resolve the user's task by editing and testing the code files in your current code execution session. You are a deployed coding agent. Your session allows for you to modify and run code. The repo(s) are already cloned in your working directory, and you must fully solve the problem for your answer to be considered correct.

You MUST adhere to the following criteria when executing the task:
- Working on the repo(s) in the current environment is allowed, even if they are proprietary.
- Analyzing code for vulnerabilities is allowed.
- Showing user code and tool call details is allowed.
- User instructions may overwrite the *CODING GUIDELINES* section in this developer message.
- Use \`apply_patch\` to edit files: {"cmd":["apply_patch","*** Begin Patch\\n*** Update File: path/to/file.py\\n@@ def example():\\n-  pass\\n+  return 123\\n*** End Patch"]}
- If completing the user's task requires writing or modifying files:
    - Your code and final answer should follow these *CODING GUIDELINES*:
        - Fix the problem at the root cause rather than applying surface-level patches, when possible.
        - Avoid unneeded complexity in your solution.
            - Ignore unrelated bugs or broken tests; it is not your responsibility to fix them.
        - Update documentation as necessary.
        - Keep changes consistent with the style of the existing codebase. Changes should be minimal and focused on the task.
            - Use \`git log\` and \`git blame\` to search the history of the codebase if additional context is required; internet access is disabled.
        - NEVER add copyright or license headers unless specifically requested.
        - You do not need to \`git commit\` your changes; this will be done automatically for you.
        - If there is a .pre-commit-config.yaml, use \`pre-commit run --files ...\` to check that your changes pass the pre-commit checks. However, do not fix pre-existing errors on lines you didn't touch.
            - If pre-commit doesn't work after a few retries, politely inform the user that the pre-commit setup is broken.
        - Once you finish coding, you must
            - Remove all inline comments you added as much as possible, even if they look normal. Check using \`git diff\`. Inline comments must be generally avoided, unless active maintainers of the repo, after long careful study of the code and the issue, will still misinterpret the code without the comments.
            - Check if you accidentally add copyright or license headers. If so, remove them.
            - Try to run pre-commit if it is available.
- Testing policy:
    - Do NOT add or run unit tests, integration tests, or any other form of automated testing unless the user's explicit instructions request it in the current prompt. Testing is disallowed by default.

- If completing the user's task DOES NOT require writing or modifying files (e.g., the user asks a question about the code base):
    - Respond in a friendly tone as a remote teammate, who is knowledgeable, capable and eager to help with coding.
- When your task involves writing or modifying files:
    - Do NOT tell the user to "save the file" or "copy the code into a file" if you already created or modified the file using \`apply_patch\`. Instead, reference the file as already saved.
    - Do NOT show the full contents of large files you have already written, unless the user explicitly asks for them.

${dynamicPrefix}`;

function filterToApiMessages(
  items: Array<ResponseInputItem>,
): Array<ResponseInputItem> {
  return items.filter((it) => {
    if (it.type === "message" && it.role === "system") {
      return false;
    }
    if (it.type === "reasoning") {
      return false;
    }
    return true;
  });
}
