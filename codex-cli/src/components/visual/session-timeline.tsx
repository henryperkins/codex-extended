import { Box, Text, useInput } from "ink";
import React, { useState } from "react";

interface TimelineItem {
  icon: string;
  summary: string;
  timestamp?: Date;
  isCurrent?: boolean;
}

interface SessionTimelineProps {
  items: Array<TimelineItem>;
  currentIndex?: number;
  onJump?: (index: number) => void;
}

function formatTime(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);

  if (minutes < 1) {
    return "just now";
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  return `${Math.floor(hours / 24)}d ago`;
}

export function SessionTimeline({
  items,
  currentIndex = -1,
  onJump,
}: SessionTimelineProps): React.ReactElement | null {
  const [collapsed, setCollapsed] = useState(true);
  const [selectedIndex, setSelectedIndex] = useState(currentIndex);

  useInput((input, key) => {
    if (input === "t" || input === "T") {
      setCollapsed(!collapsed);
    } else if (!collapsed) {
      if (key.upArrow) {
        setSelectedIndex((prev) => Math.max(0, prev - 1));
      } else if (key.downArrow) {
        setSelectedIndex((prev) => Math.min(items.length - 1, prev + 1));
      } else if (key.return && onJump) {
        onJump(selectedIndex);
      }
    }
  });

  if (items.length === 0) {
    return null;
  }

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="gray"
      paddingX={1}
    >
      <Text bold>Timeline</Text>

      {collapsed ? (
        <Box gap={1}>
          <Box>
            {items.map((item, i) => (
              <Text
                key={i}
                color={i === currentIndex ? "cyan" : undefined}
                bold={i === currentIndex}
              >
                {item.icon}
              </Text>
            ))}
          </Box>
          <Text dimColor>(T to expand)</Text>
        </Box>
      ) : (
        <Box flexDirection="column" marginTop={1}>
          {items.map((item, i) => (
            <Box key={i} gap={1}>
              <Text color={i === selectedIndex ? "cyan" : "gray"}>
                {i === currentIndex ? "▶" : i === selectedIndex ? "▷" : " "}
              </Text>
              <Text>{item.icon}</Text>
              <Box flexGrow={1}>
                <Text wrap="truncate">{item.summary}</Text>
              </Box>
              {item.timestamp && (
                <Text dimColor>{formatTime(item.timestamp)}</Text>
              )}
            </Box>
          ))}
          <Box marginTop={1}>
            <Text dimColor>↑↓ Navigate · Enter Jump · T Collapse</Text>
          </Box>
        </Box>
      )}
    </Box>
  );
}
