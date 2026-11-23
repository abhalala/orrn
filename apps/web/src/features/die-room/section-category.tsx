import { useT } from "@orrn/i18n";
import { Field } from "@orrn/ui/components/field";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { MasterPicker } from "@/shared/components/master-picker";
import { trpc } from "@/shared/utils/trpc";

import { useRefusal } from "./use-die-room";

/** The section's die category (sets the expected life on its copies). The caller gates it with `<Can>`. */
export function SectionCategory({ sectionId, current }: { sectionId: string; current: string | null }) {
  const { t } = useT();
  const refusal = useRefusal();
  const queryClient = useQueryClient();
  const set = useMutation({
    ...trpc.toolRoom.sections.setCategory.mutationOptions(),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: trpc.die.pathKey() }),
        queryClient.invalidateQueries({ queryKey: trpc.toolRoom.pathKey() }),
      ]);
      toast.success(t("adm.floor.section.categorySaved"));
    },
    onError: (e) => toast.error(refusal(e)),
  });
  return (
    <div className="max-w-sm" data-testid="section-category">
      <Field label={t("adm.floor.section.category")} hint={t("adm.floor.section.categoryHint")}>
        <MasterPicker
          kind="die_category"
          value={current}
          disabled={set.isPending}
          onChange={(categoryId) => set.mutate({ sectionId, categoryId })}
        />
      </Field>
    </div>
  );
}
