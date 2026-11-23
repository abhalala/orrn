/**
 * XE parity lane REG (`reg.*`): registers and views, complaints, the owner's morning page and its mail
 * setting, the billet need on the press plan and the order status line. Office screens only: not a
 * Gujarati floor namespace and never a public key. Keep `hi.ts` in the same shape.
 */
import { regComplaintsEn } from "./complaints.en";
import { regReportsEn } from "./reports.en";

export const regEn = {
  reports: regReportsEn,
  complaints: regComplaintsEn,
  /** Where an order line's kg sits (#32): the stage words of the WIP register and the portal's status line. */
  stage: {
    notPlanned: "Not planned",
    planned: "Planned",
    onPress: "On the press",
    ageing: "Ageing",
    unpacked: "Waiting to pack",
    packed: "Packed",
    dispatched: "Dispatched",
    over: "Over",
    statusLine: "Status",
  },
  /** The owner's page (#81) and the morning mail setting (#82). */
  owner: {
    title: "Owner",
    subtitle: "Yesterday at the plant, the same figures as the morning mail.",
    day: "Production day {day}",
    pickDay: "Day",
    pressed: "Pressed",
    pressedBody: "{runs} {runs:run|runs}",
    trials: "Trials {kg}",
    recovery: "Recovery",
    noRuns: "No runs",
    downtime: "Downtime",
    downtimeMin: "{min} min",
    noDowntime: "No downtime",
    dispatched: "Dispatched",
    dispatchedBody: "{count} {count:load|loads}",
    baki: "Open baki",
    bakiBody: "{count} order {count:line|lines}",
    failedCasts: "Casts with failed spectro",
    noFailedCasts: "None",
    loadFailed: "Could not load the figures.",
    noAccess: "This page is for the owner and the plant admin.",
    mailTitle: "Morning summary by email",
    mailHint: "Each morning orrn emails these figures to the owner and the plant admins, at the hour you pick, plant time.",
    mailOn: "Send the morning summary",
    mailHour: "Hour",
    mailHourValue: "{hour}:00",
    mailSave: "Save",
    mailSaved: "Saved",
    mailFailed: "Could not save. Try again.",
  },
  /** The billet need on the press plan (#49). */
  billet: {
    title: "Billets for this plan",
    hint: "Billet weight = plan weight divided by the die's own recovery from its logged runs.",
    alloy: "Alloy",
    length: "Billet length",
    needKg: "Billets needed",
    count: "Billets",
    stockKg: "In stock",
    noAlloy: "No alloy",
    unknownLength: "Length not known",
    recoveryDie: "Die recovery {pct}",
    recoveryPlant: "Plant recovery {pct}, the die has no logged run",
    recoveryDefault: "Default {pct}, no logged runs yet",
    ready: "Ready",
    dieNotReady: "No die copy free to issue",
    billetsShort: "Not enough billets of {alloy}",
    readyLabel: "Readiness of the line",
    loadFailed: "Could not load the billet need.",
  },
  /** Pack floor: why a bundle was cut shorter than its trolley line (optional). */
  recut: {
    label: "Why was it cut shorter?",
    placeholder: "Bend at one end",
    hint: "Optional. Saved with this bundle so the office can see why the line ran short.",
  },
} as const;
