import '@/app/globals.css'
import type { Viewport } from "next";
import { AuthProvider } from "@/app/context/AuthContext";
import { DebugMapProvider } from "@/app/components/map/DebugMapContext";
import DebugMapPanelLoader from "@/app/components/map/DebugMapPanelLoader";

export const metadata = {
  icons: { icon: "data:," },
};

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
            <DebugMapPanelLoader />
          </DebugMapProvider>
        </AuthProvider>
      </body>
    </html>
  )
}