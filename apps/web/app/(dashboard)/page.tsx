"use client";

import { Loader2 } from "lucide-react";
import { isPlatformOnlyAdmin } from "@wms/shared";
import { useAuth } from "@/components/auth/auth-provider";
import { DashboardView } from "@/components/dashboard/dashboard-view";
import { PlatformHomeView } from "@/components/platform/platform-home-view";

export default function DashboardPage() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-[#0d9488]" />
      </div>
    );
  }

  if (user && isPlatformOnlyAdmin(user)) {
    return <PlatformHomeView />;
  }

  return <DashboardView />;
}
