import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import Link from "next/link";

import { BottomNav, SidebarNav } from "@/components/nav";
import { SampleBanner } from "@/components/ui";
import { isSampleMode } from "@/lib/data";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: "DayKind", template: "%s · DayKind" },
  description: "A private daily record of sleep, movement, and recovery.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f5f0" },
    { media: "(prefers-color-scheme: dark)", color: "#141715" },
  ],
};

function Brand() {
  return (
    <Link href="/" className="brand">
      <span className="brand-mark" aria-hidden="true">
        dk
      </span>
      DayKind
    </Link>
  );
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  const sample = isSampleMode();
  return (
    <html lang="en" className={geistSans.variable}>
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <div className="shell">
          <nav className="sidebar" aria-label="Main">
            <Brand />
            <SidebarNav />
            <p className="sidebar-footer">
              Guidance is general information, not medical advice.
            </p>
          </nav>
          <main id="main" className="main">
            <div className="mobile-header">
              <Brand />
            </div>
            {sample ? <SampleBanner /> : null}
            {children}
          </main>
        </div>
        <nav className="bottom-nav" aria-label="Main">
          <BottomNav />
        </nav>
      </body>
    </html>
  );
}
