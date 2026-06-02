import { Stack } from "expo-router";
import { appStackScreenOptions } from "@/lib/navigation";

export default function WavePickingLayout() {
  return (
    <Stack screenOptions={appStackScreenOptions}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen
        name="[lineId]/pick"
        options={{ title: "Separar linha da onda" }}
      />
      <Stack.Screen
        name="[lineId]/sort"
        options={{ title: "Ordenar linha" }}
      />
    </Stack>
  );
}
