import type { CSSProperties } from "react";
import { brandArtwork } from "./brand-artwork";
import { brandEmblem } from "./brand-emblem";
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

function BrandGlyphs({
  word,
  emphasizeInitial = false,
}: {
  word: keyof typeof brandArtwork;
  emphasizeInitial?: boolean;
}) {
  const artwork = brandArtwork[word];
  const [x, y, width, height] = artwork.viewBox.split(" ").map(Number);
  // A capped double-line I avoids the original glyph's H-like middle crossbar.
  const replaceInitial = word === "investor";
  const prominentInitial = emphasizeInitial && replaceInitial;
  const initialEnd = artwork.d.indexOf("Z") + 1;
  const extraWidth = replaceInitial ? (prominentInitial ? 140 : 80) : 0;
  const initialPath =
    "M50 -750H290V-740H50Z M50 -675H290V-665H50Z " +
    "M130 -650H140V-100H130Z M200 -650H210V-100H200Z " +
    "M50 -85H290V-75H50Z M50 -10H290V0H50Z";
  return (
    <svg
      data-brand-word={word}
      viewBox={[x - 20, y - 20, width + 40 + extraWidth, height + 40].join(" ")}
      width={artwork.width + 40 + extraWidth}
      height={artwork.height + 40}
      aria-hidden="true"
      focusable="false"
    >
      <g fill="currentColor" stroke="currentColor">
        {replaceInitial ? (
          <path
            data-brand-initial=""
            d={initialPath}
            transform={
              prominentInitial ? undefined : "translate(12.5 0) scale(.75 1)"
            }
            strokeWidth={0.42}
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
        <path
          d={replaceInitial ? artwork.d.slice(initialEnd) : artwork.d}
          transform={replaceInitial ? `translate(${extraWidth} 0)` : undefined}
          strokeWidth={0.42}
          vectorEffect="non-scaling-stroke"
        />
      </g>
    </svg>
  );
}

export function BrandWordmark({
  layout = "inline",
  tone = "inherit",
  className = "",
  style,
  emphasizeInitial = false,
}: BrandProps & {
  layout?: "inline" | "stacked";
  tone?: "inherit" | "split";
  emphasizeInitial?: boolean;
}) {
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
      <BrandGlyphs word="investor" emphasizeInitial={emphasizeInitial} />
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
      <svg
        data-brand-emblem="c"
        viewBox={brandEmblem.viewBox}
        width={brandEmblem.width}
        height={brandEmblem.height}
        fill="none"
        stroke="currentColor"
        strokeWidth={brandEmblem.compactStrokeWidth}
        strokeLinecap={brandEmblem.strokeLinecap}
        strokeLinejoin={brandEmblem.strokeLinejoin}
        aria-hidden="true"
        focusable="false"
      >
        {brandEmblem.paths.map(({ id, d }) => (
          <path key={id} d={d} vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
    </span>
  );
}
