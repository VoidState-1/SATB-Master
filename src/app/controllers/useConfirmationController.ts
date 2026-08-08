import { useCallback, useEffect, useRef, useState } from "react";

export interface ConfirmationState {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
}

export function useConfirmationController() {
  const [confirmation, setConfirmation] = useState<ConfirmationState>();
  const resolverRef = useRef<((confirmed: boolean) => void) | undefined>(
    undefined,
  );

  const requestConfirmation = useCallback(
    (options: ConfirmationState) =>
      new Promise<boolean>((resolve) => {
        resolverRef.current?.(false);
        resolverRef.current = resolve;
        setConfirmation(options);
      }),
    [],
  );

  const answerConfirmation = useCallback((confirmed: boolean) => {
    const resolve = resolverRef.current;
    resolverRef.current = undefined;
    setConfirmation(undefined);
    resolve?.(confirmed);
  }, []);

  useEffect(
    () => () => {
      resolverRef.current?.(false);
    },
    [],
  );

  return { confirmation, requestConfirmation, answerConfirmation } as const;
}
