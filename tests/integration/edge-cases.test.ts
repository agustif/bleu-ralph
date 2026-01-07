import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { unlink, writeFile } from "node:fs/promises";
import { cleanupRalphFiles } from "../helpers/temp-files";

// --- Mock Setup ---

const mockSessionCreate = mock(() =>
  Promise.resolve({ data: { id: "test-session-123" } })
);
const mockSessionPrompt = mock(() => Promise.resolve());

function createMockEventStream(includeError = false) {
  const events = [
    {
      type: "server.connected",
      properties: {},
    },
  ];

  if (includeError) {
    events.push({
      type: "session.error",
      properties: {
        sessionID: "test-session-123",
        error: {
          name: "TestError",
          data: { message: "Simulated session error" },
        },
      },
    });
  } else {
    // Add successful tool event
    events.push({
      type: "message.part.updated",
      properties: {
        part: {
          sessionID: "test-session-123",
          type: "tool",
          tool: "read",
          state: {
            status: "completed",
            title: "Reading file.ts",
            input: { path: "file.ts" },
            time: { end: Date.now() },
          },
        },
      },
    });

    // Session idle - signals completion
    events.push({
      type: "session.idle",
      properties: {
        sessionID: "test-session-123",
      },
    });
  }

  return {
    stream: (async function* () {
      for (const event of events) {
        yield event;
      }
    })(),
  };
}

const mockEventSubscribe = mock((opts?: any) => Promise.resolve(createMockEventStream()));

// Mock() SDK module
mock.module("@opencode-ai/sdk", () => ({
  createOpencodeServer: mock(() =>
    Promise.resolve({
      url: "http://localhost:4190",
      close: mock(() => {}),
    })
  ),
  createOpencodeClient: mock(() => ({
    session: {
      create: mockSessionCreate,
      prompt: mockSessionPrompt,
    },
    event: {
      subscribe: mockEventSubscribe,
    },
  })),
}));

// Import the module under test AFTER mocking
const { runLoop, parseModel, buildPrompt } = await import("../../src/loop.js");
import type { LoopOptions, PersistedState } from "../../src/state.js";

