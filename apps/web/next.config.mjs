/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Hide the floating "N" dev indicator in the bottom-left corner.
  devIndicators: false,
  // Keep the scan engine and its native/node deps out of the bundle; they run
  // only in server actions.
  serverExternalPackages: ["@kelp/worker", "@kelp/core", "pg", "@octokit/app", "bullmq", "ioredis", "stripe"],
};

export default nextConfig;
