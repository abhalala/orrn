import { useT, type MessageKey } from "@orrn/i18n";
import { Link } from "@tanstack/react-router";
import type { CSSProperties, ReactNode } from "react";

import { DemoTag } from "./demo-tag";
import { ArrowIcon, PlusIcon, SectionHead } from "./hero";

type Crop = {
  sw: number;
  x: number;
  y: number;
  cw: number;
  ch: number;
  h: number;
};

function cropStyle(crop: Crop): CSSProperties {
  return {
    "--sw": crop.sw,
    "--x": crop.x,
    "--y": crop.y,
    "--cw": crop.cw,
    "--ch": crop.ch,
  } as CSSProperties;
}

function MarketingFigure({
  figureClassName,
  frameClassName,
  src,
  crop,
  captionKey,
  altKey,
  reveal = false,
}: {
  figureClassName: string;
  frameClassName: string;
  src: string;
  crop: Crop;
  captionKey?: MessageKey;
  altKey: MessageKey;
  reveal?: boolean;
}) {
  const { t } = useT();
  return (
    <figure
      className={figureClassName}
      data-demo-visual
      data-reveal={reveal ? "" : undefined}
    >
      <div className={frameClassName}>
        <div className="marketing-crop" style={cropStyle(crop)}>
          <img
            src={src}
            width={crop.sw}
            height={crop.h}
            alt={t(altKey)}
            loading="lazy"
          />
        </div>
      </div>
      <figcaption className="marketing-screen-caption">
        <DemoTag />
        {captionKey ? <span>{t(captionKey)}</span> : null}
      </figcaption>
    </figure>
  );
}

const REGISTERS = [
  { name: "marketing.record.kanta", place: "marketing.record.atKanta" },
  { name: "marketing.record.melt", place: "marketing.record.inFoundry" },
  { name: "marketing.record.press", place: "marketing.record.atPress" },
  { name: "marketing.record.die", place: "marketing.record.inDieRoom" },
  { name: "marketing.record.packing", place: "marketing.record.inOffice" },
] as const satisfies readonly { name: MessageKey; place: MessageKey }[];

const STAGES = [
  { step: "01", name: "marketing.record.scrap", code: "LOT-118" },
  { step: "02", name: "marketing.record.cast", code: "J14" },
  { step: "03", name: "marketing.record.dieCopy", code: "12170-1" },
  { step: "04", name: "marketing.record.pressStage", code: "PR-418" },
  { step: "05", name: "marketing.record.ageing", code: "AG-96" },
  { step: "06", name: "marketing.record.pack", code: "26J4086" },
  { step: "07", name: "marketing.record.dispatch", code: "DSP-000412" },
] as const satisfies readonly { step: string; name: MessageKey; code: string }[];

