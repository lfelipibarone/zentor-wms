import { Stack } from "expo-router";
import { BackButton } from "@/components/BackButton";
import { appStackScreenOptions } from "@/lib/navigation";

export default function PickingLayout() {
  return (
    <Stack screenOptions={appStackScreenOptions}>
      <Stack.Screen
        name="index"
        options={{
          title: "Separação",
          headerLeft: () => <BackButton />,
        }}
      />
      <Stack.Screen
        name="[orderId]/basket"
        options={{
          title: "Escanear cesta",
          headerLeft: () => <BackButton />,
        }}
      />
      <Stack.Screen
        name="[orderId]/pick"
        options={{
          title: "Separar itens",
          headerLeft: () => <BackButton />,
        }}
      />
    </Stack>
  );
}
