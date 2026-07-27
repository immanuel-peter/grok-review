/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // Keep the postgres driver as a real Node dependency so standalone tracing
  // copies it into .next/standalone/node_modules.
  serverExternalPackages: ["postgres"],
};

export default nextConfig;
