import { isModuleOn, type ApiTokenScope, type WebhookEventKey } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { env } from "@orrn/env/web";
import { Button } from "@orrn/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@orrn/ui/components/card";
import { Checkbox } from "@orrn/ui/components/checkbox";
import { Chip } from "@orrn/ui/components/chip";
import { Dialog } from "@orrn/ui/components/dialog";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, TextInput } from "@orrn/ui/components/field";
import { FormActions } from "@orrn/ui/components/form-actions";
import { ResponsiveList, type ResponsiveListColumn } from "@orrn/ui/components/responsive-list";
import { Sheet } from "@orrn/ui/components/sheet";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AppRouter } from "@orrn/server/routers/index";
import type { inferRouterOutputs } from "@trpc/server";
import { Copy, Plus } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { useCompanyWhen } from "@/features/stock/use-company-when";
import { Can } from "@/shared/components/can";
import { useMe } from "@/shared/lib/me";
import { useOnceMutation } from "@/shared/lib/once-mutation";
import { INLINE_ERROR_META } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import {
  ALL_EVENTS,
  API_ENDPOINTS,
  apiBaseUrl,
  authHeaderExample,
  canResend,
  canRevoke,
  curlExample,
  deliveryTone,
  eventKey,
  openApiUrl,
  parseExpiryDays,
  RATE_PER_MINUTE,
  scopeKey,
  scopeOptions,
  sendableScopes,
  SIGNATURE_EXAMPLE,
  toggleEvent,
  toggleScope,
  tokenFormErrors,
  tokenState,
  webhookFormErrors,
  type DeliveryStatus,
} from "./api-model";
import { platformRefusal } from "./platform-refusal";
import { Note, TabState } from "./ui";

type Outputs = inferRouterOutputs<AppRouter>;
type Token = Outputs["api"]["tokens"]["list"]["items"][number];
type Hook = Outputs["api"]["webhooks"]["list"]["items"][number];

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** A secret shown once, in a box to select, with a copy button. */
function SecretBox({ value, copyLabel, testId }: { value: string; copyLabel: string; testId: string }) {
  const { t } = useT();
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <p className="m-0 rounded-input border border-border bg-surface-sunken px-3 py-2 font-mono text-[13px] [overflow-wrap:anywhere] select-all" data-testid={testId}>
        {value}
      </p>
      <Button
        variant="secondary"
        className="self-start"
        onClick={() => void copyText(value).then((ok) => (ok ? toast.success(t("plat3.api.tokens.copied")) : toast.error(t("plat3.api.tokens.copyFailed"))))}
      >
        <Copy aria-hidden="true" strokeWidth={2} />
        {copyLabel}
      </Button>
    </div>
  );
}

/**
 * Settings > Plant API: tokens, webhooks and a short guide. Shown only while the plant has the `api` module on (the
 * Settings tab hides itself otherwise) and only to the roles that hold `api.manage`; the server checks both on every
 * call, reads included.
 */
