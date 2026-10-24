import { useState } from "react";

/**
 * Pull to refresh: the spinner shows only for the person's own pull, not for
 * background refetches. `refetchers` are the queries' `refetch` functions.
 */
export function useRefresh(refetchers: readonly (() => Promise<unknown>)[]) {
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = () => {
    setRefreshing(true);
    void Promise.allSettled(refetchers.map((r) => r())).finally(() => setRefreshing(false));
  };
  return { refreshing, onRefresh };
}
