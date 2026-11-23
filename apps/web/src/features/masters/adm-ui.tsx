import { useT } from "@orrn/i18n";
import type { ComponentProps } from "react";

import { admErrorKey } from "./adm-model";
import { MasterSheet } from "./masters-ui";

/** The server's refusal of the plant screens in the person's language. */
export function useAdmError() {
  const { t } = useT();
  return (error: unknown) => {
    const view = admErrorKey(error);
    return t(view.key, view.vars);
  };
}

export function AdmFormError({ error }: { error: unknown }) {
  const message = useAdmError();
  if (!error) return null;
  return (
    <p role="alert" className="m-0 rounded-card bg-tone-red-tint px-4 py-3 text-[14px] font-medium text-tone-red-ink break-words">
      {message(error)}
    </p>
  );
}

/** The masters sheet with refusals of the plant routers worded in the person's language. */
export function AdmSheet({ error, children, ...rest }: Omit<ComponentProps<typeof MasterSheet>, "error"> & { error: unknown }) {
  return (
    <MasterSheet {...rest} error={null}>
      {children}
      <AdmFormError error={error} />
    </MasterSheet>
  );
}