describe("edge cases", () => {
  const testPlanFile = "tests/fixtures/plans/partial-complete.md";
  let cleanupFiles: string[] = [];
  let callbackOrder: string[] = [];
  let capturedErrors: string[] = [];

  const createTestCallbacks = () => {
    return {
      onIterationStart: (iteration: number) => {
        callbackOrder.push(`onIterationStart:${iteration}`);
      },
      onEvent: (event: any) => {
        callbackOrder.push(`onEvent:${event.type}`);
      },
      onTasksUpdated: (done: number, total: number) => {
        callbackOrder.push(`onTasksUpdated:${done}/${total}`);
      },
      onCommitsUpdated: (commits: number) => {
        callbackOrder.push(`onCommitsUpdated:${commits}`);
      },
      onDiffUpdated: (added: number, removed: number) => {
        callbackOrder.push(`onDiffUpdated:+${added}/-${removed}`);
      },
      onIterationComplete: (iteration: number, duration: number, commits: number) => {
        callbackOrder.push(`onIterationComplete:${iteration}`);
      },
      onPause: () => {
        callbackOrder.push("onPause");
      },
      onResume: () => {
        callbackOrder.push("onResume");
      },
      onComplete: () => {
        callbackOrder.push("onComplete");
      },
      onError: (error: string) => {
        callbackOrder.push(`onError:${error}`);
        capturedErrors.push(error);
      },
      onIdleChanged: (isIdle: boolean) => {
        callbackOrder.push(`onIdleChanged:${isIdle}`);
      },
    };
  };

  const createBaseOptions = (): LoopOptions => ({
    planFile: testPlanFile,
    model: "anthropic/claude-sonnet-4",
    prompt: "Test prompt for {plan}",
  });

  const createPersistedState = (): PersistedState => ({
    startTime: Date.now(),
    initialCommitHash: "abc123",
    iterationTimes: [],
    planFile: testPlanFile,
  });

  beforeEach(() => {
    callbackOrder = [];
    capturedErrors = [];
    cleanupFiles = [];
    mockSessionCreate.mockClear();
    mockSessionPrompt.mockClear();
    mockEventSubscribe.mockClear();
  });

  afterEach(async () => {
    for (const file of cleanupFiles) {
      try {
        await unlink(file);
      } catch {
        // Ignore if file doesn't exist
      }
    }
    await cleanupRalphFiles();
  });

  describe("invalid model format", () => {
    it("should throw error for model without slash", () => {
      expect(() => parseModel("invalid-model")).toThrow(
        'Invalid model format: "invalid-model". Expected "provider/model" (e.g., "anthropic/claude-opus-4")'
      );
    });

    it("should throw error for empty model string", () => {
      expect(() => parseModel("")).toThrow(
        'Invalid model format: "". Expected "provider/model" (e.g., "anthropic/claude-opus-4")'
      );
    });

    it("should handle model with only slash (empty provider/model)", () => {
      const result = parseModel("/");
      expect(result).toEqual({ providerID: "", modelID: "" });
    });

    it("should handle model with whitespace around slash", () => {
      const result = parseModel("provider / model");
      expect(result).toEqual({ providerID: "provider ", modelID: " model" });
    });

    it("should handle model starting with slash (empty provider)", () => {
      const result = parseModel("/model");
      expect(result).toEqual({ providerID: "", modelID: "model" });
    });

    it("should handle model ending with slash (empty model)", () => {
      const result = parseModel("provider/");
      expect(result).toEqual({ providerID: "provider", modelID: "" });
    });
  });

  describe("invalid global config", () => {
    it("should handle missing global config gracefully", async () => {
      // This tests that the loop works even when global config is not loaded
      // loadGlobalConfig in index.ts silently ignores invalid JSON and returns empty object

      const options: LoopOptions = createBaseOptions();
      const persistedState = createPersistedState();
      const callbacks = createTestCallbacks();
      const controller = new AbortController();

      // Create .ralph-done to stop after first iteration
      cleanupFiles.push(".ralph-done");
      setTimeout(async () => {
        await writeFile(".ralph-done", "");
      }, 50);

      // Should not throw even with no global config
      await runLoop(options, persistedState, callbacks, controller.signal);

      // Verify loop ran successfully
      expect(callbackOrder.some((c) => c.startsWith("onIterationStart:"))).toBe(true);
    });

    it("should handle invalid model format in options", async () => {
      // Invalid model format should be caught by parseModel before reaching the loop
      expect(() => parseModel("invalid-no-slash")).toThrow(
        'Invalid model format: "invalid-no-slash". Expected "provider/model" (e.g., "anthropic/claude-opus-4")'
      );
    });
  });

  describe("network errors during loop", () => {
    it("should handle session creation failure", async () => {
      // Mock session create to throw an error
      mockSessionCreate.mockImplementationOnce(() =>
        Promise.reject(new Error("Network error: Failed to create session"))
      );

      const options: LoopOptions = createBaseOptions();
      const persistedState = createPersistedState();
      const callbacks = createTestCallbacks();
      const controller = new AbortController();

      // Should catch and report error
      await expect(runLoop(options, persistedState, callbacks, controller.signal)).rejects.toThrow();

      // Verify onError callback was called with network error
      expect(capturedErrors.length).toBeGreaterThan(0);
      expect(capturedErrors.some((e) => e.includes("Network error"))).toBe(true);
    });

    it("should handle prompt send failure gracefully", async () => {
      // Mock prompt to throw an error
      mockSessionPrompt.mockImplementationOnce(() =>
        Promise.reject(new Error("Network error: Failed to send prompt"))
      );

      const options: LoopOptions = createBaseOptions();
      const persistedState = createPersistedState();
      let iterationCount = 0;
      const callbacks = createTestCallbacks();
      const originalOnIterationComplete = callbacks.onIterationComplete;

      // Hook into onIterationComplete to create .ralph-done after iteration
      callbacks.onIterationComplete = async (iteration, duration, commits) => {
        originalOnIterationComplete(iteration, duration, commits);

        if (iteration === 1) {
          await writeFile(".ralph-done", "");
          cleanupFiles.push(".ralph-done");
        }
      };

      const controller = new AbortController();

      // Ensure .ralph-done doesn't exist before starting
      try {
        await unlink(".ralph-done");
      } catch {}

      // Should not throw - prompt error is caught and logged
      await runLoop(options, persistedState, callbacks, controller.signal);

      // Verify iteration started despite prompt error
      expect(callbackOrder.some((c) => c.startsWith("onIterationStart:"))).toBe(true);
    });

    it("should handle session.error event from SDK", async () => {
      // Mock event stream to include session.error
      mockEventSubscribe.mockImplementationOnce(() =>
        Promise.resolve(createMockEventStream(true))
      );

      const options: LoopOptions = createBaseOptions();
      const persistedState = createPersistedState();
      const callbacks = createTestCallbacks();
      const controller = new AbortController();

      // Should catch session error and throw
      await expect(runLoop(options, persistedState, callbacks, controller.signal)).rejects.toThrow();

      // Verify onError callback was called
      expect(capturedErrors.length).toBeGreaterThan(0);
      expect(capturedErrors.some((e) => e.includes("Simulated session error"))).toBe(true);
    });
  });

  describe("rapid state changes", () => {
    it("should handle multiple .ralph-done file creations", async () => {
      const options: LoopOptions = createBaseOptions();
      const persistedState = createPersistedState();
      const callbacks = createTestCallbacks();
      const controller = new AbortController();

      cleanupFiles.push(".ralph-done");

      // Create .ralph-done file multiple times rapidly
      for (let i = 0; i < 5; i++) {
        setTimeout(async () => {
          await writeFile(".ralph-done", "");
        }, i * 10); // 10ms apart
      }

      // Should complete without error
      await runLoop(options, persistedState, callbacks, controller.signal);

      // Verify onComplete was called at least once
      expect(callbackOrder.filter((c) => c === "onComplete").length).toBeGreaterThanOrEqual(1);
    });

    it("should handle concurrent abort and .ralph-done", async () => {
      const options: LoopOptions = createBaseOptions();
      const persistedState = createPersistedState();
      const callbacks = createTestCallbacks();
      const controller = new AbortController();

      cleanupFiles.push(".ralph-done");

      // Schedule both abort and .ralph-done creation
      setTimeout(() => controller.abort(), 50);
      setTimeout(async () => {
        await writeFile(".ralph-done", "");
      }, 50);

      // Should exit cleanly without throwing (either via abort or .ralph-done)
      await runLoop(options, persistedState, callbacks, controller.signal);
      
      // The important thing is that it doesn't throw
    });
  });

  describe("file state edge cases", () => {
    it("should handle missing plan file gracefully", async () => {
      const options: LoopOptions = {
        ...createBaseOptions(),
        planFile: "/nonexistent/plan.md",
      };
      const persistedState = createPersistedState();
      const callbacks = createTestCallbacks();
      const controller = new AbortController();

      // Verify parsePlan doesn't throw for missing files
      const { parsePlan } = await import("../../src/plan.js");
      const result = await parsePlan("/nonexistent/plan.md");
      expect(result).toEqual({ done: 0, total: 0, tasks: [] });
    });
  });
});
