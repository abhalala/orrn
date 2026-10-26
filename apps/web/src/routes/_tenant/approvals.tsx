import type { ApprovalKind } from "@orrn/server/lib/permissions";
import { createFileRoute } from "@tanstack/react-router";

import { isApprovalKind, isApprovalStatus, type ApprovalStatus } from "@/features/approvals/approval-filter";
import { ApprovalsPage } from "@/features/approvals/approvals-page";

type ApprovalsSearch = { status?: Exclude<ApprovalStatus, "pending">; kind?: ApprovalKind };

export const Route = createFileRoute("/_tenant/approvals")({
  validateSearch: (search: Record<string, unknown>): ApprovalsSearch => ({
    ...(isApprovalStatus(search.status) && search.status !== "pending" ? { status: search.status } : {}),
    ...(isApprovalKind(search.kind) ? { kind: search.kind } : {}),
  }),
  component: ApprovalsRoute,
});

function ApprovalsRoute() {
  const { status, kind } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <ApprovalsPage
      status={status ?? "pending"}
      kind={kind}
      onChange={(next) =>
        navigate({
          search: {
            ...(next.status !== "pending" ? { status: next.status } : {}),
            ...(next.kind ? { kind: next.kind } : {}),
          },
          replace: true,
        })
      }
    />
  );
}
