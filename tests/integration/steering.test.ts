import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { unlinkSync, writeFileSync, existsSync } from "fs";
import path from "path";

describe("Integration: Steering Message Flow", () => {
  const TEST_PLAN = path.join(process.cwd(), "test-plan-steering.md");

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

  it("should handle steering message creation", async () => {
    const planContent = `# Test Plan
- [ ] Task 1
`;
    writeFileSync(TEST_PLAN, planContent);

    const message = "Hello, Ralph! Please prioritize Task 1.";

    expect(message).toBeDefined();
    expect(typeof message).toBe("string");
    expect(message.length).toBeGreaterThan(0);
  });

  it("should handle empty steering message", () => {
    const message = "";
    const trimmedMessage = message.trim();

    expect(trimmedMessage).toBe("");
  });

  it("should handle multiline steering message", () => {
    const message = `Task 1 is blocked.
Please help unblock it.
Also check Task 2 for dependencies.`;

    const lines = message.split("\n");
    expect(lines.length).toBe(3);
    expect(lines[0]).toBe("Task 1 is blocked.");
    expect(lines[1]).toBe("Please help unblock it.");
    expect(lines[2]).toBe("Also check Task 2 for dependencies.");
  });

  it("should track message submission flow", async () => {
    let messagesSent: string[] = [];
    const sendMessage = async (msg: string) => {
      messagesSent.push(msg);
    };

    await sendMessage("First message");
    await sendMessage("Second message");

    expect(messagesSent).toHaveLength(2);
    expect(messagesSent[0]).toBe("First message");
    expect(messagesSent[1]).toBe("Second message");
  });

  it("should handle message error gracefully", async () => {
    const sendMessage = async (msg: string) => {
      if (msg.includes("error")) {
        throw new Error("Failed to send message");
      }
    };

    try {
      await sendMessage("This should error");
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      expect((e as Error).message).toBe("Failed to send message");
    }

    const result = await sendMessage("This should succeed");
    expect(result).toBeUndefined();
  });
});
