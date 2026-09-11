import { describe, expect, it } from "vitest";

import { centredGuide, cropRectForGuide } from "@/lib/capture-crop";

/**
 * The whole point of this file is the case where the preview and the photograph
 * are different shapes, because that is the one a phone actually produces and
 * the one a "crop by percentage" implementation gets wrong.
 */
describe("cropRectForGuide", () => {
  it("maps the frame straight through when preview and photo agree", () => {
    const rect = cropRectForGuide(
      { height: 1200, width: 1600 },
      { height: 300, width: 400 },
      { height: 0.5, width: 0.5, x: 0.25, y: 0.25 },
    );

    expect(rect).toEqual({ height: 600, originX: 400, originY: 300, width: 800 });
  });

  it("accounts for the sides the preview cropped away", () => {
    /*
     * A 16:9 photograph behind a 4:3 preview: the preview showed the middle
     * 1600px of a 2133px-wide image, so the frame's left edge sits 266px in
     * from the photograph's edge before the frame's own offset is added.
     *
     * Crop this by the naive percentage instead and the rectangle starts at
     * 533px — a third of the frame's width off, which on a signature means the
     * first letter of a name is outside the picture.
     */
    const rect = cropRectForGuide(
      { height: 1200, width: 2133 },
      { height: 300, width: 400 },
      { height: 0.5, width: 0.5, x: 0.25, y: 0.25 },
    );

    expect(rect.originX).toBe(667);
    expect(rect.width).toBe(800);
    // Nothing was cropped vertically, so this axis maps one to one.
    expect(rect.originY).toBe(300);
    expect(rect.height).toBe(600);
  });

  it("accounts for the top and bottom when the photo is the taller one", () => {
    const rect = cropRectForGuide(
      { height: 2133, width: 1200 },
      { height: 400, width: 300 },
      { height: 0.5, width: 0.5, x: 0.25, y: 0.25 },
    );

    expect(rect.originY).toBe(667);
    expect(rect.height).toBe(800);
    expect(rect.originX).toBe(300);
    expect(rect.width).toBe(600);
  });

  it("never returns a rectangle that leaves the photograph", () => {
    const rect = cropRectForGuide(
      { height: 1000, width: 1000 },
      { height: 1000, width: 1000 },
      { height: 1, width: 1, x: 0, y: 0 },
    );

    expect(rect.originX + rect.width).toBeLessThanOrEqual(1000);
    expect(rect.originY + rect.height).toBeLessThanOrEqual(1000);
  });
});

describe("centredGuide", () => {
  it("centres a 3:1 band across a portrait preview", () => {
    const guide = centredGuide({ height: 800, width: 400 }, 3, 0.06);

    expect(guide.width).toBeCloseTo(0.88);
    expect(guide.x).toBeCloseTo(0.06);
    // 352pt wide at 3:1 is ~117pt tall, which is 14.7% of an 800pt preview.
    expect(guide.height).toBeCloseTo(0.1467, 3);
    expect(guide.y).toBeCloseTo(0.4267, 3);
  });

  it("cannot grow taller than the preview", () => {
    const guide = centredGuide({ height: 100, width: 400 }, 1, 0);

    expect(guide.height).toBe(1);
    expect(guide.y).toBe(0);
  });
});
