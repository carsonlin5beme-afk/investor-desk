import { InvestorDesk } from "@/components/InvestorDesk";
export default async function PortfolioDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <InvestorDesk portfolioId={(await params).id} />;
}
