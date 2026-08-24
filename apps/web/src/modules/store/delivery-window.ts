import type { StoreConfig } from "@/modules/store/store-config";

const NEPAL_OFFSET_MINUTES = 5 * 60 + 45;

export type DeliveryPromise = {
  arrivesText: string;
  cutoffText: string;
  placedBefore: "morning" | "evening" | "next-day";
};

/**
 * Resolve the store promise from Nepal wall-clock time, regardless of the
 * server's local timezone. The store currently operates in Asia/Kathmandu.
 */
export function deliveryPromise(config: StoreConfig, now: Date): DeliveryPromise {
  const nepalNow = new Date(now.getTime() + NEPAL_OFFSET_MINUTES * 60 * 1000);
  const hour = nepalNow.getUTCHours();
  const schedule = config.deliverySchedule;
  const cutoffHour = schedule.eveningCutoffHour;

  if (hour < schedule.morningCutoffHour) {
    return {
      arrivesText: schedule.morningArrivalText,
      cutoffText: `Order by ${formatHour(schedule.morningCutoffHour)} for delivery ${schedule.morningArrivalText}.`,
      placedBefore: "morning",
    };
  }

  if (hour < cutoffHour) {
    return {
      arrivesText: schedule.morningArrivalText,
      cutoffText: `Order by ${formatHour(cutoffHour)} for delivery ${schedule.morningArrivalText}.`,
      placedBefore: "evening",
    };
  }

  return {
    arrivesText: schedule.eveningArrivalText,
    cutoffText: `Orders placed after ${formatHour(cutoffHour)} arrive ${schedule.eveningArrivalText}.`,
    placedBefore: "next-day",
  };
}

function formatHour(hour: number) {
  const normalized = hour % 24;
  const displayHour = normalized % 12 || 12;
  return `${displayHour} ${normalized < 12 ? "AM" : "PM"}`;
}
