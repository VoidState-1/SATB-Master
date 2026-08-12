export class HarmonyQuery<T> implements Iterable<T> {
  readonly #items: readonly T[];

  private constructor(items: readonly T[]) {
    this.#items = Object.freeze([...items]);
  }

  static from<T>(items: Iterable<T>) {
    return new HarmonyQuery(Array.from(items));
  }

  static empty<T>() {
    return new HarmonyQuery<T>([]);
  }

  [Symbol.iterator](): Iterator<T> {
    return this.#items[Symbol.iterator]();
  }

  where<S extends T>(
    predicate: (item: T, index: number) => item is S,
  ): HarmonyQuery<S>;
  where(predicate: (item: T, index: number) => boolean): HarmonyQuery<T>;
  where(predicate: (item: T, index: number) => boolean) {
    return new HarmonyQuery(this.#items.filter(predicate));
  }

  select<R>(selector: (item: T, index: number) => R) {
    return new HarmonyQuery(this.#items.map(selector));
  }

  selectMany<R>(selector: (item: T, index: number) => Iterable<R>) {
    return new HarmonyQuery(
      this.#items.flatMap((item, index) => Array.from(selector(item, index))),
    );
  }

  pairwise(): HarmonyQuery<readonly [T, T]> {
    return new HarmonyQuery(
      this.#items.slice(1).map((item, index) =>
        Object.freeze([this.#items[index], item] as const),
      ),
    );
  }

  window(size: number): HarmonyQuery<readonly T[]> {
    if (!Number.isInteger(size) || size <= 0)
      throw new Error("查询窗口大小必须是正整数");
    if (size > this.#items.length) return HarmonyQuery.empty();
    return new HarmonyQuery(
      this.#items
        .slice(0, this.#items.length - size + 1)
        .map((_, index) => Object.freeze(this.#items.slice(index, index + size))),
    );
  }

  skipWhile(predicate: (item: T, index: number) => boolean) {
    let index = 0;
    while (index < this.#items.length && predicate(this.#items[index], index))
      index += 1;
    return new HarmonyQuery(this.#items.slice(index));
  }

  takeWhile(predicate: (item: T, index: number) => boolean) {
    let index = 0;
    while (index < this.#items.length && predicate(this.#items[index], index))
      index += 1;
    return new HarmonyQuery(this.#items.slice(0, index));
  }

  distinctBy<K>(keyOf: (item: T, index: number) => K) {
    const keys = new Set<K>();
    return new HarmonyQuery(
      this.#items.filter((item, index) => {
        const key = keyOf(item, index);
        if (keys.has(key)) return false;
        keys.add(key);
        return true;
      }),
    );
  }

  orderBy<K>(
    keyOf: (item: T) => K,
    direction: "asc" | "desc" = "asc",
  ) {
    const multiplier = direction === "asc" ? 1 : -1;
    return new HarmonyQuery(
      this.#items
        .map((item, index) => ({ item, index, key: keyOf(item) }))
        .sort((left, right) => {
          if (left.key < right.key) return -1 * multiplier;
          if (left.key > right.key) return 1 * multiplier;
          return left.index - right.index;
        })
        .map(({ item }) => item),
    );
  }

  groupBy<K>(keyOf: (item: T, index: number) => K) {
    const groups = new Map<K, T[]>();
    this.#items.forEach((item, index) => {
      const key = keyOf(item, index);
      const group = groups.get(key) ?? [];
      group.push(item);
      groups.set(key, group);
    });
    return new Map(
      [...groups].map(([key, items]) => [key, Object.freeze(items)] as const),
    ) as ReadonlyMap<K, readonly T[]>;
  }

  first(predicate?: (item: T, index: number) => boolean) {
    return predicate ? this.#items.find(predicate) : this.#items[0];
  }

  last(predicate?: (item: T, index: number) => boolean) {
    if (!predicate) return this.#items.at(-1);
    for (let index = this.#items.length - 1; index >= 0; index -= 1) {
      if (predicate(this.#items[index], index)) return this.#items[index];
    }
    return undefined;
  }

  any(predicate?: (item: T, index: number) => boolean) {
    return predicate ? this.#items.some(predicate) : this.#items.length > 0;
  }

  all(predicate: (item: T, index: number) => boolean) {
    return this.#items.every(predicate);
  }

  count(predicate?: (item: T, index: number) => boolean) {
    return predicate ? this.#items.filter(predicate).length : this.#items.length;
  }

  toArray() {
    return this.#items;
  }
}
