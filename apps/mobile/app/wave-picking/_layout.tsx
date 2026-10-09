import { Stack } from "expo-router";
import { appStackScreenOptions } from "@/lib/navigation";

export default function WavePickingLayout() {
  return (
    <Stack screenOptions={{ ...appStackScreenOptions, headerShown: false }} />
  );
}
