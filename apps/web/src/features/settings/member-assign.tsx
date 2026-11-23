import { useT } from "@orrn/i18n";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { serverRefusal } from "@/features/shared/server-refusal";
import { Can } from "@/shared/components/can";
import { MasterPicker, type MasterKind } from "@/shared/components/master-picker";
import { INLINE_ERROR_META } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";
import { useModuleOn } from "@/shared/lib/modules";

type Assignable = { id: string; departmentId?: string | null; designationId?: string | null };

/** The name of one master entry for people who may read but not change it. */
function MasterName({ kind, id }: { kind: MasterKind; id: string | null | undefined }) {
  const { t } = useT();
  const list = useQuery({ ...trpc.masters.lists.list.queryOptions({ kind }), meta: INLINE_ERROR_META, enabled: Boolean(id) });
  if (!id) return <span className="text-muted-foreground">{t("adm.floor.none")}</span>;
  return <span>{list.data?.find((m) => m.id === id)?.name ?? ""}</span>;
}

/**
 * Department and designation of one member (`masters.people.assign`, `users.manage`). Both ids go in
 * every save, so changing one keeps the other. People without `users.manage` read the names.
 */
function MemberAssignInner({ member, name }: { member: Assignable; name: string }) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const assign = useMutation({
    ...trpc.masters.people.assign.mutationOptions(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: trpc.company.membersList.queryKey() });
      toast.success(t("adm.floor.people.saved"));
    },
    onError: (e) => toast.error(serverRefusal(t, e)),
  });
  const departmentId = member.departmentId ?? null;
  const designationId = member.designationId ?? null;
  const readOnly = (
    <span className="flex min-w-0 flex-col gap-0.5 text-[14px]">
      <MasterName kind="department" id={departmentId} />
      <MasterName kind="designation" id={designationId} />
    </span>
  );
  return (
    <Can do="users.manage" fallback={readOnly}>
      <div className="flex min-w-0 flex-col gap-2 sm:min-w-[11rem]" data-testid="member-assign">
        <MasterPicker
          kind="department"
          value={departmentId}
          aria-label={`${t("adm.kindOne.department")}: ${name}`}
          disabled={assign.isPending}
          onChange={(next) => assign.mutate({ membershipId: member.id, departmentId: next, designationId })}
        />
        <MasterPicker
          kind="designation"
          value={designationId}
          aria-label={`${t("adm.kindOne.designation")}: ${name}`}
          disabled={assign.isPending}
          onChange={(next) => assign.mutate({ membershipId: member.id, departmentId, designationId: next })}
        />
      </div>
    </Can>
  );
}

/** PROD-GATE: renders (and asks the server) only with the opt-in `masters_plus` module on. */
export function MemberAssign(props: Parameters<typeof MemberAssignInner>[0]) {
  return useModuleOn("masters_plus") ? <MemberAssignInner {...props} /> : null;
}
