/** Native-only strings for the platform screens: tab names, the release gate, "Open on the web" (apps/native). Top-level keys become `native.<key>.*`. Keep en and hi identical in shape. */
export const platformEn = {
  tabs: {
    press: "Press",
  },
  gate: {
    checking: "Checking this version",
    blockedTitle: "orrn can't open on this phone",
    blocked: {
      below_min_build: "This version of orrn is too old. Install the latest version, then open it again.",
      revoked: "This phone has been turned off for this plant. Ask your admin to turn it back on.",
      never_checked: "orrn could not check this version. Connect to the internet and check again.",
      grace_expired: "orrn has not been able to check for updates for over 24 hours. Connect to the internet and check again.",
      last_blocked: "This version of orrn cannot open. Connect to the internet and check again.",
      unreadable_build: "orrn could not read its own version on this phone. Install the latest version again.",
    },
    latest: "The latest version is {version}.",
    getLatest: "Get the latest version",
    graceNote: "Could not check for updates. This version can still open until {time}.",
  },
  web: {
    title: "Open on the web",
    hint: "Opens in your browser",
    team: "Team",
    shifts: "Shifts",
    standards: "Standards",
    backup: "Backup",
  },
} as const;
