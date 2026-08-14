import { describe, expect, it } from "vitest";
import { HarmonyQuery } from "./HarmonyQuery";

describe("HarmonyQuery contracts", () => {
  it("defines empty-set semantics for every terminal operation", () => {
    const query = HarmonyQuery.empty<number>();

    expect(query.first()).toBeUndefined();
    expect(query.last()).toBeUndefined();
    expect(query.first(() => true)).toBeUndefined();
    expect(query.last(() => true)).toBeUndefined();
    expect(query.any()).toBe(false);
    expect(query.any(() => true)).toBe(false);
    expect(query.all(() => false)).toBe(true);
    expect(query.count()).toBe(0);
    expect(query.count(() => true)).toBe(0);
    expect(query.pairwise().toArray()).toEqual([]);
    expect(query.window(1).toArray()).toEqual([]);
    expect(query.skipWhile(() => true).toArray()).toEqual([]);
    expect(query.takeWhile(() => true).toArray()).toEqual([]);
    expect(query.distinctBy((value) => value).toArray()).toEqual([]);
    expect(query.orderBy((value) => value).toArray()).toEqual([]);
    expect([...query.groupBy((value) => value)]).toEqual([]);
  });

  it("passes stable source indexes to callbacks", () => {
    const query = HarmonyQuery.from([10, 20, 30]);

    expect(query.where((_value, index) => index !== 1).toArray()).toEqual([
      10,
      30,
    ]);
    expect(query.select((value, index) => value + index).toArray()).toEqual([
      10,
      21,
      32,
    ]);
    expect(query.skipWhile((_value, index) => index < 2).toArray()).toEqual([
      30,
    ]);
    expect(query.takeWhile((_value, index) => index < 2).toArray()).toEqual([
      10,
      20,
    ]);
    expect(query.distinctBy((_value, index) => index).toArray()).toEqual([
      10,
      20,
      30,
    ]);
    expect(query.first((_value, index) => index === 1)).toBe(20);
    expect(query.last((_value, index) => index === 1)).toBe(20);
    expect(query.count((_value, index) => index > 0)).toBe(2);
    expect(query.orderBy((_value, index) => -index).toArray()).toEqual([
      30,
      20,
      10,
    ]);
    expect([...query.groupBy((_value, index) => index % 2).keys()]).toEqual([
      0,
      1,
    ]);
  });

  it("selectMany preserves outer and inner order", () => {
    const indexes: number[] = [];
    const result = HarmonyQuery.from(["a", "b"])
      .selectMany((value, index) => {
        indexes.push(index);
        return [value, value.toUpperCase()];
      })
      .toArray();

    expect(result).toEqual(["a", "A", "b", "B"]);
    expect(indexes).toEqual([0, 1]);
  });

  it("defines pairwise and sliding-window boundaries", () => {
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
    expect(query.window(4).toArray()).toEqual([[1, 2, 3, 4]]);
    expect(query.window(5).toArray()).toEqual([]);
    expect(() => query.window(0)).toThrow();
    expect(() => query.window(-1)).toThrow();
    expect(() => query.window(1.5)).toThrow();
    expect(() => query.window(Number.NaN)).toThrow();
  });

  it("keeps first occurrences for distinctBy", () => {
    const source = [
      { id: "b", value: 1 },
      { id: "a", value: 2 },
      { id: "b", value: 3 },
    ];

    expect(
      HarmonyQuery.from(source)
        .distinctBy((item) => item.id)
        .toArray(),
    ).toEqual(source.slice(0, 2));
  });

  it("sorts stably in ascending and descending directions", () => {
    const source = [
      { id: "a", rank: 1 },
      { id: "b", rank: 2 },
      { id: "c", rank: 1 },
      { id: "d", rank: 2 },
    ];

    expect(
      HarmonyQuery.from(source)
        .orderBy((item) => item.rank)
        .select((item) => item.id)
        .toArray(),
    ).toEqual(["a", "c", "b", "d"]);
    expect(
      HarmonyQuery.from(source)
        .orderBy((item) => item.rank, "desc")
        .select((item) => item.id)
        .toArray(),
    ).toEqual(["b", "d", "a", "c"]);
  });

  it("preserves group order and exposes immutable group collections", () => {
    const source = [
      { id: "a", group: 2 },
      { id: "b", group: 1 },
      { id: "c", group: 2 },
    ];
    const groups = HarmonyQuery.from(source).groupBy((item) => item.group);

    expect([...groups.keys()]).toEqual([2, 1]);
    expect(groups.get(2)).toEqual([source[0], source[2]]);
    expect(Object.isFrozen(groups.get(2))).toBe(true);
    expect("set" in groups).toBe(false);
    expect("delete" in groups).toBe(false);
    expect("clear" in groups).toBe(false);
  });

  it("does not mutate the source and returns frozen result snapshots", () => {
    const source = [3, 1, 2];
    const query = HarmonyQuery.from(source);
    source.push(4);

    const ordered = query.orderBy((value) => value).toArray();
    expect(source).toEqual([3, 1, 2, 4]);
    expect(ordered).toEqual([1, 2, 3]);
    expect(Object.isFrozen(ordered)).toBe(true);
    expect(Object.isFrozen(query.window(2).first())).toBe(true);
  });

  it("supports repeatable iteration without consuming query state", () => {
    const query = HarmonyQuery.from(new Set([1, 2, 3]));

    expect([...query]).toEqual([1, 2, 3]);
    expect([...query]).toEqual([1, 2, 3]);
    expect(query.toArray()).toBe(query.toArray());
  });
});
