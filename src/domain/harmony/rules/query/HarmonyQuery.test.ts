import { describe, expect, it } from "vitest";
import { HarmonyQuery } from "./HarmonyQuery";

describe("HarmonyQuery", () => {
  it("空集合量词与定位具有稳定边界语义", () => {
    const query = HarmonyQuery.empty<number>();

    expect(query.first()).toBeUndefined();
    expect(query.last()).toBeUndefined();
    expect(query.any()).toBe(false);
    expect(query.all(() => false)).toBe(true);
    expect(query.count()).toBe(0);
    expect(query.pairwise().toArray()).toEqual([]);
    expect(query.window(1).toArray()).toEqual([]);
  });

  it("组合筛选、投影和量词并保持顺序", () => {
    const query = HarmonyQuery.from([1, 2, 3, 4, 5])
      .where((value) => value % 2 === 1)
      .select((value) => value * 2);

    expect(query.toArray()).toEqual([2, 6, 10]);
    expect(query.first()).toBe(2);
    expect(query.last()).toBe(10);
    expect(query.any((value) => value > 8)).toBe(true);
    expect(query.all((value) => value % 2 === 0)).toBe(true);
  });

  it("处理 pairwise、window 和区间截取边界", () => {
    const query = HarmonyQuery.from([1, 2, 3, 4]);
    expect(query.pairwise().toArray()).toEqual([
      [1, 2],
      [2, 3],
      [3, 4],
    ]);
    expect(query.window(3).toArray()).toEqual([
      [1, 2, 3],
      [2, 3, 4],
    ]);
    expect(query.skipWhile((value) => value < 3).toArray()).toEqual([3, 4]);
    expect(query.takeWhile((value) => value < 3).toArray()).toEqual([1, 2]);
    expect(query.window(5).toArray()).toEqual([]);
  });

  it("稳定去重、排序和分组", () => {
    const source = [
      { id: "b", group: 1 },
      { id: "a", group: 1 },
      { id: "b", group: 2 },
    ];
    expect(
      HarmonyQuery.from(source)
        .distinctBy((item) => item.id)
        .orderBy((item) => item.id)
        .select((item) => item.id)
        .toArray(),
    ).toEqual(["a", "b"]);
    expect(
      HarmonyQuery.from(source).groupBy((item) => item.group).get(1),
    ).toEqual(source.slice(0, 2));
  });

  it("查询结果数组及窗口、分组结果均为只读快照", () => {
    const query = HarmonyQuery.from([1, 2, 3]);
    const result = query.toArray();
    const window = query.window(2).first();
    const group = query.groupBy((value) => value % 2).get(1);

    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(window)).toBe(true);
    expect(Object.isFrozen(group)).toBe(true);
    expect(query.toArray()).toBe(result);
  });
});
