import Constants from "expo-constants";

const DEFAULT_API =
  process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3333";

export function getApiBaseUrl(): string {
  const hostUri = Constants.expoConfig?.hostUri;
  if (hostUri && !process.env.EXPO_PUBLIC_API_URL) {
    const host = hostUri.split(":")[0];
    return `http://${host}:3333`;
  }
  return DEFAULT_API;
}