export function ApiTab() {
  const { t } = useT();
  const { data: me } = useMe();
  if (!isModuleOn(me?.company?.modules, "api")) return <EmptyState title={t("plat3.refusal.moduleOff")} />;
  return (
    <Can do="api.manage" fallback={<Note testId="api-read-only">{t("plat3.api.readOnly")}</Note>}>
      <div className="flex min-w-0 flex-col gap-5" data-testid="settings-api">
        <div className="min-w-0">
          <h2 className="m-0 text-[17px] font-semibold">{t("plat3.api.title")}</h2>
          <Note>{t("plat3.api.subtitle")}</Note>
        </div>
        <TokensCard />
        <WebhooksCard />
        <DocsCard />
      </div>
    </Can>
  );
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

function TokensCard() {
  const { t } = useT();
  const when = useCompanyWhen();
  const tokens = useQuery({ ...trpc.api.tokens.list.queryOptions(), meta: INLINE_ERROR_META });
  const [making, setMaking] = useState(false);
  const [shown, setShown] = useState<{ token: string; name: string } | null>(null);
  const [revoking, setRevoking] = useState<Token | null>(null);

  const columns: ResponsiveListColumn<Token>[] = [
    { key: "name", header: t("plat3.api.tokens.name"), cell: (k) => <span className="font-semibold break-words">{k.name}</span> },
    {
      key: "scopes",
      header: t("plat3.api.tokens.scopes"),
      cell: (k) => <span className="break-words">{k.scopes.map((s) => t(scopeKey(s as ApiTokenScope))).join(", ")}</span>,
    },
    { key: "hint", header: t("plat3.api.tokens.starts"), hideOnPhone: true, cell: (k) => <span className="font-mono whitespace-nowrap">{k.hint}</span> },
    {
      key: "last",
      header: t("plat3.api.tokens.lastUsed"),
      cell: (k) => (k.lastUsedAt ? <span className="whitespace-nowrap">{when(k.lastUsedAt)}</span> : <span className="text-muted-foreground">{t("plat3.api.tokens.neverUsed")}</span>),
    },
    {
      key: "expires",
      header: t("plat3.api.tokens.expires"),
      hideOnPhone: true,
      cell: (k) => (k.expiresAt ? <span className="whitespace-nowrap">{when(k.expiresAt)}</span> : <span className="text-muted-foreground">{t("plat3.api.tokens.expiryNone")}</span>),
    },
    {
      key: "state",
      header: t("plat3.api.tokens.status"),
      cell: (k) => {
        const state = tokenState(k);
        return (
          <Chip tone={state === "active" ? "green" : state === "expired" ? "amber" : "red"} truncate={false}>
            {t(`plat3.api.tokens.${state}`)}
          </Chip>
        );
      },
    },
    {
      key: "revoke",
      header: t("plat3.api.tokens.revoke"),
      headerHidden: true,
      hideWhenEmpty: true,
      cell: (k) =>
        canRevoke(tokenState(k)) ? (
          <Can do="api.manage">
            <Button variant="secondary" size="sm" aria-label={`${t("plat3.api.tokens.revoke")}: ${k.name}`} onClick={() => setRevoking(k)} data-testid="token-revoke">
              {t("plat3.api.tokens.revoke")}
            </Button>
          </Can>
        ) : null,
    },
  ];

  return (
    <Card data-testid="api-tokens">
      <CardHeader>
        <CardTitle>{t("plat3.api.tokens.title")}</CardTitle>
        <CardDescription>{t("plat3.api.tokens.hint")}</CardDescription>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-4">
        <Can do="api.manage">
          <Button className="self-start" onClick={() => setMaking(true)} aria-haspopup="dialog" data-testid="token-make">
            <Plus aria-hidden="true" strokeWidth={2} />
            {t("plat3.api.tokens.make")}
          </Button>
        </Can>
        <TabState query={tokens}>
          <ResponsiveList
            rows={tokens.data?.items ?? []}
            loading={tokens.isPending}
            label={t("plat3.api.tokens.title")}
            rowKey={(k) => k.id}
            columns={columns}
            empty={<EmptyState title={t("plat3.api.tokens.empty")} />}
          />
        </TabState>
      </CardContent>
      <Can do="api.manage">
        <TokenSheet open={making} billingOn={tokens.data?.billingOn ?? false} onClose={() => setMaking(false)} onMade={setShown} />
        <TokenShownDialog shown={shown} onClose={() => setShown(null)} />
        <RevokeTokenDialog token={revoking} onClose={() => setRevoking(null)} />
      </Can>
    </Card>
  );
}

function TokenSheet({ open, billingOn, onClose, onMade }: { open: boolean; billingOn: boolean; onClose(): void; onMade(v: { token: string; name: string }): void }) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<ApiTokenScope[]>([]);
  const [expiry, setExpiry] = useState("");
  const [showErrors, setShowErrors] = useState(false);
  const make = useOnceMutation(
    trpc.api.tokens.create.mutationOptions({
      onSuccess: (res, vars) => {
        void queryClient.invalidateQueries({ queryKey: trpc.api.tokens.list.queryKey() });
        setName("");
        setScopes([]);
        setExpiry("");
        setShowErrors(false);
        onClose();
        onMade({ token: res.token, name: vars.name });
      },
      onError: (e) => toast.error(platformRefusal(t, e)),
    }),
  );
  const errors = tokenFormErrors({ name, scopes, expiry }, billingOn);
  const submit = () => {
    if (errors.length > 0) {
      setShowErrors(true);
      return;
    }
    const days = parseExpiryDays(expiry);
    make.mutate({ name: name.trim(), scopes: sendableScopes(scopes, billingOn), expiresInDays: days.ok ? days.days : null });
  };
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => !o && !make.isPending && onClose()}
      dismissible={!make.isPending}
      title={t("plat3.api.tokens.make")}
      footer={
        <FormActions sticky={false}>
          <Button type="button" variant="secondary" onClick={onClose} disabled={make.isPending}>
            {t("common.cancel")}
          </Button>
          <Button type="button" loading={make.isPending} onClick={submit} data-testid="token-create">
            {t("plat3.api.tokens.make")}
          </Button>
        </FormActions>
      }
    >
      <div className="flex min-w-0 flex-col gap-4" data-testid="token-sheet">
        <Field label={t("plat3.api.tokens.name")} hint={t("plat3.api.tokens.nameHint")} error={showErrors && errors.includes("nameRequired") ? t("plat3.api.tokens.nameRequired") : undefined}>
          <TextInput value={name} maxLength={60} onChangeText={setName} autoComplete="off" data-testid="token-name" />
        </Field>
        <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
          <legend className="mb-1 p-0 text-[14px] font-semibold">{t("plat3.api.tokens.scopes")}</legend>
          {scopeOptions(billingOn).map((o) => (
            <label key={o.scope} className="flex min-h-11 items-start gap-3 rounded-input border border-border bg-card px-3 py-2 has-[:disabled]:opacity-60">
              <Checkbox
                className="mt-0.5"
                checked={scopes.includes(o.scope)}
                disabled={o.disabled}
                onCheckedChange={() => setScopes(toggleScope(scopes, o.scope))}
                data-testid={`token-scope-${o.scope}`}
              />
              <span className="min-w-0 text-[14px] break-words">
                {t(scopeKey(o.scope))}
                {o.disabled ? <span className="block text-[13px] text-muted-foreground">{t("plat3.api.tokens.billingOff")}</span> : null}
              </span>
            </label>
          ))}
          {showErrors && errors.includes("needScope") ? (
            <p role="alert" className="m-0 text-[13px] font-semibold text-tone-red-ink">
              {t("plat3.api.tokens.needScope")}
            </p>
          ) : null}
        </fieldset>
        <Field label={t("plat3.api.tokens.expiry")} hint={t("plat3.api.tokens.expiryHint")} error={showErrors && errors.includes("invalidExpiry") ? t("plat3.api.tokens.invalidExpiry") : undefined}>
          <TextInput value={expiry} inputMode="numeric" onChangeText={setExpiry} autoComplete="off" data-testid="token-expiry" />
        </Field>
      </div>
    </Sheet>
  );
}

