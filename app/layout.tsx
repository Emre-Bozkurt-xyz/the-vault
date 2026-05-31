import type { Metadata } from "next";
import {
  Bricolage_Grotesque,
  Instrument_Serif,
  Geist_Mono,
} from "next/font/google";

import { ThemeProvider } from "@/components/theme-provider";

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

export const metadata: Metadata = {
  title: "Vault",
  description: "A self-hosted collaborative document platform.",
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
      className={`${uiFont.variable} ${displayFont.variable} ${monoFont.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
