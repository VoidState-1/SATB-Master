import { describe, expect, it } from "vitest";
import { AppError, formatLogEntryText, sanitizeContext, sanitizePath, serializeError } from "./logging";

describe("shared logging", () => {
  it("preserves AppError metadata, stack and native error cause", () => {
    const cause = Object.assign(new TypeError("no file"), { code: "ENOENT" });
    const error = new AppError("FILE_READ_FAILED", "could not read", {
      userMessage: "无法读取工程",
      context: { operation: "open" },
      cause,
    });
    expect(error.userMessage).toBe("无法读取工程");
    expect(error.context).toEqual({ operation: "open" });
    expect(serializeError(error)).toMatchObject({
      name: "AppError",
      message: "could not read",
      code: "FILE_READ_FAILED",
      stack: expect.stringContaining("could not read"),
      cause: { name: "TypeError", message: "no file", code: "ENOENT" },
    });
  });

  it("serializes plain thrown values, circular causes and inaccessible objects", () => {
    const thrown = { message: "failure", cause: {} };
    thrown.cause = thrown;
    expect(serializeError(thrown).cause?.message).toBe("[Circular cause]");
    expect(serializeError({ field: 2 }).message).toBe('{"field":2}');
    expect(serializeError("failure").message).toBe("failure");
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    expect(serializeError(proxy).message).toContain("Uninspectable");
  });

  it("redacts home directories in paths, serialized messages and stack frames", () => {
    const windowsPath = "C:\\Users\\Alice (Work)\\Scores\\example.satb";
    expect(sanitizePath(windowsPath)).toBe("<USER_HOME>/Scores\\example.satb");
    expect(sanitizePath("at file:///Users/alice/app.js:4 and /home/bob/score")).toBe(
      "at file://<USER_HOME>/app.js:4 and <USER_HOME>/score",
    );
    expect(sanitizePath("D:/Users/alice")).toBe("<USER_HOME>");
    expect(sanitizePath(serializeError({ windowsPath }).message)).not.toContain("Alice");
    expect(sanitizePath("D:\\Projects\\score.satb")).toBe("D:\\Projects\\score.satb");
  });

  it("converts cyclic, deep and long context into bounded safe JSON", () => {
    const context: Record<string, unknown> = {
      path: "/home/alice/project",
      message: "a".repeat(6000),
      get accessor() { throw new Error("must not read this"); },
    };
    context.self = context;
    let deep = {};
    for (let index = 0; index < 20; index++) deep = { deep };
    context.deep = deep;
    const result = sanitizeContext(context, { redactPaths: true });
    expect(result).toMatchObject({
      path: "<USER_HOME>/project",
      message: "a".repeat(4000) + "…",
      accessor: "[Accessor]",
      self: "[Circular]",
    });
    expect(JSON.stringify(result)).toContain("[Truncated]");
    expect(sanitizeContext(context)).toMatchObject({ path: "/home/alice/project" });
  });

  it("formats one line for simple entries and includes cause and context on demand", () => {
    const entry = {
      id: "test",
      timestamp: "2026-01-01T00:00:00.000Z",
      level: "error",
      scope: "file",
      process: "main",
      message: "read failed",
      code: "FILE_READ_FAILED",
    } as const;
    expect(formatLogEntryText(entry)).toBe(
      "2026-01-01T00:00:00.000Z [ERROR] main/file FILE_READ_FAILED read failed",
    );
    expect(formatLogEntryText({
      ...entry,
      error: serializeError({ message: "failed", cause: "permission denied" }),
      context: { path: "score.satb" },
    })).toContain('Error: failed\nCaused by:\nError: permission denied\n{\n  "path": "score.satb"\n}');
  });
});
