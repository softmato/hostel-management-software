import type { Metadata } from "next";
import { Geist, Geist_Mono, Poppins } from "next/font/google";

import { MediaViewerProvider } from "@/components/media-viewer";
import { QueryProvider } from "@/components/query-provider";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/toaster";
import { SITE_NAME, siteUrl } from "@/lib/site";

import "./globals.css";

const geistSans = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
});

const poppins = Poppins({
  subsets: ["latin"],
  variable: "--font-poppins",
  weight: ["400", "500", "600", "700"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: {
    default: `${SITE_NAME} — Find & Manage Hostels in Nepal`,
    template: `%s · ${SITE_NAME}`,
  },
  description: "Nepal-focused multi-hostel SaaS for discovery and hostel operations.",
  openGraph: {
    siteName: SITE_NAME,
    type: "website",
    locale: "en_NP",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${poppins.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider>
          <QueryProvider>
            {/* Any screen can open images or videos full-screen from here. */}
            <MediaViewerProvider>{children}</MediaViewerProvider>
          </QueryProvider>
          {/* Global feedback surface: live upload progress + one-shot toasts. */}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
