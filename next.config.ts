import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Không bật cacheComponents/PPR: vỏ tĩnh không mang được nonce CSP theo request (D-006).
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
