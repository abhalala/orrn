import { useRef } from "react";

import { requestIdFor } from "@/features/dispatch/request-key";

/**
 * XE FOUNDRY (fix round 1): a foundry floor write (logs received, a cut, an issue, a reject, a plan
 * line accepted) carries a `clientRequestId`. The same content sent again (Save tapped twice, a retry
 * after an unsure answer) keeps its key, so the server answers the first write; edited content is a new
 * write with a new key. `landed()` ends the attempt once the server saved it.
 */
export function useRequestKey(): { keyFor: (body: unknown) => string; landed: () => void } {
  const ref = useRef<{ id: string; body: string } | null>(null);
  return {
    keyFor: (body) => {
      ref.current = requestIdFor(ref.current, body);
      return ref.current.id;
    },
    landed: () => {
      ref.current = null;
    },
  };
}
