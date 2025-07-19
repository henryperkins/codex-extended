# Azure OpenAI Compliance Refactor Plan

This document captures the changes required to make **codex-cli** and **codex-rs** fully compliant with the behaviour described in `docs/azure_reasoning.md` and `docs/azure_responses_api.md`.

## 1 Overview

The current implementation works well for standard OpenAI chat completions, but several “o-series” (reasoning) specifics are missing. Those gaps cause 400-level errors or silent feature downgrades when the CLI is used against Azure OpenAI deployments of `o1`, `o3`, `o4-mini`, etc.

## 2 Problems & Root Causes

| ID  | Problem                                                                     | Source                                       | Root cause                                                      |
| --- | --------------------------------------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------- |
| A1  | `max_completion_tokens` never included – required for every reasoning model | `agent-loop.ts`, `responses.ts`, `client.rs` | Code still sends legacy `max_tokens` / `max_output_tokens` only |
| A2  | Overflow handling looks only at `max_tokens`                                | `agent-loop.ts`                              | Regular-expression guard does not match `max_completion_tokens` |
| B1  | Unsupported knobs (`temperature`, `top_p`) sent to reasoning models         | `responses.ts`, `agent-loop.ts`              | No model-based gating                                           |
| B2  | `parallel_tool_calls` always set when >1 tool                               | `agent-loop.ts`                              | Feature not yet available on reasoning models                   |
| B3  | `reasoning.summary` forced to `auto` for every model starting with “o”      | `agent-loop.ts`                              | Should only apply to `o3` & `o4-mini`                           |
| C1  | `store:false` path does not request / forward `reasoning.encrypted_content` | `agent-loop.ts`                              | Missing logic for ZDR tenants                                   |
| C2  | System **and** developer messages may be mixed                              | `responses.ts`                               | Helper prepends a system role even if developer already present |

## 3 Change List

### 3.1 Parameter handling

1. Detect reasoning models via `model.startsWith("o")` (or more robust map).
2. When true:
   - Add `max_completion_tokens` to request payload.
   - Strip `max_tokens` / `max_output_tokens` / sampling knobs.
   - Omit `parallel_tool_calls` (until Azure supports it).

### 3.2 Error handling

- Extend the “max tokens too large” guard to recognise the new parameter name.

### 3.3 Reasoning summary guard

- Only attach `reasoning.summary` when model id matches `/^o3($|-)|^o4-mini/`.

### 3.4 Zero-data-retention workflow

- When `store:false` include `include:["reasoning.encrypted_content"]`.
- Persist the encrypted blob in `this.transcript` and forward it on the next turn.

### 3.5 Role-message sanitising

- Ensure exactly **one** of {system, developer} is present. If the caller
  supplies a developer message, skip auto-injection of a system message.

## 4 Implementation Pointers

| Task                              | Suggested file(s)                                                                                     |
| --------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Add `max_completion_tokens` param | `codex-cli/src/utils/agent/agent-loop.ts` (L960-1040) & `codex-rs/core/src/client.rs` (payload build) |
| Remove legacy params for o-series | Same locations as above plus `codex-cli/src/utils/responses.ts` (createCompletion)                    |
| Update overflow regex             | `agent-loop.ts` (≈L1030)                                                                              |
| Guard `reasoning.summary`         | `agent-loop.ts` (≈L948)                                                                               |
| ZDR encrypted reasoning items     | `agent-loop.ts` (request construction & transcript logic)                                             |
| Role-mix guard                    | `codex-cli/src/utils/responses.ts` (`getFullMessages`)                                                |

## 5 Validation Steps

1. Create an Azure deployment of `o1` with API version `2025-04-01-preview`.
2. Run CLI with `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY` set and:

   ```bash
   codex --provider azure --model o1-mydeploy "Hello, world"
   ```

3. Expect a valid answer instead of **HTTP 400**.
4. Toggle `--store false` (or ZDR tenant) and verify multi-turn context.

## 6 Timeline & Ownership

- **Day 0** – land param handling & overflow fix.
- **Day 1** – encrypted-reasoning & role mixing.
- **Day 2** – manual QA against Azure; update docs/examples.

---

After these changes the project should be fully compatible with all currently released Azure OpenAI reasoning and responses capabilities.
