import { useT } from "@orrn/i18n";
import type { ReactNode } from "react";

import { BundleQr } from "./bundle-label";
import { DEMO_TRACE } from "./demo-data";
import { DemoLabel } from "./demo-label";

type Job = "foundry" | "dieRoom" | "planner" | "operator" | "packer" | "gate" | "owner";
type Fill = "paper" | "surface" | "deep" | "accent";

const TILES: readonly { id: Job; fill: Fill }[] = [
  { id: "foundry", fill: "surface" },
  { id: "dieRoom", fill: "deep" },
  { id: "planner", fill: "surface" },
  { id: "operator", fill: "deep" },
  { id: "packer", fill: "paper" },
  { id: "gate", fill: "accent" },
  { id: "owner", fill: "surface" },
];

/**
 * A board of close-ups, one per job on the floor: each tile crops a piece of
 * the screen that job uses, enlarged, with what gets easier for that job.
 */
export function Floor() {
  const { t } = useT();
  const closeUps: Record<Job, ReactNode> = {
    foundry: (
      <span className="marketing-ui-chip">
        <small>{t("marketing.floor.ui.heat")}</small>
        <b>{DEMO_TRACE.heat}</b>
        <span>
          <i data-tone="green" />
          {t("marketing.floor.ui.alloyCheck")}
        </span>
      </span>
    ),
    dieRoom: (
      <span className="marketing-ui-readout">
        <b>{DEMO_TRACE.die}</b>
        <span>1.655 {t("marketing.floor.ui.perLength")}</span>
      </span>
    ),
    planner: (
      <span className="marketing-ui-readout">
        <small>{t("marketing.floor.ui.baki")}</small>
        <b>1,840 kg</b>
      </span>
    ),
    operator: (
      <span className="marketing-ui-stepper">
        <small>{t("marketing.floor.ui.billets")}</small>
        <span>
          <i>−</i>
          <b>38</b>
          <i>+</i>
        </span>
      </span>
    ),
    packer: <BundleQr className="marketing-ui-qr" />,
    gate: (
      <span className="marketing-ui-status">
        <i />
        <b>{t("marketing.floor.ui.scanned")}</b>
        <span>{t("marketing.floor.ui.scanCount")}</span>
      </span>
    ),
    owner: (
      <span className="marketing-ui-readout">
        <small>{t("marketing.floor.ui.recovery")}</small>
        <b>84.2%</b>
      </span>
    ),
  };

  return (
    <section id="floor" className="marketing-floor" aria-labelledby="floor-title">
      <ul role="list" className="marketing-board">
        <li className="marketing-tile" data-tile="intro" data-fill="paper" data-reveal>
          <h2 id="floor-title" className="marketing-heading">
            {t("marketing.floor.title")}
          </h2>
          <p>{t("marketing.floor.body")}</p>
          <DemoLabel />
        </li>
        {TILES.map((tile) => (
          <li key={tile.id} className="marketing-tile" data-tile={tile.id} data-fill={tile.fill} data-reveal>
            <span data-ui aria-hidden="true" className="marketing-tile-ui">
              {closeUps[tile.id]}
            </span>
            <div className="marketing-tile-copy">
              <h3>{t(`marketing.floor.${tile.id}.role`)}</h3>
              <p className="marketing-tile-claim">{t(`marketing.floor.${tile.id}.title`)}</p>
              <p>{t(`marketing.floor.${tile.id}.body`)}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
