import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Dialog } from "@orrn/ui/components/dialog";
import { Combobox, type ComboboxOption } from "@orrn/ui/components/combobox";
import { Field } from "@orrn/ui/components/field";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserPlus } from "lucide-react";
import { useId, useRef, useState } from "react";
import { toast } from "sonner";

import { dieTitle } from "@/features/orders/view";
import { useCompanyWhen } from "@/features/stock/use-company-when";
import { Can } from "@/shared/components/can";
import { INLINE_ERROR_META } from "@/shared/lib/query-errors";
import { trpc, trpcClient } from "@/shared/utils/trpc";

import { GrantSheet, InviteLink } from "./staff-logins";
import { grantHidden, isLoginStatus, LOGIN_TONE, loginActions, staffErrorKey } from "./staff-model";

/**
 * Customers > one customer: "Portal access" (`portal.manage`). The party's logins and the dies the
 * plant opened for them. A die another customer owns can be granted but the party will not see it:
 * the card says so instead of pretending.
 */
export function CustomerPortalCard({ customerId, customerName }: { customerId: string; customerName: string }) {
  const { t } = useT();
  const titleId = useId();
  const when = useCompanyWhen();
  const queryClient = useQueryClient();
  const logins = useQuery({ ...trpc.portal.users.list.queryOptions({ customerId }), meta: INLINE_ERROR_META });
  const grants = useQuery({ ...trpc.portal.sections.list.queryOptions({ customerId }), meta: INLINE_ERROR_META });
  const [grantOpen, setGrantOpen] = useState(false);
  const [link, setLink] = useState<{ email: string; url: string } | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [dieKey, setDieKey] = useState(0);
  const labels = useRef(new Map<string, string>());

  const refreshLogins = () => void queryClient.invalidateQueries({ queryKey: trpc.portal.users.list.queryKey() });
  const refreshGrants = () => void queryClient.invalidateQueries({ queryKey: trpc.portal.sections.list.queryKey() });

  const revokeLogin = useMutation(
    trpc.portal.users.revoke.mutationOptions({
      onSuccess: () => {
        toast.success(t("portal.staff.revokedToast"));
        refreshLogins();
      },
      onError: (e) => toast.error(t(staffErrorKey(e))),
    }),
  );
  const regrant = useMutation(
    trpc.portal.users.grant.mutationOptions({
      onSuccess: (res, vars) => {
        refreshLogins();
        if (res.inviteUrl) setLink({ email: vars.email, url: res.inviteUrl });
        else toast.success(t("portal.staff.regranted", { email: vars.email }));
      },
      onError: (e) => toast.error(t(staffErrorKey(e))),
    }),
  );
  const grantSection = useMutation(
    trpc.portal.sections.grant.mutationOptions({
      onSuccess: (res) => {
        refreshGrants();
        setDieKey((k) => k + 1);
        if (res.ownedByOther) setWarning(t("portal.staff.ownedByOther"));
        else {
          setWarning(null);
          toast.success(t("portal.staff.sectionGranted"));
        }
      },
      onError: (e) => {
        setWarning(null);
        toast.error(t(staffErrorKey(e)));
      },
    }),
  );
  const revokeSection = useMutation(
    trpc.portal.sections.revoke.mutationOptions({
      onSuccess: () => {
        refreshGrants();
        toast.success(t("portal.staff.sectionRevoked"));
      },
      onError: (e) => toast.error(t(staffErrorKey(e))),
    }),
  );

  return (
    <section aria-labelledby={titleId} className="flex min-w-0 flex-col gap-4 rounded-card border border-border bg-card p-5" data-testid="customer-portal-card">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <h2 id={titleId} className="m-0 text-[17px] leading-6 font-semibold tracking-[-0.01em]">
          {t("portal.staff.accessTitle")}
        </h2>
        <Button variant="secondary" onClick={() => setGrantOpen(true)} aria-haspopup="dialog" data-testid="customer-portal-grant">
          <UserPlus aria-hidden="true" strokeWidth={2} />
          {t("portal.staff.grant")}
        </Button>
      </div>
      <p className="m-0 text-[14px] leading-5 text-muted-foreground">{t("portal.staff.accessBody")}</p>

      <div className="flex min-w-0 flex-col gap-2">
        <h3 className="m-0 text-[15px] font-semibold">{t("portal.staff.logins")}</h3>
        {(logins.data ?? []).length === 0 ? (
          <p className="m-0 text-[14px] text-muted-foreground">{logins.isPending ? t("common.loading") : t("portal.staff.noLogins")}</p>
        ) : (
          <ul className="m-0 flex list-none flex-col divide-y divide-border p-0">
            {(logins.data ?? []).map((l) => {
              const a = isLoginStatus(l.status) ? loginActions(l.status) : null;
              return (
                <li key={l.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2 py-2" data-login={l.email}>
                  <div className="min-w-0">
                    <p className="m-0 text-[15px] font-medium break-all">{l.email}</p>
                    <p className="m-0 text-[13px] text-muted-foreground">{l.acceptedAt ?? l.invitedAt ? when((l.acceptedAt ?? l.invitedAt)!) : ""}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {isLoginStatus(l.status) ? (
                      <Chip tone={LOGIN_TONE[l.status]} truncate={false}>
                        {t(`portal.staff.status_${l.status}`)}
                      </Chip>
                    ) : null}
                    {a && (a.resend || a.regrant) ? (
                      <Button size="sm" variant="secondary" onClick={() => regrant.mutate({ customerId, email: l.email })} aria-label={`${t(a.regrant ? "portal.staff.turnOn" : "portal.staff.newLink")}: ${l.email}`}>
                        {t(a.regrant ? "portal.staff.turnOn" : "portal.staff.newLink")}
                      </Button>
                    ) : null}
                    {a?.revoke ? (
                      <Button size="sm" variant="secondary" loading={revokeLogin.isPending && revokeLogin.variables?.id === l.id} onClick={() => revokeLogin.mutate({ id: l.id })} aria-label={`${t("portal.staff.revoke")}: ${l.email}`}>
                        {t("portal.staff.revoke")}
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-2">
        <h3 className="m-0 text-[15px] font-semibold">{t("portal.staff.sections")}</h3>
        {grants.isError ? (
          <EmptyState title={t("settings.team.loadFailed")} />
        ) : (grants.data ?? []).length === 0 ? (
          <p className="m-0 text-[14px] text-muted-foreground">{grants.isPending ? t("common.loading") : t("portal.staff.noSections")}</p>
        ) : (
          <ul className="m-0 flex list-none flex-col divide-y divide-border p-0" data-testid="portal-grants">
            {(grants.data ?? []).map((g) => {
              const hidden = grantHidden(g, customerId);
              return (
                <li key={g.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2 py-2" data-grant={g.sectionCode}>
                  <div className="min-w-0">
                    <p className="m-0 text-[15px] font-medium break-words">{dieTitle({ sectionCode: g.sectionCode, name: g.name, series: g.series })}</p>
                    {hidden ? <p className="m-0 text-[13px] text-destructive">{t("portal.staff.ownedByOther")}</p> : null}
                  </div>
                  <Button size="sm" variant="secondary" loading={revokeSection.isPending && revokeSection.variables?.id === g.id} onClick={() => revokeSection.mutate({ id: g.id })} aria-label={`${t("portal.staff.revokeSection")}: ${g.sectionCode}`}>
                    {t("portal.staff.revokeSection")}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
        <Can do="portal.manage">
          <div className="flex min-w-0 flex-col gap-2" key={dieKey}>
            <Field label={t("portal.staff.grantSection")}>
              <Combobox<string>
                value={null}
                onChange={(dieId) => grantSection.mutate({ customerId, dieId })}
                search={async (q) => {
                  const res = await trpcClient.die.list.query({ search: q, limit: 20 });
                  return res.items.map((d) => {
                    const label = dieTitle({ sectionCode: d.sectionCode, name: d.name, series: d.series });
                    labels.current.set(d.id, label);
                    return { value: d.id, label } satisfies ComboboxOption<string>;
                  });
                }}
                placeholder={t("orders.form.dieSearch")}
              />
            </Field>
          </div>
        </Can>
        {warning ? (
          <p role="alert" data-testid="portal-owned-warning" className="m-0 rounded-card border border-border bg-surface-sunken px-3 py-2 text-[14px] font-medium">
            {warning}
          </p>
        ) : null}
      </div>

      <GrantSheet
        open={grantOpen}
        onOpenChange={setGrantOpen}
        customer={{ id: customerId, label: customerName }}
        onGranted={(email, url) => {
          refreshLogins();
          setGrantOpen(false);
          if (url) setLink({ email, url });
        }}
      />
      <Dialog
        open={link !== null}
        onOpenChange={(o) => !o && setLink(null)}
        title={t("portal.staff.linkTitle", { email: link?.email ?? "" })}
        actions={<Button onClick={() => setLink(null)}>{t("common.done")}</Button>}
      >
        {link ? <InviteLink url={link.url} /> : null}
      </Dialog>
    </section>
  );
}
