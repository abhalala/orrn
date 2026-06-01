import { Button } from "@orrn/ui/components/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Printer } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { trpc } from "@/shared/utils/trpc";

import { LayoutSelectionDialog } from "./layout-selection-dialog";

export function BundlePrintButton({
  bundleId,
  label = "Print",
  size = "sm",
  variant = "outline",
}: {
  bundleId: string;
  label?: string;
  size?: "sm" | "default" | "lg";
  variant?: "default" | "outline" | "ghost";
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [profileId, setProfileId] = useState("");

  const profilesQuery = useQuery(trpc.spool.listProfiles.queryOptions());
  const profileOptions = useMemo(
    () =>
      (profilesQuery.data ?? [])
        .filter((profile) => profile.templateKind === "bundle")
        .map((profile) => ({
          label: `${profile.name} · ${profile.templateName}`,
          value: profile.id,
        })),
    [profilesQuery.data],
  );

  const printMutation = useMutation({
    ...trpc.spool.printBundleLabel.mutationOptions(),
    onSuccess: () => {
      toast.success("Label print submitted");
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: trpc.spool.listJobs.queryKey() });
    },
    onError: (error) => toast.error(error.message || "Failed to print label"),
  });

  return (
    <>
      <Button size={size} variant={variant} onClick={() => setOpen(true)}>
        <Printer className="mr-2 size-4" aria-hidden="true" />
        {label}
      </Button>
      <LayoutSelectionDialog
        open={open}
        onOpenChange={setOpen}
        title="Select label layout"
        profileOptions={profileOptions}
        profileId={profileId}
        onProfileIdChange={setProfileId}
        loading={printMutation.isPending || profilesQuery.isLoading}
        onConfirm={(layout) => {
          if (profileOptions.length > 0 && !profileId) {
            toast.error("Select a printer profile");
            return;
          }
          printMutation.mutate({ bundleId, profileId: profileId || undefined, layout });
        }}
      />
    </>
  );
}
