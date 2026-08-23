import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ['192.168.8.150', 'hypnoses-safeness-education.ngrok-free.dev'],
  // `sharp` is a native addon (needs a platform-specific .so binary). Next
  // also vendors its own internal copy for image optimization, and without
  // this, Turbopack's bundler traces/bundles the wrong one for the
  // serverless function — the deployed API route ends up unable to find
  // libvips at runtime (ERR_DLOPEN_FAILED) even though it built fine.
  // Marking it external forces Next to `require('sharp')` directly from
  // node_modules at runtime instead, which resolves the correct
  // architecture-specific binary Vercel actually installed.
  serverExternalPackages: ["sharp"],
};

export default nextConfig;