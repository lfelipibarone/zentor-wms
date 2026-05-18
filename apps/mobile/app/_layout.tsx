import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthGate } from "@/components/AuthGate";
import { AuthProvider } from "@/contexts/AuthContext";
import { BackButton } from "@/components/BackButton";
import { appStackScreenOptions } from "@/lib/navigation";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 2, staleTime: 3_000 },
  },
});

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AuthGate>
          <StatusBar style="light" />
          <Stack screenOptions={appStackScreenOptions}>
            <Stack.Screen name="login" options={{ headerShown: false }} />
            <Stack.Screen name="index" options={{ headerShown: false }} />
            <Stack.Screen
              name="picking"
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="replenishment/index"
              options={{
                title: "Reabastecimento",
                headerLeft: () => <BackButton />,
              }}
            />
            <Stack.Screen
              name="stocking/index"
              options={{
                title: "Abastecer gôndola",
                headerLeft: () => <BackButton />,
              }}
            />
            <Stack.Screen
              name="lookup/index"
              options={{
                title: "Consulta rápida",
                headerLeft: () => <BackButton />,
              }}
            />
            <Stack.Screen
              name="perfil"
              options={{
                title: "Meu perfil",
                headerLeft: () => <BackButton />,
              }}
            />
            <Stack.Screen
              name="notifications"
              options={{
                title: "Notificações",
                headerLeft: () => <BackButton />,
              }}
            />
          </Stack>
        </AuthGate>
      </AuthProvider>
    </QueryClientProvider>
  );
}
