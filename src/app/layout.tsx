import { ThemeRuntime } from "@/components/ThemeRuntime";
import { AmbientRadio } from "@/components/AmbientRadio";
import { themeBootstrap } from "@/lib/theme";
import type { Metadata } from "next";
import localFont from "next/font/local";
const ui = localFont({
  src: "./fonts/dm-sans-variable.woff2",
  variable: "--font-ui",
  display: "swap",
  weight: "400 700",
});
const editorial = localFont({
  src: [
    {
      path: "./fonts/newsreader-variable.woff2",
      style: "normal",
      weight: "400 600",
    },
    {
      path: "./fonts/newsreader-italic-variable.woff2",
      style: "italic",
      weight: "400 600",
    },
  ],
  variable: "--font-editorial",
  display: "swap",
  adjustFontFallback: "Times New Roman",
  weight: "400 600",
});

import "@/app/globals.css";
import "@/app/luxury.css";

export const metadata: Metadata = {
  title: "Investor Desk",
  description:
    "Portfolio simulation with live equities/options pricing and target-based net worth projection.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      data-theme="dark"
      className={`${ui.variable} ${editorial.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body>
        <ThemeRuntime />
        <AmbientRadio>{children}</AmbientRadio>
      </body>
    </html>
  );
}
