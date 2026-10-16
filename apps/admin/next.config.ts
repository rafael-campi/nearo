import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Os links de convite e de redefinição de senha levam o token na URL: nada disso vai no cabeçalho Referer.
  async headers() {
    return [{ source: "/:path*", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] }];
  },
  cacheComponents: true,
  partialPrefetching: true,
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
