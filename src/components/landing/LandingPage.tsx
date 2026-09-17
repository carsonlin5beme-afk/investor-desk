import Link from "next/link";
import { AmbientRadioOrb } from "@/components/AmbientRadio";
import { BrandWordmark } from "@/components/Brand";
import {
  ArrowDown,
  ArrowUpRight,
  Check,
  Layers,
  LockKeyhole,
  MoveUpRight,
  SlidersHorizontal,
  Wallet,
} from "lucide-react";
import { ScenarioPreview } from "./ScenarioPreview";
import styles from "./landing.module.css";
import hero from "./orbit-hero.module.css";
import { OrbitArtwork } from "./OrbitArtwork";
const questions = [
  {
    question: "Is this a brokerage account?",
    answer:
      "No. Investor Desk is a portfolio simulator. You assign virtual cash, enter simulated orders, and explore hypothetical outcomes. No money is deposited and no orders are sent to a broker.",
  },
  {
    question: "Are the prices on this page live?",
    answer:
      "No. The examples on this page use clearly labeled sample prices and assumed share counts. The app starts in sample mode. Supported market-data providers can be connected with your own API credentials and appropriate entitlements; current quote updates use snapshot polling.",
  },
  {
    question: "How are projected values calculated?",
    answer:
      "Stock and ETF targets use shares multiplied by your target price. Company market-cap targets are divided by the effective shares outstanding to derive a share price. The app shows both intrinsic and model estimates for standard long options. The landing-page option example shows intrinsic value only.",
  },
  {
    question: "Does a projection predict what will happen?",
    answer:
      "No. It answers a what-if question: what would your portfolio be worth if every holding reached its own target simultaneously? It is not a probability estimate, a timeline, or investment advice. Actual results can differ substantially, and options can expire worthless.",
  },
];
export function LandingPage() {
  return (
    <div className={styles.page} data-landing-page>
      <a href="#main" className={styles.skipLink}>
        Skip to content
      </a>
      <header className={`${styles.header} ${styles.titleHeader}`}>
        <Link href="/sign-in" className={styles.headerCta}>
          Sign in
        </Link>
        <AmbientRadioOrb />
      </header>
      <main id="main">
        <section
          className={hero.hero}
          data-orbit-hero
          aria-labelledby="hero-heading"
        >
          <div className={hero.copy}>
            <h1 id="hero-heading" className={hero.title}>
              <BrandWordmark
                layout="stacked"
                tone="split"
                className={hero.titleBrand}
                emphasizeInitial
              />
            </h1>
            <div className={hero.actions}>
              <Link href="/dashboard" className={hero.primary}>
                <span>Workspace</span>
              </Link>
              <a href="#explore-example" className={hero.secondary}>
                Explore the example <ArrowDown size={15} aria-hidden="true" />
              </a>
            </div>
          </div>
          <OrbitArtwork />
        </section>
        <section
          id="explore-example"
          className={styles.exploreExample}
          aria-labelledby="example-heading"
        >
          <div className={styles.exampleIntro}>
            <h2 id="example-heading">
              A little perspective.
              <br />
              <em>A bigger picture.</em>
            </h2>
            <p>
              Move a target. See how one idea changes the whole portfolio.
              Explore stocks and options with this interactive example.
            </p>
          </div>
          <ScenarioPreview />
        </section>
        <section
          className={styles.assetStrip}
          aria-label="Supported portfolio assets"
        >
          <p>One desk. Infinite simulations.</p>
          <div>
            <span>Stocks</span>
            <span>ETFs</span>
            <span>Long options</span>
            <span>Virtual cash</span>
          </div>
        </section>
        <section
          id="how-it-works"
          className={styles.workflow}
          aria-labelledby="workflow-heading"
        >
          <div className={styles.sectionIntro}>
            <div>
              <span className={styles.eyebrow}>FROM AN IDEA TO A SCENARIO</span>
              <h2 id="workflow-heading">
                What if, <em>made tangible.</em>
              </h2>
            </div>
          </div>
          <div className={styles.steps}>
            <article>
              <div className={styles.stepTop}>
                <span>01</span>
                <Wallet size={24} strokeWidth={1.3} aria-hidden="true" />
              </div>
              <h3>Give your ideas a home.</h3>
              <p>
                Create a portfolio and assign its virtual cash. Keep your
                long-term plan, personal account, and next big idea separate.
              </p>
              <span className={styles.stepLabel}>
                YOUR PORTFOLIO. YOUR STARTING POINT.
              </span>
            </article>
            <article>
              <div className={styles.stepTop}>
                <span>02</span>
                <Layers size={24} strokeWidth={1.3} aria-hidden="true" />
              </div>
              <h3>Build the position.</h3>
              <p>
                Simulate buying stocks, ETFs, or long options with an order
                ticket. See the cost, remaining cash, and what you own.
              </p>
              <span className={styles.stepLabel}>
                STOCKS, ETFS & STANDARD LONG OPTIONS.
              </span>
            </article>
            <article>
              <div className={styles.stepTop}>
                <span>03</span>
                <SlidersHorizontal
                  size={24}
                  strokeWidth={1.3}
                  aria-hidden="true"
                />
              </div>
              <h3>Put a number on your thesis.</h3>
              <p>
                Set a share-price or company-valuation target. See each
                holding&apos;s potential value and the combined portfolio
                scenario.
              </p>
              <span className={styles.stepLabel}>
                EVERY TARGET. ONE BIGGER PICTURE.
              </span>
            </article>
          </div>
        </section>
        <section
          id="your-workspace"
          className={styles.workspace}
          aria-labelledby="workspace-heading"
        >
          <div className={styles.workspaceVisual}>
            <div className={styles.workspaceVisualTop}>
              <span>THE PORTFOLIO HUB</span>
              <Layers size={18} aria-hidden="true" />
            </div>
            <div className={styles.accountRow}>
              <span className={styles.accountIndex}>01</span>
              <div>
                <strong>Personal</strong>
                <span>Everyday ideas. A long-term view.</span>
              </div>
              <span className={styles.accountAmount}>
                $250,000<small>STARTING CASH</small>
              </span>
            </div>
            <div className={styles.accountRow}>
              <span className={styles.accountIndex}>02</span>
              <div>
                <strong>The long game</strong>
                <span>Room for conviction to grow.</span>
              </div>
              <span className={styles.accountAmount}>
                $100,000<small>STARTING CASH</small>
              </span>
            </div>
            <div className={styles.accountRow}>
              <span className={styles.accountIndex}>03</span>
              <div>
                <strong>What if?</strong>
                <span>A place to test a different thesis.</span>
              </div>
              <span className={styles.accountAmount}>
                $50,000<small>STARTING CASH</small>
              </span>
            </div>
          </div>
          <div className={styles.workspaceCopy}>
            <span className={styles.eyebrow}>
              SEPARATE IDEAS. SHARED CLARITY.
            </span>
            <h2 id="workspace-heading">
              One hub.
              <br />
              Different <em>ambitions.</em>
            </h2>
            <p>
              Not every investment idea belongs in the same portfolio. Explore
              different allocations without mixing their cash, positions, or
              targets.
            </p>
            <ul>
              <li>
                <Check size={15} aria-hidden="true" />
                Independent portfolios and cash balances
              </li>
              <li>
                <Check size={15} aria-hidden="true" />
                Current values alongside target scenarios
              </li>
              <li>
                <Check size={15} aria-hidden="true" />
                Option intrinsic and model estimates, side by side
              </li>
            </ul>
            <Link href="/dashboard" className={styles.textCta}>
              Find your bigger picture{" "}
              <ArrowUpRight size={17} aria-hidden="true" />
            </Link>
          </div>
        </section>
        <section
          className={styles.principles}
          aria-label="Simulation principles"
        >
          <div>
            <LockKeyhole size={19} strokeWidth={1.5} aria-hidden="true" />
            <strong>Your ideas, kept close.</strong>
            <p>
              Explore in a temporary guest workspace. Save to a profile to keep
              your portfolios, scenarios, and journal in the local database.
            </p>
          </div>
          <div>
            <SlidersHorizontal size={19} strokeWidth={1.5} aria-hidden="true" />
            <strong>Assumptions in the open.</strong>
            <p>
              See quote sources, timestamps, and the inputs behind your
              projections.
            </p>
          </div>
          <div>
            <MoveUpRight size={19} strokeWidth={1.5} aria-hidden="true" />
            <strong>Possibilities, not promises.</strong>
            <p>
              Explore your own targets. Not a forecast, financial advice, or
              guaranteed return.
            </p>
          </div>
        </section>
        <section
          id="questions"
          className={styles.questions}
          aria-labelledby="questions-heading"
        >
          <div>
            <span className={styles.eyebrow}>A LITTLE CLARITY</span>
            <h2 id="questions-heading">
              Before you
              <br />
              <em>take a seat.</em>
            </h2>
            <p>
              Know what your numbers mean.
              <br />
              And what they don&apos;t.
            </p>
          </div>
          <div className={styles.accordion}>
            {questions.map(({ question, answer }) => (
              <details key={question}>
                <summary>
                  {question}
                  <span className={styles.questionIcon} aria-hidden="true" />
                </summary>
                <p>{answer}</p>
              </details>
            ))}
          </div>
        </section>
        <section className={styles.closing} aria-labelledby="closing-heading">
          <div className={styles.closingOrbit} aria-hidden="true" />
          <span className={styles.eyebrow}>THERE&apos;S A BIGGER PICTURE.</span>
          <h2 id="closing-heading">
            Make room for
            <br />
            your <em>next what-if.</em>
          </h2>
          <Link href="/dashboard" className={styles.lightCta}>
            Open your workspace <ArrowUpRight size={18} aria-hidden="true" />
          </Link>
          <p>Start with virtual cash. Keep your real money out of it.</p>
        </section>
      </main>
      <footer className={styles.footer}>
        <div>
          <Link href="/" className={styles.footerBrand}>
            <BrandWordmark layout="inline" />
          </Link>
          <p>Perspective for the portfolio you imagine.</p>
        </div>
        <nav aria-label="Footer navigation">
          <a href="#how-it-works">How it works</a>
          <a href="#questions">Questions</a>
          <Link href="/methodology">Methodology</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/dashboard">
            Open workspace <ArrowUpRight size={13} aria-hidden="true" />
          </Link>
        </nav>
        <div className={styles.footerLegal}>
          <span className={styles.brandSignature}>
            <BrandWordmark layout="inline" />
            <span>/ Local-first portfolio simulation</span>
          </span>
          <p>
            All examples are hypothetical. Simulated results are not actual
            investment performance. Market-data access depends on provider
            credentials and entitlements.
          </p>
        </div>
      </footer>
    </div>
  );
}
