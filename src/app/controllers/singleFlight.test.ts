import { describe, expect, it, vi } from "vitest";
import { createSingleFlight } from "./singleFlight";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("single-flight command", () => {
  it("shares one operation while it is still pending", async () => {
    const gate = createSingleFlight<string>();
    const pending = deferred<string>();
    const firstOperation = vi.fn(() => pending.promise);
    const duplicateOperation = vi.fn(async () => "duplicate");

    const first = gate.run(firstOperation);
    const duplicate = gate.run(duplicateOperation);

    expect(first).toBe(duplicate);
    expect(duplicateOperation).not.toHaveBeenCalled();

    pending.resolve("ready");
    await expect(first).resolves.toBe("ready");
    await Promise.resolve();

    expect(firstOperation).toHaveBeenCalledTimes(1);
  });

  it("allows a new operation after success or failure", async () => {
    const gate = createSingleFlight<number>();

    await expect(gate.run(async () => 1)).resolves.toBe(1);
    await expect(
      gate.run(async () => {
        throw new Error("load failed");
      }),
    ).rejects.toThrow("load failed");
    await expect(gate.run(async () => 2)).resolves.toBe(2);
  });
});
