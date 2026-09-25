import { describe, expect, it } from "vitest";

import { editRoomRow } from "./registration-fields";

const row = { bedsPerRoom: "", rooms: "", roomType: "Single Room", vacantBeds: "" };

describe("editRoomRow", () => {
  it("fills beds each from the room type and vacant from every bed", () => {
    const double = editRoomRow(row, { roomType: "Double Sharing" });
    expect(double.bedsPerRoom).toBe("2");
    expect(editRoomRow(double, { rooms: "20" }).vacantBeds).toBe("40");
  });

  it("never lets vacant go above rooms × beds each", () => {
    const full = { ...row, bedsPerRoom: "2", rooms: "20", vacantBeds: "40" };
    expect(editRoomRow(full, { vacantBeds: "45" }).vacantBeds).toBe("40");
    expect(editRoomRow(full, { vacantBeds: "30" }).vacantBeds).toBe("30");
  });

  it("keeps a typed-down vacant, clamped when capacity shrinks", () => {
    const partly = { ...row, bedsPerRoom: "2", rooms: "20", vacantBeds: "30" };
    expect(editRoomRow(partly, { rooms: "25" }).vacantBeds).toBe("30");
    expect(editRoomRow(partly, { rooms: "10" }).vacantBeds).toBe("20");
  });
});
