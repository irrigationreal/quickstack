/** @type {import('next').NextConfig} */
const nextConfig = {
    output: 'standalone',
    outputFileTracingRoot: process.cwd(),
    serverExternalPackages: ['@prisma/client', '@prisma/adapter-better-sqlite3', 'better-sqlite3'],
    eslint: {
        ignoreDuringBuilds: true,
    },
   /* experimental: {
        instrumentationHook: true
    }*/
};

export default nextConfig;
