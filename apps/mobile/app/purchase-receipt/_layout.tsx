import { Stack } from "expo-router";
import { appStackScreenOptions } from "@/lib/navigation";

export default function PurchaseReceiptLayout() {
  return (
    <Stack screenOptions={{ ...appStackScreenOptions, headerShown: false }} />
  );
}
