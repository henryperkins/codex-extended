# Context Engineering Improvement Plan

## Executive Summary

The Codex CLI has sophisticated context management components (progressive compaction, monitoring, scratchpad) that are underutilized and not integrated into a cohesive strategy. This plan outlines how to activate and enhance these features to align with modern context engineering principles.

## Current State Analysis

### Strengths
- Progressive compaction system with 4 levels (LIGHT, MEDIUM, HEAVY, CRITICAL)
- Real-time context monitoring with visual indicators
- Automatic compaction triggers
- Azure support via `disableResponseStorage`
- Scratchpad tool for session memory

### Critical Issues
1. **Underutilized Infrastructure** - Progressive compaction only works for auto-compact
2. **Reactive Approach** - Only acts when context is nearly full (70%+)
3. **No Context Isolation** - All tools share the same context window
4. **Basic Memory System** - Session-only, no cross-session or intelligent retrieval
5. **Inefficient Tool Outputs** - No compression or summarization of verbose outputs

## Implementation Plan

### Immediate Quick Wins (1-2 days)

#### 1. Enable Progressive Compaction for Manual Command
**File:** `src/components/chat/terminal-chat-input.tsx`
```typescript
// Change manual /compact to use progressive compaction
if (value === "/compact") {
  onCompact(false); // Currently uses simple summary
  // Change to: onCompact(true); // Use progressive compaction
}
```

#### 2. Adjust Context Warning Thresholds
**File:** `src/components/chat/terminal-chat-input.tsx`
- Add 60% warning (yellow): "Context filling up - consider /compact"
- Add 50% notice (green): Show context usage subtly
- Keep existing 75%, 25%, 10% warnings

#### 3. Implement Tool Output Limits
**File:** `src/utils/agent/agent-loop.ts`
```typescript
// In handleExecCommand result processing
const MAX_OUTPUT_LENGTH = 10000; // 10KB
if (outputText.length > MAX_OUTPUT_LENGTH) {
  const truncated = outputText.substring(0, MAX_OUTPUT_LENGTH);
  outputText = `${truncated}\n\n[Output truncated from ${outputText.length} to ${MAX_OUTPUT_LENGTH} characters]`;
}
```

#### 4. Improve Token Counting Accuracy
**File:** `src/utils/token-counter.ts`
- Include system prompts in token count
- Add 10% buffer for response generation
- Show actual tokens remaining, not just percentage

### Phase 1: Critical Integration (Weeks 1-2)

#### 1.1 Enhanced Progressive Compaction
- Enable progressive compaction for manual `/compact` command
- Add compaction level indicator to UI
- Implement compaction preview before applying
- Show tokens saved after compaction

**New Features:**
- `/compact preview` - Show what would be compacted
- `/compact light|medium|heavy` - User-controlled compaction level
- Compaction history in session

#### 1.2 Proactive Context Monitoring
**New File:** `src/utils/context-monitor.ts`
```typescript
export class ContextMonitor {
  // Continuous monitoring of context usage
  // Early warning system at 50%, 60%, 70%
  // Context usage trends and predictions
  // Suggest optimal compaction timing
}
```

#### 1.3 Smart Tool Output Compression
- Tool-specific output summarization rules
- Configurable output limits per tool
- Output importance scoring
- Automatic compression of verbose outputs

### Phase 2: Memory Enhancement (Weeks 3-4)

#### 2.1 Persistent Memory Store
**New File:** `src/utils/memory/memory-store.ts`
```typescript
export interface Memory {
  id: string;
  type: 'episodic' | 'procedural' | 'semantic';
  content: string;
  embedding?: number[];
  importance: number;
  lastAccessed: Date;
  sessionId: string;
  metadata: Record<string, any>;
}

export class MemoryStore extends Scratchpad {
  // Extend existing Scratchpad for cross-session storage
  // Implement memory categories
  // Add embedding-based indexing
  // Memory decay and importance scoring
}
```

#### 2.2 Context-Aware Memory Selection
**New File:** `src/utils/memory/memory-selector.ts`
- RAG-based memory retrieval
- Task-based filtering
- Relevance scoring
- Context budget allocation

### Phase 3: Advanced Context Isolation (Weeks 5-7)

