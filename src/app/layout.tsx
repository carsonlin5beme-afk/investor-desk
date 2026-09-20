import { ThemeRuntime } from "@/components/ThemeRuntime";
import { AmbientRadio } from "@/components/AmbientRadio";
import { themeBootstrap } from "@/lib/theme";
import type { Metadata } from "next";
import localFont from "next/font/local";
const ui = localFont({
  src: "./fonts/dm-sans-variable.woff2",
  variable: "--font-fallback",
  preload: false,
  display: "swap",
  weight: "400 700",
});
// Keep financial figures legible even inside the decorative ROME/WHARF faces.
const numerals = localFont({
  src: "./fonts/dm-sans-variable.woff2",
  variable: "--font-numerals",
  preload: false,
  display: "swap",
  weight: "400 700",
  adjustFontFallback: false,
  declarations: [
    {
      prop: "unicode-range",
      value: "U+0024-0025,U+002B-002E,U+0030-0039,U+00A3,U+00A5,U+20AC,U+2212",
    },
  ],
});
const buttonFace = localFont({
  src: "./fonts/high-tide.otf",
  variable: "--font-button-regular",
  display: "swap",
  weight: "400",
  adjustFontFallback: false,
});
const rome = localFont({
  src: "./fonts/arenq.otf",
  variable: "--font-rome",
  display: "swap",
  weight: "400",
  adjustFontFallback: false,
});
// The original Sans variant supplies only the clearer T/t crossbars.
const buttonT = localFont({
  src: "./fonts/high-tide-sans.otf",
  variable: "--font-button-t",
  display: "swap",
  weight: "400",
  adjustFontFallback: false,
  declarations: [{ prop: "unicode-range", value: "U+0054,U+0074" }],
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
      className={`${ui.variable} ${numerals.variable} ${rome.variable} ${buttonFace.variable} ${buttonT.variable}`}
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
