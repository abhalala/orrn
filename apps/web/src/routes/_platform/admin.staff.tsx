import { useT, type MessageKey } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, TextInput } from "@orrn/ui/components/field";
import { PageHeader } from "@orrn/ui/components/page-header";
import { ResponsiveList, type ResponsiveListColumn } from "@orrn/ui/components/responsive-list";
import { Select } from "@orrn/ui/components/select";
import { Sheet } from "@orrn/ui/components/sheet";
import { cn } from "@orrn/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useId, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { formatDay } from "@/features/admin/format";
import type { StaffRow } from "@/features/admin/types";
import { ConfirmDialog, errorCode, errorText, LoadError } from "@/features/admin/ui";
import { Can } from "@/shared/components/can";
import { can, useMe } from "@/shared/lib/me";
import { trpc } from "@/shared/utils/trpc";

export const Route = createFileRoute("/_platform/admin/staff")({
  component: AdminStaff,
});

type PlatformStaffRole = StaffRow["role"];

const ROLE_KEYS: Record<PlatformStaffRole, MessageKey> = {
  super_admin: "platformRoles.super_admin",
  admin: "platformRoles.admin",
  support: "platformRoles.support",
};

const ROLE_HINT_KEYS: Record<PlatformStaffRole, MessageKey> = {
  super_admin: "admin.staff.roleHints.super_admin",
  admin: "admin.staff.roleHints.admin",
  support: "admin.staff.roleHints.support",
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Godseye staff accounts (orrn's own people). Created here only; there is
 * no public sign-up. A person can't change or remove their own account, and
 * can only hand out roles their own role allows (`staffAssignableRoles`).
 */
function AdminStaff() {
  const { t, locale } = useT();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const staff = useQuery(trpc.platform.staffList.queryOptions());
  const assignable = useQuery(trpc.platform.staffAssignableRoles.queryOptions());
  const [addOpen, setAddOpen] = useState(false);
  const [removing, setRemoving] = useState<StaffRow | null>(null);

  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: trpc.platform.staffList.queryKey() }),
      qc.invalidateQueries({ queryKey: trpc.platform.overview.queryKey() }),
    ]);

  const updateRole = useMutation({
    ...trpc.platform.staffUpdateRole.mutationOptions(),
    onSuccess: async () => {
      toast.success(t("admin.staff.roleChanged"));
      await refresh();
    },
    onError: (err) => toast.error(errorText(t, err)),
  });
  const remove = useMutation({
    ...trpc.platform.staffRemove.mutationOptions(),
    onSuccess: async () => {
      toast.success(t("admin.staff.removed"));
      setRemoving(null);
      await refresh();
    },
    onError: (err) => toast.error(errorText(t, err)),
  });

  const roles = (assignable.data ?? []) as PlatformStaffRole[];
  const canEditRoles = can(me, "platform.staff.updateRole");
  const canRemove = can(me, "platform.staff.remove");
  const roleOptions = roles.map((role) => ({ value: role, label: t(ROLE_KEYS[role]) }));

  const columns: ResponsiveListColumn<StaffRow>[] = [
    {
      key: "name",
      header: t("admin.staff.name"),
      cell: (row) => (
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="font-semibold text-foreground break-words">
            {row.userId === me?.user.id ? t("admin.access.staffYou", { name: row.name }) : row.name}
          </span>
          <span className="text-[13px] text-muted-foreground [overflow-wrap:anywhere]">{row.email}</span>
        </span>
      ),
    },
    {
      key: "role",
      header: t("admin.staff.role"),
      cell: (row) => {
        const role = row.role as PlatformStaffRole;
        const editable = canEditRoles && row.userId !== me?.user.id && roles.includes(role);
        return editable ? (
          <Select
            aria-label={t("admin.staff.roleFor", { name: row.name })}
            value={role}
            onValueChange={(next) => updateRole.mutate({ userId: row.userId, role: next as PlatformStaffRole })}
            options={roleOptions}
            disabled={updateRole.isPending}
            className="w-full min-w-40 lg:w-44"
          />
        ) : (
          <Chip tone="violet">{t(ROLE_KEYS[role])}</Chip>
        );
      },
    },
    {
      key: "added",
      header: t("admin.staff.added"),
      cell: (row) => <span className="whitespace-nowrap">{formatDay(row.createdAt, { locale })}</span>,
    },
    {
      key: "actions",
      header: "",
      align: "end",
      cell: (row) =>
        canRemove && row.userId !== me?.user.id ? (
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive"
            aria-label={t("admin.staff.removeLabel", { name: row.name })}
            onPress={() => setRemoving(row)}
          >
            {t("admin.staff.remove")}
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <PageHeader
        title={t("admin.staff.title")}
        subtitle={t("admin.staff.subtitle")}
        actions={
          <Can do="platform.staff.create">
            <Button onPress={() => setAddOpen(true)} className="pointer-coarse:h-14">
              {t("admin.staff.add")}
            </Button>
          </Can>
        }
      />

      {staff.isError && !staff.data ? (
        <LoadError message={t("admin.staff.loadError")} onRetry={() => void staff.refetch()} />
      ) : (
        <ResponsiveList
          label={t("admin.staff.listLabel")}
          rows={staff.data ?? []}
          columns={columns}
          rowKey={(row) => row.userId}
          loading={staff.isPending}
          empty={<EmptyState title={t("admin.staff.empty")} />}
        />
      )}

      <AddStaffSheet open={addOpen} onOpenChange={setAddOpen} roles={roles} onAdded={refresh} />

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => (open ? undefined : setRemoving(null))}
        title={removing ? t("admin.staff.removeTitle", { name: removing.name }) : ""}
        body={removing ? t("admin.staff.removeBody", { email: removing.email }) : ""}
        confirmLabel={t("admin.staff.remove")}
        tone="danger"
        pending={remove.isPending}
        onConfirm={() => removing && remove.mutate({ userId: removing.userId })}
      />
    </div>
  );
}

