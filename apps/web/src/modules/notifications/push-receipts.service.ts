/**
 * The other half of an Expo send: finding out whether it was actually delivered.
 *
 * ## A ticket is not a delivery
 *
 * `sendPushToUsers` posts to Expo and reads back one *ticket* per message. A
 * ticket with `status: "ok"` means Expo queued it — nothing more. The transport
 * that matters is the one after Expo: FCM for Android, APNS for iOS, and their
 * verdict arrives minutes later in a *receipt*, keyed by the ticket's id.
 *
 * For months this module did not exist, and the consequence was not a missing
 * metric — it was a product whose push notifications did not work while every
 * signal available said they did. The receipts had been carrying the reason the
 * whole time:
 *
 *     FCM 403 · PERMISSION_DENIED
 *     Permission 'cloudmessaging.messages.create' denied on
 *     resource 'projects/softmato-e65a6'
 *
 * Expo was doing its job; Google was refusing every message because the service
 * account behind this project's FCM credentials had lost that permission. A
 * ticket cannot express that, because at ticket time it has not happened yet.
 *
 * So the rule this module exists to enforce: **the only honest answer to "did
 * that push arrive" comes from a receipt**, and something has to go and ask.
 *
 * ## Why a cron and not the request
 *
 * Receipts are not ready when the send returns — Expo's own guidance is to wait
 * and batch. Holding a serverless invocation open for that would burn the
 * request that raised the notification, so the ticket ids are written down
 * (`PushTicket`) and swept later. `/api/v1/cron/push-receipts` is the sweeper.
 *
 * ## What it does with the answer
 *
 * Two things, and deliberately no more:
 *
 *  - **Logs it**, at `error`, with the error code and the FCM/APNS detail. This
 *    is the signal whose absence is the entire reason the bug survived so long,
 *    so it is loud and it names the credential problem when it sees one.
 *  - **Revokes what is provably dead.** A receipt saying `DeviceNotRegistered`
 *    is the same verdict a ticket can give, and means the same thing: that
 *    install is gone. Everything else is left alone — a `MessageRateExceeded`
 *    or a broken service account is a problem with *us*, and revoking a
 *    perfectly good token over it would turn an outage into data loss.
 */

import { DeviceTokenModel } from "@hostel/db/models/DeviceToken";
import { PushTicketModel } from "@hostel/db/models/PushTicket";

import { connectToDatabase } from "@/lib/db";
import { logger } from "@/lib/logger";

const EXPO_RECEIPTS_ENDPOINT = "https://exp.host/--/api/v2/push/getReceipts";

/** Expo's documented cap for a single receipts request. */
const MAX_IDS_PER_REQUEST = 1000;

/**
 * How many tickets one sweep will look at. A cap rather than "everything
 * pending", so a backlog after an outage cannot run the invocation past its
 * `maxDuration` and fail without checking any of them.
 */
const MAX_TICKETS_PER_RUN = 3000;

/**
 * Expo keeps a receipt for roughly a day. Younger than this and the answer is
 * usually not ready yet; older and it never will be.
 */
const READY_AFTER_MS = 60_000;
const EXPIRES_AFTER_MS = 24 * 60 * 60 * 1000;

const REQUEST_TIMEOUT_MS = 15_000;

type ExpoReceipt = {
  details?: { error?: string; fcm?: unknown };
  message?: string;
  status: "ok" | "error";
};

export type ReceiptSweepResult = {
  checked: number;
  delivered: number;
  expired: number;
  failed: number;
  revoked: number;
};

