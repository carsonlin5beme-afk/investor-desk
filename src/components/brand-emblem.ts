/**
 * Original vector interpretation of the user-selected ROME concept-sheet C.
 * Provenance and compact rendering guidance: docs/third-party/emblem-c.md.
 * These are open stroked paths; do not fill them or add an enclosing frame.
 */
export const brandEmblem = {
  viewBox: "-5 0 240 240",
  width: 240,
  height: 240,
  strokeWidth: 2.8,
  compactStrokeWidth: 0.85,
  strokeLinecap: "butt",
  strokeLinejoin: "miter",
  palette: {
    platinum: "#d9e3de",
    emerald: "#a5d5bc",
    lightInk: "#28503f",
  },
  paths: [
    {
      id: "outer-d-and-lower-cap",
      d: "M53 32V6H115C177 6 223 56 223 116C223 179 171 233 88 233V54H6",
    },
    {
      id: "inner-d-and-upper-cap",
      d: "M65 32V19H114C167 19 210 64 210 116C210 169 163 217 101 220V41H6",
    },
    { id: "i-stems", d: "M36 64V190M50 64V190" },
    { id: "i-foot-caps", d: "M6 199H76M6 211H76" },
    {
      id: "outer-ribbon",
      d: "M114 96C150 118 178 150 185 181",
    },
    {
      id: "inner-ribbon",
      d: "M114 109C146 129 169 159 174 192",
    },
  ],
} as const;