function TokenShownDialog({ shown, onClose }: { shown: { token: string; name: string } | null; onClose(): void }) {
  const { t } = useT();
  return (
    <Dialog
      open={shown !== null}
      // Not dismissed by a stray click: the token is gone once this closes.
      onOpenChange={() => {}}
      title={t("plat3.api.tokens.shownOnce")}
      description={t("plat3.api.tokens.shownOnceBody")}
      actions={
        <Button onClick={onClose} data-testid="token-done">
          {t("plat3.api.tokens.done")}
        </Button>
      }
    >
      {shown ? <SecretBox value={shown.token} copyLabel={t("plat3.api.tokens.copy")} testId="token-value" /> : null}
    </Dialog>
  );
}

function RevokeTokenDialog({ token, onClose }: { token: Token | null; onClose(): void }) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const [last, setLast] = useState<Token | null>(token);
  if (token && token !== last) setLast(token);
  const revoke = useOnceMutation(
    trpc.api.tokens.revoke.mutationOptions({
      onSuccess: () => {
        toast.success(t("plat3.api.tokens.revokedToast"));
        void queryClient.invalidateQueries({ queryKey: trpc.api.tokens.list.queryKey() });
        onClose();
      },
      onError: (e) => toast.error(platformRefusal(t, e)),
    }),
  );
  return (
    <Dialog
      open={token !== null}
      onOpenChange={(o) => !o && onClose()}
      title={t("plat3.api.tokens.revokeTitle", { name: (token ?? last)?.name ?? "" })}
      description={t("plat3.api.tokens.revokeBody")}
      actions={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="button" variant="danger" loading={revoke.isPending} onClick={() => token && revoke.mutate({ id: token.id })} data-testid="token-revoke-confirm">
            {t("plat3.api.tokens.revokeConfirm")}
          </Button>
        </>
      }
    />
  );
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

