import type { Metadata, Viewport } from "next";
import {
  Bricolage_Grotesque,
  Instrument_Serif,
  Geist_Mono,
} from "next/font/google";

import { ServiceWorkerRegistrar } from "@/components/pwa/ServiceWorkerRegistrar";
import { ThemeProvider } from "@/components/theme-provider";
import { getSiteUrl } from "@/lib/site-url";

import "katex/dist/katex.min.css";
import "./globals.css";

const uiFont = Bricolage_Grotesque({
  variable: "--font-ui",
  subsets: ["latin"],
});

const displayFont = Instrument_Serif({
  variable: "--font-display",
  subsets: ["latin"],
  weight: "400",
});

const monoFont = Geist_Mono({
  variable: "--font-mono-src",
  subsets: ["latin"],
});

const siteUrl = new URL(getSiteUrl());

export const metadata: Metadata = {
  metadataBase: siteUrl,
  title: "Vault",
  description: "A self-hosted collaborative document platform.",
  applicationName: "Vault",
  appleWebApp: {
    capable: true,
    title: "Vault",
    // `default` keeps the iOS status bar legible in both light and dark themes;
    // safe-area insets (see the shell) reserve space for the notch/home bar.
    statusBarStyle: "default",
  },
  formatDetection: {
    telephone: false,
  },
  openGraph: {
    title: "Vault",
    description: "A self-hosted collaborative document platform.",
    url: siteUrl,
    siteName: "Vault",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Vault",
    description: "A self-hosted collaborative document platform.",
  },
};

export const viewport: Viewport = {
  // `cover` lets the app draw into the notch/home-indicator area so we can
  // control safe-area insets ourselves (see the workspace shell + globals).
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0d0d0d" },
    { media: "(prefers-color-scheme: light)", color: "#fafafa" },
  ],
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
      className={`${uiFont.variable} ${displayFont.variable} ${monoFont.variable} dark h-full antialiased`}
      style={{ colorScheme: "dark" }}
    >
      <body className="flex min-h-full flex-col">
        <ServiceWorkerRegistrar />
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
