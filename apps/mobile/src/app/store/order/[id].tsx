import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, View } from "react-native";

import { AppBar } from "@/components/ui/app-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { FactRow } from "@/components/ui/layout";
import { Money } from "@/components/ui/money";
import { Screen } from "@/components/ui/screen";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { Text } from "@/components/ui/text";
import { useAppTheme } from "@/hooks/use-app-theme";
import { useResource } from "@/hooks/use-resource";
import { REALTIME_TOPIC } from "@/constants/topics";
import { readApiError } from "@/lib/api-contract";
import { formatDateTime } from "@/lib/format";
import { cancelStoreOrder, getStoreOrder, type StoreOrder } from "@/lib/store-api";
import { orderTone, rupees } from "@/lib/store-format";
import { toastError, toastSuccess } from "@/lib/toast";

/**
 * One order, and where it has got to.
 *
 * ## The timeline is read off the order, not off the audit log
 *
 * `StoreOrder.timeline` is written by the same function that writes the status,
 * so this screen shows the order's own history. A buyer is entitled to see what
 * happened to their order without anyone granting them access to a privileged
 * trail, and an order whose status and history could disagree is an order
 * nobody trusts.
 *
 * ## Cancel is the server's decision, not this screen's
 *
 * `order.canCancel` comes back on the payload. The button reads that rather than
 * re-deriving it from the status, so the control on screen and the rule the API
 * enforces are the same fact — once it is with a courier, cancelling is a phone
 * call, and the screen says so instead of offering a tap that would 409.
 */