function WebhooksCard() {
  const { t } = useT();
  const hooks = useQuery({ ...trpc.api.webhooks.list.queryOptions(), meta: INLINE_ERROR_META });
  const [adding, setAdding] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Hook | null>(null);
  return (
    <Card data-testid="api-webhooks">
      <CardHeader>
        <CardTitle>{t("plat3.api.webhooks.title")}</CardTitle>
        <CardDescription>{t("plat3.api.webhooks.hint")}</CardDescription>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-4">
        <Can do="api.manage">
          <Button className="self-start" onClick={() => setAdding(true)} aria-haspopup="dialog" data-testid="webhook-add">
            <Plus aria-hidden="true" strokeWidth={2} />
            {t("plat3.api.webhooks.add")}
          </Button>
        </Can>
        <TabState query={hooks}>
          {(hooks.data?.items ?? []).length === 0 ? (
            <EmptyState title={t("plat3.api.webhooks.empty")} />
          ) : (
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {(hooks.data?.items ?? []).map((h) => (
                <WebhookRow key={h.id} hook={h} onDelete={() => setDeleting(h)} />
              ))}
            </ul>
          )}
        </TabState>
      </CardContent>
      <Can do="api.manage">
        <WebhookSheet open={adding} onClose={() => setAdding(false)} onMade={setSecret} />
        <Dialog
          open={secret !== null}
          onOpenChange={() => {}}
          title={t("plat3.api.webhooks.secretTitle")}
          description={t("plat3.api.webhooks.secretBody")}
          actions={
            <Button onClick={() => setSecret(null)} data-testid="webhook-secret-done">
              {t("plat3.api.tokens.done")}
            </Button>
          }
        >
          {secret ? <SecretBox value={secret} copyLabel={t("plat3.api.webhooks.copySecret")} testId="webhook-secret" /> : null}
        </Dialog>
        <DeleteWebhookDialog hook={deleting} onClose={() => setDeleting(null)} />
      </Can>
    </Card>
  );
}

function WebhookRow({ hook, onDelete }: { hook: Hook; onDelete(): void }) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const toggle = useOnceMutation(
    trpc.api.webhooks.update.mutationOptions({
      onSuccess: () => {
        toast.success(t("plat3.api.webhooks.updated"));
        void queryClient.invalidateQueries({ queryKey: trpc.api.webhooks.list.queryKey() });
      },
      onError: (e) => toast.error(platformRefusal(t, e)),
    }),
  );
  return (
    <li className="flex min-w-0 flex-col gap-3 rounded-card border border-border bg-card p-4" data-testid="webhook-row">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 basis-56">
          <p className="m-0 font-mono text-[14px] font-semibold [overflow-wrap:anywhere]">{hook.url}</p>
          <p className="m-0 text-[13px] text-muted-foreground break-words">{hook.events.map((e) => t(eventKey(e))).join(", ")}</p>
        </div>
        <Chip tone={hook.active ? "green" : "amber"} truncate={false}>
          {hook.active ? t("plat3.api.webhooks.sending") : t("plat3.api.webhooks.paused")}
        </Chip>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" aria-expanded={open} onClick={() => setOpen(!open)} data-testid="webhook-deliveries-toggle">
          {open ? t("plat3.api.webhooks.hideDeliveries") : t("plat3.api.webhooks.showDeliveries")}
        </Button>
        <Can do="api.manage">
          <Button variant="secondary" size="sm" loading={toggle.isPending} onClick={() => toggle.mutate({ id: hook.id, active: !hook.active })} data-testid="webhook-toggle">
            {hook.active ? t("plat3.api.webhooks.pause") : t("plat3.api.webhooks.resume")}
          </Button>
          <Button variant="secondary" size="sm" onClick={onDelete} data-testid="webhook-delete">
            {t("plat3.api.webhooks.delete")}
          </Button>
        </Can>
      </div>
      {open ? <Deliveries hookId={hook.id} /> : null}
    </li>
  );
}

type Delivery = Outputs["api"]["webhooks"]["deliveries"]["items"][number];

