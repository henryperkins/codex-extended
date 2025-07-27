import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import React from "react";

interface ProgressBarProps {
  task: string;
  progress?: number;
  subTasks?: Array<{ name: string; status: "pending" | "running" | "done" }>;
  eta?: number;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

export function EnhancedProgressBar({
  task,
  progress,
  subTasks,
  eta,
}: ProgressBarProps): React.ReactElement {
  const width = 30;
  const filled = Math.floor((progress || 0) * width);

  return (
    <Box flexDirection="column" gap={1}>
      <Box gap={1}>
        <Spinner type="dots" />
        <Text>{task}</Text>
        {progress !== undefined && (
          <>
            <Text>
              [{"█".repeat(filled)}
              {"░".repeat(width - filled)}]
            </Text>
            <Text dimColor>{(progress * 100).toFixed(0)}%</Text>
          </>
        )}
        {eta && <Text dimColor>ETA: {formatDuration(eta)}</Text>}
      </Box>
      {subTasks && (
        <Box flexDirection="column" marginLeft={2}>
          {subTasks.map((st, i) => (
            <Text key={i} dimColor>
              {st.status === "done" ? "✓" : st.status === "running" ? "◉" : "○"}{" "}
              {st.name}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  );
}