type FormErrors = Partial<Record<"name" | "email" | "password", string>>;

function AddStaffSheet({
  open,
  onOpenChange,
  roles,
  onAdded,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  roles: PlatformStaffRole[];
  onAdded(): Promise<unknown>;
}) {
  const { t } = useT();
  const formId = useId();
  const empty = { name: "", email: "", password: "", role: "support" as PlatformStaffRole };
  const [form, setForm] = useState(empty);
  const [errors, setErrors] = useState<FormErrors>({});

  const create = useMutation({
    ...trpc.platform.staffCreate.mutationOptions(),
    onSuccess: async () => {
      toast.success(t("admin.staff.created"));
      setForm(empty);
      setErrors({});
      onOpenChange(false);
      await onAdded();
    },
    onError: (err) => {
      if (errorCode(err) === "CONFLICT") setErrors({ email: t("admin.staff.emailTaken") });
      else toast.error(errorText(t, err));
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next: FormErrors = {};
    if (!form.name.trim()) next.name = t("errors.required");
    if (!EMAIL.test(form.email.trim())) next.email = t("errors.invalidEmail");
    if (form.password.length < 12) next.password = t("admin.staff.passwordShort");
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    create.mutate({ name: form.name.trim(), email: form.email.trim().toLowerCase(), password: form.password, role: form.role });
  };

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    if (errors[key as keyof FormErrors]) setErrors((x) => ({ ...x, [key]: undefined }));
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => (create.isPending ? undefined : onOpenChange(next))}
      title={t("admin.staff.addTitle")}
      footer={
        <>
          <Button variant="secondary" disabled={create.isPending} onPress={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form={formId} loading={create.isPending} className="pointer-coarse:h-14">
            {t("admin.staff.create")}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate className="flex flex-col gap-5">
        <Field label={t("admin.staff.name")} error={errors.name}>
          <TextInput value={form.name} onChange={set("name")} autoComplete="off" maxLength={120} />
        </Field>
        <Field label={t("admin.staff.email")} error={errors.email}>
          <TextInput
            type="email"
            value={form.email}
            onChange={set("email")}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            inputMode="email"
          />
        </Field>
        <Field label={t("admin.staff.password")} hint={t("admin.staff.passwordHint")} error={errors.password}>
          <TextInput type="password" value={form.password} onChange={set("password")} autoComplete="new-password" maxLength={128} />
        </Field>
        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="mb-1.5 p-0 text-[14px] font-semibold text-foreground">{t("admin.staff.role")}</legend>
          {roles.map((role) => {
            const id = `${formId}-${role}`;
            const checked = form.role === role;
            return (
              <label
                key={role}
                htmlFor={id}
                className={cn(
                  "flex min-h-14 cursor-pointer items-start gap-3 rounded-input border px-4 py-3 transition-colors duration-[var(--dur-fast)]",
                  checked ? "border-primary bg-tone-violet-tint" : "border-border bg-card hover:bg-surface-sunken",
                )}
              >
                <input
                  id={id}
                  type="radio"
                  name={`${formId}-role`}
                  value={role}
                  checked={checked}
                  onChange={() => setForm((f) => ({ ...f, role }))}
                  className="mt-0.5 size-[18px] shrink-0 accent-[var(--primary)]"
                />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-[15px] font-semibold text-foreground">{t(ROLE_KEYS[role])}</span>
                  <span className="text-[13px] text-muted-foreground">{t(ROLE_HINT_KEYS[role])}</span>
                </span>
              </label>
            );
          })}
        </fieldset>
      </form>
    </Sheet>
  );
}
