import type { Metadata } from "next";
import { LandingPage } from "@/components/landing/LandingPage";
export const metadata: Metadata = {
  title: "Investor Desk | Your conviction. A clearer picture.",
  description:
    "Build simulated stock, ETF, and options portfolios. Set your own price or valuation targets and explore the bigger picture, without placing real-money trades.",
};
export default function HomePage() {
  return <LandingPage />;
}
