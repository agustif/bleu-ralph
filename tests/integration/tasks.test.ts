import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { unlinkSync, writeFileSync, existsSync } from "fs";
import path from "path";

describe("Integration: Tasks Widget State Management", () => {
  const TEST_PLAN = path.join(process.cwd(), "test-plan-tasks.md");

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

  it("should toggle tasks panel state", () => {
    let showTasks = false;

    expect(showTasks).toBe(false);

    showTasks = !showTasks;
    expect(showTasks).toBe(true);

    showTasks = !showTasks;
    expect(showTasks).toBe(false);

    showTasks = !showTasks;
    expect(showTasks).toBe(true);
  });

  it("should handle tasks display with checkboxes", async () => {
    const { parsePlan } = await import("../../src/plan");

    const planContent = `# Test Plan
- [x] Completed task
- [ ] Pending task
`;
    writeFileSync(TEST_PLAN, planContent);

    const result = await parsePlan(TEST_PLAN);

    expect(result.tasks).toHaveLength(2);

    const completedTask = result.tasks[0];
    const pendingTask = result.tasks[1];

    expect(completedTask.done).toBe(true);
    expect(completedTask.text).toBe("Completed task");
    expect(completedTask.line).toBeGreaterThan(0);

    expect(pendingTask.done).toBe(false);
    expect(pendingTask.text).toBe("Pending task");
    expect(pendingTask.line).toBeGreaterThan(0);
  });

  it("should filter tasks by completion status", async () => {
    const { parsePlan } = await import("../../src/plan");

    const planContent = `# Test Plan
- [x] Done 1
- [ ] Todo 1
- [x] Done 2
- [ ] Todo 2
- [x] Done 3
`;
    writeFileSync(TEST_PLAN, planContent);

    const result = await parsePlan(TEST_PLAN);

    const completedTasks = result.tasks.filter((t) => t.done);
    const pendingTasks = result.tasks.filter((t) => !t.done);

    expect(completedTasks).toHaveLength(3);
    expect(pendingTasks).toHaveLength(2);

    expect(result.done).toBe(3);
    expect(result.total).toBe(5);
  });

  it("should handle task completion update", () => {
    const tasks = [
      { id: "task-1", line: 1, text: "Task 1", done: false },
      { id: "task-2", line: 2, text: "Task 2", done: false },
    ];

    expect(tasks[0].done).toBe(false);

    tasks[0].done = true;
    expect(tasks[0].done).toBe(true);

    expect(tasks[1].done).toBe(false);

    tasks[1].done = true;
    expect(tasks[1].done).toBe(true);
  });

  it("should display task counts correctly", async () => {
    const { parsePlan } = await import("../../src/plan");

    const planContent = `# Test Plan
- [x] Completed
- [ ] Pending 1
- [ ] Pending 2
- [ ] Pending 3
`;
    writeFileSync(TEST_PLAN, planContent);

    const result = await parsePlan(TEST_PLAN);

    expect(result.done).toBe(1);
    expect(result.total).toBe(4);

    const progressText = `${result.done}/${result.total}`;
    expect(progressText).toBe("1/4");

    const percentage = (result.done / result.total) * 100;
    expect(percentage).toBe(25);
  });
});
