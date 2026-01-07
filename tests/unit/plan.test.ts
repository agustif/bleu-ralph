import { describe, it, expect } from "bun:test";
import { parsePlan } from "../../src/plan";
import path from "path";

const fixturesDir = path.join(import.meta.dir, "../fixtures/plans");

describe("parsePlan", () => {
  it("should return { done: 0, total: 0, tasks: [] } for non-existent file", async () => {
    const result = await parsePlan("/nonexistent/path/to/plan.md");
    expect(result).toEqual({ done: 0, total: 0, tasks: [] });
  });

  it("should not throw for non-existent file", async () => {
    await expect(parsePlan("/nonexistent/path/to/plan.md")).resolves.toBeDefined();
  });

  it("should return { done: 0, total: 0, tasks: [] } for empty file", async () => {
    const result = await parsePlan(path.join(fixturesDir, "empty.md"));
    expect(result).toEqual({ done: 0, total: 0, tasks: [] });
  });

  it("should return { done: 5, total: 5 } for all completed tasks", async () => {
    const result = await parsePlan(path.join(fixturesDir, "all-complete.md"));
    expect(result.done).toBe(5);
    expect(result.total).toBe(5);
    expect(result.tasks).toHaveLength(5);
    expect(result.tasks.every((t) => t.done)).toBe(true);
  });

  it("should return { done: 0, total: 3 } for all incomplete tasks", async () => {
    const result = await parsePlan(path.join(fixturesDir, "all-incomplete.md"));
    expect(result.done).toBe(0);
    expect(result.total).toBe(3);
    expect(result.tasks).toHaveLength(3);
    expect(result.tasks.every((t) => !t.done)).toBe(true);
  });

  it("should return { done: 3, total: 10 } for mixed task states", async () => {
    const result = await parsePlan(path.join(fixturesDir, "partial-complete.md"));
    expect(result.done).toBe(3);
    expect(result.total).toBe(10);
    expect(result.tasks).toHaveLength(10);
  });

  it("should count uppercase [X] as completed (case insensitive)", async () => {
    const result = await parsePlan(path.join(fixturesDir, "uppercase-complete.md"));
    expect(result.done).toBe(3);
    expect(result.total).toBe(4);
    expect(result.tasks).toHaveLength(4);
  });

  it("should ignore checkboxes inside fenced code blocks", async () => {
    const result = await parsePlan(path.join(fixturesDir, "code-blocks.md"));
    expect(result.done).toBe(2);
    expect(result.total).toBe(5);
    expect(result.tasks).toHaveLength(5);
  });

  it("should count all checkboxes at any nesting level", async () => {
    const result = await parsePlan(path.join(fixturesDir, "complex-nested.md"));
    expect(result.done).toBe(6);
    expect(result.total).toBe(12);
    expect(result.tasks).toHaveLength(12);
  });
});
