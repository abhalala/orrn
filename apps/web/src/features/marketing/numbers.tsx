import { useT } from "@orrn/i18n";
import type { ReactNode } from "react";

import { DemoTag } from "./demo-tag";

/**
 * Two sums that check. Press run PR-418 is the spec's worked example: 234.2
 * over 310.4 is 75.5 %, and PR-418 is the code in the stage list. SO-1 line 2
 * is seed-true (dev-seed-orders.ts): 800 kg of angle ordered on the line,
 * nothing dispatched, so baki is 800 kg. The labels stay English because each
 * card is a picture of the app; the sr-only caption reads them in the page
 * language.
 */
type Row = { label: string; value: ReactNode; total?: true };

function SumCard({ head, rows }: { head: ReactNode; rows: readonly Row[] }) {
  return (
    <div className="marketing-shot marketing-sum" data-demo-visual aria-hidden="true" lang="en">
      <DemoTag />
      <p className="marketing-sum-head">{head}</p>
      <dl>
        {rows.map((row) => (
          <div key={row.label} data-total={row.total ? "" : undefined}>
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Code({ children }: { children: ReactNode }) {
  return <span className="marketing-code">{children}</span>;
}

const PRESS_RUN: readonly Row[] = [
  { label: "Billets in", value: <Code>310.4 kg</Code> },
  { label: "Good", value: <Code>234.2 kg</Code> },
  { label: "Recovery", value: <Code>75.5 %</Code>, total: true },
];

const ORDER_LINE: readonly Row[] = [
  { label: "Section", value: "Angle" },
  { label: "Due", value: <span className="marketing-nb">25 days late</span> },
  { label: "Baki", value: <Code>800 kg</Code>, total: true },
];

/** Numbers (#numbers): the server does the arithmetic; two sums and two rules. */
export function Numbers() {
  const { t } = useT();
  return (
    <section id="numbers" aria-labelledby="numbers-title" className="marketing-section">
      <div className="marketing-wrap marketing-grid">
        <div className="marketing-copy">
          <h2 id="numbers-title">{t("marketing.numbers.title")}</h2>
          <p>{t("marketing.numbers.body")}</p>
        </div>
        <div className="marketing-proof">
          <figure>
            <div className="marketing-sums">
              <SumCard
                head={
                  <>
                    Press run <Code>PR-418</Code>
                  </>
                }
                rows={PRESS_RUN}
              />
              <SumCard
                head={
                  <>
                    <Code>SO-1</Code> line 2
                  </>
                }
                rows={ORDER_LINE}
              />
            </div>
            <figcaption>
              {/* The sr-only line reads the two cards; the visible caption says how the sums are made and is read too. */}
              <span className="sr-only">{t("marketing.numbers.alt")}</span>
              <span>{t("marketing.numbers.caption")}</span>
            </figcaption>
          </figure>
          {/* Rules are div with h3 and p, never a heading inside dt. */}
          <div className="marketing-rules">
            <div>
              <h3>{t("marketing.numbers.rule1Title")}</h3>
              <p>{t("marketing.numbers.rule1")}</p>
            </div>
            <div>
              <h3>{t("marketing.numbers.rule2Title")}</h3>
              <p>{t("marketing.numbers.rule2")}</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
