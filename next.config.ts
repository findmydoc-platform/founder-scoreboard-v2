import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      {
        source: "/reviews",
        destination: "/planning?tasks.review=requested",
        permanent: true,
      },
      {
        source: "/reviews/:id",
        destination: "/tasks/:id",
        permanent: true,
      },
    ];
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "avatars.githubusercontent.com",
      },
    ],
  },
};

export default nextConfig;
