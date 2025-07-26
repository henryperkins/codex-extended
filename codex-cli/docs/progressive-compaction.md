# Progressive Compaction Strategy

## Overview

The progressive compaction strategy automatically manages context usage by applying increasingly aggressive compaction techniques as the context window fills up. This ensures optimal use of available context while maintaining conversation continuity.

## Compaction Levels

The system uses five compaction levels based on context usage percentage:

### 1. **NONE** (0-69% usage)
- No compaction needed
- All messages and tool outputs retained

### 2. **LIGHT** (70-79% usage)
- Keep last 10 messages
- Summarize messages older than 20 from the end
- Retain all tool outputs
- Standard summarization

### 3. **MEDIUM** (80-89% usage)
- Keep last 6 messages
- Summarize messages older than 10 from the end
- Drop tool outputs to save space
- Aggressive summarization (shorter summaries)

### 4. **HEAVY** (90-94% usage)
- Keep last 4 messages
- Summarize messages older than 6 from the end
- Drop tool outputs and system messages
- Very aggressive summarization

### 5. **CRITICAL** (95%+ usage)
- Keep only last 2 messages
- Summarize everything else
- Drop all non-essential content
- Emergency ultra-compact summaries

## How It Works

### Automatic Triggering
The system monitors context usage continuously and triggers compaction when thresholds are crossed:
- First compaction at 70% (LIGHT)
- Progressive increases as usage grows
- Automatic re-compaction if needed after initial attempt

### Progressive Compaction Process
1. **Analyze Context Usage**: Calculate current usage percentage
2. **Determine Level**: Select appropriate compaction level
3. **Prepare Items**: Separate items to keep vs. summarize
4. **Generate Summary**: Create level-appropriate summary
5. **Apply Compaction**: Replace old items with summary + recent items
6. **Verify Results**: If still over threshold, try next level

### Manual Compaction
Users can trigger manual compaction with custom instructions:
```
/compact
/compact Focus on the authentication implementation details
/compact Summarize only the bug fixes and testing results
```

## Implementation Details

### Key Components

1. **CompactionLevel Enum**: Defines the five levels
2. **getCompactionLevel()**: Maps usage percentage to level
3. **getCompactionConfig()**: Returns configuration for each level
4. **prepareItemsForCompaction()**: Separates items based on config
5. **performProgressiveCompaction()**: Main compaction logic
6. **generateProgressiveSummary()**: Creates level-appropriate summaries

### Token Estimation
The system estimates token savings before compaction:
- Calculates tokens in items to be removed
- Estimates summary size (200-500 tokens)
- Returns net savings estimate

### Model-Aware Token Counting
Uses proper BPE tokenization for accurate counts:
- Supports all OpenAI models including o3 and gpt-4.1
- Falls back to character estimation for unknown models
- Considers model-specific token limits

## Benefits

1. **Gradual Degradation**: Context quality degrades gradually, not suddenly
2. **Automatic Management**: No manual intervention needed in most cases
3. **Preserves Recent Context**: Always keeps the most recent exchanges
4. **Customizable**: Manual compaction supports custom instructions
5. **Multi-Level Strategy**: Different strategies for different usage levels
6. **Performance Optimized**: Prevents context overflow proactively

## User Experience

### Visual Indicators
- 🔄 Standard compaction (LIGHT/MEDIUM)
- ⚠️ Warning indicator (HEAVY/CRITICAL)
- ✅ Completion confirmation with tokens freed

### Status Messages
- Shows current usage percentage
- Indicates compaction level being applied
- Reports tokens freed after compaction
- Lists what was dropped (tool outputs, system messages)

## Configuration

The system is pre-configured with sensible defaults but can be adjusted:
- Compaction thresholds
- Number of messages to keep per level
- Summarization aggressiveness
- Tool output retention policies

## Best Practices

1. **Monitor Context Usage**: Watch the percentage indicator
2. **Manual Compaction**: Use `/compact` with instructions for better summaries
3. **Strategic Timing**: Compact before starting new complex tasks
4. **Custom Instructions**: Provide focus areas for manual compaction
5. **Review Summaries**: Check that important context is preserved