import { describe, expect, test } from "bun:test";

import { STOCK_SIZES } from "./label-metrics";
import { closestStock, detectLabelQuad, homography, project, quadSize, rectQuad, rotateQuad, warpPixels, type Pixels, type Quad } from "./label-photo-geometry";

const near = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  expect(a.x).toBeCloseTo(b.x, 6);
  expect(a.y).toBeCloseTo(b.y, 6);
};

/** A photographed label: tilted and foreshortened. */
const photo: Quad = [
  { x: 112, y: 64 },
  { x: 905, y: 131 },
  { x: 861, y: 702 },
  { x: 74, y: 655 },
];

function pixels(width: number, height: number, paint: (x: number, y: number) => number): Pixels {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = paint(x, y);
      data.set([value, value, value, 255], (y * width + x) * 4);
    }
  }
  return { data, width, height };
}

describe("homography", () => {
  test("maps each corner of the straight label onto the same corner of the photo", () => {
    const m = homography(rectQuad(1600, 1192), photo);
    rectQuad(1600, 1192).forEach((corner, index) => near(project(m, corner), photo[index]!));
  });

  test("its inverse maps the photo corners back onto the rectangle", () => {
    const m = homography(photo, rectQuad(102.25, 76.2));
    photo.forEach((corner, index) => near(project(m, corner), rectQuad(102.25, 76.2)[index]!));
  });

  test("an axis-aligned rectangle maps by plain scaling, centre to centre", () => {
    const m = homography(rectQuad(100, 50), rectQuad(200, 150));
    near(project(m, { x: 50, y: 25 }), { x: 100, y: 75 });
    near(project(m, { x: 10, y: 40 }), { x: 20, y: 120 });
  });

  test("keeps straight lines straight: the photo's diagonals cross at the label's centre", () => {
    const m = homography(rectQuad(100, 100), photo);
    const centre = project(m, { x: 50, y: 50 });
    // Intersection of the photo's diagonals (TL-BR and TR-BL).
    const [a, b, c, d] = photo;
    const denominator = (a.x - c.x) * (b.y - d.y) - (a.y - c.y) * (b.x - d.x);
    const t = ((a.x - b.x) * (b.y - d.y) - (a.y - b.y) * (b.x - d.x)) / denominator;
    near(centre, { x: a.x + t * (c.x - a.x), y: a.y + t * (c.y - a.y) });
  });

  test("refuses corners that collapse onto a line", () => {
    const flat: Quad = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
      { x: 30, y: 0 },
    ];
    expect(() => homography(rectQuad(10, 10), flat)).toThrow();
  });
});

describe("warpPixels", () => {
  test("straightens a skewed dark square back to the middle of the output", () => {
    // Source: white page whose quad is a parallelogram; a dark blob at the quad's centre.
    const quad: Quad = [
      { x: 20, y: 10 },
      { x: 180, y: 30 },
      { x: 170, y: 130 },
      { x: 10, y: 110 },
    ];
    const centre = project(homography(rectQuad(1, 1), quad), { x: 0.5, y: 0.5 });
    const source = pixels(200, 150, (x, y) => (Math.hypot(x - centre.x, y - centre.y) < 12 ? 0 : 255));
    const out = warpPixels(source, quad, 80, 40);
    const at = (x: number, y: number) => out[(y * 80 + x) * 4]!;
    expect(at(40, 20)).toBeLessThan(40);
    expect(at(4, 4)).toBeGreaterThan(220);
    expect(at(76, 36)).toBeGreaterThan(220);
    expect(out[3]).toBe(255);
  });
});

describe("label corners", () => {
  test("finds a white label on a dark table", () => {
    const found = detectLabelQuad(pixels(160, 120, (x, y) => (x >= 30 && x < 130 && y >= 20 && y < 95 ? 245 : 40)));
    expect(found).not.toBeNull();
    const [tl, tr, br, bl] = found!;
    near(tl, { x: 30, y: 20 });
    near(tr, { x: 130, y: 20 });
    near(br, { x: 130, y: 95 });
    near(bl, { x: 30, y: 95 });
  });

  test("keeps the whole image for a scan that is all label", () => {
    expect(detectLabelQuad(pixels(160, 120, (x, y) => (x > 40 && x < 60 && y > 40 && y < 50 ? 10 : 250)))).toBeNull();
  });

  test("keeps the whole image when nothing bright stands out", () => {
    expect(detectLabelQuad(pixels(160, 120, (x, y) => (x === 5 && y === 5 ? 255 : 30)))).toBeNull();
  });

  test("turning moves which corner is the top left, clockwise", () => {
    const [tl, tr, br, bl] = photo;
    expect(rotateQuad(photo, 1)).toEqual([bl, tl, tr, br]);
    expect(rotateQuad(photo, -1)).toEqual([tr, br, bl, tl]);
    expect(rotateQuad(photo, 4)).toEqual(photo);
  });

  test("a crop's aspect picks the nearest stock, wide or tall", () => {
    const size = quadSize(rectQuad(1020, 762));
    expect(closestStock(size.width / size.height, STOCK_SIZES).widthMm).toBe(102.25);
    expect(closestStock(2, STOCK_SIZES).label).toBe("100 × 50 mm");
    expect(closestStock(101.6 / 152.4, STOCK_SIZES).heightMm).toBe(152.4);
  });
});
