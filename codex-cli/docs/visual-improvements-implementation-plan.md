# Codex CLI Visual Improvements Implementation Plan

## Overview

This plan outlines the implementation strategy for enhancing the terminal visual display in Codex CLI, organized in 3-week sprints focusing on critical improvements first.

## Phase 1: Foundation & Critical Components (Week 1)

### 1.1 Create Core Visual Components Library

**Location**: `src/ui/components/visual/`

#### Components to Build:

- `ProgressBar.tsx` - Enhanced progress indicators with subtasks
- `SmartOutput.tsx` - Intelligent output viewer with expand/collapse
- `ContextMeter.tsx` - Visual context usage indicator
- `ErrorPanel.tsx` - Categorized error display

#### Integration Points:

- Replace spinner in `singlepass-cli-app.tsx:WorkingSpinner`
- Enhance output in `terminal-chat-tool-call-command.tsx`
- Update context display in `singlepass-cli-app.tsx`
- Wrap errors in `terminal-chat-base-command.tsx`

### 1.2 Implement Progress System

```typescript
// src/ui/hooks/use-progress.ts
interface ProgressState {
  task: string;
  progress?: number;
  subtasks: SubTask[];
  startTime: number;
}

// src/ui/components/visual/ProgressBar.tsx
export function ProgressBar({ state }: { state: ProgressState }) {
  // Implementation with ETA calculation
}
```

### 1.3 Smart Output Management

```typescript
// src/ui/components/visual/SmartOutput.tsx
- Implement truncation algorithm preserving error/warning lines
- Add keyboard shortcuts for expand/collapse
- Include search functionality with highlighting
```

### 1.4 Context Visualization

```typescript
// src/ui/components/visual/ContextMeter.tsx
- Visual bar with color coding
- Breakdown by message type
- Proactive suggestions when >75% full
```

## Phase 2: Enhanced Editing & Tool Visualization (Week 2)

### 2.1 Enhanced Multiline Editor

**Location**: `src/ui/components/enhanced-editor/`

#### Features:

- Line numbers component
- Cursor position indicator
- Syntax highlighting (leverage existing syntax highlighter if available)
- Minimap for large files

#### Integration:

- Extend `text-buffer.ts` functionality
- Update `multiline-text-editor.tsx`

### 2.2 Tool Call Tree Visualization

```typescript
// src/ui/components/visual/ToolCallTree.tsx
- Hierarchical display of tool calls
- Animated status indicators
- Collapsible nodes with output preview
```

### 2.3 Responsive Layout System

```typescript
// src/ui/components/layout/ResponsiveLayout.tsx
- Use existing useTerminalSize() hook
- Define breakpoints: compact (<80), normal (80-120), wide (>120)
- Conditionally render sidebar components
```

## Phase 3: Advanced Features (Week 3+)

### 3.1 Session Timeline

```typescript
// src/ui/components/visual/SessionTimeline.tsx
- Compact and expanded views
- Jump-to functionality
- Visual indicators for message types
```

### 3.2 Theme System

```typescript
// src/ui/theme/index.ts
- Define color schemes
- Terminal capability detection
- User preference storage
```

## Implementation Strategy

### Week 1 Tasks:

1. **Day 1-2**: Set up component structure and base classes
2. **Day 3-4**: Implement ProgressBar and SmartOutput
3. **Day 5-6**: Implement ContextMeter and ErrorPanel
4. **Day 7**: Integration and testing

### Week 2 Tasks:

1. **Day 1-2**: Enhanced editor components
2. **Day 3-4**: Tool call visualization
3. **Day 5-6**: Responsive layout system
4. **Day 7**: Integration and refinement

### Week 3 Tasks:

1. **Day 1-3**: Session timeline
2. **Day 4-5**: Theme system
3. **Day 6-7**: Polish and optimization

## File Structure

```
src/ui/
├── components/
│   ├── visual/
│   │   ├── ProgressBar.tsx
│   │   ├── SmartOutput.tsx
│   │   ├── ContextMeter.tsx
│   │   ├── ErrorPanel.tsx
│   │   ├── ToolCallTree.tsx
│   │   └── SessionTimeline.tsx
│   ├── enhanced-editor/
│   │   ├── LineNumbers.tsx
│   │   ├── SyntaxHighlighter.tsx
│   │   └── Minimap.tsx
│   └── layout/
│       └── ResponsiveLayout.tsx
├── hooks/
│   ├── use-progress.ts
│   └── use-theme.ts
└── theme/
    └── index.ts
```

## Integration Points

### Existing Files to Modify:

1. `singlepass-cli-app.tsx` - Replace WorkingSpinner, update context display
2. `terminal-chat-tool-call-command.tsx` - Add ToolCallTree visualization
3. `terminal-chat-base-command.tsx` - Wrap with ResponsiveLayout
4. `multiline-text-editor.tsx` - Add enhanced editor features
5. `diff-overlay.tsx` & `history-overlay.tsx` - Apply SmartOutput patterns

### New Hooks to Create:

- `useProgress()` - Track operation progress
- `useTheme()` - Theme management
- `useKeyboardShortcuts()` - Enhanced navigation

## Testing Strategy

### Unit Tests:

- Component rendering tests
- Truncation algorithm tests
- Progress calculation tests
- Theme switching tests

### Integration Tests:

- Terminal size responsiveness
- Keyboard navigation
- Performance with large outputs
- Context meter accuracy

### Manual Testing:

- Various terminal emulators
- Different screen sizes
- Color scheme compatibility
- Performance profiling

## Performance Considerations

1. **Debouncing**: Terminal resize events
2. **Memoization**: Complex calculations (progress, truncation)
3. **Virtualization**: Long lists and outputs
4. **Lazy Loading**: Theme and syntax highlighting

## Rollout Strategy

1. **Feature Flags**: Gradual rollout of visual improvements
2. **Backwards Compatibility**: Maintain existing CLI arguments
3. **Documentation**: Update user guide with new features
4. **Feedback Loop**: Collect user feedback for iterations

## Success Metrics

- Reduced time to understand operation status
- Fewer context limit surprises
- Improved error resolution time
- Better navigation in long outputs
- Positive user feedback on visual clarity

## Dependencies

### External:

- Ink components (already in use)
- Terminal size detection (existing)
- ANSI color support (existing)

### Internal:

- Existing hooks and utilities
- Type definitions
- Configuration system

## Risks & Mitigations

1. **Terminal Compatibility**: Test on multiple terminals, provide fallbacks
2. **Performance Impact**: Profile and optimize rendering
3. **Complexity**: Keep components focused and composable
4. **User Disruption**: Feature flags for gradual adoption
