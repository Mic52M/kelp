/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Keep the scan engine and its native/node deps out of the bundle; they run
  // only in server actions.
  serverExternalPackages: ["@kelp/worker", "@kelp/core", "pg", "@octokit/app"],
};

export default nextConfig;
