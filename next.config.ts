import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Sick notes are uploaded through a server action (photos up to 10 MB).
    serverActions: { bodySizeLimit: "11mb" },
  },
};

export default nextConfig;