#### 3.1 Context Tracks
**New File:** `src/utils/context-tracks.ts`
```typescript
export class ContextTrack {
  id: string;
  purpose: string;
  items: ResponseItem[];
  maxTokens: number;
  priority: number;
}

export class ContextTrackManager {
  // Parallel context tracks for different tasks
  // Context switching mechanism
  // Track merging strategies
  // Archival and restoration
}
```

#### 3.2 Tool Context Isolation
- Isolated context pools for each tool
- Token budget allocation per tool
- Tool output staging area
- Selective context inclusion

### Phase 4: Intelligent Compaction (Weeks 8-9)

#### 4.1 Hierarchical Compaction
**New File:** `src/utils/hierarchical-compaction.ts`
- Message importance scoring
- Multi-level summarization
- Context expansion capability
- Critical information preservation

#### 4.2 Compaction Recovery
**New File:** `src/utils/compaction-recovery.ts`
- Store original context before compaction
- Selective expansion of summaries
- Compaction history tracking
- State rollback capability

### Phase 5: Provider Optimization (Week 10)

#### 5.1 Azure-Specific Optimizations
**New File:** `src/utils/providers/azure-context.ts`
- Azure-aware chunking strategies
- Dynamic context sizing for Azure models
- Optimized compaction for stateless mode
- Improved transcript management

## Implementation Priority

### Week 1-2: Quick Wins + Critical Integration
1. Enable progressive compaction for manual command
2. Implement tool output limits
3. Add proactive monitoring
4. Improve token counting

### Week 3-4: Memory Enhancement
1. Build persistent memory store
2. Implement memory selection
3. Add memory UI commands
4. Test cross-session memory

### Week 5-7: Context Isolation
1. Implement context tracks
2. Add tool isolation
3. Create switching UI
4. Test parallel contexts

### Week 8-9: Intelligent Compaction
1. Build hierarchical system
2. Add recovery mechanism
3. Implement importance scoring
4. Test reversibility

### Week 10: Provider Optimization
1. Azure optimizations
2. Provider-specific strategies
3. Performance testing
4. Documentation

## Success Metrics

- **50% reduction** in context limit errors
- **30% increase** in average conversation length
- **40% reduction** in unnecessary compactions
- **User-controlled** compaction timing
- **Zero loss** of critical information during compaction
- **25% improvement** in Azure performance

## Technical Considerations

### Backward Compatibility
- All changes must be backward compatible
- Existing sessions should continue to work
- Configuration migration if needed

### Performance Impact
- Monitor token counting overhead
- Optimize memory search operations
- Cache frequently accessed memories
- Async operations where possible

### Testing Strategy
- Unit tests for each new component
- Integration tests for context flow
- Performance benchmarks
- User acceptance testing

## Configuration Updates

### New Settings
```yaml
# ~/.codex/config.yaml
context:
  # Proactive monitoring
  warningThresholds: [50, 60, 70, 80, 90]
  
  # Compaction settings
  autoCompactThreshold: 70
  compactionLevels:
    light: 70
    medium: 80
    heavy: 90
    critical: 95
  
  # Memory settings
  memory:
    enabled: true
    maxMemories: 1000
    crossSession: true
    
  # Tool output limits
  toolOutputLimits:
    shell: 10000
    fetch_url: 20000
    web_search: 15000
```

## Rollout Plan

1. **Alpha Testing** - Internal testing with team
2. **Beta Release** - Limited release to power users
3. **Staged Rollout** - 
   - Week 1: 10% of users
   - Week 2: 25% of users
   - Week 3: 50% of users
   - Week 4: 100% of users
4. **Monitoring** - Track metrics and user feedback
5. **Iteration** - Quick fixes based on feedback

## Risk Mitigation

- **Feature Flags** - All new features behind flags
- **Rollback Plan** - Easy disable for each feature
- **Performance Monitoring** - Track impact on latency
- **User Communication** - Clear documentation of changes

## Next Steps

1. Review and approve plan
2. Create feature branches for each phase
3. Begin implementation of quick wins
4. Set up monitoring infrastructure
5. Prepare user documentation

---

*This plan addresses the critical gap between Codex CLI's existing infrastructure and modern context engineering best practices. By activating and enhancing what already exists, we can deliver significant improvements quickly while building toward a more sophisticated system.*