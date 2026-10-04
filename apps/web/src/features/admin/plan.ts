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
 * `dirty` when the form differs from what is saved. A company without a
 * plan is always dirty (`noPlanYet`): the form shows Starter, and saving it
 * as is must be possible, otherwise "No plan" could never become Starter.
 */
export function planForm(saved: PlanValues, form: { plan: string; modules: readonly string[] }) {
  const noPlanYet = saved.plan === null;
  return { dirty: noPlanYet || form.plan !== saved.plan || !sameModules(form.modules, saved.modules), noPlanYet };
}
