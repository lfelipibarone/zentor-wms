import { Stack } from "expo-router";
import { appStackScreenOptions } from "@/lib/navigation";

export default function PickingLayout() {
  return (
    <Stack screenOptions={appStackScreenOptions}>
      <Stack.Screen name="index" options={{ title: "Separação" }} />
      <Stack.Screen
        name="[orderId]/basket"
        options={{ title: "Escanear cesta" }}
      />
      <Stack.Screen
        name="[orderId]/pick"
        options={{ title: "Separar itens" }}
      />
    </Stack>
  );
}
