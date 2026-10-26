import { describe, expect, test } from "bun:test";

import { focusSelected, stillMayFocus, type FocusableField } from "./focus-weight";

/** A field that behaves like an <input>: focus keeps the old selection; typing replaces the selection. */
function field(value: string) {
  const f = {
    value,
    sel: [0, 0] as [number, number],
    focused: false,
    scrolled: true,
    focus(opts?: { preventScroll?: boolean }) {
      f.focused = true;
      f.scrolled = !opts?.preventScroll;
    },
    setSelectionRange(a: number, b: number) {
      f.sel = [a, b];
    },
    type(text: string) {
      f.value = f.value.slice(0, f.sel[0]) + text + f.value.slice(f.sel[1]);
      f.sel = [f.sel[0] + text.length, f.sel[0] + text.length];
    },
  };
  return f;
}

describe("BACKLOG 64: the weight field after Edit", () => {
  test("a plain focus left the caret at 0: keystrokes in that frame landed in front ('21' + '50.1')", () => {
    const f = field("50.1");
    f.focus({ preventScroll: true });
    f.type("21");
    expect(f.value).toBe("2150.1");
  });

  test("focusSelected selects the whole value: typing replaces it, never prepends", () => {
    const f = field("50.1");
    expect(focusSelected(f as FocusableField)).toBe(true);
    expect(f.focused).toBe(true);
    expect(f.scrolled).toBe(false);
    expect(f.sel).toEqual([0, 4]);
    f.type("49.95");
    expect(f.value).toBe("49.95");
    // An empty new-bundle field just takes the caret.
    const empty = field("");
    focusSelected(empty as FocusableField);
    empty.type("50.10");
    expect(empty.value).toBe("50.10");
    expect(focusSelected(null)).toBe(false);
  });

  test("a field that refuses selection ranges still gets focus", () => {
    const f = { value: "1", focused: false, focus() { this.focused = true; }, setSelectionRange() { throw new Error("InvalidStateError"); } };
    expect(focusSelected(f)).toBe(true);
    expect(f.focused).toBe(true);
  });

  test("the deferred focus waits for nobody: once the person is in another field (pieces, feet), it stays there", () => {
    const row = {};
    const pieces = {};
    const body = {};
    expect(stillMayFocus(row, row, body)).toBe(true);
    expect(stillMayFocus(row, body, body)).toBe(true);
    expect(stillMayFocus(row, null, body)).toBe(true);
    expect(stillMayFocus(row, pieces, body)).toBe(false);
  });
});