function Deliveries({ hookId }: { hookId: string }) {
  const { t } = useT();
  const when = useCompanyWhen();
  const queryClient = useQueryClient();
  const list = useQuery({ ...trpc.api.webhooks.deliveries.queryOptions({ id: hookId }), meta: INLINE_ERROR_META });
  const resend = useOnceMutation(
    trpc.api.webhooks.resend.mutationOptions({
      onSuccess: () => {
        toast.success(t("plat3.api.webhooks.resent"));
        void queryClient.invalidateQueries({ queryKey: trpc.api.webhooks.deliveries.queryKey({ id: hookId }) });
      },
      onError: (e) => toast.error(platformRefusal(t, e)),
    }),
  );
  const columns: ResponsiveListColumn<Delivery>[] = [
    { key: "event", header: t("plat3.api.webhooks.event"), cell: (d) => <span className="break-words">{t(eventKey(d.event))}</span> },
    { key: "when", header: t("plat3.api.webhooks.when"), cell: (d) => <span className="whitespace-nowrap">{when(d.createdAt)}</span> },
    {
      key: "state",
      header: t("plat3.api.webhooks.state"),
      cell: (d) => (
        <Chip tone={deliveryTone(d.status as DeliveryStatus)} truncate={false}>
          {t(`plat3.api.webhooks.${d.status as DeliveryStatus}`)}
        </Chip>
      ),
    },
    { key: "tries", header: t("plat3.api.webhooks.tries"), hideOnPhone: true, cell: (d) => t("plat3.api.webhooks.attempts", { count: d.attempts }) },
    {
      key: "error",
      header: t("plat3.api.webhooks.lastError"),
      cell: (d) => (
        <span className="break-words">
          {d.lastError ? d.lastError : d.lastStatus ? t("plat3.api.webhooks.httpStatus", { status: d.lastStatus }) : <span className="text-muted-foreground">{t("plat3.api.webhooks.noError")}</span>}
        </span>
      ),
    },
    {
      key: "resend",
      header: t("plat3.api.webhooks.resend"),
      headerHidden: true,
      hideWhenEmpty: true,
      cell: (d) =>
        canResend(d.status) ? (
          <Can do="api.manage">
            <Button variant="secondary" size="sm" loading={resend.isPending} onClick={() => resend.mutate({ id: d.id })} data-testid="delivery-resend">
              {t("plat3.api.webhooks.resend")}
            </Button>
          </Can>
        ) : null,
    },
  ];
  return (
    <div data-testid="webhook-deliveries">
      <h3 className="m-0 mb-2 text-[14px] font-semibold">{t("plat3.api.webhooks.deliveries")}</h3>
      <TabState query={list}>
        <ResponsiveList
          rows={list.data?.items ?? []}
          loading={list.isPending}
          label={t("plat3.api.webhooks.deliveries")}
          rowKey={(d) => d.id}
          columns={columns}
          empty={<EmptyState title={t("plat3.api.webhooks.noDeliveries")} />}
        />
      </TabState>
    </div>
  );
}

function WebhookSheet({ open, onClose, onMade }: { open: boolean; onClose(): void; onMade(secret: string): void }) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<WebhookEventKey[]>([]);
  const [showErrors, setShowErrors] = useState(false);
  const add = useOnceMutation(
    trpc.api.webhooks.create.mutationOptions({
      onSuccess: (res) => {
        void queryClient.invalidateQueries({ queryKey: trpc.api.webhooks.list.queryKey() });
        toast.success(t("plat3.api.webhooks.added"));
        setUrl("");
        setEvents([]);
        setShowErrors(false);
        onClose();
        onMade(res.secret);
      },
      onError: (e) => toast.error(platformRefusal(t, e)),
    }),
  );
  const errors = webhookFormErrors({ url, events });
  const submit = () => {
    if (errors.length > 0) {
      setShowErrors(true);
      return;
    }
    add.mutate({ url: url.trim(), events });
  };
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => !o && !add.isPending && onClose()}
      dismissible={!add.isPending}
      title={t("plat3.api.webhooks.add")}
      footer={
        <FormActions sticky={false}>
          <Button type="button" variant="secondary" onClick={onClose} disabled={add.isPending}>
            {t("common.cancel")}
          </Button>
          <Button type="button" loading={add.isPending} onClick={submit} data-testid="webhook-create">
            {t("plat3.api.webhooks.add")}
          </Button>
        </FormActions>
      }
    >
      <div className="flex min-w-0 flex-col gap-4" data-testid="webhook-sheet">
        <Field label={t("plat3.api.webhooks.url")} hint={t("plat3.api.webhooks.urlHint")} error={showErrors && errors.includes("invalidUrl") ? t("plat3.api.webhooks.invalidUrl") : undefined}>
          <TextInput type="url" value={url} onChangeText={setUrl} autoComplete="off" autoCapitalize="none" spellCheck={false} inputMode="url" data-testid="webhook-url" />
        </Field>
        <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
          <legend className="mb-1 p-0 text-[14px] font-semibold">{t("plat3.api.webhooks.events")}</legend>
          {ALL_EVENTS.map((e) => (
            <label key={e} className="flex min-h-11 items-start gap-3 rounded-input border border-border bg-card px-3 py-2">
              <Checkbox className="mt-0.5" checked={events.includes(e)} onCheckedChange={() => setEvents(toggleEvent(events, e))} data-testid={`webhook-event-${e}`} />
              <span className="min-w-0 text-[14px] break-words">{t(eventKey(e))}</span>
            </label>
          ))}
          {showErrors && errors.includes("needEvent") ? (
            <p role="alert" className="m-0 text-[13px] font-semibold text-tone-red-ink">
              {t("plat3.api.webhooks.needEvent")}
            </p>
          ) : null}
        </fieldset>
      </div>
    </Sheet>
  );
}

