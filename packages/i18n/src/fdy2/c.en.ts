/**
 * XE FOUNDRY screens, part c (en): the casting plan. Merged into the `fdy2` namespace by ./en.ts.
 * Units are never written as bare words: use {massUnit}, which the plant's formatter fills.
 */
export const fdy2CEn = {
  plan: {
    nav: "Casting plan",
    title: "Casting plan",
    subtitle: "Built from the billet need of the press plans, less the logs and billets in stock and the lines already accepted.",
    loadFailed: "The casting plan did not load.",
    from: "From day",
    to: "To day",
    backwards: "The end day is before the start day.",
    tooLong: "Look at 31 days or fewer at a time.",
    furnaceSize: "Furnace size: {kg} {massUnit} a cast.",
    furnaceNone: "No furnace size is set, so one cast per row is assumed.",
    kgLine: "{kg} {massUnit}",
    proposed: {
      title: "Proposed",
      empty: "Nothing to cast in these days. The stock and accepted lines cover the press plans.",
      col: { day: "Day", alloy: "Alloy", need: "Need", covered: "Covered", cast: "To cast", casts: "Casts" },
      accept: "Accept",
      noAlloy: "This alloy is not in the masters. Add it before accepting.",
      nothing: "Nothing to cast",
    },
    plans: {
      title: "Press plans used",
      empty: "No press plans start in these days.",
      line: "{number} · {day} · billets {kg} {massUnit}",
      noAlloy: "{kg} {massUnit} of this plan is on lines with no alloy, so it is not in the plan.",
      truncated: "More press plans start in these days than are read. Look at fewer days.",
    },
    lines: {
      title: "Accepted lines",
      empty: "No lines accepted in these days.",
      col: { day: "Day", alloy: "Alloy", kg: "Weight", status: "Status", note: "Note", actions: "Actions" },
      status: { accepted: "Accepted", opened: "Opened", dropped: "Dropped" },
      edit: "Edit",
      drop: "Drop",
      open: "Open a cast",
      cast: "Cast {number}",
      proposedWas: "Proposed {kg} {massUnit}",
    },
    totals: {
      title: "Totals by alloy",
      line: "need {need} {massUnit}, covered {covered} {massUnit}, to cast {cast} {massUnit}, {casts} casts",
    },
    accept: {
      title: "Accept {alloy} for {day}",
      editTitle: "Change the line for {alloy}",
      dropTitle: "Drop the line for {alloy}",
      proposedHint: "Proposed: {kg} {massUnit}",
      kg: "Weight to cast",
      day: "Day",
      note: "Note",
      save: "Accept",
      saveEdit: "Save",
      confirmDrop: "Drop the line",
      saved: "Line accepted.",
      updated: "Line saved.",
      dropped: "Line dropped.",
      opened: "Cast {number} opened.",
      issue: {
        kg: "Enter a weight of 1 {massUnit} or more.",
        day: "Pick a day.",
      },
    },
  },
};
