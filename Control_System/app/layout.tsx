import '@/app/globals.css'
import type { Viewport } from "next";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0EA5E9"
};


export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  
  return (    
    <html lang="ko">
      <body>{children}</body>
    </html>
  )
}