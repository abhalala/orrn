import { COMPANY_ROLES, useT, type CompanyRole } from "@orrn/i18n";
import { Badge } from "@orrn/ui/components/badge";
import { Button } from "@orrn/ui/components/button";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, TextInput } from "@orrn/ui/components/field";
import { FormActions } from "@orrn/ui/components/form-actions";
import { NativeSelect } from "@orrn/ui/components/native-select";
import { ResponsiveList, type ResponsiveListColumn } from "@orrn/ui/components/responsive-list";
import { Dialog } from "@orrn/ui/components/dialog";
import { Sheet } from "@orrn/ui/components/sheet";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Action } from "@orrn/server/lib/permissions";
import type { AppRouter } from "@orrn/server/routers/index";
import type { inferRouterOutputs } from "@trpc/server";
import { Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Can } from "@/shared/components/can";
import { useOnceMutation } from "@/shared/lib/once-mutation";
import { trpc } from "@/shared/utils/trpc";

import { platformRefusal } from "./platform-refusal";
import {
  actionWordKey,
  areaKey,
  changesAgainstBase,
  copyableRoles,
  draftChanged,
  draftErrors,
  draftFromBase,
  draftFromRole,
  flip,
  groupActions,
  lackingActions,
  ROLE_NAME_MAX,
  switchView,
  type RoleDraft,
} from "./roles-model";
import { Note, SwitchRow, TabState } from "./ui";

type RolesData = inferRouterOutputs<AppRouter>["roles"]["list"];
type Role = RolesData["roles"][number];

/** What the sheet is doing: making a role (`new`) or changing one. */
type Editing = { kind: "new" } | { kind: "edit"; role: Role } | null;

/**
 * Settings > Roles: the plant's own roles, each a copy of one fixed role with single actions switched on or off
 * (`roles.*`). Reading needs `role.manage` or `users.manage`; make, change and delete need `role.manage`. The server
 * judges every save: a role cannot hold an action the person saving it lacks, and a role people hold cannot be deleted.
 */
export function RolesTab() {
  const { t } = useT();
  const roles = useQuery(trpc.roles.list.queryOptions());
  const [editing, setEditing] = useState<Editing>(null);
  const [deleting, setDeleting] = useState<Role | null>(null);

  const columns: ResponsiveListColumn<Role>[] = [
    { key: "name", header: t("plat3.roles.name"), cell: (r) => <span className="font-semibold break-words">{r.name}</span> },
    {
      key: "base",
      header: t("plat3.roles.copyOfPick"),
      cell: (r) => <Badge tone="neutral">{t("plat3.roles.copyOf", { role: t(`roles.${r.baseRole}`) })}</Badge>,
    },
    {
      key: "people",
      header: t("plat3.roles.holders"),
      cell: (r) => (r.members > 0 ? t("plat3.roles.people", { count: r.members }) : <span className="text-muted-foreground">{t("plat3.roles.noPeople")}</span>),
    },
    {
      key: "actions",
      header: t("plat3.roles.switches"),
      headerHidden: true,
      cell: (r) => (
        <Can do="role.manage">
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" aria-label={`${t("plat3.roles.change")}: ${r.name}`} onClick={() => setEditing({ kind: "edit", role: r })} data-testid="role-change">
              {t("plat3.roles.change")}
            </Button>
            <Button variant="secondary" size="sm" aria-label={`${t("plat3.roles.delete")}: ${r.name}`} onClick={() => setDeleting(r)} data-testid="role-delete">
              {t("plat3.roles.delete")}
            </Button>
          </div>
        </Can>
      ),
    },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="settings-roles">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="m-0 text-[17px] font-semibold">{t("plat3.roles.title")}</h2>
          <Note>{t("plat3.roles.subtitle")}</Note>
        </div>
        <Can do="role.manage" fallback={<Note testId="roles-read-only">{t("plat3.roles.readOnly")}</Note>}>
          <Button onClick={() => setEditing({ kind: "new" })} aria-haspopup="dialog" data-testid="role-make">
            <Plus aria-hidden="true" strokeWidth={2} />
            {t("plat3.roles.make")}
          </Button>
        </Can>
      </div>

      <TabState query={roles}>
        <ResponsiveList
          rows={roles.data?.roles ?? []}
          loading={roles.isPending}
          label={t("plat3.roles.title")}
          rowKey={(r) => r.id}
          columns={columns}
          empty={<EmptyState title={t("plat3.roles.empty")} />}
        />
      </TabState>

      <Can do="role.manage">
        {roles.data ? <RoleSheet data={roles.data} editing={editing} onClose={() => setEditing(null)} /> : null}
        <DeleteRoleDialog role={deleting} onClose={() => setDeleting(null)} />
      </Can>
    </div>
  );
}

