import { Box, Text } from "ink";
import React from "react";

export interface ErrorInfo {
  type: "syntax" | "runtime" | "permission" | "network" | "validation";
  message: string;
  file?: string;
  line?: number;
  suggestion?: string;
  quickFixes?: Array<{ label: string; action: () => void }>;
}

export function ErrorPanel({
  error,
}: {
  error: ErrorInfo;
}): React.ReactElement {
  const icons = {
    syntax: "⚠️",
    runtime: "❌",
    permission: "🔒",
    network: "🌐",
    validation: "📋",
  };

  const colors = {
    syntax: "yellow",
    runtime: "red",
    permission: "magenta",
    network: "cyan",
    validation: "orange",
  } as const;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={colors[error.type]}
      paddingX={1}
    >
      <Box gap={1}>
        <Text>{icons[error.type]}</Text>
        <Text color={colors[error.type]} bold>
          {error.type.toUpperCase()} ERROR
        </Text>
        {error.file && (
          <Text dimColor>
            in {error.file}:{error.line}
          </Text>
        )}
      </Box>

      <Text wrap="wrap">{error.message}</Text>

      {error.suggestion && (
        <Box marginTop={1}>
          <Text color="green">💡 Suggestion: {error.suggestion}</Text>
        </Box>
      )}

      {error.quickFixes && error.quickFixes.length > 0 && (
        <Box marginTop={1} gap={2}>
          <Text dimColor>Quick fixes:</Text>
          {error.quickFixes.map((fix, i) => (
            <Text key={i} color="cyan">
              [{i + 1}] {fix.label}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  );
}