export function Record() {
  const { t } = useT();
  return (
    <section className="marketing-section" id="record" aria-labelledby="record-title">
      <div className="marketing-wrap">
        <SectionHead
          id="record-title"
          title={t("marketing.record.title")}
          body={t("marketing.record.body")}
        />
        <div className="marketing-record" data-reveal>
          <div className="marketing-record-panel">
            <h3>{t("marketing.record.oldTitle")}</h3>
            <p>{t("marketing.record.oldBody")}</p>
            <ul role="list" className="marketing-registers">
              {REGISTERS.map((row) => (
                <li key={row.name}>
                  <span>{t(row.name)}</span>
                  <span className="marketing-muted">{t(row.place)}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="marketing-record-panel">
            <h3>{t("marketing.record.newTitle")}</h3>
            <p>{t("marketing.record.newBody")}</p>
            <ol role="list" className="marketing-stages">
              {STAGES.map((stage) => (
                <li key={stage.step}>
                  <span className="marketing-code marketing-muted">{stage.step}</span>
                  <span>{t(stage.name)}</span>
                  <span className="marketing-code">{stage.code}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
        <p className="marketing-record-caption" data-reveal>
          {t("marketing.record.caption")}
        </p>
      </div>
    </section>
  );
}

const BENEFIT_CARDS = [
  {
    id: undefined,
    eyebrow: "marketing.benefits.dispatch.eyebrow",
    title: "marketing.benefits.dispatch.title",
    body: "marketing.benefits.dispatch.body",
    alt: "marketing.benefits.dispatch.alt",
    frameClassName: "marketing-phone-in",
    src: "/marketing/packer-dispatch-bundles-390.webp",
    crop: { sw: 390, x: 0, y: 96, cw: 390, ch: 640, h: 844 },
    showLanguages: false,
  },
  {
    id: undefined,
    eyebrow: "marketing.benefits.orders.eyebrow",
    title: "marketing.benefits.orders.title",
    body: "marketing.benefits.orders.body",
    alt: "marketing.benefits.orders.alt",
    frameClassName: "marketing-lap-in",
    src: "/marketing/owner-order-so7-1440.webp",
    crop: { sw: 1440, x: 320, y: 80, cw: 1100, ch: 620, h: 900 },
    showLanguages: false,
  },
  {
    id: undefined,
    eyebrow: "marketing.benefits.die.eyebrow",
    title: "marketing.benefits.die.title",
    body: "marketing.benefits.die.body",
    alt: "marketing.benefits.die.alt",
    frameClassName: "marketing-lap-in",
    src: "/marketing/dieroom-die-13090-1440.webp",
    crop: { sw: 1440, x: 320, y: 80, cw: 1100, ch: 620, h: 900 },
    showLanguages: false,
  },
  {
    id: "floor",
    eyebrow: "marketing.benefits.floor.eyebrow",
    title: "marketing.benefits.floor.title",
    body: "marketing.benefits.floor.body",
    alt: "marketing.benefits.floor.alt",
    frameClassName: "marketing-phone-in",
    src: "/marketing/packer-today-390.webp",
    crop: { sw: 390, x: 0, y: 140, cw: 390, ch: 640, h: 844 },
    showLanguages: true,
  },
] as const satisfies readonly {
  id?: string;
  eyebrow: MessageKey;
  title: MessageKey;
  body: MessageKey;
  alt: MessageKey;
  frameClassName: string;
  src: string;
  crop: Crop;
  showLanguages: boolean;
}[];

export function Benefits() {
  const { t } = useT();
  return (
    <section className="marketing-section" id="benefits" aria-labelledby="benefits-title">
      <div className="marketing-wrap">
        <SectionHead
          id="benefits-title"
          title={t("marketing.benefits.title")}
          body={t("marketing.benefits.body")}
        />
        <div className="marketing-bento">
          {BENEFIT_CARDS.map((card) => (
            <article key={card.title} id={card.id} className="marketing-card" data-reveal>
              <div className="marketing-card-text">
                <div className="marketing-eyebrow">
                  <span>{t(card.eyebrow)}</span>
                </div>
                <h3>{t(card.title)}</h3>
                <p>{t(card.body)}</p>
                {card.showLanguages ? (
                  <ul
                    role="list"
                    className="marketing-languages"
                    aria-label={t("marketing.benefits.floor.languagesLabel")}
                  >
                    <li className="marketing-chip" lang="en">
                      English
                    </li>
                    <li className="marketing-chip" lang="hi">
                      हिंदी
                    </li>
                    <li className="marketing-chip" lang="gu">
                      ગુજરાતી
                    </li>
                  </ul>
                ) : null}
              </div>
              <MarketingFigure
                figureClassName="marketing-card-visual"
                frameClassName={card.frameClassName}
                src={card.src}
                crop={card.crop}
                altKey={card.alt}
              />
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

const TAGLINE_LINES = [
  "marketing.tagline.line1",
  "marketing.tagline.line2",
  "marketing.tagline.line3",
  "marketing.tagline.line4",
] as const satisfies readonly MessageKey[];

export function Tagline() {
  const { t } = useT();
  return (
    <section
      className="marketing-tagline-wrap"
      id="tagline"
      aria-label={t("marketing.tagline.label")}
    >
      <div className="marketing-wrap">
        <p className="marketing-tagline" data-tagline>
          {TAGLINE_LINES.map((lineKey, lineIndex) => {
            const words = t(lineKey).split(/\s+/).filter(Boolean);
            return (
              <span key={lineKey} className="marketing-tagline-line">
                {words.map((word, wordIndex) => (
                  <span key={`${lineKey}-${wordIndex}`}>
                    {wordIndex > 0 ? " " : null}
                    <span data-tagline-word>{word}</span>
                  </span>
                ))}
                {lineIndex < TAGLINE_LINES.length - 1 ? " " : null}
              </span>
            );
          })}
        </p>
      </div>
    </section>
  );
}

const FLOW_STEPS = [
  {
    step: "press",
    number: "01",
    title: "marketing.flow.press.title",
    body: "marketing.flow.press.body",
    caption: "marketing.flow.press.caption",
    alt: "marketing.flow.press.alt",
    src: "/marketing/press-station-390.webp",
    crop: { sw: 390, x: 0, y: 56, cw: 390, ch: 640, h: 844 },
  },
  {
    step: "dispatch",
    number: "02",
    title: "marketing.flow.dispatch.title",
    body: "marketing.flow.dispatch.body",
    caption: "marketing.flow.dispatch.caption",
    alt: "marketing.flow.dispatch.alt",
    src: "/marketing/packer-scan-390.webp",
    crop: { sw: 390, x: 0, y: 204, cw: 390, ch: 640, h: 844 },
  },
  {
    step: "office",
    number: "03",
    title: "marketing.flow.office.title",
    body: "marketing.flow.office.body",
    caption: "marketing.flow.office.caption",
    alt: "marketing.flow.office.alt",
    src: "/marketing/packer-bundle-390.webp",
    crop: { sw: 390, x: 0, y: 56, cw: 390, ch: 640, h: 844 },
  },
] as const satisfies readonly {
  step: "press" | "dispatch" | "office";
  number: string;
  title: MessageKey;
  body: MessageKey;
  caption: MessageKey;
  alt: MessageKey;
  src: string;
  crop: Crop;
}[];

export function Flow() {
  const { t } = useT();
  return (
    <section className="marketing-section" id="flow" aria-labelledby="flow-title">
      <div className="marketing-wrap">
        <SectionHead
          id="flow-title"
          title={t("marketing.flow.title")}
          body={t("marketing.flow.body")}
        />
        <ol role="list" className="marketing-steps">
          {FLOW_STEPS.map((item) => (
            <li
              key={item.step}
              className="marketing-step"
              data-flow-step={item.step}
              data-reveal
            >
              <div className="marketing-step-rail" aria-hidden="true">
                <span className="marketing-step-number">{item.number}</span>
                <span className="marketing-step-line" />
              </div>
              <div className="marketing-step-body">
                <h3>{t(item.title)}</h3>
                <p>{t(item.body)}</p>
              </div>
              <MarketingFigure
                figureClassName="marketing-step-visual"
                frameClassName="marketing-step-shot"
                src={item.src}
                crop={item.crop}
                captionKey={item.caption}
                altKey={item.alt}
              />
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

const PROOF_FACTS = [
  { figure: "13", key: "marketing.proof.roles" },
  { figure: "41", key: "marketing.proof.actions" },
  { figure: "12", key: "marketing.proof.approvals" },
  { figure: "10", key: "marketing.proof.refusals" },
  { figure: "44", key: "marketing.proof.guides" },
  { figure: "3", key: "marketing.proof.languages" },
] as const satisfies readonly { figure: string; key: MessageKey }[];

export function Proof() {
  const { t } = useT();
  return (
    <section className="marketing-section" id="proof" aria-labelledby="proof-title">
      <div className="marketing-wrap">
        <div className="marketing-proof-grid">
          <div className="marketing-section-head" data-reveal style={{ marginBottom: 0 }}>
            <h2 id="proof-title">{t("marketing.proof.title")}</h2>
            <p>{t("marketing.proof.body")}</p>
          </div>
          <MarketingFigure
            figureClassName="marketing-screen"
            frameClassName="marketing-screen-frame"
            src="/marketing/owner-stock-1440.webp"
            crop={{ sw: 1440, x: 320, y: 20, cw: 1080, ch: 820, h: 900 }}
            captionKey="marketing.proof.caption"
            altKey="marketing.proof.alt"
            reveal
          />
          <dl className="marketing-facts" data-reveal>
            {PROOF_FACTS.map((fact) => (
              <div key={fact.key} className="marketing-fact">
                <dt>{fact.figure}</dt>
                <dd>{t(fact.key)}</dd>
              </div>
            ))}
          </dl>
        </div>
        <template id="testimonial-slot">
          <blockquote>
            <p>{"{{testimonial}}"}</p>
            <footer>{"{{name}}, {{role}}, {{plant}}"}</footer>
          </blockquote>
        </template>
      </div>
    </section>
  );
}

const FAQ_LEFT = [
  { q: "marketing.faq.q1.q", a: "marketing.faq.q1.a", open: true },
  { q: "marketing.faq.q2.q", a: "marketing.faq.q2.a", open: false },
  { q: "marketing.faq.q3.q", a: "marketing.faq.q3.a", open: false },
  { q: "marketing.faq.q4.q", a: "marketing.faq.q4.a", open: false },
  { q: "marketing.faq.q5.q", a: "marketing.faq.q5.a", open: false },
] as const satisfies readonly { q: MessageKey; a: MessageKey; open: boolean }[];

const FAQ_RIGHT = [
  { q: "marketing.faq.q6.q", a: "marketing.faq.q6.a", open: true },
  { q: "marketing.faq.q7.q", a: "marketing.faq.q7.a", open: false },
  { q: "marketing.faq.q8.q", a: "marketing.faq.q8.a", open: false },
  { q: "marketing.faq.q9.q", a: "marketing.faq.q9.a", open: false },
  { q: "marketing.faq.q10.q", a: "marketing.faq.q10.a", open: false },
] as const satisfies readonly { q: MessageKey; a: MessageKey; open: boolean }[];

export function Faq() {
  const { t } = useT();
  const renderColumn = (items: readonly { q: MessageKey; a: MessageKey; open: boolean }[]) => (
    <div className="marketing-faq-column">
      {items.map((item) => (
        <details key={item.q} className="marketing-faq" open={item.open}>
          <summary>
            <h3>{t(item.q)}</h3>
            <PlusIcon />
          </summary>
          <p className="marketing-faq-answer">{t(item.a)}</p>
        </details>
      ))}
    </div>
  );

  return (
    <section className="marketing-section" id="faq" aria-labelledby="faq-title">
      <div className="marketing-wrap">
        <SectionHead id="faq-title" title={t("marketing.faq.title")} />
        <div className="marketing-faq-grid" data-reveal>
          {renderColumn(FAQ_LEFT)}
          {renderColumn(FAQ_RIGHT)}
        </div>
      </div>
    </section>
  );
}

const KEEP_CARDS: readonly {
  title: MessageKey;
  body: MessageKey;
  icon: ReactNode;
}[] = [
  {
    title: "marketing.keep.old.title",
    body: "marketing.keep.old.body",
    icon: (
      <svg
        viewBox="0 0 256 256"
        fill="none"
        stroke="currentColor"
        strokeWidth="16"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M48 48h160v160H48z" />
        <path d="M96 48v160M48 104h160" />
      </svg>
    ),
  },
  {
    title: "marketing.keep.price.title",
    body: "marketing.keep.price.body",
    icon: (
      <svg
        viewBox="0 0 256 256"
        fill="none"
        stroke="currentColor"
        strokeWidth="16"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M128 24v208M176 72c0-22-21.5-40-48-40S80 50 80 72s21.5 32 48 40 48 18 48 40-21.5 40-48 40-48-18-48-40" />
      </svg>
    ),
  },
  {
    title: "marketing.keep.exports.title",
    body: "marketing.keep.exports.body",
    icon: (
      <svg
        viewBox="0 0 256 256"
        fill="none"
        stroke="currentColor"
        strokeWidth="16"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M128 32v136M72 112l56 56 56-56M40 208h176" />
      </svg>
    ),
  },
];

export function Keep() {
  const { t } = useT();
  return (
    <section className="marketing-section" id="keep" aria-labelledby="keep-title">
      <div className="marketing-wrap">
        <SectionHead id="keep-title" title={t("marketing.keep.title")} />
        <div className="marketing-keep">
          {KEEP_CARDS.map((card) => (
            <article key={card.title} className="marketing-keep-card" data-reveal>
              <div className="marketing-icon-box" aria-hidden="true">
                {card.icon}
              </div>
              <h3>{t(card.title)}</h3>
              <p>{t(card.body)}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

export function Close() {
  const { t } = useT();
  return (
    <section className="marketing-section" data-marketing-cta aria-labelledby="cta-title">
      <div className="marketing-wrap">
        <div className="marketing-close" data-reveal>
          <h2 id="cta-title">{t("marketing.close.title")}</h2>
          <p className="marketing-lead">{t("marketing.close.body")}</p>
          <div className="marketing-actions">
            <Link className="marketing-button" to="/request-access">
              {t("marketing.requestAccess")}
              <ArrowIcon />
            </Link>
            <Link className="marketing-text-link" to="/login">
              {t("marketing.signIn")}
            </Link>
          </div>
          <p className="marketing-helper">{t("marketing.close.helper")}</p>
        </div>
      </div>
    </section>
  );
}
