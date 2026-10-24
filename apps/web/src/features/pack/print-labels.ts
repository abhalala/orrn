/**
 * Label printing for packing sessions. One label at a time (the plant has
 * one label printer per station, and the server call waits for the printer
 * to accept the job), with progress, a list of failures and a retry that
 * prints only those. A queue lives per session in a module-level registry,
 * so it keeps going while the person moves from the review step to the
 * session page, and a reload never reprints anything by itself.
 *
 * Pure: the print call is injected (`use-print-labels.ts` wires it to
 * `spool.printBundleLabel`).
 */

export type PrintItem = { bundleId: string; serial: string };

/**
 * Bundle serials in counting order (26J9 before 26J10, 26J99 before 26J100).
 * Plant numbers are not zero-padded and `bundle.getGroup` sorts them as text,
 * so every list or label run "in packing order" sorts with this.
 */
export const compareSerials: (a: string, b: string) => number = new Intl.Collator("en", { numeric: true }).compare;

/**
 * The labels a session prints, in the order the bundles were packed: void
 * bundles get none. Used by the post-save run and "Print all labels" alike,
 * so the label stack always comes out in weighing order.
 */
export function labelRun(bundles: readonly { id: string; serial: string; status: string }[]): PrintItem[] {
  return bundles
    .filter((b) => b.status !== "void")
    .sort((a, b) => compareSerials(a.serial, b.serial))
    .map((b) => ({ bundleId: b.id, serial: b.serial }));
}
export type PrintFailure = PrintItem & { error: unknown };

export type PrintState = {
  /** `idle`: nothing asked yet. `done`: the last run finished (check `failed`). */
  status: "idle" | "running" | "done";
  /** Labels in the current (or last) run. */
  total: number;
  /** Labels attempted so far in this run, printed or failed. */
  done: number;
  failed: PrintFailure[];
  current: PrintItem | null;
};

export type PrintQueue = {
  getState(): PrintState;
  subscribe(listener: () => void): () => void;
  /**
   * Prints these labels. While a run is going, new labels join it (a label
   * already waiting is not added twice). Resolves when the run ends.
   */
  run(items: readonly PrintItem[]): Promise<PrintState>;
  /** Prints the last run's failed labels again, as a new run. */
  retryFailed(): Promise<PrintState>;
};

const IDLE: PrintState = { status: "idle", total: 0, done: 0, failed: [], current: null };

export function createPrintQueue(print: (item: PrintItem) => Promise<unknown>): PrintQueue {
  let state: PrintState = IDLE;
  const listeners = new Set<() => void>();
  let pending: PrintItem[] = [];
  let running: Promise<PrintState> | null = null;

  const set = (next: PrintState) => {
    state = next;
    for (const l of listeners) l();
  };

  async function drain(): Promise<PrintState> {
    while (pending.length > 0) {
      const item = pending.shift()!;
      set({ ...state, current: item });
      try {
        await print(item);
        set({ ...state, done: state.done + 1 });
      } catch (error) {
        set({ ...state, done: state.done + 1, failed: [...state.failed, { ...item, error }] });
      }
    }
    set({ ...state, status: "done", current: null });
    running = null;
    return state;
  }

  function run(items: readonly PrintItem[]): Promise<PrintState> {
    if (running) {
      const waiting = new Set([...pending.map((p) => p.bundleId), state.current?.bundleId]);
      const extra = items.filter((i) => !waiting.has(i.bundleId));
      pending.push(...extra);
      set({ ...state, total: state.total + extra.length });
      return running;
    }
    if (items.length === 0) return Promise.resolve(state);
    pending = [...items];
    set({ status: "running", total: items.length, done: 0, failed: [], current: null });
    running = drain();
    return running;
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    run,
    retryFailed() {
      if (running) return running;
      return run(state.failed.map(({ bundleId, serial }) => ({ bundleId, serial })));
    },
  };
}

const registry = new Map<string, PrintQueue>();

/** The print queue for one packing session (created on first use). */
export function printQueueFor(groupId: string, print: (item: PrintItem) => Promise<unknown>): PrintQueue {
  let q = registry.get(groupId);
  if (!q) {
    q = createPrintQueue(print);
    registry.set(groupId, q);
  }
  return q;
}

export type PrintErrorKey =
  | "pack.print.errors.notSetUp"
  | "pack.print.errors.noPrinter"
  | "pack.print.errors.noTemplate"
  | "pack.print.errors.offline"
  | "pack.print.errors.forbidden"
  | "pack.print.errors.network"
  | "pack.print.errors.generic";

/**
 * What to tell the floor about a failed label, in plain words (the server's
 * messages name the print service, which the UI never does).
 */
export function printErrorKey(error: unknown): PrintErrorKey {
  if (isConnectionError(error)) return "pack.print.errors.network";
  if (!error || typeof error !== "object") return "pack.print.errors.generic";
  const code = (error as { data?: { code?: string } }).data?.code;
  const message = String((error as { message?: unknown }).message ?? "").toLowerCase();
  if (code === "FORBIDDEN") return "pack.print.errors.forbidden";
  if (code === "NOT_FOUND" && message.includes("deployment")) return "pack.print.errors.notSetUp";
  if (code === "NOT_FOUND" && message.includes("printer")) return "pack.print.errors.noPrinter";
  if (code === "BAD_REQUEST" && message.includes("template")) return "pack.print.errors.noTemplate";
  if (code === "BAD_GATEWAY") return "pack.print.errors.offline";
  return "pack.print.errors.generic";
}

/**
 * No answer from orrn at all: the fetch itself failed. The tRPC client wraps
 * that TypeError in a TRPCClientError and keeps it as `cause`.
 */
export function isConnectionError(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  const cause = error && typeof error === "object" ? (error as { cause?: unknown }).cause : undefined;
  return cause instanceof TypeError;
}
