/** Plan and modules form state (Godseye company tab "Plan and modules"). */

export type PlanValues = { plan: string | null; modules: readonly string[] };

/** The plan the form starts on: the saved one, Starter when the company has none yet. */
export function initialPlan(saved: string | null): string {
  return saved ?? "starter";
}

function sameModules(a: readonly string[], b: readonly string[]) {
  return a.length === b.length && a.every((m) => b.includes(m));
}

/**
 * The ticked modules: the saved ones, or every module when none is saved
 * (an empty list means "all on", and the boxes say so).
 */
export function modulesOn<T extends string>(saved: readonly string[], all: readonly T[]): T[] {
  const known = all.filter((m) => saved.includes(m));
  return known.length > 0 ? known : [...all];
}

/** What to save for the ticked boxes: every box ticked is "all on" (empty), otherwise the ticked ones in catalogue order. */
export function modulesToSave<T extends string>(on: readonly string[], all: readonly T[]): T[] {
  const ticked = all.filter((m) => on.includes(m));
  return ticked.length === all.length ? [] : ticked;
}

/**
 * `dirty` when the form differs from what is saved (`saved.modules` as the
 * boxes show it, see `modulesOn`). A company without a plan is always dirty
 * (`noPlanYet`): the form shows Starter, and saving it as is must be
 * possible, otherwise "No plan" could never become Starter. `noneOn`: no box
 * ticked, which cannot be saved (an empty list means every module on).
 */
export function planForm(saved: PlanValues, form: { plan: string; modules: readonly string[] }) {
  const noPlanYet = saved.plan === null;
  return {
    dirty: noPlanYet || form.plan !== saved.plan || !sameModules(form.modules, saved.modules),
    noPlanYet,
    noneOn: form.modules.length === 0,
  };
}
