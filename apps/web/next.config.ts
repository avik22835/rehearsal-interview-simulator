import type { NextConfig } from 'next';
const config: NextConfig = {
  // Model generation may be silent while a browser tab loads or thinks.
  // Let the API's configured timeout own that limit, not the 30-second proxy.
  experimental: { proxyTimeout: 1_260_000 },
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${process.env.SIMULATOR_API_URL || 'http://127.0.0.1:8000'}/api/:path*` }];
  },
};
export default config;
