import { COMPANY_ROLES, useT, type CompanyRole } from "@orrn/i18n";
import { Badge } from "@orrn/ui/components/badge";
import { Button } from "@orrn/ui/components/button";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, TextInput } from "@orrn/ui/components/field";
import { FormActions } from "@orrn/ui/components/form-actions";
import { HowToButton } from "@orrn/ui/components/how-to-button";
import { NativeSelect } from "@orrn/ui/components/native-select";
import { ResponsiveList, type ResponsiveListColumn } from "@orrn/ui/components/responsive-list";
import { Dialog } from "@orrn/ui/components/dialog";
import { Sheet } from "@orrn/ui/components/sheet";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AppRouter } from "@orrn/server/routers/index";
import type { inferRouterOutputs } from "@trpc/server";
import { UserPlus } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { PortalLoginsSection } from "@/features/portal/staff-logins";
import { useCompanyWhen } from "@/features/stock/use-company-when";
import { Can } from "@/shared/components/can";
import { useMe } from "@/shared/lib/me";
import { trpc } from "@/shared/utils/trpc";

import { invitableRoles, isExpired, validEmail } from "./model";

type Outputs = inferRouterOutputs<AppRouter>;
type Member = Outputs["company"]["membersList"][number];
type Invite = Outputs["invite"]["list"][number];

/**
 * Team: members with their role, pending invites, the invite sheet
 * (`invite.create`, `member.invite`), and per member a role change
 * (`member.updateRole`) and removal (`member.remove`). Only an owner may touch an owner row, and
 * nobody changes or removes their own row. Party logins (portal.manage) are listed below the invites.
 */
export function TeamTab() {
  const { t } = useT();
  const when = useCompanyWhen();
  const { data: me } = useMe();
  const members = useQuery(trpc.company.membersList.queryOptions());
  const invites = useQuery(trpc.invite.list.queryOptions());
  const [inviteOpen, setInviteOpen] = useState(false);
  const [roleFor, setRoleFor] = useState<Member | null>(null);
  const [removing, setRemoving] = useState<Member | null>(null);

  const memberColumns: ResponsiveListColumn<Member>[] = [
    {
      key: "name",
      header: t("settings.team.name"),
      cell: (m) => (
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="font-semibold break-words">{m.user.name || m.user.email}</span>
          {m.userId === me?.user.id ? <Badge tone="neutral">{t("settings.team.you")}</Badge> : null}
        </span>
      ),
    },
    { key: "email", header: t("settings.team.email"), cell: (m) => <span className="break-all">{m.user.email}</span> },
    {
      key: "role",
      header: t("settings.team.role"),
      cell: (m) => <Badge tone={m.role === "owner" || m.role === "admin" ? "brand" : "neutral"}>{t(`roles.${m.role}`)}</Badge>,
    },
    { key: "joined", header: t("settings.team.joined"), hideOnPhone: true, cell: (m) => <span className="whitespace-nowrap">{when(m.createdAt)}</span> },
    {
      key: "actions",
      header: t("settings.team.actions"),
      headerHidden: true,
      cell: (m) => <MemberActions member={m} onChangeRole={() => setRoleFor(m)} onRemove={() => setRemoving(m)} />,
    },
  ];

  const inviteColumns: ResponsiveListColumn<Invite>[] = [
    { key: "email", header: t("settings.team.email"), cell: (i) => <span className="font-semibold break-all">{i.email}</span> },
    { key: "role", header: t("settings.team.role"), cell: (i) => <Badge tone="neutral">{t(`roles.${i.role}`)}</Badge> },
    {
      key: "expires",
      header: t("settings.team.linkColumn"),
      cell: (i) =>
        isExpired(i.expiresAt) ? (
          <span className="text-muted-foreground">{t("settings.team.expired")}</span>
        ) : (
          <span className="whitespace-nowrap">{t("settings.team.expires", { date: when(i.expiresAt) })}</span>
        ),
    },
    { key: "revoke", header: "", cell: (i) => <RevokeInvite invite={i} /> },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="settings-team">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <h2 className="m-0 text-[17px] font-semibold">{t("settings.team.members")}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <HowToButton slug="invite-member" />
          <Can
            do="member.invite"
            fallback={<p className="m-0 text-[13px] text-muted-foreground" data-testid="team-read-only">{t("settings.team.readOnly")}</p>}
          >
            <Button onClick={() => setInviteOpen(true)} aria-haspopup="dialog" data-testid="invite-open">
              <UserPlus aria-hidden="true" strokeWidth={2} />
              {t("settings.team.invite")}
            </Button>
          </Can>
        </div>
      </div>

      <ResponsiveList
        rows={members.data ?? []}
        loading={members.isPending}
        label={t("settings.team.members")}
        rowKey={(m) => m.id}
        columns={memberColumns}
        empty={
          members.isError ? (
            <EmptyState
              title={t("settings.team.loadFailed")}
              action={
                <Button variant="secondary" onClick={() => void members.refetch()}>
                  {t("common.retry")}
                </Button>
              }
            />
          ) : (
            <EmptyState title={t("settings.team.empty")} />
          )
        }
      />

      <section aria-labelledby="pending-invites" className="flex min-w-0 flex-col gap-3">
        <h2 id="pending-invites" className="m-0 text-[17px] font-semibold">
          {t("settings.team.pending")}
        </h2>
        <ResponsiveList
          rows={invites.data ?? []}
          loading={invites.isPending}
          label={t("settings.team.pending")}
          rowKey={(i) => i.id}
          columns={inviteColumns}
          empty={<EmptyState title={invites.isError ? t("settings.team.loadFailed") : t("settings.team.pendingEmpty")} />}
        />
      </section>

      <PortalLoginsSection />

      <Can do="member.invite">
        <InviteSheet open={inviteOpen} onOpenChange={setInviteOpen} />
      </Can>
      <Can do="member.updateRole">
        <RoleSheet member={roleFor} onClose={() => setRoleFor(null)} />
      </Can>
      <Can do="member.remove">
        <RemoveDialog member={removing} onClose={() => setRemoving(null)} />
      </Can>
    </div>
  );
}

