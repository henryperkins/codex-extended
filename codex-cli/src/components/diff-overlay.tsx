import { SmartOutputViewer } from "./visual";
import { Box, Text, useInput } from "ink";
import React from "react";

/**
 * Simple scrollable view for displaying a diff.
 * The component is intentionally lightweight and mirrors the UX of
 * HistoryOverlay: Up/Down or j/k to scroll, PgUp/PgDn for paging and Esc to
 * close. The caller is responsible for computing the diff text.
 */
export default function DiffOverlay({
  diffText,
  onExit,
}: {
  diffText: string;
  onExit: () => void;
}): JSX.Element {
  useInput((input, key) => {
    if (key.escape || input === "q") {
      onExit();
      return;
    }
  });

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="gray"
      width={Math.min(120, process.stdout.columns || 120)}
    >
      <Box paddingX={1}>
        <Text bold>
          Working tree diff ({diffText.split("\n").length} lines)
        </Text>
      </Box>

      <Box flexDirection="column" paddingX={1}>
        <SmartOutputViewer
          content={diffText}
          maxInitialLines={process.stdout.rows ? process.stdout.rows - 6 : 20}
          preservePatterns={[/^\+/, /^-/, /^@@/, /^diff --git/]}
          highlightErrors={false}
        />
      </Box>

      <Box paddingX={1}>
        <Text dimColor>esc Close ↑↓ Scroll PgUp/PgDn g/G First/Last</Text>
      </Box>
    </Box>
  );
}
