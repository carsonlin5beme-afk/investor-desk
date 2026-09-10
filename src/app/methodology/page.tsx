import { DocumentPage } from "@/components/DocumentPage";
export default function Page() {
  return (
    <DocumentPage
      eyebrow="THE ASSUMPTIONS, IN THE OPEN"
      title="What your numbers mean."
    >
      <p>
        Investor Desk is a what-if workspace. A target expresses your assumption
        about a future price. It does not assign a probability, predict a date,
        or represent an actual return.
      </p>
      <h2>Current value</h2>
      <p>
        Portfolio value combines virtual cash with the current marked value of
        each holding. Stocks use quantity × share price. Standard long options
        use contracts × premium × contract multiplier. The interface identifies
        sample, stale, and estimated quotes, with their sources and timestamps.
      </p>
      <h2>Price and valuation targets</h2>
      <p>
        A stock or ETF target multiplies quantity by your target share price. A
        company-valuation target divides market capitalization by the effective
        shares outstanding to derive that price. Manual share counts are
        labeled. Company market-cap targeting is unsuitable for ETF net asset
        values.
      </p>
      <h2>Option estimates</h2>
      <p>
        Intrinsic value is the option’s exercise value at the underlying target,
        multiplied by contracts and their deliverable. Calls use the positive
        difference between target and strike; puts reverse that difference.
      </p>
      <p>
        The model uses Black–Scholes with remaining time, provider implied
        volatility when available, a labeled 60% fallback when unavailable, a 4%
        interest rate, and zero dividends. These are simplified estimates.
        Standard long options only: no adjusted contracts, early exercise,
        automatic exercise, margin, or short positions.
      </p>
      <h2>The chart’s horizontal axis</h2>
      <p>
        Scenario progress moves every targeted holding toward its own target
        together. It is not time. Equity and intrinsic comparisons interpolate
        between current and target values. Option model curves apply the chosen
        underlying price and taper the difference between today’s quote and
        today’s model to zero at the target. Untargeted holdings and cash remain
        constant.
      </p>
      <h2>Saved possibilities</h2>
      <p>
        Each saved scenario captures its holdings, quotes, cash, model date, and
        assumptions. Its values remain comparable after the live workspace
        changes. Custom volatility, interest, and elapsed-time assumptions
        affect that scenario alone.
      </p>
      <h2>Simulated execution</h2>
      <p>
        Simulated buys fill at the ask and sells at the bid. A limit order fills
        immediately only when the current quote satisfies the limit; otherwise
        it cancels. Limits do not rest at a broker. Quantities and cash are
        validated by the server. Fees, dividends, and corporate actions are not
        modeled.
      </p>
      <h2>Reading an investment brief</h2>
      <p>
        Reports state their selected portfolios, holdings scope, currency, quote
        sources, and timestamps. Filtered reports retain cash from the selected
        portfolios and say so. CSV and JSON exports contain exact amounts even
        when the printable presentation is masked. Activity is a recent
        transaction record, not historical performance or a tax statement.
      </p>
    </DocumentPage>
  );
}
