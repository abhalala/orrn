import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import type { ReactNode } from "react";

import { INLINE_ERROR_META } from "@/shared/lib/query-errors";
import { trpcClient } from "@/shared/utils/trpc";

import { shortDate } from "./die-room-model";
import { kgText, sectionLabel, shareFailure, wallText } from "./share-model";

/** The drawing link lives 10 minutes; come back before it dies (focus after 8 minutes asks again). */
const FRESH_MS = 8 * 60 * 1000;

/**
 * What a party sees from a die share link: the section number, the press drawing, the weight band
 * and the best tier, and the owner when the link is for the owner. No sign-in. An unknown, revoked or
 * expired link is one neutral page. Costs, stock and customers are not in the answer at all.
 */
export function DieSharePage({ token }: { token: string }) {
  const { t } = useT();
  const view = useQuery({
    queryKey: ["die-share-view", token],
    queryFn: () => trpcClient.die.share.view.mutate({ token }),
    retry: false,
    staleTime: FRESH_MS,
    gcTime: 0,
    refetchOnWindowFocus: true,
    meta: INLINE_ERROR_META,
  });

  if (view.isPending) {
    return (
      <Frame>
        <div aria-busy="true" className="flex flex-col gap-4">
          <span className="sr-only">{t("common.loading")}</span>
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="h-40 rounded-card" />
        </div>
      </Frame>
    );
  }
  if (!view.data) {
    const failure = shareFailure(view.error);
    return (
      <Frame>
        <div role="status" className="flex flex-col gap-3" data-testid={`share-${failure}`}>
          <h1 className="m-0 font-display text-[28px] leading-tight font-extrabold tracking-[-0.03em]">
            {t(failure === "gone" ? "dieRoom.share.page.goneTitle" : failure === "busy" ? "dieRoom.share.page.busyTitle" : "dieRoom.share.page.errorTitle")}
          </h1>
          <p className="m-0 text-[17px] leading-7 text-muted-foreground">
            {t(failure === "gone" ? "dieRoom.share.page.goneBody" : failure === "busy" ? "dieRoom.share.page.busyBody" : "dieRoom.share.page.errorBody")}
          </p>
          {failure === "gone" ? null : (
            <div>
              <Button variant="secondary" onClick={() => view.refetch()}>
                {t("common.retry")}
              </Button>
            </div>
          )}
        </div>
      </Frame>
    );
  }

  const { section, bands, drawing, owner, tier, from, expiresAt } = view.data;
  const [main, ...others] = bands;
  const wall = wallText(main?.wallTenthMm);
  const alloy = [section.alloy, section.temper].filter(Boolean).join(" ");
  return (
    <Frame from={from}>
      <article className="flex min-w-0 flex-col gap-6" data-testid="share-page">
        <header className="flex min-w-0 flex-col gap-1">
          <p className="m-0 text-[14px] font-medium text-muted-foreground">{t("dieRoom.share.page.sharedBy", { name: from })}</p>
          <p className="m-0 text-[13px] font-medium text-muted-foreground">{t("dieRoom.share.page.sectionNo")}</p>
          <h1 className="m-0 break-words font-mono text-[34px] leading-tight font-semibold" data-testid="share-section">
            {section.sectionCode}
          </h1>
          <p className="m-0 text-[17px] leading-6 text-muted-foreground" data-testid="share-series">
            {[section.series, section.name].filter(Boolean).join(" · ")}
          </p>
        </header>

        <section aria-labelledby="share-drawing" className="flex min-w-0 flex-col gap-3 rounded-card border border-border bg-card p-4">
          <h2 id="share-drawing" className="m-0 text-[17px] leading-6 font-semibold">
            {t("dieRoom.share.page.drawing")}
          </h2>
          {drawing ? (
            <>
              <Button asChild size="lg" className="self-start">
                <a href={drawing.url} target="_blank" rel="noreferrer noopener" data-testid="share-drawing">
                  <FileText aria-hidden="true" strokeWidth={2} />
                  {t("dieRoom.share.page.openDrawing")}
                </a>
              </Button>
              {drawing.filename ? <p className="m-0 font-mono text-[13px] break-all text-muted-foreground">{drawing.filename}</p> : null}
              <p className="m-0 text-[14px] leading-6 text-muted-foreground">{t("dieRoom.share.page.notToScale")}</p>
            </>
          ) : (
            <p className="m-0 text-[15px] text-muted-foreground" data-testid="share-no-drawing">
              {t("dieRoom.share.page.noDrawing")}
            </p>
          )}
        </section>

        <dl className="m-0 grid grid-cols-1 gap-4 sm:grid-cols-2" data-testid="share-facts">
          <Fact label={t("dieRoom.share.page.weight")}>
            <span className="font-mono tabular-nums" data-testid="share-weight">
              {kgText(main?.weightMinG ?? 0)} to {kgText(main?.weightMaxG ?? 0)} {t("units.kgPer12ft")}
            </span>
            {others.map((b, i) => (
              <span key={i} className="block font-mono text-[14px] font-medium tabular-nums text-muted-foreground">
                {kgText(b.weightMinG)} to {kgText(b.weightMaxG)} {t("units.kgPer12ft")}
                {wallText(b.wallTenthMm) ? ` · ${wallText(b.wallTenthMm)} ${t("units.mm")}` : ""}
              </span>
            ))}
          </Fact>
          {wall ? (
            <Fact label={t("dieRoom.share.page.wall")}>
              <span className="font-mono tabular-nums">
                {wall} {t("units.mm")}
              </span>
            </Fact>
          ) : null}
          {alloy ? <Fact label={t("dieRoom.share.page.alloy")}>{alloy}</Fact> : null}
          {tier != null ? (
            <Fact label={t("dieRoom.share.page.tier")}>
              <span data-testid="share-tier">{t("dieRoom.copies.tier", { rank: tier })}</span>
            </Fact>
          ) : null}
          {owner ? (
            <Fact label={t("dieRoom.share.page.owner")}>
              <span data-testid="share-owner">{owner}</span>
            </Fact>
          ) : null}
        </dl>

        <p className="m-0 text-[13px] leading-5 text-muted-foreground">{t("dieRoom.share.page.openUntil", { date: shortDate(expiresAt) })}</p>
        <span className="sr-only">{sectionLabel(section)}</span>
      </article>
    </Frame>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-[13px] font-medium text-muted-foreground">{label}</dt>
      <dd className="m-0 min-w-0 text-[17px] font-semibold break-words">{children}</dd>
    </div>
  );
}

function Frame({ children, from }: { children: ReactNode; from?: string }) {
  const { t } = useT();
  return (
    <main className="mx-auto flex min-h-[100dvh] w-full max-w-xl flex-col gap-8 px-4 py-10 text-foreground">
      <p className="m-0 font-display text-[22px] font-extrabold tracking-[-0.03em]">{from ?? t("common.appName")}</p>
      {children}
    </main>
  );
}
