import type TextBuffer from "../../text-buffer";

import { Box, Text } from "ink";
import React from "react";

interface EnhancedEditorProps {
  buffer: TextBuffer;
  showLineNumbers?: boolean;
  height?: number;
  showStatusBar?: boolean;
}

export function EnhancedMultilineEditor({
  buffer,
  showLineNumbers = true,
  height = 10,
  showStatusBar = true,
}: EnhancedEditorProps): React.ReactElement {
  const [cursorRow, cursorCol] = buffer.getCursor();
  const lines = buffer.getLines();

  // Calculate visible lines based on cursor position
  const startLine = Math.max(0, cursorRow - Math.floor(height / 2));
  const endLine = Math.min(lines.length, startLine + height);
  const visibleLines = lines.slice(startLine, endLine);

  return (
    <Box flexDirection="column">
      <Box>
        {showLineNumbers && (
          <Box flexDirection="column" marginRight={1}>
            {visibleLines.map((_, idx) => {
              const lineNumber = startLine + idx + 1;
              const isCursorLine = startLine + idx === cursorRow;
              return (
                <Text
                  key={idx}
                  dimColor={!isCursorLine}
                  color={isCursorLine ? "cyan" : undefined}
                >
                  {String(lineNumber).padStart(3)}
                </Text>
              );
            })}
          </Box>
        )}

        <Box flexDirection="column" flexGrow={1}>
          {visibleLines.map((line, idx) => {
            const isCurrentLine = startLine + idx === cursorRow;
            return (
              <Box key={idx}>
                <Text backgroundColor={isCurrentLine ? "gray" : undefined}>
                  {line || " "}
                </Text>
              </Box>
            );
          })}
        </Box>
      </Box>

      {showStatusBar && (
        <Box marginTop={1} gap={2}>
          <Text dimColor>
            Ln {cursorRow + 1}, Col {cursorCol + 1}
          </Text>
          <Text dimColor>|</Text>
          <Text dimColor>{lines.length} lines</Text>
          <Text dimColor>|</Text>
          <Text dimColor>UTF-8</Text>
        </Box>
      )}
    </Box>
  );
}
