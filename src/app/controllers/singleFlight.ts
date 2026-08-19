export interface SingleFlight<T> {
  run(operation: () => Promise<T>): Promise<T>;
}

export function createSingleFlight<T>(): SingleFlight<T> {
  let active: Promise<T> | undefined;

  return {
    run(operation) {
      if (active) return active;
      const current = Promise.resolve().then(operation);
      active = current;
      void current.then(
        () => {
          if (active === current) active = undefined;
        },
        () => {
          if (active === current) active = undefined;
        },
      );
      return current;
    },
  };
}
