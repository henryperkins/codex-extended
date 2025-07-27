import { Box, Text } from "ink";
import React from "react";

interface MinimapProps {
  lines: Array<string>;
  visibleStart: number;
  visibleEnd: number;
  height?: number;
}

export function Minimap({
  lines,
  visibleStart,
  visibleEnd,
  height = 10,
}: MinimapProps): React.ReactElement {
  const scale = Math.max(1, Math.ceil(lines.length / height));
  const minimapLines: Array<string> = [];

  for (let i = 0; i < height && i * scale < lines.length; i++) {
    const lineIndex = i * scale;
    const line = lines[lineIndex] || "";
    const isVisible = lineIndex >= visibleStart && lineIndex < visibleEnd;

    // Create a simplified representation of the line
    const simplified = line
      .replace(/\s+/g, " ")
      .substring(0, 10)
      .padEnd(10, " ");

    minimapLines.push(isVisible ? `▐${simplified}▌` : ` ${simplified} `);
  }

  return (
    <Box flexDirection="column" marginLeft={1}>
      <Text dimColor>──Map──</Text>
      {minimapLines.map((line, i) => (
        <Text
          key={i}
          dimColor
          backgroundColor={
            i * scale >= visibleStart && i * scale < visibleEnd
              ? "gray"
              : undefined
          }
        >
          {line}
        </Text>
      ))}
    </Box>
  );
}
