// .mjs (không phải .ts) để image production không cần cài TypeScript chỉ để đọc cấu hình.
/** @type {import("next").NextConfig} */
const nextConfig = {
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
