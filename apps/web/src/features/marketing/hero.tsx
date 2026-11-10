import { useT } from "@orrn/i18n";
import { Link } from "@tanstack/react-router";
import type { CSSProperties, ReactNode } from "react";

import { DemoTag } from "./demo-tag";

type Crop = { sw: number; x: number; y: number; cw: number; ch: number; h: number };

function cropStyle(crop: Crop) {
  return {
    "--sw": crop.sw,
    "--x": crop.x,
    "--y": crop.y,
    "--cw": crop.cw,
    "--ch": crop.ch,
  } as CSSProperties;
}

export function ArrowIcon() {
  return (
    <svg viewBox="0 0 256 256" fill="none" stroke="currentColor" strokeWidth="16" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M40 128h176M144 56l72 72-72 72" />
    </svg>
  );
}

function CropImage({ crop, src, alt, darkSrc, eager = false }: { crop: Crop; src: string; alt: string; darkSrc?: string; eager?: boolean }) {
  const image = (source: string, className: string) => (
    <img
      className={className}
      src={source}
      width={crop.sw}
      height={crop.h}
      alt={alt}
      loading={eager ? "eager" : "lazy"}
      fetchPriority={eager ? "high" : "auto"}
    />
  );
  return (
    <div className="marketing-crop" style={cropStyle(crop)}>
      {image(src, darkSrc ? "marketing-only-light" : "")}
      {darkSrc ? image(darkSrc, "marketing-only-dark") : null}
    </div>
  );
}

export function RequestAccessLink({ className = "marketing-button" }: { className?: string }) {
  const { t } = useT();
  return (
    <Link className={className} to="/request-access">
      {t("marketing.requestAccess")}
      <ArrowIcon />
    </Link>
  );
}

export function SignInLink() {
  const { t } = useT();
  return <Link className="marketing-text-link" to="/login">{t("marketing.signIn")}</Link>;
}

function HeroVisual() {
  const { t } = useT();
  return (
    <figure className="marketing-hero-stage" data-demo-visual>
      <div className="marketing-laptop">
        <CropImage
          crop={{ sw: 1440, x: 0, y: 138, cw: 1440, ch: 674, h: 900 }}
          src="/marketing/owner-today-1440.webp"
          darkSrc="/marketing/owner-today-dark-1440.webp"
          alt={t("marketing.hero.alt")}
          eager
        />
      </div>
      <div className="marketing-phone">
        <CropImage
          crop={{ sw: 390, x: 0, y: 56, cw: 390, ch: 788, h: 844 }}
          src="/marketing/packer-dispatch-build-390.webp"
          alt={t("marketing.benefits.dispatch.alt")}
          eager
        />
      </div>
      <figcaption className="marketing-screen-caption">
        <DemoTag />
        <span>{t("marketing.hero.caption")}</span>
      </figcaption>
    </figure>
  );
}

export function Hero() {
  const { t } = useT();
  return (
    <section data-marketing-hero aria-labelledby="hero-title" className="marketing-hero">
      <div className="marketing-wrap marketing-hero-copy">
        <h1 id="hero-title">
          <span className="marketing-hero-line">{t("marketing.hero.line1")}</span>{" "}
          <span className="marketing-hero-line">{t("marketing.hero.line2")}</span>{" "}
          <span className="marketing-hero-line">{t("marketing.hero.line3")}</span>
        </h1>
        <p className="marketing-hero-sub">{t("marketing.hero.sub")}</p>
        <div className="marketing-actions">
          <span id="hero-cta"><RequestAccessLink /></span>
          <SignInLink />
        </div>
        <p className="marketing-helper">{t("marketing.hero.helper")}</p>
        <div className="marketing-proof-line">
          <span className="marketing-proof-figure">{t("marketing.hero.proofFigure")}</span>
          <p>{t("marketing.hero.proof")}</p>
        </div>
      </div>
      <div className="marketing-wrap"><HeroVisual /></div>
    </section>
  );
}

export function SectionHead({ title, body, id }: { title: string; body?: string; id: string }) {
  return (
    <div className="marketing-section-head" data-reveal>
      <h2 id={id}>{title}</h2>
      {body ? <p>{body}</p> : null}
    </div>
  );
}

export function PlusIcon(): ReactNode {
  return (
    <svg viewBox="0 0 256 256" fill="none" stroke="currentColor" strokeWidth="16" strokeLinecap="round" aria-hidden="true">
      <path d="M40 128h176M128 40v176" />
    </svg>
  );
}
