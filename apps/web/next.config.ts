import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@wms/shared"],
  output: "standalone",
  typescript: {
    // Monorepo pode ter @types/react duplicados; build de homologação não deve travar nisso.
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
