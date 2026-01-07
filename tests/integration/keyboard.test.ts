import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { unlinkSync, writeFileSync, existsSync } from "fs";
import path from "path";

describe("Integration: Keyboard Command Handling", () => {
  const TEST_PLAN = path.join(process.cwd(), "test-plan-integration.md");

  beforeAll(() => {
    if (existsSync(TEST_PLAN)) {
      unlinkSync(TEST_PLAN);
    }
  });

  afterAll(() => {
    if (existsSync(TEST_PLAN)) {
      unlinkSync(TEST_PLAN);
    }
  });

  it("should handle command mode entry and exit", async () => {
    const planContent = `# Test Plan
- [ ] Task 1
- [ ] Task 2
`;
    writeFileSync(TEST_PLAN, planContent);

    expect(existsSync(TEST_PLAN)).toBe(true);
  });

  it("should parse tasks correctly for keyboard interaction", async () => {
    const { parsePlan } = await import("../../src/plan");

    const result = await parsePlan(TEST_PLAN);

    expect(result.tasks).toHaveLength(2);
    expect(result.total).toBe(2);
    expect(result.done).toBe(0);

    result.tasks.forEach((task) => {
      expect(task.id).toBeDefined();
      expect(task.text).toBeDefined();
      expect(task.done).toBe(false);
    });
  });

  it("should handle complex plan with multiple sections", async () => {
    const { parsePlan } = await import("../../src/plan");

    const complexPlan = `# Complex Plan

## Section 1
- [x] Completed task 1
- [ ] Pending task 1

## Section 2
- [x] Completed task 2
- [ ] Pending task 2

\`\`\`typescript
// Code block with checkboxes (should be ignored)
- [ ] Code task 1
- [x] Code task 2
\`\`\`

## Section 3
- [ ] Pending task 3
- [x] Completed task 3
`;

    writeFileSync(TEST_PLAN, complexPlan);

    const result = await parsePlan(TEST_PLAN);

    expect(result.tasks).toHaveLength(6);
    expect(result.done).toBe(3);
    expect(result.total).toBe(6);

    const taskTexts = result.tasks.map((t) => t.text);
    expect(taskTexts).toContain("Completed task 1");
    expect(taskTexts).toContain("Pending task 1");
    expect(taskTexts).toContain("Completed task 2");
    expect(taskTexts).toContain("Pending task 2");
    expect(taskTexts).toContain("Pending task 3");
    expect(taskTexts).toContain("Completed task 3");

    expect(taskTexts).not.toContain("Code task 1");
    expect(taskTexts).not.toContain("Code task 2");
  });
});
