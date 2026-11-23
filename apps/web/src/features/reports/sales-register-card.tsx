/** The dispatch sales register for one month, saved as a CSV (reports.salesRegisterCsv: reports.read or export.accounts). */
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Field } from "@orrn/ui/components/field";
import { Select } from "@orrn/ui/components/select";
import { companyToday } from "@orrn/server/lib/purchase";
import { FileSpreadsheet } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Can } from "@/shared/components/can";
import { useMe } from "@/shared/lib/me";
import { trpcClient } from "@/shared/utils/trpc";

import { recentMonths } from "../billing/model";
import { downloadCsv } from "../imports/templates";

export function SalesRegisterCard() {
  const { t } = useT();
  const { data: me } = useMe();
  const months = recentMonths(companyToday(me?.company?.settings ?? null, new Date()));
  const [month, setMonth] = useState(months[0]!);
  const [busy, setBusy] = useState(false);

  async function download() {
    setBusy(true);
    try {
      const r = await trpcClient.reports.salesRegisterCsv.query({ month });
      if (r.rows === 0) toast.message(t("reports.salesRegister.none"));
      else downloadCsv(r.filename, r.csv);
    } catch {
      toast.error(t("reports.downloadFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Can do={["reports.read", "export.accounts"]}>
      <section aria-labelledby="sales-register" className="flex min-w-0 flex-col gap-3 rounded-card border border-border bg-card p-4">
        <div>
          <h2 id="sales-register" className="m-0 text-[15px] font-semibold">
            {t("reports.salesRegister.title")}
          </h2>
          <p className="m-0 text-[13px] text-muted-foreground">{t("reports.salesRegister.hint")}</p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <Field label={t("reports.salesRegister.month")} className="sm:w-56">
            <Select value={month} onValueChange={setMonth} options={months.map((m) => ({ value: m, label: m }))} placeholder={t("reports.salesRegister.month")} />
          </Field>
          <Button variant="secondary" loading={busy} onClick={() => void download()}>
            <FileSpreadsheet aria-hidden="true" strokeWidth={2} />
            {t("reports.salesRegister.download")}
          </Button>
        </div>
      </section>
    </Can>
  );
}
