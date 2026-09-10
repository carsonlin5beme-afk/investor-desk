import type { Metadata } from "next";
import { PortfolioHub } from "@/components/PortfolioHub";
export const metadata: Metadata = {
  title: "Your Portfolio Hub | Investor Desk",
};
export default function DashboardPage() {
  return <PortfolioHub />;
}
