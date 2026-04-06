/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',         // ✅ 반드시 있어야 함
  trailingSlash: true,      // ✅ index.html 경로 안정화
  basePath: '',             // ✅ _next 경로 깨짐 방지
  images: { unoptimized: true }, // ✅ static export 시 Image Optimization 비활성화

  // 개발 시 API 프록시 (next dev에서만 동작, 빌드 시 무시됨)
  // localhost:3000/api/* → localhost:8000/api/* 프록시
  // same-origin이 되므로 cross-origin 쿠키 문제 없음
  async rewrites() {
    return [
      { source: '/api/:path*', destination: 'http://localhost:8000/api/:path*' },
      { source: '/DB/:path*', destination: 'http://localhost:8000/DB/:path*' },
      { source: '/robot/:path*', destination: 'http://localhost:8000/robot/:path*' },
      { source: '/nav/:path*', destination: 'http://localhost:8000/nav/:path*' },
      { source: '/map/:path*', destination: 'http://localhost:8000/map/:path*' },
      { source: '/Video/:path*', destination: 'http://localhost:8000/Video/:path*' },
      { source: '/static/:path*', destination: 'http://localhost:8000/static/:path*' },
      { source: '/user/:path*', destination: 'http://localhost:8000/user/:path*' },
      { source: '/ws/:path*', destination: 'http://localhost:8000/ws/:path*' },
    ];
  },
};

module.exports = nextConfig;
