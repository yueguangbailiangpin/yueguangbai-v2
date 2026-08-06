import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { BuyerMutationController } from './BuyerMutationController';

export function useBuyerMutation<TBody, TResult>(input: Readonly<{
  operation: (body: TBody, idempotencyKey: string, signal: AbortSignal) => Promise<TResult>;
  onSuccess: (result: TResult) => void | Promise<void>;
  onError?: (error: unknown) => void | Promise<void>;
}>) {
  const controller = useMemo(() => new BuyerMutationController<TBody, TResult>(), []);
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useEffect(() => () => controller.dispose(), [controller]);
  const settle = useCallback((promise: Promise<TResult> | null): void => {
    if (promise === null) return;
    void promise.then(input.onSuccess).catch((error: unknown) => input.onError?.(error));
  }, [input.onError, input.onSuccess]);
  return Object.freeze({
    ...snapshot,
    mutate: (body: TBody) => settle(controller.execute(body, input.operation)),
    retrySame: () => settle(controller.retry()),
    cancel: () => controller.cancel(),
  });
}
