export type WriteGate = { locked: boolean };

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