function DeleteWebhookDialog({ hook, onClose }: { hook: Hook | null; onClose(): void }) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const [last, setLast] = useState<Hook | null>(hook);
  if (hook && hook !== last) setLast(hook);
  const remove = useOnceMutation(
    trpc.api.webhooks.delete.mutationOptions({
      onSuccess: () => {
        toast.success(t("plat3.api.webhooks.deleted"));
        void queryClient.invalidateQueries({ queryKey: trpc.api.webhooks.list.queryKey() });
        onClose();
      },
      onError: (e) => toast.error(platformRefusal(t, e)),
    }),
  );
  return (
    <Dialog
      open={hook !== null}
      onOpenChange={(o) => !o && onClose()}
      title={t("plat3.api.webhooks.deleteTitle")}
      description={t("plat3.api.webhooks.deleteBody", { url: (hook ?? last)?.url ?? "" })}
      actions={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="button" variant="danger" loading={remove.isPending} onClick={() => hook && remove.mutate({ id: hook.id })} data-testid="webhook-delete-confirm">
            {t("plat3.api.webhooks.deleteConfirm")}
          </Button>
        </>
      }
    />
  );
}

// ---------------------------------------------------------------------------
// Docs
// ---------------------------------------------------------------------------

function Code({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <pre className="m-0 max-w-full overflow-x-auto rounded-input border border-border bg-surface-sunken p-3 font-mono text-[12.5px] leading-5" data-testid={testId}>
      <code>{children}</code>
    </pre>
  );
}

function DocsCard() {
  const { t } = useT();
  const base = apiBaseUrl(env.VITE_SERVER_URL);
  return (
    <Card data-testid="api-docs">
      <CardHeader>
        <CardTitle>{t("plat3.api.docs.title")}</CardTitle>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-3 text-[14px] leading-6">
        <p className="m-0 font-semibold">{t("plat3.api.docs.base")}</p>
        <Code testId="api-base">{base}</Code>
        <p className="m-0">{t("plat3.api.docs.auth")}</p>
        <Code>{authHeaderExample}</Code>
        <Code>{curlExample(env.VITE_SERVER_URL)}</Code>
        <p className="m-0 font-semibold">{t("plat3.api.docs.endpoints")}</p>
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {API_ENDPOINTS.map((e) => (
            <li key={e.path} className="min-w-0">
              <span className="font-mono text-[13px] break-all">GET {e.path}</span> <span className="text-muted-foreground">{t(`plat3.api.docs.${e.word}`)}</span>
            </li>
          ))}
        </ul>
        <p className="m-0">{t("plat3.api.docs.paging")}</p>
        <p className="m-0">{t("plat3.api.docs.rate", { count: RATE_PER_MINUTE })}</p>
        <p className="m-0">{t("plat3.api.docs.rates")}</p>
        <p className="m-0">{t("plat3.api.docs.hooks")}</p>
        <p className="m-0">{t("plat3.api.docs.signature")}</p>
        <Code testId="api-signature">{SIGNATURE_EXAMPLE}</Code>
        <a className="font-semibold text-primary underline underline-offset-2" href={openApiUrl(env.VITE_SERVER_URL)} target="_blank" rel="noreferrer" data-testid="api-openapi">
          {t("plat3.api.docs.openapi")}
        </a>
      </CardContent>
    </Card>
  );
}
