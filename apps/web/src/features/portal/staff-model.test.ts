import { describe, expect, test } from "bun:test";

import { grantHidden, loginActions, partyInviteUrl, staffErrorKey } from "./staff-model";

describe("party logins", () => {
  test("what the office can do by status", () => {
    expect(loginActions("invited")).toEqual({ revoke: true, resend: true, regrant: false });
    expect(loginActions("active")).toEqual({ revoke: true, resend: false, regrant: false });
    expect(loginActions("revoked")).toEqual({ revoke: false, resend: false, regrant: true });
  });
  test("a section another party owns stays hidden from this party", () => {
    expect(grantHidden({ ownerCustomerId: "other" }, "me")).toBe(true);
    expect(grantHidden({ ownerCustomerId: "me" }, "me")).toBe(false);
    expect(grantHidden({ ownerCustomerId: null }, "me")).toBe(false);
  });
  test("server refusals map to the plant's words", () => {
    expect(staffErrorKey({ message: "Turn on the party portal in Settings first" })).toBe("portal.staff.portalOff");
    expect(staffErrorKey({ message: "This login is already active" })).toBe("portal.staff.alreadyActive");
    expect(staffErrorKey({ message: "This email is a plant login here. Use another email for the party." })).toBe("portal.staff.plantLogin");
    expect(staffErrorKey({ message: "This email already signs in for another party" })).toBe("portal.staff.otherParty");
    expect(staffErrorKey({ message: "This party already sees this section" })).toBe("portal.staff.alreadyGranted");
    expect(staffErrorKey({ message: "x", data: { code: "FORBIDDEN" } })).toBe("errors.forbidden");
    expect(staffErrorKey(new Error("boom"))).toBe("errors.generic");
  });
});

describe("invite link", () => {
  test("a party link ends in ?kind=portal, once", () => {
    expect(partyInviteUrl("https://orrn.in/invite/abc")).toBe("https://orrn.in/invite/abc?kind=portal");
    expect(partyInviteUrl("https://orrn.in/invite/abc?kind=portal")).toBe("https://orrn.in/invite/abc?kind=portal");
  });
});