function RoleSheet({ data, editing, onClose }: { data: RolesData; editing: Editing; onClose(): void }) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const copyable = copyableRoles(COMPANY_ROLES as readonly CompanyRole[]);
  const [draft, setDraft] = useState<RoleDraft>(() => draftFromBase(copyable[0] ?? "viewer", data.fixed));
  const [saved, setSaved] = useState<RoleDraft>(draft);
  const [forKey, setForKey] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);

  // Start from the right values each time the sheet opens on a different role (or a new one).
  const key = editing ? (editing.kind === "new" ? "new" : editing.role.id) : null;
  if (key !== forKey) {
    setForKey(key);
    setShowErrors(false);
    if (editing) {
      const next = editing.kind === "new" ? draftFromBase(copyable[0] ?? "viewer", data.fixed) : draftFromRole(editing.role);
      setDraft(next);
      setSaved(next);
    }
  }

  const base = data.fixed[draft.baseRole as keyof typeof data.fixed] ?? [];
  const groups = groupActions(data.toggleActions);
  const errors = draftErrors(draft, data.mine);
  const lacking = lackingActions(draft.enabled, data.mine);
  const changes = changesAgainstBase(draft.enabled, base, data.toggleActions);

  const finish = () => {
    void queryClient.invalidateQueries({ queryKey: trpc.roles.list.queryKey() });
    // A person who holds the role has new actions from the next request.
    void queryClient.invalidateQueries({ queryKey: trpc.auth.me.queryKey() });
    toast.success(t("plat3.roles.saved"));
    onClose();
  };
  const fail = (e: unknown) => toast.error(platformRefusal(t, e));
  const create = useOnceMutation(trpc.roles.create.mutationOptions({ onSuccess: finish, onError: fail }));
  const update = useOnceMutation(trpc.roles.update.mutationOptions({ onSuccess: finish, onError: fail }));
  const pending = create.isPending || update.isPending;

  const submit = () => {
    if (errors.length > 0) {
      setShowErrors(true);
      return;
    }
    const name = draft.name.trim();
    if (editing?.kind === "edit") update.mutate({ id: editing.role.id, name, on: changes.on as Action[], off: changes.off as Action[] });
    else create.mutate({ name, baseRole: draft.baseRole as CompanyRole, on: changes.on as Action[], off: changes.off as Action[] });
  };

  const nameError = showErrors && errors.includes("nameRequired") ? t("plat3.roles.nameRequired") : undefined;
  const isNew = editing?.kind !== "edit";
  const title = isNew ? t("plat3.roles.makeTitle") : t("plat3.roles.editTitle", { name: saved.name });
  const onCount = draft.enabled.filter((a) => (data.toggleActions as readonly string[]).includes(a)).length;

  return (
    <Sheet
      open={editing !== null}
      onOpenChange={(open) => !open && !pending && onClose()}
      dismissible={!pending}
      title={title}
      footer={
        <FormActions sticky={false}>
          <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
            {t("common.cancel")}
          </Button>
          <Button type="button" loading={pending} disabled={!isNew && !draftChanged(draft, saved)} onClick={submit} data-testid="role-save">
            {t("plat3.roles.save")}
          </Button>
        </FormActions>
      }
    >
      <div className="flex min-w-0 flex-col gap-4" data-testid="role-sheet">
        <Field label={t("plat3.roles.name")} hint={t("plat3.roles.nameHint")} error={nameError}>
          <TextInput value={draft.name} maxLength={ROLE_NAME_MAX} onChangeText={(name) => setDraft({ ...draft, name })} autoComplete="off" data-testid="role-name" />
        </Field>

        {isNew ? (
          <Field id="role-base-select" label={t("plat3.roles.copyOfPick")} hint={t("plat3.roles.copyOfHint")}>
            <NativeSelect
              id="role-base-select"
              value={draft.baseRole}
              onChange={(e) => setDraft({ ...draft, baseRole: e.target.value, enabled: [...(data.fixed[e.target.value as keyof typeof data.fixed] ?? [])] })}
              data-testid="role-base"
            >
              {copyable.map((r) => (
                <option key={r} value={r}>
                  {t(`roles.${r}`)}
                </option>
              ))}
            </NativeSelect>
          </Field>
        ) : (
          <p className="m-0 text-[14px] text-muted-foreground">{t("plat3.roles.copyOf", { role: t(`roles.${draft.baseRole as CompanyRole}`) })}</p>
        )}

        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="m-0 text-[15px] font-semibold">{t("plat3.roles.switches")}</h3>
          <Note>{t("plat3.roles.switchesHint")}</Note>
          <Note testId="role-summary" role="status">
            {t("plat3.roles.count", { count: onCount, total: data.toggleActions.length })}{" "}
            {changes.on.length + changes.off.length === 0 ? t("plat3.roles.noChanges") : t("plat3.roles.changes", { on: changes.on.length, off: changes.off.length })}
          </Note>
          {showErrors && lacking.length > 0 ? (
            <p role="alert" className="m-0 text-[13px] font-semibold text-tone-red-ink">
              {t("plat3.roles.cannotGive")}
            </p>
          ) : null}
        </div>

        {groups.map((group) => (
          <section key={group.id} aria-labelledby={`role-area-${group.id}`} className="flex min-w-0 flex-col gap-2" data-testid={`role-area-${group.id}`}>
            <h4 id={`role-area-${group.id}`} className="m-0 text-[14px] font-semibold text-muted-foreground">
              {t(areaKey(group.id))}
            </h4>
            {group.actions.map((action) => {
              const view = switchView(action, draft.enabled, base, data.mine);
              const tags = [view.inBase ? t("plat3.roles.inBase") : "", view.changed ? t("plat3.roles.changed") : "", view.reason ? t("plat3.roles.cannotGive") : ""].filter(Boolean);
              return (
                <SwitchRow
                  key={action}
                  label={t(actionWordKey(action))}
                  hint={tags.join(" ") || " "}
                  on={view.on}
                  disabled={view.disabled}
                  onToggle={() => setDraft({ ...draft, enabled: flip(draft.enabled, action) })}
                  testId={`role-switch-${action}`}
                />
              );
            })}
          </section>
        ))}
      </div>
    </Sheet>
  );
}

function DeleteRoleDialog({ role, onClose }: { role: Role | null; onClose(): void }) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const [last, setLast] = useState<Role | null>(role);
  if (role && role !== last) setLast(role);
  const shown = role ?? last;
  const remove = useOnceMutation(
    trpc.roles.delete.mutationOptions({
      onSuccess: () => {
        toast.success(t("plat3.roles.deleted"));
        void queryClient.invalidateQueries({ queryKey: trpc.roles.list.queryKey() });
        onClose();
      },
      // "People still hold this role": the server's refusal, in the person's language.
      onError: (e) => {
        toast.error(platformRefusal(t, e));
        void queryClient.invalidateQueries({ queryKey: trpc.roles.list.queryKey() });
      },
    }),
  );
  return (
    <Dialog
      open={role !== null}
      onOpenChange={(open) => !open && onClose()}
      title={t("plat3.roles.deleteTitle", { name: shown?.name ?? "" })}
      description={t("plat3.roles.deleteBody")}
      actions={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="button" variant="danger" loading={remove.isPending} onClick={() => role && remove.mutate({ id: role.id })} data-testid="role-delete-confirm">
            {t("plat3.roles.deleteConfirm")}
          </Button>
        </>
      }
    />
  );
}
