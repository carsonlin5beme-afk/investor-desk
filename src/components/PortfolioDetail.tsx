import { InvestorDesk } from "./InvestorDesk";
export function PortfolioDetail({ portfolioId }: { portfolioId: string }) {
  return <InvestorDesk portfolioId={portfolioId} />;
}
