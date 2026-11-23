/** Month pickers for the Tally file and the GST sales register, saved as files. */
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Field } from "@orrn/ui/components/field";
import { Select } from "@orrn/ui/components/select";
import { FileSpreadsheet, FileText } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { saveTextFile } from "@/shared/lib/exports";
import { trpcClient } from "@/shared/utils/trpc";

import { recentMonths } from "./model";
import { errorText, useToday } from "./ui";

export function ExportsCard() {
  const { t } = useT();
  const today = useToday();
  const months = recentMonths(today);
  const [month, setMonth] = useState(months[0]!);
  const [busy, setBusy] = useState<"tally" | "register" | null>(null);

  async function tally() {
    setBusy("tally");
    try {
      const r = await trpcClient.billing.export.tally.query({ month });
      if (r.count === 0) toast.message(t("bill.exports.nothing"));
      else {
        saveTextFile(r.fileName, r.xml, "application/xml");
        toast.success(t("bill.exports.saved", { count: r.count }));
      }
    } catch (e) {
      toast.error(errorText(e, t("errors.generic")));
    } finally {
      setBusy(null);
    }
  }

  async function register() {
    setBusy("register");
    try {
      const r = await trpcClient.billing.export.salesRegister.query({ month });
      if (r.count === 0) toast.message(t("bill.exports.nothing"));
      else {
        saveTextFile(r.fileName, r.csv, "text/csv");
        toast.success(t("bill.exports.saved", { count: r.count }));
      }
    } catch (e) {
      toast.error(errorText(e, t("errors.generic")));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-labelledby="bill-exports" className="flex min-w-0 flex-col gap-3 rounded-card border border-border bg-card p-4">
      <div>
        <h2 id="bill-exports" className="m-0 text-[15px] font-semibold">
          {t("bill.exports.title")}
        </h2>
        <p className="m-0 text-[13px] text-muted-foreground">{t("bill.exports.hint")}</p>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <Field label={t("bill.exports.month")} className="sm:w-56">
          <Select value={month} onValueChange={setMonth} options={months.map((m) => ({ value: m, label: m }))} placeholder={t("bill.exports.month")} />
        </Field>
        <Button variant="secondary" loading={busy === "tally"} onClick={() => void tally()}>
          <FileText aria-hidden="true" strokeWidth={2} />
          {t("bill.exports.tally")}
        </Button>
        <Button variant="secondary" loading={busy === "register"} onClick={() => void register()}>
          <FileSpreadsheet aria-hidden="true" strokeWidth={2} />
          {t("bill.exports.register")}
        </Button>
      </div>
    </section>
  );
}
