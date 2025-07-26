import { log } from "./logger/log.js";
import fs from "fs/promises";
import os from "os";
import path from "path";

/**
 * Scratchpad entry with metadata
 */
export interface ScratchpadEntry {
  id: string;
  timestamp: number;
  category: "note" | "plan" | "result" | "error" | "state";
  content: string;
  metadata?: Record<string, unknown>;
}

/**
 * Scratchpad manager for persisting agent state during sessions
 */
export class Scratchpad {
  private entries: Array<ScratchpadEntry> = [];
  private sessionId: string;
  private saveDir: string;
  private autoSaveEnabled: boolean = true;
  private maxEntries: number = 1000;

  constructor(sessionId: string, saveDir?: string) {
    this.sessionId = sessionId;
    this.saveDir = saveDir || path.join(os.homedir(), ".codex", "scratchpads");
  }

  /**
   * Add an entry to the scratchpad
   */
  async write(
    content: string,
    category: ScratchpadEntry["category"] = "note",
    metadata?: Record<string, unknown>,
  ): Promise<string> {
    const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const entry: ScratchpadEntry = {
      id,
      timestamp: Date.now(),
      category,
      content,
      metadata,
    };

    this.entries.push(entry);

    // Trim old entries if exceeding limit
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(-this.maxEntries);
    }

    if (this.autoSaveEnabled) {
      await this.save();
    }

    log(`Scratchpad: Added ${category} entry (${content.length} chars)`);
    return id;
  }

  /**
   * Read entries from the scratchpad
   */
  read(options?: {
    category?: ScratchpadEntry["category"];
    limit?: number;
    since?: number;
    search?: string;
  }): Array<ScratchpadEntry> {
    let results = [...this.entries];

    if (options?.category) {
      results = results.filter((e) => e.category === options.category);
    }

    if (options?.since) {
      results = results.filter((e) => e.timestamp >= options.since!);
    }

    if (options?.search) {
      const searchLower = options.search.toLowerCase();
      results = results.filter(
        (e) =>
          e.content.toLowerCase().includes(searchLower) ||
          JSON.stringify(e.metadata || {})
            .toLowerCase()
            .includes(searchLower),
      );
    }

    if (options?.limit) {
      results = results.slice(-options.limit);
    }

    return results;
  }

  /**
   * Update an existing entry
   */
  async update(
    id: string,
    content: string,
    metadata?: Record<string, unknown>,
  ): Promise<boolean> {
    const index = this.entries.findIndex((e) => e.id === id);
    if (index === -1) {
      return false;
    }

    this.entries[index] = {
      ...this.entries[index],
      content,
      metadata: metadata || this.entries[index]!.metadata,
      timestamp: Date.now(),
    } as ScratchpadEntry;

    if (this.autoSaveEnabled) {
      await this.save();
    }

    return true;
  }

  /**
   * Delete an entry
   */
  async delete(id: string): Promise<boolean> {
    const initialLength = this.entries.length;
    this.entries = this.entries.filter((e) => e.id !== id);

    if (this.entries.length < initialLength) {
      if (this.autoSaveEnabled) {
        await this.save();
      }
      return true;
    }
    return false;
  }

  /**
   * Clear all entries
   */
  async clear(): Promise<void> {
    this.entries = [];
    if (this.autoSaveEnabled) {
      await this.save();
    }
  }

  /**
   * Get a summary of scratchpad contents
   */
  summarize(): string {
    const categoryCounts = this.entries.reduce(
      (acc, entry) => {
        acc[entry.category] = (acc[entry.category] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    const totalChars = this.entries.reduce(
      (sum, e) => sum + e.content.length,
      0,
    );

    const summary = [
      `Scratchpad Summary (${this.entries.length} entries):`,
      ...Object.entries(categoryCounts).map(
        ([cat, count]) => `  - ${cat}: ${count}`,
      ),
      `Total content: ${totalChars} characters`,
      `Session: ${this.sessionId}`,
    ].join("\n");

    return summary;
  }

  /**
   * Get entries formatted for context inclusion
   */
  formatForContext(limit: number = 10): string {
    const recent = this.read({ limit });

    if (recent.length === 0) {
      return "Scratchpad: (empty)";
    }

    const formatted = recent
      .map((entry) => {
        const timestamp = new Date(entry.timestamp).toISOString();
        const metadata = entry.metadata
          ? ` [${JSON.stringify(entry.metadata)}]`
          : "";
        return `[${entry.category}] ${timestamp}${metadata}\n${entry.content}`;
      })
      .join("\n---\n");

    return `Scratchpad (last ${recent.length} entries):\n${formatted}`;
  }

  /**
   * Save scratchpad to disk
   */
  async save(): Promise<void> {
    try {
      await fs.mkdir(this.saveDir, { recursive: true });
      const filePath = path.join(this.saveDir, `${this.sessionId}.json`);

      const data = {
        sessionId: this.sessionId,
        lastUpdated: Date.now(),
        entries: this.entries,
      };

      await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
      log(`Scratchpad: Saved ${this.entries.length} entries to disk`);
    } catch (error) {
      log(`Scratchpad: Failed to save - ${error}`);
    }
  }

  /**
   * Load scratchpad from disk
   */
  async load(): Promise<boolean> {
    try {
      const filePath = path.join(this.saveDir, `${this.sessionId}.json`);
      const data = await fs.readFile(filePath, "utf-8");
      const parsed = JSON.parse(data);

      if (
        parsed.sessionId === this.sessionId &&
        Array.isArray(parsed.entries)
      ) {
        this.entries = parsed.entries;
        log(`Scratchpad: Loaded ${this.entries.length} entries from disk`);
        return true;
      }
    } catch (error) {
      // File doesn't exist or is invalid, start fresh
      log(`Scratchpad: No existing data found for session ${this.sessionId}`);
    }
    return false;
  }

  /**
   * Export entries as JSON
   */
  toJSON(): string {
    return JSON.stringify(
      {
        sessionId: this.sessionId,
        entries: this.entries,
        summary: this.summarize(),
      },
      null,
      2,
    );
  }

  /**
   * Get entry count by category
   */
  getStats(): Record<string, number> {
    return this.entries.reduce(
      (acc, entry) => {
        acc[entry.category] = (acc[entry.category] || 0) + 1;
        acc["total"] = (acc["total"] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );
  }
}
