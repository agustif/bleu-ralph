/**
 * Plan file parser for opencode-ralph
 */

export type PlanProgress = {
  done: number;
  total: number;
};

export type Task = {
  id: string;
  line: number;
  text: string;
  done: boolean;
};

export type PlanData = PlanProgress & {
  tasks: Task[];
};

/**
 * Parse a plan file and return structured task data.
 * Tasks are identified by markdown checkboxes: `- [x]` (done) and `- [ ]` (not done)
 * @param path - Path to plan file
 * @returns Object with done/total counts and structured tasks array
 */
export async function parsePlan(path: string): Promise<PlanData> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    return { done: 0, total: 0, tasks: [] };
  }

  const content = await file.text();
  const tasks: Task[] = [];
  let done = 0;
  let total = 0;

  const lines = content.split("\n");

  // Remove content inside fenced code blocks (```...```) before parsing
  // This prevents counting checkboxes that appear in code examples
  const linesWithoutCodeBlocks: (string | null)[] = lines.map((line, index) => {
    // Start of code block
    if (line.trim().startsWith("```")) {
      return null; // Mark as code block line (will be skipped)
    }
    return line;
  });

  let inCodeBlock = false;

  for (let i = 0; i < linesWithoutCodeBlocks.length; i++) {
    const line = linesWithoutCodeBlocks[i];

    // Toggle code block state
    if (line === null || (typeof line === "string" && line.trim().startsWith("```"))) {
      inCodeBlock = !inCodeBlock;
      continue;
    }

    // Skip lines inside code blocks
    if (inCodeBlock || line === null) continue;

    // Match checkboxes: "- [x]" (done) or "- [ ]" (not done)
    // Support any indentation level
    const match = typeof line === "string" ? line.match(/^(\s*)-\s\[([ xX])\]\s+(.*)$/) : null;
    if (match) {
      const isDone = match[2].toLowerCase() === "x";
      const taskText = match[3].trim();

      total++;
      if (isDone) {
        done++;
      }

      tasks.push({
        id: `task-${i + 1}`,
        line: i + 1,
        text: taskText,
        done: isDone,
      });
    }
  }

  return {
    done,
    total,
    tasks,
  };
}