function authHeaders(): Record<string, string> {
  const accessToken = process.env.EXPO_ACCESS_TOKEN?.trim();

  return {
    accept: "application/json",
    "content-type": "application/json",
    ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
  };
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

async function fetchReceipts(ids: string[]): Promise<Record<string, ExpoReceipt>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(EXPO_RECEIPTS_ENDPOINT, {
      body: JSON.stringify({ ids }),
      headers: authHeaders(),
      method: "POST",
      signal: controller.signal,
    });

    if (!response.ok) {
      logger.error("Expo receipt lookup failed", {
        action: "push_receipts_http_error",
        status: response.status,
      });

      return {};
    }

    const payload = (await response.json()) as {
      data?: Record<string, ExpoReceipt>;
    };

    return payload?.data ?? {};
  } catch (error) {
    logger.error("Expo receipt lookup threw", {
      action: "push_receipts_request_failed",
      error,
    });

    return {};
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * A credential failure reads completely differently from a dead handset, and
 * conflating them is how this stayed invisible. `DeveloperError` and any FCM
 * `403` mean *our* configuration is wrong and no device will ever receive
 * anything — so it is called out by name rather than counted as one more
 * delivery failure.
 */
function isConfigurationFailure(receipt: ExpoReceipt) {
  const fcm = receipt.details?.fcm;
  const detail = typeof fcm === "string" ? fcm : JSON.stringify(fcm ?? "");

  return (
    receipt.details?.error === "DeveloperError" ||
    detail.includes("PERMISSION_DENIED") ||
    detail.includes("UNAUTHENTICATED") ||
    detail.includes("SenderId")
  );
}

/**
 * Read every pending ticket's receipt, log what failed, revoke what is dead.
 *
 * Safe to run concurrently with itself: tickets are marked `CHECKED` per batch,
 * and a receipt read twice produces the same verdict.
 */
export async function sweepPushReceipts(): Promise<ReceiptSweepResult> {
  await connectToDatabase();

  const now = Date.now();

  // Anything past the window will never have a receipt. Retire it rather than
  // asking Expo about ids it has already forgotten.
  const expired = await PushTicketModel.deleteMany({
    createdAt: { $lt: new Date(now - EXPIRES_AFTER_MS) },
    status: "PENDING",
  });

  const pending = await PushTicketModel.find({
    createdAt: { $lte: new Date(now - READY_AFTER_MS) },
    status: "PENDING",
  })
    .select({ category: 1, ticketId: 1, token: 1 })
    .limit(MAX_TICKETS_PER_RUN)
    .lean<{ _id: unknown; category?: string; ticketId: string; token: string }[]>();

  const result: ReceiptSweepResult = {
    checked: 0,
    delivered: 0,
    expired: expired?.deletedCount ?? 0,
    failed: 0,
    revoked: 0,
  };

  if (pending.length === 0) {
    return result;
  }

  const byTicket = new Map(pending.map((row) => [row.ticketId, row]));
  const dead: string[] = [];
  const failureCodes: Record<string, number> = {};
  let configurationFailures = 0;
  let configurationDetail = "";

  for (const batch of chunk(pending, MAX_IDS_PER_REQUEST)) {
    const receipts = await fetchReceipts(batch.map((row) => row.ticketId));
    const seen: string[] = [];

    for (const [ticketId, receipt] of Object.entries(receipts)) {
      seen.push(ticketId);
      result.checked += 1;

      if (receipt.status === "ok") {
        result.delivered += 1;
        continue;
      }

      result.failed += 1;

      const code = receipt.details?.error ?? "Unknown";
      failureCodes[code] = (failureCodes[code] ?? 0) + 1;

      if (isConfigurationFailure(receipt)) {
        configurationFailures += 1;

        if (!configurationDetail) {
          const fcm = receipt.details?.fcm;
          configurationDetail =
            typeof fcm === "string" ? fcm : JSON.stringify(fcm ?? receipt.message ?? "");
        }
      }

      if (code === "DeviceNotRegistered") {
        const row = byTicket.get(ticketId);

        if (row?.token) {
          dead.push(row.token);
        }
      }
    }

    // Marked from the ids Expo actually answered for. A ticket it stayed silent
    // about is left PENDING and asked again next run, rather than being retired
    // as though it had come back clean.
    if (seen.length > 0) {
      await PushTicketModel.updateMany(
        { ticketId: { $in: seen } },
        { $set: { status: "CHECKED" } },
      ).catch(() => undefined);
    }
  }

  if (dead.length > 0) {
    const revoked = await DeviceTokenModel.updateMany(
      { token: { $in: dead } },
      { $set: { status: "REVOKED" } },
    ).catch(() => null);

    result.revoked = revoked?.modifiedCount ?? 0;
  }

  if (result.failed > 0) {
    logger.error("Push notifications were not delivered", {
      action: "push_receipts_delivery_failed",
      codes: failureCodes,
      failed: result.failed,
      checked: result.checked,
    });
  }

  /*
   * The one that matters most, and the one that was missing. When the transport
   * is refusing everything, "12 failed" is a number somebody has to interpret;
   * this says what is broken and where it is fixed, because the fix is not in
   * this repository — it is the FCM service account on the EAS project.
   */
  if (configurationFailures > 0) {
    logger.error(
      "Push transport is rejecting every message — FCM credentials are wrong",
      {
        action: "push_transport_misconfigured",
        count: configurationFailures,
        detail: configurationDetail.slice(0, 800),
        remedy:
          "Re-upload the FCM V1 service account key to the EAS project (eas credentials) " +
          "and grant it the Firebase Cloud Messaging API Admin role on the Firebase project.",
      },
    );
  }

  return result;
}