export default function StoreOrderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useAppTheme();
  const [cancelling, setCancelling] = useState(false);

  const resource = useResource(
    useCallback(() => getStoreOrder(String(id)), [id]),
    { topics: [REALTIME_TOPIC.STORE] },
  );

  const { setData } = resource;

  const cancel = useCallback(() => {
    Alert.alert(
      "Cancel this order?",
      "Everything on it goes back on the shelf. You would have to order again.",
      [
        { style: "cancel", text: "Keep it" },
        {
          onPress: async () => {
            setCancelling(true);

            try {
              const order = await cancelStoreOrder(String(id));

              setData(() => order);
              toastSuccess("Order cancelled", order.orderNumber);
            } catch (error) {
              toastError("Could not cancel", readApiError(error));
            } finally {
              setCancelling(false);
            }
          },
          style: "destructive",
          text: "Cancel order",
        },
      ],
    );
  }, [id, setData]);

  const header = <AppBar accent centerTitle showBack title="Order" />;

  if (resource.loading) {
    return (
      <Screen header={header}>
        <LoadingState label="Loading the order…" />
      </Screen>
    );
  }

  const order = resource.data;

  if (resource.error || !order) {
    return (
      <Screen header={header}>
        <ErrorState
          message={resource.error ?? "That order was not found."}
          onRetry={resource.reload}
        />
      </Screen>
    );
  }

  return (
    <Screen
      footer={
        order.canCancel ? (
          <View className="px-5 pt-3">
            <Button
              haptic={false}
              label="Cancel this order"
              loading={cancelling}
              onPress={cancel}
              variant="outline"
            />
          </View>
        ) : undefined
      }
      header={header}
      onRefresh={resource.refresh}
      refreshing={resource.refreshing}
      scroll
    >
      <View className="gap-6 pb-2 pt-4">
        {/*
          The state, first and large. `esewa-04` and `ebl-04` both open a detail
          screen with the identity, the timestamp and a status pill above the
          facts, and this is that: what it is, when it happened, where it is now.
        */}
        <Card className="gap-3">
          <View className="flex-row items-start justify-between gap-3">
            <View className="flex-1">
              <Text variant="subtitle">{order.orderNumber}</Text>
              <Text variant="caption">
                {order.createdAt ? formatDateTime(order.createdAt) : ""}
              </Text>
            </View>
            <Badge label={order.statusLabel} tone={orderTone(order.status)} />
          </View>

          <View className="flex-row items-center gap-2 rounded-xl bg-muted px-3 py-2.5">
            <Ionicons
              color={order.paymentStatus === "PAID" ? colors.success : colors.mutedForeground}
              name={order.paymentStatus === "PAID" ? "checkmark-circle" : "cash-outline"}
              size={18}
            />
            <Text className="flex-1 text-xs text-muted-foreground">
              {order.paymentStatus === "PAID"
                ? "Paid on delivery."
                : "Cash on delivery — pay the courier when it arrives."}
            </Text>
            <Money size="inline" value={rupees(order.total)} />
          </View>

          {order.status === "CANCELLED" && order.cancelledReason ? (
            <Text variant="caption">{order.cancelledReason}</Text>
          ) : null}
        </Card>

        <View>
          <SectionHeader title="What happened" />

          <Card className="gap-3">
            {order.timeline.map((entry, index) => (
              <TimelineRow
                entry={entry}
                key={`${entry.status}-${entry.at ?? index}`}
                latest={index === order.timeline.length - 1}
              />
            ))}
          </Card>
        </View>

        <View>
          <SectionHeader
            title={`${order.itemCount} ${order.itemCount === 1 ? "item" : "items"}`}
          />

          <Card className="gap-2.5">
            {order.items.map((item) => (
              <View className="flex-row items-start gap-2" key={item.productId}>
                <View className="flex-1">
                  <Text className="text-sm text-foreground" numberOfLines={2}>
                    {item.quantity} × {item.name}
                  </Text>
                  <Text variant="caption">
                    {`NPR ${(item.unitPrice / 100).toLocaleString("en-NP")} / ${item.unit}`}
                  </Text>
                </View>
                <Money size="inline" value={rupees(item.lineTotal)} />
              </View>
            ))}

            <View className="mt-1 gap-1.5 border-t border-border pt-3">
              <SummaryRow label="Subtotal" value={order.subtotal} />
              <SummaryRow
                free={order.deliveryFee === 0}
                label="Delivery"
                value={order.deliveryFee}
              />
              <View className="mt-1 flex-row items-center justify-between border-t border-border pt-2">
                <Text variant="subtitle">Total</Text>
                <Money size="inline" value={rupees(order.total)} />
              </View>
            </View>
          </Card>
        </View>

        <View>
          <SectionHeader title="Delivering to" />

          <Card padding="px-4 py-1">
            <FactRow label="Contact" value={order.delivery.contactName} />
            <FactRow label="Phone" value={order.delivery.phone} />
            <FactRow label="Address" value={order.delivery.addressLine} />
            {order.delivery.city ? (
              <FactRow label="City" value={order.delivery.city} />
            ) : null}
            {order.delivery.note ? (
              <FactRow label="Note" value={order.delivery.note} />
            ) : null}
          </Card>
        </View>

        {order.canCancel ? null : order.status === "CANCELLED" ||
          order.status === "DELIVERED" ? null : (
          <Text variant="caption">
            This order is already with us. Get in touch if something needs changing.
          </Text>
        )}

        <Button
          label="Back to the store"
          onPress={() => router.replace("/(store)")}
          variant="ghost"
        />
      </View>
    </Screen>
  );
}

/**
 * One step. The most recent one is filled; the rest are hollow.
 *
 * A filled-vs-hollow dot rather than a colour per status: five coloured dots in
 * a column is five things competing to be read, and the only one that matters is
 * where the order is *now*.
 */
function TimelineRow({
  entry,
  latest,
}: {
  entry: StoreOrder["timeline"][number];
  latest: boolean;
}) {
  const { colors } = useAppTheme();

  return (
    <View className="flex-row items-start gap-3">
      <View className="pt-1">
        <Ionicons
          color={latest ? colors.primary : colors.mutedForeground}
          name={latest ? "ellipse" : "ellipse-outline"}
          size={11}
        />
      </View>

      <View className="flex-1">
        <Text className={latest ? "text-sm font-semibold text-foreground" : "text-sm text-foreground"}>
          {entry.statusLabel}
        </Text>
        <Text variant="caption">
          {entry.at ? formatDateTime(entry.at) : ""}
          {entry.note ? ` · ${entry.note}` : ""}
        </Text>
      </View>
    </View>
  );
}

function SummaryRow({
  free = false,
  label,
  value,
}: {
  free?: boolean;
  label: string;
  value: number;
}) {
  return (
    <View className="flex-row items-center justify-between">
      <Text variant="muted">{label}</Text>
      {free ? (
        <Text className="text-sm font-semibold text-success">Free</Text>
      ) : (
        <Money size="inline" value={rupees(value)} />
      )}
    </View>
  );
}
