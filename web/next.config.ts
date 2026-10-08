import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    // Use Next's TypeScript API checker; the CLI subprocess in this Node
    // environment returns empty --showConfig output during `next build`.
    useTypeScriptCli: false,
  },
};

export default nextConfig;
