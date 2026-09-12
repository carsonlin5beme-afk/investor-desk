import type { CSSProperties } from "react";
import { brandArtwork } from "./brand-artwork";
import styles from "./Brand.module.css";

const accessibleText: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clipPath: "inset(50%)",
  whiteSpace: "nowrap",
  border: 0,
};

type BrandProps = { className?: string; style?: CSSProperties };

function BrandGlyphs({ word }: { word: keyof typeof brandArtwork }) {
  const artwork = brandArtwork[word];
  const [x, y, width, height] = artwork.viewBox.split(" ").map(Number);
  return (
    <svg
      data-brand-word={word}
      viewBox={[x - 20, y - 20, width + 40, height + 40].join(" ")}
      width={artwork.width + 40}
      height={artwork.height + 40}
      aria-hidden="true"
      focusable="false"
    >
      <path
        d={artwork.d}
        fill="currentColor"
        stroke="currentColor"
        strokeWidth={0.42}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export function BrandWordmark({
  layout = "inline",
  tone = "inherit",
  className = "",
  style,
}: BrandProps & { layout?: "inline" | "stacked"; tone?: "inherit" | "split" }) {
  return (
    <span
      data-brand-wordmark=""
      data-brand-layout={layout}
      className={[
        styles.wordmark,
        styles[layout],
        tone === "split" ? styles.split : "",
        className,
      ].join(" ")}
      style={style}
    >
      <span style={accessibleText}>Investor Desk</span>
      <BrandGlyphs word="investor" />
      <BrandGlyphs word="desk" />
    </span>
  );
}

export function BrandMonogram({
  className = "",
  style,
  decorative = false,
}: BrandProps & { decorative?: boolean }) {
  return (
    <span
      data-brand-monogram=""
      className={[styles.monogram, className].join(" ")}
      style={style}
      aria-hidden={decorative || undefined}
    >
      {decorative ? null : <span style={accessibleText}>Investor Desk</span>}
      <BrandGlyphs word="id" />
    </span>
  );
}
