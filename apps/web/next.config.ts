import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@wms/shared"],
  output: "standalone",
};

export default nextConfig;
