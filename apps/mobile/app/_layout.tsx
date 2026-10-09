import "react-native-gesture-handler";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthGate } from "@/components/AuthGate";
import { Toaster } from "@/components/Toaster";
import { AuthProvider } from "@/contexts/AuthContext";
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
              name="wave-picking"
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="ressuprimento/index"
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="atualizar-gondola/index"
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="armazenagem-pulmao/index"
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="cargo-transport/index"
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="stocking/index"
              options={{ headerShown: false }}
            />
            <Stack.Screen name="lookup/index" options={{ headerShown: false }} />
            <Stack.Screen
              name="purchase-receipt"
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="putaway"
              options={{ headerShown: false }}
            />
            <Stack.Screen name="perfil" options={{ headerShown: false }} />
            <Stack.Screen name="minhas-tarefas" options={{ headerShown: false }} />
            <Stack.Screen
              name="notifications"
              options={{ headerShown: false }}
            />
          </Stack>
          <Toaster />
        </AuthGate>
      </AuthProvider>
    </QueryClientProvider>
  );
}
