import { useLocalSearchParams } from "expo-router";

import { OrderDetail } from "@/features/orders/order-detail";

export default function OrderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <OrderDetail id={id ?? ""} />;
}
