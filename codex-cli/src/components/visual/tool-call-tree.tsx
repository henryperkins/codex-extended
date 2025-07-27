import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import React from "react";

export interface ToolCallNode {
  id: string;
  name: string;
  status: "pending" | "running" | "success" | "failed" | "skipped";
  children?: Array<ToolCallNode>;
  duration?: number;
  output?: string;
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.substring(0, maxLength - 3) + "...";
}

export function ToolCallTree({
  root,
  expanded = false,
}: {
  root: ToolCallNode;
  expanded?: boolean;
}): React.ReactElement {
  const statusIcons = {
    pending: { icon: "○", color: "gray" },
    running: { icon: "◉", color: "blue", animated: true },
    success: { icon: "✓", color: "green" },
    failed: { icon: "✗", color: "red" },
    skipped: { icon: "⊘", color: "yellow" },
  } as const;

  const renderNode = (node: ToolCallNode, depth = 0) => {
    const status = statusIcons[node.status];
    const indent = "  ".repeat(depth);

    return (
      <Box key={node.id} flexDirection="column">
        <Box>
          <Text>{indent}</Text>
          <Text color={status.color}>
            {"animated" in status && status.animated ? (
              <Spinner type="dots" />
            ) : (
              status.icon
            )}
          </Text>
          <Text> {node.name}</Text>
          {node.duration && <Text dimColor> ({node.duration}ms)</Text>}
        </Box>
        {expanded && node.output && (
          <Box marginLeft={depth + 2}>
            <Text dimColor>{truncate(node.output, 80)}</Text>
          </Box>
        )}
        {node.children?.map((child) => renderNode(child, depth + 1))}
      </Box>
    );
  };

  return <Box flexDirection="column">{renderNode(root)}</Box>;
}
