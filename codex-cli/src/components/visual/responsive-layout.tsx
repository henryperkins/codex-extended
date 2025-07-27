import type { ReactNode } from "react";

import { ContextVisualizer } from "./context-visualizer";
import { SessionTimeline } from "./session-timeline";
import { useTerminalSize } from "../../hooks/use-terminal-size";
import { Box } from "ink";
import React, { useMemo } from "react";

interface ResponsiveLayoutProps {
  children: ReactNode;
  showContextVisualizer?: boolean;
  showTimeline?: boolean;
  contextUsed?: number;
  contextTotal?: number;
  timelineItems?: Array<{
    icon: string;
    summary: string;
    timestamp?: Date;
    isCurrent?: boolean;
  }>;
  onTimelineJump?: (index: number) => void;
}

export function ResponsiveLayout({
  children,
  showContextVisualizer = false,
  showTimeline = false,
  contextUsed = 0,
  contextTotal = 1,
  timelineItems = [],
  onTimelineJump,
}: ResponsiveLayoutProps): React.ReactElement {
  const { columns, rows } = useTerminalSize();

  const layout = useMemo(() => {
    if (columns < 80) {
      return "compact";
    }
    if (columns < 120) {
      return "normal";
    }
    return "wide";
  }, [columns]);

  const showSidebar = columns > 100 && (showContextVisualizer || showTimeline);
  const sidebarWidth = Math.min(30, Math.floor(columns * 0.25));
  const showTimelineInSidebar = rows > 30 && showTimeline;

  return (
    <Box flexDirection={layout === "compact" ? "column" : "row"}>
      <Box flexGrow={1} flexDirection="column">
        {children}
      </Box>

      {showSidebar && (
        <Box width={sidebarWidth} flexDirection="column" marginLeft={1} gap={1}>
          {showContextVisualizer && (
            <ContextVisualizer used={contextUsed} total={contextTotal} />
          )}

          {showTimelineInSidebar && timelineItems.length > 0 && (
            <SessionTimeline
              items={timelineItems}
              currentIndex={timelineItems.findIndex((item) => item.isCurrent)}
              onJump={onTimelineJump}
            />
          )}
        </Box>
      )}
    </Box>
  );
}
