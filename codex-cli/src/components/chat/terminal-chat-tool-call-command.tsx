import { parseApplyPatch } from "../../parse-apply-patch";
import { shortenPath } from "../../utils/short-path";
import { SmartOutputViewer } from "../visual";
import chalk from "chalk";
import { Text, Box } from "ink";
import React from "react";

export function TerminalChatToolCallCommand({
  commandForDisplay,
  explanation,
}: {
  commandForDisplay: string;
  explanation?: string;
}): React.ReactElement {
  // -------------------------------------------------------------------------
  // Colorize diff output inside the command preview: we detect individual
  // lines that begin with '+' or '-' (excluding the typical diff headers like
  // '+++', '---', '++', '--') and apply green/red coloring.  This mirrors
  // how Git shows diffs and makes the patch easier to review.
  // -------------------------------------------------------------------------

  const colorizedCommand = commandForDisplay
    .split("\n")
    .map((line) => {
      if (line.startsWith("+") && !line.startsWith("++")) {
        return chalk.green(line);
      }
      if (line.startsWith("-") && !line.startsWith("--")) {
        return chalk.red(line);
      }
      return line;
    })
    .join("\n");

  return (
    <Box flexDirection="column" gap={1}>
      <Text bold color="green">
        Shell Command
      </Text>
      <SmartOutputViewer
        content={`$ ${colorizedCommand}`}
        maxInitialLines={10}
        preservePatterns={[/^\+/, /^-/]}
        highlightErrors={false}
      />
      {explanation && (
        <>
          <Text bold color="yellow">
            Explanation
          </Text>
          <Box flexDirection="column">
            {explanation.split("\n").map((line, i) => {
              // Apply different styling to headings (numbered items)
              if (line.match(/^\d+\.\s+/)) {
                return (
                  <Text key={i} bold color="cyan">
                    {line}
                  </Text>
                );
              } else if (line.match(/^\s*\*\s+/)) {
                // Style bullet points
                return (
                  <Text key={i} color="magenta">
                    {line}
                  </Text>
                );
              } else if (line.match(/^(WARNING|CAUTION|NOTE):/i)) {
                // Style warnings
                return (
                  <Text key={i} bold color="red">
                    {line}
                  </Text>
                );
              } else {
                return <Text key={i}>{line}</Text>;
              }
            })}
          </Box>
        </>
      )}
    </Box>
  );
}

export function TerminalChatToolCallApplyPatch({
  commandForDisplay,
  patch,
}: {
  commandForDisplay: string;
  patch: string;
}): React.ReactElement {
  const ops = React.useMemo(() => parseApplyPatch(patch), [patch]);
  const firstOp = ops?.[0];

  const title = React.useMemo(() => {
    if (!firstOp) {
      return "";
    }
    return capitalize(firstOp.type);
  }, [firstOp]);

  const filePath = React.useMemo(() => {
    if (!firstOp) {
      return "";
    }
    return shortenPath(firstOp.path || ".");
  }, [firstOp]);

  if (ops == null) {
    return (
      <Box flexDirection="column">
        <Text bold color="red">
          Invalid Patch
        </Text>
        <Text color="red" dimColor>
          The provided patch command is invalid.
        </Text>
        <SmartOutputViewer
          content={commandForDisplay}
          maxInitialLines={5}
          highlightErrors={true}
        />
      </Box>
    );
  }

  if (!firstOp) {
    return (
      <>
        <Text bold color="yellow">
          Empty Patch
        </Text>
        <Text color="yellow" dimColor>
          No operations found in the patch command.
        </Text>
        <Text dimColor>{commandForDisplay}</Text>
      </>
    );
  }

  return (
    <>
      <Text>
        <Text bold>{title}</Text> <Text dimColor>{filePath}</Text>
      </Text>
      <Text>
        <Text dimColor>$</Text> {commandForDisplay}
      </Text>
    </>
  );
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
