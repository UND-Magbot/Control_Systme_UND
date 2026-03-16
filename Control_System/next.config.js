/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',         // ✅ 반드시 있어야 함
  trailingSlash: true,      // ✅ index.html 경로 안정화
  basePath: '',             // ✅ _next 경로 깨짐 방지
};

module.exports = nextConfig;
