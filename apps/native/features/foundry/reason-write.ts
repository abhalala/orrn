export type WriteGate = { locked: boolean };

export const spectroVoidBody = (id: string, reason: string) => ({ id, reason: reason.trim() });
export const castCancelBody = (castId: string, reason: string) => ({ castId, reason: reason.trim() });
export const meltCancelBody = (meltId: string, reason: string) => ({ meltId, reason: reason.trim() });

/** Locks before the first await, so two presses in one frame cannot send the same destructive write twice. */
export async function runOnce<T>(gate: WriteGate, write: () => Promise<T>): Promise<{ ran: boolean; value?: T }> {
  if (gate.locked) return { ran: false };
  gate.locked = true;
  try {
    return { ran: true, value: await write() };
  } finally {
    gate.locked = false;
  }
}
