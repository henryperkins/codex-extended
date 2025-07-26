import type { ResponseItem } from "openai/resources/responses/responses.mjs";
import { countTokensUsed } from "./token-counter.js";

/**
 * @deprecated Use countTokensUsed from token-counter.ts for accurate token counting
 * 
 * This function now delegates to the accurate token counter.
 * Kept for backward compatibility.
 */
export function approximateTokensUsed(items: Array<ResponseItem>): number {
  // Use a default model for backward compatibility
  // Most models use cl100k_base encoding, which is a reasonable default
  return countTokensUsed(items, "gpt-4");
}
