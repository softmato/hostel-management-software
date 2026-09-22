import mongoose from "mongoose";
import { expect, it, vi } from "vitest";

import { connectToDatabase } from "@hostel/db/connection";

it("retries after a failed connect instead of replaying the failure", async () => {
  process.env.MONGODB_URI = "mongodb://example.invalid/test";

  const connect = vi
    .spyOn(mongoose, "connect")
    .mockRejectedValueOnce(new Error("tlsv1 alert internal error"))
    .mockResolvedValueOnce(mongoose);

  await expect(connectToDatabase()).rejects.toThrow("tlsv1 alert internal error");
  await expect(connectToDatabase()).resolves.toBe(mongoose);
  expect(connect).toHaveBeenCalledTimes(2);
});
