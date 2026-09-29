import path from 'node:path';

/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: path.resolve(import.meta.dirname),
  webpack: (config) => {
    // @shadergradient/react exports only an `import` condition, which webpack's
    // specifier resolution skips — alias the specifier straight to the file.
    config.resolve.alias['@shadergradient/react'] = path.resolve(
      import.meta.dirname,
      'node_modules/@shadergradient/react/dist/index.mjs',
    );
    return config;
  },
  async rewrites() {
    return [
      { source: '/manifest', destination: '/manifest.app.json' },
      { source: '/.well-known/agent-page', destination: '/api/discovery' },
    ];
  },
  async redirects() {
    return [{ source: '/html', destination: '/', permanent: true }];
  },
};

export default nextConfig;
