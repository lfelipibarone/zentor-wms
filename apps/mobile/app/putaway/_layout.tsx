import { Stack } from "expo-router";
import { appStackScreenOptions } from "@/lib/navigation";

export default function PutawayLayout() {
  return (
    <Stack screenOptions={{ ...appStackScreenOptions, headerShown: false }} />
  );
}
