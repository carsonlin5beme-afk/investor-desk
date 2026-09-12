# Investor Desk emblem C

This is a code-native vector interpretation of **Option C (top right)** from the
latest ROME emblem concept sheet selected by the user on 2026-09-12. The source is
an image generated for this project, not a font glyph or downloaded logo:

`/Users/carsonlinville/.codex/generated_images/01a08862-258d-7192-bc0c-df23ef1ef852/exec-00380f54-62fa-441c-b4bf-f034456cda7c.png`

An unchanged project-local reference copy is preserved at `output/atlas-verification/emblem-c/concept-sheet.png`. The source PNG remains unchanged. The editable vector source is
`src/components/brand-emblem.ts`; `src/app/icon.svg` is a standalone favicon
rendering of the same six paths. There are no external fonts, images, scripts,
filters, masks, or clip paths in the emblem. The source sheet's glow is represented
by a restrained platinum-to-emerald stroke gradient, rather than a blur effect.
No additional enclosure, square, circle, or orbit has been added.

## Geometry and rendering contract

`brandEmblem` exports `viewBox`, `width`, `height`, `paths` (`id` and `d`),
`strokeWidth`, `compactStrokeWidth`, `strokeLinecap`, `strokeLinejoin`, and
`palette`. Render each path with `fill="none"`. The design retains the raised,
offset double D arch; interlocking top caps and D stems; separate double I stems
and foot caps; and the paired curved ribbon in the lower-right bowl.

For larger illustrations, use the 2.8-unit `strokeWidth` and normal SVG scaling.
For the app's 24–40px emblems, use the 0.85px `compactStrokeWidth` with
`vector-effect="non-scaling-stroke"` on every path. This keeps the thin paired
lines visible without changing their centerlines or the proportions of the C
design. Inherit `currentColor` for a monochrome treatment or apply the provided
platinum/emerald colors with an integration-specific, uniquely named gradient.
Accessible naming and decorative semantics belong to the integrating component.

The favicon uses the same compact stroke treatment on a transparent background.
It adapts to the browser's preferred light/dark color scheme; its dark-on-light
stroke avoids losing the platinum outline on a light browser tab.

## Proof artifacts

`output/atlas-verification/emblem-c/` contains a self-contained static SVG proof,
the standalone emblem, a repeatable proof generator, native-size browser
screenshots, and a validation receipt. The proof includes the selected geometry
at large scale and native 24, 32, and 40px sizes against dark and light surfaces.
These artifacts are development documentation, outside production build inputs.

The geometry is manually authored from the selected image. It is not a claim
that the generated raster was a pre-existing vector asset, nor a trademark or
rights clearance. No third-party typeface outlines are included in this emblem.
