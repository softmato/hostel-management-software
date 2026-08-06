import type { Metadata } from "next";
import { Geist, Geist_Mono, Poppins } from "next/font/google";

import { MediaViewerProvider } from "@/components/media-viewer";
import { QueryProvider } from "@/components/query-provider";
import { SiteConfigProvider } from "@/components/site-config-provider";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/toaster";
import { siteUrl } from "@/lib/site";
import { loadSiteConfig } from "@/lib/site-config-server";

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

/**
 * Titles and OG metadata carry the owner-configured site name, so renaming the
 * platform in the admin portal renames the browser tab too.
 */
export async function generateMetadata(): Promise<Metadata> {
  const { identity } = await loadSiteConfig();

  return {
    metadataBase: new URL(siteUrl()),
    title: {
      default: identity.tagline
        ? `${identity.siteName} — ${identity.tagline}`
        : identity.siteName,
      template: `%s · ${identity.siteName}`,
    },
    description: "Nepal-focused multi-hostel SaaS for discovery and hostel operations.",
    openGraph: {
      siteName: identity.siteName,
      type: "website",
      locale: "en_NP",
    },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Loaded here rather than per route group so portals, auth screens, and the
  // marketing site all read branding from the same admin-owned source.
  const siteConfig = await loadSiteConfig();

  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${poppins.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider>
          <QueryProvider>
            <SiteConfigProvider config={siteConfig}>
              {/* Any screen can open images or videos full-screen from here. */}
              <MediaViewerProvider>{children}</MediaViewerProvider>
            </SiteConfigProvider>
          </QueryProvider>
          {/* Global feedback surface: live upload progress + one-shot toasts. */}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
