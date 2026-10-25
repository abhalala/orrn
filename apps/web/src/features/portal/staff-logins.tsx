import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { Dialog } from "@orrn/ui/components/dialog";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, TextInput } from "@orrn/ui/components/field";
import { FormActions } from "@orrn/ui/components/form-actions";
import { ResponsiveList, type ResponsiveListColumn } from "@orrn/ui/components/responsive-list";
import { Sheet } from "@orrn/ui/components/sheet";
import type { AppRouter } from "@orrn/server/routers/index";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import { Copy, UserPlus } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { CustomerField, type Picked } from "@/features/orders/components/pickers";
import { useCompanyWhen } from "@/features/stock/use-company-when";
import { Can } from "@/shared/components/can";
import { INLINE_ERROR_META } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import { isLoginStatus, LOGIN_TONE, loginActions, partyInviteUrl, staffErrorKey } from "./staff-model";

type Login = inferRouterOutputs<AppRouter>["portal"]["users"]["list"][number];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Copyable invite link (email is unreliable; the office passes it on). */
export function InviteLink({ url: rawUrl }: { url: string }) {
  const { t } = useT();
  const url = partyInviteUrl(rawUrl);
  return (
    <div className="flex min-w-0 flex-col gap-2" data-testid="portal-invite-link">
      <p className="m-0 text-[13px] font-medium text-muted-foreground">{t("portal.staff.inviteLink")}</p>
      <p className="m-0 rounded-input border border-border bg-surface-sunken px-3 py-2 font-mono text-[13px] [overflow-wrap:anywhere]" data-testid="portal-invite-url">
        {url}
      </p>
      <Button
        variant="secondary"
        className="self-start"
        onClick={() => {
          void navigator.clipboard
            ?.writeText(url)
            .then(() => toast.success(t("common.copied")))
            .catch(() => {});
        }}
      >
        <Copy aria-hidden="true" strokeWidth={2} />
        {t("portal.staff.copyLink")}
      </Button>
      <p className="m-0 text-[13px] leading-5 text-muted-foreground">{t("portal.staff.linkHint")}</p>
    </div>
  );
}

/** Settings > Team: the party logins of this plant, behind `portal.manage`. Without it nothing is asked of the server. */
export function PortalLoginsSection() {
  return (
    <Can do="portal.manage" fallback={null}>
      <PortalLoginsBody />
    </Can>
  );
}

