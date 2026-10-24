import { Badge } from "@orrn/ui/components/badge";
import { Button } from "@orrn/ui/components/button";
import { DataTable, type DataTableColumn } from "@orrn/ui/components/data-table";
import { Dialog } from "@orrn/ui/components/dialog";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Label } from "@orrn/ui/components/label";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Truncate } from "@orrn/ui/components/truncate";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { format } from "date-fns";
import { Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Can } from "@/shared/components/can";
import { requirePlatformAdmin } from "@/shared/lib/guards";
import { trpc } from "@/shared/utils/trpc";

export const Route = createFileRoute("/_platform/admin/waitlist")({
  component: AdminWaitlistComponent,
  beforeLoad: requirePlatformAdmin,
});

type WaitlistRow = {
  id: string;
  companyName: string;
  requesterName: string;
  requesterEmail: string;
  notes: string | null;
  createdAt: string | number | Date;
};

/** The approval email, returned so it can be sent by hand when email fails. */
type SignInDetails = {
  emailSent: boolean;
  emailError: string | null;
  to: string;
  requesterName: string;
  companyName: string;
  subject: string;
  text: string;
  link: string;
  expiresAt: string | number | Date;
};

const copyToClipboard = async (text: string, label: string) => {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  } catch {
    toast.error("Could not copy. Select the text and copy it instead.");
  }
};

