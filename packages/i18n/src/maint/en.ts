/**
 * XE parity lane MAINT (`maint.*`): plant maintenance. Assets, preventive plans, work orders, spares,
 * readings and the report. Not a Gujarati floor namespace (gu reads English) and never a public key.
 * Units of a reading are typed by the plant and never sit in a dictionary. Keep `hi.ts` in the same shape.
 */
import { maintAssetsEn } from "./assets.en";
import { maintReportsEn } from "./reports.en";
import { maintWoEn } from "./wo.en";

export const maintEn = {
  title: "Maintenance",
  subtitle: "Machines, the work on them and what is due next.",
  noAccess: "Your role does not see maintenance.",
  moduleOff: "Maintenance is not on for this plant.",
  loadFailed: "Could not load maintenance. Try again.",
  showMore: "Show more",
  saved: "Saved",
  none: "None",

  kind: {
    press: "Press",
    furnace: "Furnace",
    oven: "Ageing oven",
    compressor: "Compressor",
    crane: "Crane",
    dg_set: "DG set",
    other: "Other",
  },
  link: {
    press: "Press",
    furnace: "Furnace",
    oven: "Ageing oven",
  },
  criticality: {
    A: "Critical A",
    B: "Critical B",
    C: "Critical C",
  },
  criticalityHint: {
    A: "Stops the plant when it stops",
    B: "Slows the plant",
    C: "Can wait",
  },
  assetStatus: {
    running: "Running",
    standby: "Standby",
    under_repair: "Under repair",
    retired: "Retired",
  },
  woKind: {
    breakdown: "Breakdown",
    preventive: "Preventive",
    condition: "Condition",
  },
  woStatus: {
    open: "Open",
    in_progress: "In progress",
    waiting_spares: "Waiting for spares",
    done: "Done",
    cancelled: "Cancelled",
  },
  woSource: {
    manual: "Raised by hand",
    downtime: "From press downtime",
    plan: "From a plan",
    reading: "From a reading",
  },
  priority: {
    high: "High",
    medium: "Medium",
    low: "Low",
  },
  flag: {
    ok: "In limit",
    low: "Below limit",
    high: "Above limit",
  },
  due: {
    inDays: "Due in {n} days",
    today: "Due today",
    overdueDays: "Overdue by {n} days",
    inHours: "Due in {n} run hours",
    overHours: "Over by {n} run hours",
    hoursNow: "Run hours reached",
    hoursRun: "{n} run hours since last done",
    state: {
      ok: "On time",
      soon: "Due soon",
      overdue: "Overdue",
    },
  },

  /** The maintenance home (`/maintenance`). */
  home: {
    dueTitle: "Plans due",
    dueEmpty: "Nothing is due in the next 7 days.",
    openTitle: "Open work orders",
    openEmpty: "No open work orders.",
    breakdownsTitle: "Press breakdowns",
    breakdownsHint: "Breakdowns logged on the press in the last 30 days.",
    breakdownsEmpty: "No breakdowns in the last 30 days.",
    flaggedTitle: "Readings outside limits",
    flaggedEmpty: "No readings outside limits in the last 30 days.",
    makeWorkOrder: "Make work order",
    openWorkOrder: "Open {number}",
    noAsset: "Add this press to the assets first",
    since: "Since {time}",
    minutes: "{min} min",
    assets: "Assets",
    workOrders: "Work orders",
    report: "Report",
    newWorkOrder: "New work order",
  },

  /** Today's tile for maintenance people. */
  today: {
    title: "Maintenance",
    open: "Open maintenance",
    overdue: "Plans overdue",
    overdueMeta: "Past their date or run hours",
    soon: "Due soon",
    soonMeta: "In 7 days or the last run hours",
    live: "Open work orders",
    liveMeta: "Breakdowns and plans in hand",
    flagged: "Readings out of limit",
    flaggedMeta: "Last 7 days, no work order yet",
  },

  /** The one-tap button on a press breakdown (press station). */
  station: {
    makeWorkOrder: "Make work order",
    workOrder: "Work order {number}",
    offline: "Make the work order when the tablet is back online.",
  },

  errors: {
    notFound: "Not found.",
    changed: "This changed since you opened it. Open it again.",
    final: "This work order is closed.",
    numberBusy: "Others are raising work orders at the same moment. Try again.",
    badMove: "A work order cannot move to that status from here.",
    needsWorkDone: "Write what was done before marking the work order done.",
    needsReason: "Say why the work order is cancelled.",
    finishBeforeStart: "The finish time is before the start time.",
    notBreakdown: "Only a downtime entry with the breakdown reason makes a work order.",
    noAsset: "No asset points at this press yet. Add it to the assets first.",
    spareNotMaintenance: "Only a store issue for maintenance can be linked.",
    spareCancelled: "That store issue was cancelled.",
    spareTaken: "That store issue is already on a work order.",
    spareNotLinked: "That store issue is not on this work order.",
    noRunHours: "This asset has no run hours. Link it to a press, furnace or oven, or plan by days.",
    needsInterval: "A plan needs days, run hours or both.",
    hoursPlans: "Plans on this asset run on run hours. Change them to days before you remove the link.",
    codeTaken: "Another asset already has that code.",
    linkTaken: "Another asset already points at that press, furnace or oven.",
    linkMissing: "That press, furnace or oven is not in this plant.",
    notMember: "The person is not a member of this plant.",
    limitInvalid: "Give a low limit, a high limit or both, with the low below the high.",
    kindTaken: "This asset already reads something by that name.",
    kindOff: "That reading is switched off.",
    inLimit: "That reading is inside its limits.",
    retired: "This asset is retired.",
    timeFuture: "A start or finish time cannot be in the future.",
    doneKeepsTimes: "A done work order keeps its start and finish times.",
    linkKindMismatch: "A press asset points at a press, a furnace asset at a furnace and an oven asset at an oven.",
    unitLocked: "This reading already has readings in its unit. Add a new reading kind for another unit.",
    moduleOff: "Maintenance is not on for this plant.",
    forbidden: "Your role cannot do this.",
    unknown: "That did not work. Try again.",
  },

  workOrders: maintWoEn,
  assets: maintAssetsEn,
  reports: maintReportsEn,
};
