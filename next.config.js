/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config) => {
    // Suppress canvas/encoding peer deps that pdfjs-dist and jsPDF reference
    config.resolve.alias.canvas   = false;
    config.resolve.alias.encoding = false;
    return config;
  },
};

module.exports = nextConfig;
