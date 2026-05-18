import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  fetchMe,
  getStoredToken,
  loginMobile,
  logoutMobile,
  type MobileUser,
} from "@/lib/auth";
import { registerSessionExpiredHandler } from "@/lib/session-events";
import { setupPushNotifications } from "@/lib/push";

interface AuthContextValue {
  user: MobileUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<MobileUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const token = await getStoredToken();
    if (!token) {
      setUser(null);
      return;
    }
    try {
      setUser(await fetchMe(token));
    } catch {
      await logoutMobile();
      setUser(null);
    }
  }, []);

  useEffect(() => {
    refresh()
      .then(() => setupPushNotifications().catch(() => {}))
      .finally(() => setLoading(false));
  }, [refresh]);

  useEffect(() => registerSessionExpiredHandler(() => setUser(null)), []);

  const login = useCallback(async (email: string, password: string) => {
    const { user: loggedIn } = await loginMobile(email, password);
    setUser(loggedIn);
    setupPushNotifications().catch(() => {});
  }, []);

  const logout = useCallback(async () => {
    await logoutMobile();
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, logout, refresh }),
    [user, loading, login, logout, refresh],
  );

  return (
    <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth requer AuthProvider");
  return ctx;
}
