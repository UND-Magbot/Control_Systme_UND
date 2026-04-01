import '@/app/globals.css'
import type { Viewport } from "next";
import { DebugMapProvider } from "@/app/components/map/DebugMapContext";
import DebugMapPanel from "@/app/components/map/DebugMapPanel";
import { AuthProvider } from "@/app/context/AuthContext";

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
      <body suppressHydrationWarning>
        <AuthProvider>
          <DebugMapProvider>
            {children}
            <DebugMapPanel />
          </DebugMapProvider>
        </AuthProvider>
      </body>
    </html>
  )
}