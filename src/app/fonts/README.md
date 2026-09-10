# Local typefaces

Investor Desk serves genuine variable fonts through `next/font/local`; no font request goes to Google or another external service at runtime.

- **DM Sans**: UI, weights 400–700, optical-size axis 9–40. Upstream: [Google Fonts / DM Sans](https://github.com/google/fonts/tree/main/ofl/dmsans). License: `dmsans-OFL.txt`.
- **Newsreader**: editorial headings, normal and italic, weights 400–600, optical-size axis 6–72. Upstream: [Google Fonts / Newsreader](https://github.com/google/fonts/tree/main/ofl/newsreader). License: `newsreader-OFL.txt`.

The three WOFF2 files were generated from the original variable TTFs using fontTools 4.64.0 and Brotli 1.2.0. Weight axes were restricted with `fontTools.varLib.instancer.instantiateVariableFont` while preserving optical sizing. A fontTools subset retains Latin/Latin Extended, combining accents, punctuation, currency symbols, arrows, and supported mathematical symbols (Unicode U+0020–024F, U+0300–036F, U+2000–206F, U+20A0–20CF, U+2190–22FF, U+25A0–25FF, U+FEFF and U+FFFD). Other characters use the system font fallback.

OpenType layout features and font name/license records are retained. Each generated font was reloaded to verify its variable axes, retained Unicode coverage, and sampled text advance widths against the source at weights 400, 500, and the maximum supported weight. Optical sizing remains variable; these are not static bold faces.

The delivered font files total **343,536 bytes**, down from **1,187,512 bytes** of variable TTF source files (71.1% smaller, before transfer compression). The old TTFs and unused early static WOFF2 files were removed after verification. Runtime font conversion is not required.
