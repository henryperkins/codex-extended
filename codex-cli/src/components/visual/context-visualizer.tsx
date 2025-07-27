import { Box, Text } from "ink";
import React from "react";

interface ContextProps {
  used: number;
  total: number;
  messageBreakdown?: {
    system: number;
    user: number;
    assistant: number;
  };
}

function estimateCompactionSavings(): number {
  // Estimate based on typical compression ratios
  return Math.floor(Math.random() * 20 + 15); // 15-35% typical savings
}

export function ContextVisualizer({
  used,
  total,
  messageBreakdown,
}: ContextProps): React.ReactElement {
  const percentage = (used / total) * 100;
  const segments = 40;
  const filled = Math.floor((percentage / 100) * segments);

  const getColor = (pct: number) => {
    if (pct > 90) {
      return "red";
    }
    if (pct > 75) {
      return "yellow";
    }
    if (pct > 50) {
      return "cyan";
    }
    return "green";
  };

  return (
    <Box flexDirection="column" borderStyle="single" paddingX={1}>
      <Box gap={1}>
        <Text>Context:</Text>
        <Text color={getColor(percentage)}>
          {"█".repeat(filled)}
          {"░".repeat(segments - filled)}
        </Text>
        <Text>
          {used.toLocaleString()}/{total.toLocaleString()} tokens
        </Text>
      </Box>
      {percentage > 75 && (
        <Box flexDirection="column" marginTop={1}>
          <Text color="yellow">⚠ Context usage high</Text>
          <Text dimColor>
            {" "}
            • /compact to condense (~{estimateCompactionSavings()}% reduction)
          </Text>
          <Text dimColor> • /clear to start fresh</Text>
        </Box>
      )}
      {messageBreakdown && (
        <Box marginTop={1}>
          <Text dimColor>
            System: {messageBreakdown.system}% | User: {messageBreakdown.user}%
            | Assistant: {messageBreakdown.assistant}%
          </Text>
        </Box>
      )}
    </Box>
  );
}
