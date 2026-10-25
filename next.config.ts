import type { NextConfig } from 'next';

const config: NextConfig = {
  serverExternalPackages: ['@electric-sql/pglite'],
  outputFileTracingIncludes: { '/api/**': ['./data/players.json'] },
};

export default config;
