/**
 * What a refused role or plant API write says, in the person's language. The two routers' own sentences
 * (`ROLE_REFUSALS` in `routers/roles.ts`, `API_REFUSALS` in `routers/apiAccess.ts`, `MODULE_OFF_MESSAGE`) are
 * English; an unknown sentence shows the generic line, never the server's words. `platform-refusal.test.ts` reads
 * both router files and fails when a sentence has no key here.
 */
import type { MessageKey, Translate } from "@orrn/i18n";

export const PLATFORM_REFUSALS: Readonly<Record<string, MessageKey>> = {
  "Not found": "plat3.refusal.notFound",
  "A custom role can't copy the owner": "plat3.refusal.ownerBase",
  "You can't give a role an action you don't hold yourself": "plat3.refusal.moreThanYou",
  "A role with this name already exists": "plat3.refusal.nameTaken",
  "People still hold this role. Give them another role first": "plat3.refusal.inUse",
  "The owner keeps the owner role": "plat3.refusal.ownerMember",
  "Cannot change your own role": "plat3.refusal.yourself",
  "Invoices can be read only when billing is on": "plat3.refusal.invoicesNeedBilling",
  "Use a public https address. orrn does not send to local, private or tailnet addresses": "plat3.refusal.urlRefused",
  "Webhook signing is not set up on this server": "plat3.refusal.keyMissing",
  "A plant may keep at most 20 tokens and 10 webhooks": "plat3.refusal.tooMany",
  "That module is not on for this plant": "plat3.refusal.moduleOff",
};

export function platformRefusalKey(error: unknown): MessageKey {
  const message = error instanceof Error ? error.message : typeof error === "object" && error && "message" in error ? String((error as { message: unknown }).message) : "";
  if (PLATFORM_REFUSALS[message]) return PLATFORM_REFUSALS[message]!;
  return "plat3.refusal.generic";
}

export function platformRefusal(t: Translate, error: unknown): string {
  return t(platformRefusalKey(error));
}
