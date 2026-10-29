import { useT } from "@orrn/i18n";
import { breakpoints, useMediaQuery } from "@orrn/ui/hooks/use-media-query";
import { useEffect, useRef, useState } from "react";

import { BundleLabel } from "./bundle-label";
import { Hero } from "./hero";
import { PHOTOS, STAGE_PHOTO, STAGES, type Stage } from "./media";
import { StagePhoto } from "./stage-photo";

type Frame = "hero" | Stage;

/**
 * The hero and the seven-stage chain scroll in the left column while one
 * sticky frame on the right shows the stage in view: the furnace pour, then
 * scrap, billets, the die, the press, profiles, the label and the gate. On
 * phones each stage carries its own picture instead.
 */
export function Story() {
  const wide = useMediaQuery(breakpoints.desktop);
  const root = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<Frame>("hero");

  useEffect(() => {
    if (!wide || !root.current || typeof IntersectionObserver === "undefined") return;
    // A line across the middle of the viewport: whichever block it crosses owns the frame.
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive((entry.target as HTMLElement).dataset.frame as Frame);
        }
      },
      { rootMargin: "-50% 0px -50% 0px" },
    );
    root.current.querySelectorAll("[data-frame]").forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [wide]);

  return (
    <div ref={root} className="marketing-story">
      <div className="marketing-story-flow">
        <Hero wide={wide} />
        <Chain wide={wide} />
      </div>
      {wide ? <StageFrames active={active} /> : null}
    </div>
  );
}

function Chain({ wide }: { wide: boolean }) {
  const { t } = useT();
  return (
    <section id="flow" className="marketing-chain" aria-labelledby="flow-title">
      <div className="marketing-chain-intro" data-reveal>
        <h2 id="flow-title" className="marketing-heading">
          {t("marketing.chain.title")}
        </h2>
        <p className="marketing-lead">{t("marketing.chain.body")}</p>
      </div>
      <ol role="list" className="marketing-stages">
        {STAGES.map((stage) => (
          <li key={stage} data-frame={stage} data-flow-step={stage} className="marketing-stage">
            <div className="marketing-stage-copy" data-reveal>
              <h3 className="marketing-stage-name">{t(`marketing.chain.${stage}.name`)}</h3>
              <p className="marketing-lead">{t(`marketing.chain.${stage}.title`)}</p>
              <p className="marketing-stage-body">{t(`marketing.chain.${stage}.body`)}</p>
              <p className="marketing-stage-record">
                <i aria-hidden="true" />
                <span>
                  {t("marketing.chain.recorded")}: {t(`marketing.chain.${stage}.record`)}
                </span>
              </p>
            </div>
            {wide ? null : <StageMedia stage={stage} sizes="100vw" />}
          </li>
        ))}
      </ol>
    </section>
  );
}

function StageMedia({ stage, sizes }: { stage: Stage; sizes: string }) {
  const { t } = useT();
  if (stage === "pack") {
    return (
      <figure className="marketing-photo marketing-photo-label">
        <BundleLabel />
        <figcaption>{t("marketing.chain.pack.caption")}</figcaption>
      </figure>
    );
  }
  return (
    <StagePhoto
      photo={STAGE_PHOTO[stage]}
      sizes={sizes}
      alt={t(`marketing.chain.${stage}.alt`)}
      caption={t(`marketing.chain.${stage}.caption`)}
    />
  );
}

const FRAMES: readonly Frame[] = ["hero", ...STAGES];

function StageFrames({ active }: { active: Frame }) {
  const { t } = useT();
  // Mount each picture once the frame before it has shown, so the page does not fetch all eight at once.
  const [reached, setReached] = useState(0);
  const activeIndex = FRAMES.indexOf(active);
  if (activeIndex > reached) setReached(activeIndex);
  return (
    <div className="marketing-frames">
      <div className="marketing-frames-inner">
        {FRAMES.map((frame, index) => (
          <div
            key={frame}
            className="marketing-frame"
            data-frame-for={frame}
            data-active={frame === active}
            aria-hidden={frame !== active}
          >
            {index > Math.max(reached, activeIndex) + 1 ? null : frame === "hero" ? (
              <StagePhoto
                photo={PHOTOS.furnace}
                sizes="50vw"
                alt={t("marketing.chain.heroAlt")}
                caption={t("marketing.chain.heroCaption")}
                priority
              />
            ) : (
              <StageMedia stage={frame} sizes="50vw" />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
