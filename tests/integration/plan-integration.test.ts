import { describe, it, expect } from "bun:test";
import { parsePlan } from "../../src/plan";
import path from "path";

describe("Integration: Plan Parsing with Task IDs", () => {
  it("should generate unique IDs for each task", async () => {
    const result = await parsePlan(path.join(import.meta.dir, "../fixtures/plans/partial-complete.md"));

    expect(result.tasks).toHaveLength(10);

    const ids = result.tasks.map((t) => t.id);
    const uniqueIds = new Set(ids);

    expect(uniqueIds.size).toBe(10);

    result.tasks.forEach((task) => {
      expect(task.id).toMatch(/^task-\d+$/);
    });
  });

  it("should include line numbers in task objects", async () => {
    const result = await parsePlan(path.join(import.meta.dir, "../fixtures/plans/all-complete.md"));

    result.tasks.forEach((task) => {
      expect(task.line).toBeGreaterThan(0);
      expect(typeof task.line).toBe("number");
    });
  });

  it("should include completion status in task objects", async () => {
    const result = await parsePlan(path.join(import.meta.dir, "../fixtures/plans/partial-complete.md"));

    const completedTasks = result.tasks.filter((t) => t.done);
    const incompleteTasks = result.tasks.filter((t) => !t.done);

    expect(completedTasks).toHaveLength(3);
    expect(incompleteTasks).toHaveLength(7);
  });
});
