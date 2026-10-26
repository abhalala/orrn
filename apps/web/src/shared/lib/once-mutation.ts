import { useMutation, type DefaultError, type UseMutationOptions, type UseMutationResult } from "@tanstack/react-query";
import { useMemo, useRef } from "react";

import { onceGuard } from "./once";

/**
 * `useMutation` that sends ONE request per tap: while a call from this hook is still in flight, `mutate` does nothing and
 * `mutateAsync` answers the call in flight (final fixes 5, M4b: a double click on Approve, Lock, Close, Correct now or Age
 * again sent two requests and the second showed an error toast). The lock is released when the call has settled, its
 * `onSuccess` / `onError` included, so a refusal can be retried. Everything else is `useMutation`.
 */
export function useOnceMutation<TData = unknown, TError = DefaultError, TVariables = void, TContext = unknown>(
  options: UseMutationOptions<TData, TError, TVariables, TContext>,
): UseMutationResult<TData, TError, TVariables, TContext> {
  const m = useMutation(options);
  const guard = useRef(onceGuard<TData>());
  const { mutateAsync: send } = m;
  return useMemo(() => {
    const mutateAsync: typeof send = (variables, o) => guard.current.run(() => send(variables, o)).promise;
    const mutate: typeof m.mutate = (variables, o) => {
      const { promise, started } = guard.current.run(() => send(variables, o));
      if (started) promise.catch(() => undefined);
    };
    return { ...m, mutate, mutateAsync };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m, send]);
}
