import { createI18n } from "@orrn/i18n";
import { describe, expect, test } from "bun:test";

import { actionErrorText, dispatchErrorText, failedFirstLoad, isConflict } from "./errors";

const { t } = createI18n("en");
const err = (code: string, message = "") => ({ message, data: { code } });

describe("dispatchErrorText", () => {
  test("says what happened and what to do, never the server's English", () => {
    expect(dispatchErrorText(t, err("CONFLICT", "Cannot reserve: 2 bundle(s)"))).toBe(
      "Some bundles changed since this page loaded. The ones that can't go are marked in the list.",
    );
    expect(dispatchErrorText(t, err("BAD_REQUEST", "Cannot reserve an empty dispatch"))).toBe("Add at least one bundle first.");
    expect(dispatchErrorText(t, err("BAD_REQUEST", "Cannot complete an empty dispatch"))).toBe("Add at least one bundle first.");
    expect(dispatchErrorText(t, err("BAD_REQUEST", "Dispatch transition completed -> reserved is not allowed."))).toBe(
      "This dispatch has moved on. Reload to see where it is now.",
    );
    expect(dispatchErrorText(t, err("FORBIDDEN"))).toBe("Your role can't do this. Ask an admin if you need it.");
    expect(dispatchErrorText(t, err("NOT_FOUND"))).toBe("Not found in this company");
    expect(dispatchErrorText(t, new TypeError("Failed to fetch"))).toBe("No internet connection. Check it and try again.");
    expect(dispatchErrorText(t, err("INTERNAL_SERVER_ERROR"))).toBe("Something went wrong. Try again.");
  });

  test("Q36: off-band rows refused at Complete say what to do; rejected rows first", () => {
    expect(
      dispatchErrorText(t, err("PRECONDITION_FAILED", "KJ-1 is more than 0.1 kg/12ft off the order line. A manager has to approve before this dispatch can complete.")),
    ).toBe("Some bundles are off the order weight. A manager has to approve them before this dispatch can go.");
    expect(
      dispatchErrorText(
        t,
        err("PRECONDITION_FAILED", "KJ-1 is more than 0.1 kg/12ft off the order line. A manager has to approve. KJ-2 was rejected for the order line. Take it off the dispatch or link it to a line that fits."),
      ),
    ).toBe("A bundle was rejected for the order weight. Take it off this dispatch, then try again.");
    expect(dispatchErrorText(t, err("PRECONDITION_FAILED", "Loaded 9 kg is 1 kg over"))).toBe("Something went wrong. Try again.");
    expect(dispatchErrorText(t, err("PRECONDITION_FAILED", "Over the order balance: SO-4 line 2 by 30.00 kg (limit 1050.00 kg). A manager has to approve before this dispatch can complete."))).toBe(
      "This load is more than the order allows. A manager has to approve it first. Your note went with the request.",
    );
  });
});

describe("actionErrorText", () => {
  test("words the shared codes for any write (a new customer), never the server's text", () => {
    const zod = err("BAD_REQUEST", '[{"code":"too_big","maximum":500,"path":["name"]}]');
    expect(actionErrorText(t, zod)).toBe("Something went wrong. Try again.");
    expect(actionErrorText(t, err("CONFLICT", "Customer already exists"))).toBe("Someone else changed this. Reload to see the latest.");
    expect(actionErrorText(t, err("FORBIDDEN", "Missing customer.create"))).toBe("Your role can't do this. Ask an admin if you need it.");
    expect(actionErrorText(t, err("UNAUTHORIZED"))).toBe("Your session ended. Sign in again.");
    expect(actionErrorText(t, new TypeError("Failed to fetch"))).toBe("No internet connection. Check it and try again.");
  });
});

describe("dispatchErrorText: late packing list (arch 52)", () => {
  test("waiting for approval and the server's own refusals of the time", () => {
    expect(dispatchErrorText(t, err("PRECONDITION_FAILED", "Entered late: a second person has to approve the dispatch time before this dispatch can complete."))).toBe(
      "A manager has to approve the time the truck left. Press Dispatch again with the same time once it is approved.",
    );
    expect(dispatchErrorText(t, err("BAD_REQUEST", "The dispatch time can't be in the future."))).toBe("That time is in the future. Check the date and time.");
    expect(dispatchErrorText(t, err("BAD_REQUEST", "A late packing list can go back at most 72 hours."))).toBe("A late packing list can go back at most 72 hours.");
    expect(dispatchErrorText(t, err("BAD_REQUEST", "Give the reason the packing list is entered late."))).toBe("Write why it is entered late.");
    expect(dispatchErrorText(t, err("BAD_REQUEST", "A late reason needs the time the truck left."))).toBe("Enter the date and time the truck left.");
    // Review 7: approved for other bundles, past the 72 hours.
    expect(dispatchErrorText(t, err("BAD_REQUEST", "The bundles changed after a manager approved this time. Put the load back as approved, or dispatch it at the time it leaves."))).toBe("The bundles changed after a manager approved this time. Put the load back as approved, or dispatch it at the time it leaves.");
  });
});

describe("dispatchErrorText: no vehicle number (BACKLOG 70)", () => {
  test("the server's refusal asks for the vehicle number", () => {
    expect(dispatchErrorText(t, err("PRECONDITION_FAILED", "No vehicle number: add it before this dispatch can complete."))).toBe(
      "Add the vehicle number before you dispatch.",
    );
  });
});

describe("isConflict", () => {
  test("only a CONFLICT from the server", () => {
    expect(isConflict(err("CONFLICT", "Packing list already exists for this dispatch"))).toBe(true);
    expect(isConflict(err("BAD_REQUEST"))).toBe(false);
    expect(isConflict(new TypeError("Failed to fetch"))).toBe(false);
    expect(isConflict(null)).toBe(false);
  });
});

describe("failedFirstLoad", () => {
  test("only a read that never loaded is an error screen; a failed refetch keeps what is on screen", () => {
    expect(failedFirstLoad({ isError: true, data: undefined })).toBe(true);
    // React Query v5: a failed refetch keeps `data` and sets isError.
    expect(failedFirstLoad({ isError: true, data: [{ month: "2026-10", kgG: 1 }] })).toBe(false);
    // A packing list that does not exist yet is `null`, and that is a loaded answer.
    expect(failedFirstLoad({ isError: true, data: null })).toBe(false);
    expect(failedFirstLoad({ isError: false, data: undefined })).toBe(false);
  });
});