function AdminWaitlistComponent() {
  const { data: requests, isLoading, refetch } = useQuery(trpc.platform.waitlistList.queryOptions());
  const awaiting = useQuery(trpc.platform.waitlistAwaitingSignIn.queryOptions());
  const pendingCount = requests?.length ?? 0;
  const [signIn, setSignIn] = useState<SignInDetails | null>(null);

  const approveMutation = useMutation({
    ...trpc.platform.waitlistApprove.mutationOptions(),
    onSuccess: (data) => {
      refetch();
      awaiting.refetch();
      const { signIn: details, signInError } = data;
      if (!details) {
        toast.warning(
          `Approved, but no sign-in link was made (${signInError}). Use "Get sign-in details" below to try again.`,
        );
      } else if (details.emailSent) {
        toast.success(`Approved. Sign-in email sent to ${details.to}`, {
          action: { label: "Show email", onClick: () => setSignIn(details) },
        });
      } else {
        toast.warning("Approved, but the email could not be sent. Copy the details instead.");
        setSignIn(details);
      }
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to approve request");
    },
  });

  const rejectMutation = useMutation({
    ...trpc.platform.waitlistReject.mutationOptions(),
    onSuccess: () => {
      toast.success("Access request rejected");
      refetch();
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to reject request");
    },
  });

  const detailsMutation = useMutation({
    ...trpc.platform.waitlistSignInDetails.mutationOptions(),
    onSuccess: (data) => setSignIn(data),
    onError: (error: any) => {
      toast.error(error.message || "Could not create sign-in details");
    },
  });

  const awaitingColumns: DataTableColumn<WaitlistRow>[] = [
    { id: "company", header: "Company", cell: (r) => <span className="font-medium">{r.companyName}</span>, flex: 2 },
    { id: "requester", header: "Owner", cell: (r) => r.requesterName },
    { id: "email", header: "Email", cell: (r) => r.requesterEmail, flex: 2 },
    {
      id: "actions",
      header: "",
      align: "right",
      cell: (r) => (
        <Can do="platform.waitlist.review">
          <Button
            size="sm"
            variant="outline"
            loading={detailsMutation.isPending && detailsMutation.variables?.id === r.id}
            disabled={detailsMutation.isPending}
            onPress={() => detailsMutation.mutate({ id: r.id })}
          >
            Get sign-in details
          </Button>
        </Can>
      ),
    },
  ];

  const columns: DataTableColumn<WaitlistRow>[] = [
    {
      id: "date",
      header: "Date",
      cell: (r) => format(new Date(r.createdAt), "MMM d, yyyy"),
    },
    {
      id: "company",
      header: "Company",
      cell: (r) => <span className="font-medium">{r.companyName}</span>,
      flex: 2,
    },
    { id: "requester", header: "Requester", cell: (r) => r.requesterName },
    { id: "email", header: "Email", cell: (r) => r.requesterEmail, flex: 2 },
    {
      id: "notes",
      header: "Notes",
      cell: (r) => (
        <span className="text-xs text-muted-foreground line-clamp-1 max-w-[280px]">
          {r.notes || "None"}
        </span>
      ),
      flex: 2,
    },
    {
      id: "actions",
      header: "",
      align: "right",
      cell: (r) => (
        <div className="flex gap-2">
          <Can do="platform.waitlist.review">
            <Button
              variant="destructive"
              size="sm"
              onClick={() => rejectMutation.mutate({ id: r.id })}
              disabled={rejectMutation.isPending || approveMutation.isPending}
            >
              Reject
            </Button>
            <Button
              size="sm"
              onClick={() => approveMutation.mutate({ id: r.id })}
              disabled={rejectMutation.isPending || approveMutation.isPending}
            >
              Approve
            </Button>
          </Can>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Godseye"
        title={
          <span className="flex flex-wrap items-center gap-3">
            Access requests
            {pendingCount > 0 ? <Badge tone="warning" size="md">{pendingCount} pending</Badge> : null}
          </span>
        }
        description="Review and approve companies asking for ORRN access."
        actions={
          <Button asChild variant="outline">
            <Link to="/admin">Back to console</Link>
          </Button>
        }
      />

      <DataTable
        rows={(requests ?? []) as WaitlistRow[]}
        rowKey={(r) => r.id}
        columns={columns}
        renderCard={(r) => (
          <div className="flex h-full min-w-0 flex-col gap-4 rounded-lg border border-border bg-card p-4 shadow-sm">
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <Truncate as="p" lines={2} className="m-0 text-base font-semibold text-foreground">
                  {r.companyName}
                </Truncate>
                <Truncate as="p" className="m-0 text-sm text-muted-foreground">
                  {r.requesterName}
                </Truncate>
                <Truncate as="p" className="m-0 text-sm text-muted-foreground">
                  {r.requesterEmail}
                </Truncate>
              </div>
              <span className="shrink-0 text-xs text-muted-foreground">
                {format(new Date(r.createdAt), "MMM d, yyyy")}
              </span>
            </div>
            <p className="m-0 line-clamp-3 break-words text-sm text-muted-foreground">{r.notes || "No notes provided."}</p>
            <div className="mt-auto grid grid-cols-2 gap-2 border-t border-border pt-3 sm:flex sm:justify-end">
              <Can do="platform.waitlist.review">
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => rejectMutation.mutate({ id: r.id })}
                  disabled={rejectMutation.isPending || approveMutation.isPending}
                >
                  Reject
                </Button>
                <Button
                  size="sm"
                  onClick={() => approveMutation.mutate({ id: r.id })}
                  disabled={rejectMutation.isPending || approveMutation.isPending}
                >
                  Approve
                </Button>
              </Can>
            </div>
          </div>
        )}
        isLoading={isLoading}
        emptyState={<EmptyState title="No pending requests" description="New access requests show up here." />}
      />

      {awaiting.data && awaiting.data.length > 0 ? (
        <section className="space-y-3">
          <div className="space-y-1">
            <h2 className="m-0 text-lg font-semibold">Approved, not signed in yet</h2>
            <p className="m-0 text-sm text-muted-foreground">
              If the email did not arrive, get a fresh sign-in link and send it yourself.
            </p>
          </div>
          <DataTable
            rows={awaiting.data as WaitlistRow[]}
            rowKey={(r) => r.id}
            columns={awaitingColumns}
            renderCard={(r) => (
              <div className="flex h-full min-w-0 flex-col gap-3 rounded-lg border border-border bg-card p-4 shadow-sm">
                <div className="min-w-0">
                  <Truncate as="p" lines={2} className="m-0 text-base font-semibold text-foreground">
                    {r.companyName}
                  </Truncate>
                  <Truncate as="p" className="m-0 text-sm text-muted-foreground">
                    {r.requesterName}
                  </Truncate>
                  <Truncate as="p" className="m-0 text-sm text-muted-foreground">
                    {r.requesterEmail}
                  </Truncate>
                </div>
                <Can do="platform.waitlist.review">
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-auto"
                    loading={detailsMutation.isPending && detailsMutation.variables?.id === r.id}
                    disabled={detailsMutation.isPending}
                    onPress={() => detailsMutation.mutate({ id: r.id })}
                  >
                    Get sign-in details
                  </Button>
                </Can>
              </div>
            )}
          />
        </section>
      ) : null}

      <Dialog
        open={signIn !== null}
        maxWidth={640}
        onOpenChange={(open) => {
          if (!open) setSignIn(null);
        }}
        title={signIn?.emailSent ? "Sign-in email sent" : "Email could not be sent"}
        description={
          signIn
            ? `Send this to ${signIn.requesterName} on WhatsApp or from your own email. The link works once and expires ${format(new Date(signIn.expiresAt), "d MMM yyyy, h:mm a")}.`
            : undefined
        }
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onPress={() => setSignIn(null)}>
              Done
            </Button>
            <Button onPress={() => signIn && copyToClipboard(signIn.text, "Message")}>
              <Copy className="size-4" />
              Copy message
            </Button>
          </div>
        }
      >
        {signIn ? (
          <div className="flex flex-col gap-3">
            {signIn.emailError ? (
              <p className="m-0 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-foreground">
                {signIn.emailError}
              </p>
            ) : null}
            <CopyField label="To" value={signIn.to} />
            <CopyField label="Subject" value={signIn.subject} />
            <CopyField label="Sign-in link" value={signIn.link} mono />
            <div className="flex flex-col gap-1">
              <Label htmlFor="signin-message">Message</Label>
              <textarea
                id="signin-message"
                readOnly
                value={signIn.text}
                rows={10}
                onFocus={(e) => e.currentTarget.select()}
                className="w-full resize-y rounded-md border border-border bg-muted px-3 py-2 text-sm leading-6"
              />
            </div>
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}

function CopyField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <Label>{label}</Label>
      <div className="flex min-w-0 items-start gap-2">
        <code
          className={`min-w-0 flex-1 break-all rounded-md border border-border bg-muted px-2 py-1 text-sm ${mono ? "font-mono text-xs" : "font-sans"}`}
        >
          {value}
        </code>
        <Button
          size="sm"
          variant="outline"
          className="shrink-0"
          aria-label={`Copy ${label.toLowerCase()}`}
          onPress={() => copyToClipboard(value, label)}
        >
          <Copy className="size-3" />
        </Button>
      </div>
    </div>
  );
}
