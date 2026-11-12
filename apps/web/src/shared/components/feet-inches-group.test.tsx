import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

import { FeetInchesGroup } from "./feet-inches-group";

describe("the old two-box feet and inches pair is a named group", () => {
  test("a group with the field's name around its two boxes, each box named by its own label", () => {
    const html = renderToStaticMarkup(
      <FeetInchesGroup label="Cut length">
        <input aria-label="Feet" />
        <input aria-label="Inches" />
      </FeetInchesGroup>,
    );
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="Cut length"');
    expect(html).toContain('aria-label="Feet"');
    expect(html).toContain('aria-label="Inches"');
  });

  // The pack forms already wrap their pair in a fieldset with a legend and a label for each box; these three did not.
  for (const file of ["../../features/orders/components/line-editor.tsx", "../../features/orders/components/die-block.tsx", "../../features/portal/new-order-page.tsx"]) {
    test(`${file.split("/").pop()} wraps its feet and inches boxes in the group, each box named`, () => {
      const src = readFileSync(join(import.meta.dir, file), "utf8");
      expect(src).toContain("<FeetInchesGroup");
      const feetBox = src.match(/aria-label=\{t\("(?:orders\.form|portal\.orders)\.feet"\)\}/g) ?? [];
      const inchBox = src.match(/aria-label=\{t\("(?:orders\.form|portal\.orders)\.inches"\)\}/g) ?? [];
      expect(feetBox.length).toBe(1);
      expect(inchBox.length).toBe(1);
      expect(src.match(/<FeetInchesGroup/g)?.length).toBe(1);
    });
  }
});
