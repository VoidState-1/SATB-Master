import { describe, expect, it } from "vitest";
import { intervalName } from "./core";

describe("书写音程名称", () => {
  it.each([
    [0, -1, "增1度"], [0, 2, "倍增1度"], [0, -2, "倍增1度"],
    [1, 3, "增2度"], [1, 4, "倍增2度"], [2, 1, "倍减3度"],
    [7, 13, "增8度"], [7, 14, "倍增8度"], [2, 3, "小3度"],
  ] as const)("区分谱级 %i、半音 %i 的书写音程", (diatonicSteps, semitones, label) => {
    expect(intervalName({ diatonicSteps, semitones }).label).toBe(label);
  });
});
