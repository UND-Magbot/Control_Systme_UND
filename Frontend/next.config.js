/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',         // ✅ 반드시 있어야 함
  trailingSlash: true,      // ✅ index.html 경로 안정화
  basePath: '',             // ✅ _next 경로 깨짐 방지
  images: { unoptimized: true }, // ✅ static export 시 Image Optimization 비활성화

  // 개발 시 API 프록시 (next dev에서만 동작, 빌드 시 무시됨)
  // localhost:3000/api/* → 백엔드/api/* 프록시
  // same-origin이 되므로 cross-origin 쿠키 문제 없음
  // 백엔드 포트: 8000 점유 중이라 8010 사용
  async rewrites() {
    const backend = 'http://localhost:8010';
    return [
      { source: '/api/:path*', destination: `${backend}/api/:path*` },
      { source: '/DB/:path*', destination: `${backend}/DB/:path*` },
      { source: '/robot/:path*', destination: `${backend}/robot/:path*` },
      { source: '/nav/:path*', destination: `${backend}/nav/:path*` },
      { source: '/map/:path*', destination: `${backend}/map/:path*` },
      { source: '/Video/:path*', destination: `${backend}/Video/:path*` },
      { source: '/static/:path*', destination: `${backend}/static/:path*` },
      { source: '/user/:path*', destination: `${backend}/user/:path*` },
      { source: '/ws/:path*', destination: `${backend}/ws/:path*` },
    ];
  },
};

module.exports = nextConfig;
