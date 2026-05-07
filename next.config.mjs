/** @type {import('next').NextConfig} */
const nextConfig = {
    output: 'standalone',
    outputFileTracingRoot: process.cwd(),
    eslint: {
        ignoreDuringBuilds: true,
    },
   /* experimental: {
        instrumentationHook: true
    }*/
};

export default nextConfig;
