import Link from "next/link";
import { AmbientRadioOrb } from "@/components/AmbientRadio";
import { BrandWordmark } from "@/components/Brand";
import styles from "./landing.module.css";
import hero from "./orbit-hero.module.css";
import { OrbitArtwork } from "./OrbitArtwork";
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
        <AmbientRadioOrb autoPlay />
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
            </div>
          </div>
          <OrbitArtwork />
        </section>
      </main>
    </div>
  );
}
