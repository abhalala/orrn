/** One payslip with every line named and every statutory figure explained in words, and a Print button (A4, in the viewer's language). */
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Dialog } from "@orrn/ui/components/dialog";
import type { SlipFigures } from "@orrn/server/lib/hr/payroll";
import { Printer } from "lucide-react";
import { useMemo } from "react";
import { toast } from "sonner";

import { paperHtml, payslipPaperModel, printHtml } from "@/shared/lib/payslipPaper";
import { useMe } from "@/shared/lib/me";

import { monthName, slipView, type SlipLine } from "./explain";
import { Rupees } from "./ui";

function Table({ heading, lines }: { heading: string; lines: SlipLine[] }) {
  return (
    <section className="flex min-w-0 flex-col gap-1">
      <h3 className="m-0 text-[13px] font-semibold text-muted-foreground">{heading}</h3>
      <ul className="m-0 flex list-none flex-col divide-y divide-border p-0">
        {lines.map((l, i) => (
          <li key={`${l.name}-${i}`} className="flex flex-col gap-0.5 py-2">
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 break-words text-[14px]">{l.name}</span>
              <Rupees paise={l.paise} className="text-[14px]" />
            </div>
            {l.why ? <span className="text-[12px] leading-5 text-muted-foreground">{l.why}</span> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The body of a payslip: used by the run screen's dialog and by `/me`. */
export function SlipBody({ figures }: { figures: SlipFigures }) {
  const { t } = useT();
  const v = useMemo(() => slipView(t, figures), [t, figures]);
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <p className="m-0 text-[13px] text-muted-foreground">
        {figures.person.code} {figures.person.name} · {monthName(t, figures.month)}
      </p>
      <Table heading={t("payroll.payslip.earnings")} lines={v.earnings} />
      <div className="flex items-baseline justify-between gap-3 border-t border-border pt-2 text-[14px] font-semibold">
        <span>{t("payroll.payslip.gross")}</span>
        <Rupees paise={figures.grossPaise} />
      </div>
      <Table heading={t("payroll.payslip.deductions")} lines={v.deductions} />
      <div className="flex items-baseline justify-between gap-3 border-t border-border pt-2 text-[14px] font-semibold">
        <span>{t("payroll.payslip.totalDeductions")}</span>
        <Rupees paise={figures.totalDeductionsPaise} />
      </div>
      <div className="flex items-baseline justify-between gap-3 rounded-card border border-border bg-muted/40 px-3 py-2 text-[16px] font-semibold">
        <span>{t("payroll.payslip.net")}</span>
        <Rupees paise={figures.netPaise} />
      </div>
      {v.employer.length > 0 ? <Table heading={t("payroll.payslip.employer")} lines={v.employer} /> : null}
      <ul className="m-0 flex list-disc flex-col gap-0.5 pl-5 text-[12px] leading-5 text-muted-foreground">
        {v.notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </div>
  );
}

/** Opens the print page of a payslip. Shared by the run dialog and `/me`. */
export function usePrintPayslip(): (figures: SlipFigures) => void {
  const { t, locale } = useT();
  const { data: me } = useMe();
  return (figures) => {
    try {
      printHtml(paperHtml(payslipPaperModel(t, figures, locale, me?.company ? { name: me.company.name } : null)));
    } catch {
      toast.error(t("payroll.slip.printFailed"));
    }
  };
}

export function SlipDialog({ figures, onClose }: { figures: SlipFigures | null; onClose: () => void }) {
  const { t } = useT();
  const print = usePrintPayslip();
  return (
    <Dialog
      open={figures !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t("payroll.slip.title")}
      maxWidth={640}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("payroll.slip.close")}
          </Button>
          <Button onClick={() => figures && print(figures)}>
            <Printer aria-hidden="true" strokeWidth={2} />
            {t("payroll.slip.print")}
          </Button>
        </>
      }
    >
      {figures ? <SlipBody figures={figures} /> : null}
    </Dialog>
  );
}
