import { networkInterfaces } from "node:os";
import type { NextConfig } from "next";

/**
 * This machine's LAN IPv4 addresses, so a phone on the same Wi-Fi can use the
 * dev server (`npm run dev -- -H 0.0.0.0`). Detected at startup because the
 * router may assign a different address later. Dev-only; no effect in production.
 */
function lanAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .filter((iface) => iface && iface.family === "IPv4" && !iface.internal)
    .map((iface) => iface!.address);
}

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  allowedDevOrigins: lanAddresses(),
};

export default nextConfig;
