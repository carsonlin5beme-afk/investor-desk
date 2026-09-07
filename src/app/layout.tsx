import type { Metadata } from "next";

import "@/app/globals.css";

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
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
