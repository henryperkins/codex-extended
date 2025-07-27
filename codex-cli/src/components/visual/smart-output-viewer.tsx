import { Box, Text, useInput } from "ink";
import React, { useState, useMemo } from "react";

interface SmartOutputProps {
  content: string;
  maxInitialLines?: number;
  preservePatterns?: Array<RegExp>;
  highlightErrors?: boolean;
}

interface ImportantLine {
  line: string;
  idx: number;
  important: boolean;
}

function smartTruncate(
  lines: Array<string>,
  maxLines: number,
  importantLines: Array<ImportantLine>,
): Array<string> {
  if (lines.length <= maxLines) {
    return lines;
  }

  const result: Array<string> = [];
  const importantIndices = new Set(importantLines.map((l) => l.idx));

  // Always include first few and last few lines
  const headLines = 3;
  const tailLines = 3;
  const availableForMiddle =
    maxLines - headLines - tailLines - importantLines.length;

  // Add head
  for (let i = 0; i < headLines && i < lines.length; i++) {
    if (!importantIndices.has(i)) {
      result.push(lines[i] ?? "");
    }
  }

  // Add important lines
  for (const { line, idx } of importantLines) {
    if (idx >= headLines && idx < lines.length - tailLines) {
      result.push(`[${idx}] ${line}`);
    }
  }

  // Add truncation indicator
  if (availableForMiddle < 0) {
    result.push(
      `... ${lines.length - headLines - tailLines - importantLines.length} lines hidden ...`,
    );
  }

  // Add tail
  for (let i = Math.max(lines.length - tailLines, 0); i < lines.length; i++) {
    if (!importantIndices.has(i)) {
      result.push(lines[i] ?? "");
    }
  }

  return result;
}

export function SmartOutputViewer({
  content,
  maxInitialLines = 10,
  preservePatterns = [/error/i, /warning/i, /failed/i],
  highlightErrors = true,
}: SmartOutputProps): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const [searchTerm] = useState("");

  const lines = useMemo(() => content.split("\n"), [content]);

  const importantLines = useMemo(() => {
    return lines.reduce((acc, line, idx) => {
      if (preservePatterns.some((p) => p.test(line))) {
        acc.push({ line, idx, important: true });
      }
      return acc;
    }, [] as Array<ImportantLine>);
  }, [lines, preservePatterns]);

  const displayLines = useMemo(() => {
    return expanded
      ? lines
      : smartTruncate(lines, maxInitialLines, importantLines);
  }, [expanded, lines, maxInitialLines, importantLines]);

  useInput((input) => {
    if (input === " ") {
      setExpanded(!expanded);
    }
  });

  return (
    <Box flexDirection="column">
      <Box flexDirection="column" borderStyle="single" borderColor="gray">
        {displayLines.map((line, i) => (
          <Text
            key={i}
            color={highlightErrors && /error/i.test(line) ? "red" : undefined}
            backgroundColor={
              searchTerm &&
              line.toLowerCase().includes(searchTerm.toLowerCase())
                ? "yellow"
                : undefined
            }
          >
            {line}
          </Text>
        ))}
      </Box>
      <Box gap={1}>
        <Text dimColor>
          {expanded ? "▼" : "▶"} {lines.length} lines
        </Text>
        <Text dimColor>Space: expand/collapse</Text>
        {expanded && <Text dimColor>/ : search</Text>}
      </Box>
    </Box>
  );
}