function RevokeInvite({ invite }: { invite: Invite }) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const revoke = useMutation(
    trpc.invite.revoke.mutationOptions({
      onSuccess: () => {
        toast.success(t("settings.team.revoked"));
        void queryClient.invalidateQueries({ queryKey: trpc.invite.list.queryKey() });
      },
    }),
  );
  return (
    <Can do="member.invite">
      <Button
        variant="secondary"
        loading={revoke.isPending}
        aria-label={`${t("settings.team.revoke")}: ${invite.email}`}
        onClick={() => revoke.mutate({ inviteId: invite.id })}
      >
        {t("settings.team.revoke")}
      </Button>
    </Can>
  );
}

function InviteSheet({ open, onOpenChange }: { open: boolean; onOpenChange(open: boolean): void }) {
  const { t } = useT();
  const { data: me } = useMe();
  const queryClient = useQueryClient();
  const roles = invitableRoles(me?.company?.role, COMPANY_ROLES);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<CompanyRole>("viewer");
  const [error, setError] = useState<string | undefined>();

  const invite = useMutation(
    trpc.invite.create.mutationOptions({
      onSuccess: (_, vars) => {
        toast.success(t("settings.team.inviteSent", { email: vars.email.trim() }));
        void queryClient.invalidateQueries({ queryKey: trpc.invite.list.queryKey() });
        setEmail("");
        setError(undefined);
        onOpenChange(false);
      },
      onError: () => setError(t("settings.team.inviteFailed")),
    }),
  );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!validEmail(email)) {
      setError(t("errors.invalidEmail"));
      return;
    }
    setError(undefined);
    invite.mutate({ email: email.trim(), role });
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("settings.team.inviteTitle")}
      footer={
        <FormActions sticky={false}>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form="invite-form" loading={invite.isPending}>
            {t("settings.team.sendInvite")}
          </Button>
        </FormActions>
      }
    >
      <form id="invite-form" onSubmit={submit} className="flex min-w-0 flex-col gap-4" noValidate>
        <Field label={t("settings.team.email")} error={error}>
          <TextInput
            type="email"
            value={email}
            onChangeText={(next) => {
              setEmail(next);
              if (error) setError(undefined);
            }}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            inputMode="email"
            data-testid="invite-email"
          />
        </Field>
        <Field id="invite-role-select" label={t("settings.team.role")} hint={t(`settings.team.roleHints.${role}`)}>
          <NativeSelect id="invite-role-select" value={role} onChange={(e) => setRole(e.target.value as CompanyRole)} data-testid="invite-role">
            {roles.map((r) => (
              <option key={r} value={r}>
                {t(`roles.${r}`)}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </form>
    </Sheet>
  );
}

/** Role and Remove buttons for one member. Hidden on your own row, and on an owner's row unless you are an owner. */
function MemberActions({ member, onChangeRole, onRemove }: { member: Member; onChangeRole(): void; onRemove(): void }) {
  const { t } = useT();
  const { data: me } = useMe();
  if (member.userId === me?.user.id) return null;
  const name = member.user.name || member.user.email;
  if (member.role === "owner" && me?.company?.role !== "owner") {
    return <span className="text-[13px] text-muted-foreground">{t("settings.team.ownerLocked")}</span>;
  }
  return (
    <div className="flex flex-wrap gap-2">
      <Can do="member.updateRole">
        <Button variant="secondary" size="sm" aria-label={`${t("settings.team.changeRole")}: ${name}`} onClick={onChangeRole} data-testid="member-change-role">
          {t("settings.team.changeRole")}
        </Button>
      </Can>
      <Can do="member.remove">
        <Button variant="secondary" size="sm" aria-label={`${t("settings.team.remove")}: ${name}`} onClick={onRemove} data-testid="member-remove">
          {t("settings.team.remove")}
        </Button>
      </Can>
    </div>
  );
}

function RoleSheet({ member, onClose }: { member: Member | null; onClose(): void }) {
  const { t } = useT();
  const { data: me } = useMe();
  const queryClient = useQueryClient();
  const roles = invitableRoles(me?.company?.role, COMPANY_ROLES);
  const [role, setRole] = useState<CompanyRole>("viewer");
  const [forId, setForId] = useState<string | null>(null);
  // Start from the member's current role each time a different member opens.
  if (member && member.id !== forId) {
    setForId(member.id);
    setRole(member.role as CompanyRole);
  }
  const update = useMutation(
    trpc.company.membersUpdateRole.mutationOptions({
      onSuccess: () => {
        toast.success(t("settings.team.roleChanged"));
        void queryClient.invalidateQueries({ queryKey: trpc.company.membersList.queryKey() });
        onClose();
      },
      onError: () => toast.error(t("settings.team.roleFailed")),
    }),
  );
  const name = member ? member.user.name || member.user.email : "";
  return (
    <Sheet
      open={member !== null}
      onOpenChange={(open) => !open && onClose()}
      title={t("settings.team.changeRoleTitle", { name })}
      footer={
        <FormActions sticky={false}>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            loading={update.isPending}
            disabled={!member || role === member.role}
            onClick={() => member && update.mutate({ membershipId: member.id, role })}
            data-testid="member-save-role"
          >
            {t("settings.team.saveRole")}
          </Button>
        </FormActions>
      }
    >
      <Field id="member-role-select" label={t("settings.team.role")} hint={t(`settings.team.roleHints.${role}`)}>
        <NativeSelect id="member-role-select" value={role} onChange={(e) => setRole(e.target.value as CompanyRole)} data-testid="member-role">
          {roles.map((r) => (
            <option key={r} value={r}>
              {t(`roles.${r}`)}
            </option>
          ))}
        </NativeSelect>
      </Field>
    </Sheet>
  );
}

function RemoveDialog({ member, onClose }: { member: Member | null; onClose(): void }) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const [last, setLast] = useState<Member | null>(member);
  if (member && member !== last) setLast(member);
  const shown = member ?? last;
  const name = shown ? shown.user.name || shown.user.email : "";
  const remove = useMutation(
    trpc.company.membersRemove.mutationOptions({
      onSuccess: () => {
        toast.success(t("settings.team.removed", { name }));
        void queryClient.invalidateQueries({ queryKey: trpc.company.membersList.queryKey() });
        onClose();
      },
      onError: () => toast.error(t("settings.team.removeFailed")),
    }),
  );
  return (
    <Dialog
      open={member !== null}
      onOpenChange={(open) => !open && onClose()}
      title={t("settings.team.removeTitle", { name })}
      description={t("settings.team.removeBody")}
      actions={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            variant="danger"
            loading={remove.isPending}
            onClick={() => member && remove.mutate({ membershipId: member.id })}
            data-testid="member-remove-confirm"
          >
            {t("settings.team.removeConfirm")}
          </Button>
        </>
      }
    />
  );
}
