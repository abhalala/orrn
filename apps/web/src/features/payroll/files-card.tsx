/** Bank sheet, EPF ECR file and ESIC sheet from an approved run: made on click, saved as files, with the people left out named. */
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Banknote, FileSpreadsheet, FileText } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { saveTextFile } from "@/shared/lib/exports";
import { trpcClient } from "@/shared/utils/trpc";

import { rs } from "./explain";
import { codesText } from "./model";
import { errorText } from "./ui";

type Kind = "bank" | "ecr" | "esic";
type Result = { name: string; missing: string[]; facts: string | null };

export function FilesCard({ runId }: { runId: string }) {
  const { t } = useT();
  const [busy, setBusy] = useState<Kind | null>(null);
  const [results, setResults] = useState<Partial<Record<Kind, Result>>>({});

  async function make(kind: Kind) {
    setBusy(kind);
    try {
      let name: string;
      let missing: string[];
      let facts: string | null = null;
      let empty = false;
      if (kind === "bank") {
        const r = await trpcClient.payroll.files.bank.query({ runId });
        name = r.filename;
        missing = r.missing;
        empty = r.csv.trim().split("\n").length <= 1;
        if (!empty) saveTextFile(r.filename, r.csv, "text/csv");
      } else if (kind === "ecr") {
        const r = await trpcClient.payroll.files.ecr.query({ runId });
        name = r.filename;
        missing = r.missing;
        empty = r.members === 0;
        facts = t("payroll.files.ecrFacts", { count: r.members, admin: rs(r.adminPaise), edli: rs(r.edliPaise) });
        if (!empty) saveTextFile(r.filename, r.text, "text/plain");
      } else {
        const r = await trpcClient.payroll.files.esic.query({ runId });
        name = r.filename;
        missing = r.missing;
        empty = r.members === 0;
        facts = t("payroll.files.esicFacts", { count: r.members });
        if (!empty) saveTextFile(r.filename, r.csv, "text/csv");
      }
      setResults((prev) => ({ ...prev, [kind]: { name, missing, facts } }));
      if (empty) toast.message(t("payroll.files.nothing", { name }));
      else toast.success(t("payroll.files.saved", { name }));
    } catch (e) {
      toast.error(errorText(e, t("payroll.files.failed")));
    } finally {
      setBusy(null);
    }
  }

  const missingKey = { bank: "payroll.files.missingBank", ecr: "payroll.files.missingEcr", esic: "payroll.files.missingEsic" } as const;
  const shown = (["bank", "ecr", "esic"] as Kind[]).flatMap((k) => (results[k] ? [[k, results[k]!] as const] : []));

  return (
    <section aria-labelledby="pay-files" className="flex min-w-0 flex-col gap-3 rounded-card border border-border bg-card p-4">
      <div>
        <h2 id="pay-files" className="m-0 text-[15px] font-semibold">
          {t("payroll.files.title")}
        </h2>
        <p className="m-0 text-[13px] text-muted-foreground">{t("payroll.files.hint")}</p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button variant="secondary" loading={busy === "bank"} onClick={() => void make("bank")}>
          <Banknote aria-hidden="true" strokeWidth={2} />
          {t("payroll.files.bank")}
        </Button>
        <Button variant="secondary" loading={busy === "ecr"} onClick={() => void make("ecr")}>
          <FileText aria-hidden="true" strokeWidth={2} />
          {t("payroll.files.ecr")}
        </Button>
        <Button variant="secondary" loading={busy === "esic"} onClick={() => void make("esic")}>
          <FileSpreadsheet aria-hidden="true" strokeWidth={2} />
          {t("payroll.files.esic")}
        </Button>
      </div>
      {shown.length > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-live="polite">
          {shown.map(([k, r]) => (
            <li key={k} className="flex flex-col gap-0.5 text-[13px]">
              <span className="font-medium">{r.name}</span>
              {r.facts ? <span className="text-muted-foreground">{r.facts}</span> : null}
              {r.missing.length > 0 ? (
                <span role="alert" className="text-destructive">
                  {t("payroll.files.leftOut")}. {t(missingKey[k], { codes: codesText(r.missing) })}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