function PortalLoginsBody() {
  const { t } = useT();
  const when = useCompanyWhen();
  const queryClient = useQueryClient();
  const logins = useQuery({ ...trpc.portal.users.list.queryOptions(), meta: INLINE_ERROR_META });
  const [grantOpen, setGrantOpen] = useState(false);
  const [link, setLink] = useState<{ email: string; url: string } | null>(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: trpc.portal.users.list.queryKey() });

  const revoke = useMutation(
    trpc.portal.users.revoke.mutationOptions({
      onSuccess: () => {
        toast.success(t("portal.staff.revokedToast"));
        refresh();
      },
      onError: (e) => toast.error(t(staffErrorKey(e))),
    }),
  );
  const regrant = useMutation(
    trpc.portal.users.grant.mutationOptions({
      onSuccess: (res, vars) => {
        refresh();
        if (res.inviteUrl) setLink({ email: vars.email, url: res.inviteUrl });
        else toast.success(t("portal.staff.regranted", { email: vars.email }));
      },
      onError: (e) => toast.error(t(staffErrorKey(e))),
    }),
  );

  const columns: ResponsiveListColumn<Login>[] = [
    { key: "party", header: t("portal.staff.party"), cell: (l) => <span className="font-semibold break-words">{l.customerName}</span> },
    { key: "email", header: t("portal.staff.email"), cell: (l) => <span className="break-all">{l.email}</span> },
    {
      key: "status",
      header: t("portal.staff.status"),
      phoneWide: true,
      cell: (l) =>
        isLoginStatus(l.status) ? (
          <Chip tone={LOGIN_TONE[l.status]} truncate={false}>
            {t(`portal.staff.status_${l.status}`)}
          </Chip>
        ) : (
          l.status
        ),
    },
    {
      key: "since",
      header: t("portal.staff.since"),
      hideOnPhone: true,
      cell: (l) => <span className="whitespace-nowrap">{l.acceptedAt ?? l.invitedAt ? when((l.acceptedAt ?? l.invitedAt)!) : ""}</span>,
    },
    {
      key: "actions",
      header: t("settings.team.actions"),
      headerHidden: true,
      cell: (l) => {
        if (!isLoginStatus(l.status)) return null;
        const a = loginActions(l.status);
        return (
          <div className="flex flex-wrap gap-2">
            {a.resend || a.regrant ? (
              <Button
                variant="secondary"
                size="sm"
                loading={regrant.isPending && regrant.variables?.email === l.email}
                aria-label={`${t(a.regrant ? "portal.staff.turnOn" : "portal.staff.newLink")}: ${l.email}`}
                onClick={() => regrant.mutate({ customerId: l.customerId, email: l.email })}
              >
                {t(a.regrant ? "portal.staff.turnOn" : "portal.staff.newLink")}
              </Button>
            ) : null}
            {a.revoke ? (
              <Button
                variant="secondary"
                size="sm"
                loading={revoke.isPending && revoke.variables?.id === l.id}
                aria-label={`${t("portal.staff.revoke")}: ${l.email}`}
                onClick={() => revoke.mutate({ id: l.id })}
                data-testid="portal-login-revoke"
              >
                {t("portal.staff.revoke")}
              </Button>
            ) : null}
          </div>
        );
      },
    },
  ];

  return (
    <>
      <section aria-labelledby="portal-logins" className="flex min-w-0 flex-col gap-3" data-testid="team-portal">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
          <h2 id="portal-logins" className="m-0 text-[17px] font-semibold">
            {t("settings.team.portalTitle")}
          </h2>
          <Button onClick={() => setGrantOpen(true)} aria-haspopup="dialog" data-testid="portal-grant-open">
            <UserPlus aria-hidden="true" strokeWidth={2} />
            {t("portal.staff.grant")}
          </Button>
        </div>
        <ResponsiveList
          rows={logins.data ?? []}
          loading={logins.isPending}
          label={t("settings.team.portalTitle")}
          rowKey={(l) => l.id}
          columns={columns}
          empty={<EmptyState title={logins.isError ? t("settings.team.loadFailed") : t("settings.team.portalBody")} />}
        />
        <GrantSheet
          open={grantOpen}
          onOpenChange={setGrantOpen}
          onGranted={(email, url) => {
            refresh();
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
    </>
  );
}

/** Give a party a login: pick the party, type the email; the invite link comes back to copy. */
export function GrantSheet({
  open,
  onOpenChange,
  onGranted,
  customer,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  onGranted(email: string, inviteUrl: string | null): void;
  /** Fixed party (the customer page); the Team tab lets the office pick. */
  customer?: Picked;
}) {
  const { t } = useT();
  const [picked, setPicked] = useState<Picked | null>(null);
  const [email, setEmail] = useState("");
  const [errors, setErrors] = useState<{ customer?: string; email?: string; form?: string }>({});
  const party = customer ?? picked;

  const grant = useMutation(
    trpc.portal.users.grant.mutationOptions({
      onSuccess: (res, vars) => {
        toast.success(t("portal.staff.granted", { email: vars.email }));
        setEmail("");
        setErrors({});
        onGranted(vars.email, res.inviteUrl);
      },
      onError: (e) => setErrors({ form: t(staffErrorKey(e)) }),
    }),
  );

  function submit(e: FormEvent) {
    e.preventDefault();
    const next: typeof errors = {};
    if (!party) next.customer = t("portal.staff.pickParty");
    if (!EMAIL.test(email.trim())) next.email = t("errors.invalidEmail");
    setErrors(next);
    if (next.customer || next.email || !party) return;
    grant.mutate({ customerId: party.id, email: email.trim() });
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("portal.staff.grantTitle")}
      footer={
        <FormActions sticky={false}>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form="portal-grant-form" loading={grant.isPending}>
            {t("portal.staff.grantSubmit")}
          </Button>
        </FormActions>
      }
    >
      <form id="portal-grant-form" onSubmit={submit} noValidate className="flex min-w-0 flex-col gap-4">
        {customer ? (
          <p className="m-0 text-[15px] font-semibold">{customer.label}</p>
        ) : (
          <CustomerField value={picked} onChange={setPicked} error={errors.customer} />
        )}
        <Field label={t("portal.staff.email")} error={errors.email}>
          <TextInput
            type="email"
            value={email}
            onChangeText={setEmail}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            inputMode="email"
            data-testid="portal-grant-email"
          />
        </Field>
        {errors.form ? (
          <p role="alert" className="m-0 text-[14px] font-medium text-destructive">
            {errors.form}
          </p>
        ) : null}
      </form>
    </Sheet>
  );
}

