# Homepage redesign (quiet paper)

Supersedes `2026-10-28-homepage-taste-redesign.md`. The full design record is `.unslop-build/home2/DIRECTION.md` (outside the repo); this file keeps what a maintainer needs.

## Idea

orrn keeps one record for a plant, so the page shows one record. The hero object is the bundle page that the QR on a label opens, drawn only with fields that page has. Its codes (bundle `26J4086`, die copy `12170-1`, cast `J14`, dispatch `DSP-000412`) come back in the stage list and the scan sheet, so the page proves its own claim. Everything else is quiet paper, black type and the product's own screens. The one loud thing is the headline.

## Tokens

Values come from `packages/ui/src/styles/globals.css` unless marked new.

| Token | Light | Dark |
| --- | --- | --- |
| canvas | `#f4f4f1` | `#0c0c0e` |
| surface | `#ffffff` | `#17171a` |
| sunken | `#efefeb` | `#1f1f23` |
| ink | `#0c0c0e` | `#f4f4f1` |
| muted (new value) | `#5c5c62` | `#a1a1a8` |
| hairline | `#e7e7e2` | `#26262a` |
| control (new, language switch border) | `#85858b` | `#6b6b72` |

- No accent on the page chrome. Buttons are ink. The four brand tones appear only inside the 24 px mark.
- Status colours (added, refused, demo tag) appear only inside product screens, each with a glyph and a word.
- One shadow, on product screens only. Radius: pills 999 px, screens 24 px (phone 32 px), scan rows 14 px.
- Focus: 2 px ink outline, 3 px offset, 3 px canvas box shadow (two tones, as `a11y.spec.ts` requires).
- Dark mode follows the system. The legal pages follow too (`orrn-ink-panel` is gone from both roots).

## Type

Bricolage Grotesque for display, Geist for text, Geist Mono for codes and figures, through `--font-display`, `--font-sans`, `--font-mono`. General Sans is deleted.

| Role | Size | Notes |
| --- | --- | --- |
| h1 | `clamp(2.375rem, 1.55rem + 3.4vw, 4.5rem)` | 68 px at 1280, 40 px at 390, max 15ch, 600 |
| h2 | `clamp(1.75rem, 1.35rem + 1.5vw, 2.5rem)` | 600 |
| Body | 1.0625rem | measure under 34rem |
| Small | 0.875rem | notes, captions |

Hindi (`[data-locale="hi"]`): h1 to h3 get line height 1.3 and tracking 0. Hindi h1 is two lines at 1280 and 390. Codes and numbers with units are `white-space: nowrap`. Content width is 75 rem; the page stays 1200 px wide at 1920.

## Sections and their jobs

| Section | Job |
| --- | --- |
| Header (sticky) | Brand, "How it works" and "For your team" anchors, language radiogroup, Sign in, Request access. One row of at most 64 px at 320 to 390 in both languages. |
| Hero | Say what orrn is and for whom. h1 "One record, from the kanta to the truck." Two buttons. Bundle page figure, "Demo data". |
| How it works (`#flow`) | Seven stages (scrap, cast, die, press, age, pack, dispatch), each with an example code and what the floor enters. Each `li` keeps `data-flow-step`. |
| The truck (`#truck`) | The scans decide what leaves stock. 13 scan answers, 10 of them refusals. The 62 % count (1,071 of 1,721 bundles missing on 30 June 2026). Phone scan sheet, 3 added, 156.40 kg. |
| Numbers (`#numbers`) | The server does the sums. PR-418: 310.4 kg in, 234.2 kg good, 75.5 %. SO-1 line 2: 25 days late, baki 800 kg. Two rules: nobody edits stock, twelve changes need a second person. |
| For your team (`#floor`) | 13 roles, 44 guides (9 also in Gujarati). One refusal in English, Hindi and Gujarati, copied word for word from the app. |
| Close | "Tell us about your plant." Request access and Sign in on a surface band. |
| Footer | Brand, Guides, Privacy, Terms, copyright. Links at least 44 px tall. |

Layout: one column below 1024 px. From 1024 px, a 12 column grid with each section title and body in columns 1 to 5 and its proof in columns 7 to 12. Section padding is 3.5 rem below 768 px and 4.5 rem from 768 px.

Motion: a scale 0.97 press on buttons and hover colour, both inside `prefers-reduced-motion: no-preference` and a fine hover pointer. No entrance animation. The only observer sets `aria-current` on the nav link.

Deleted from `apps/web/src/features/marketing/`: `audit.tsx`, `bundle-label.tsx`, `demo-label.tsx`, `flow.tsx`, `floor.tsx`, `office.tsx`, `record.tsx`, `stage-photo.tsx`, `use-reveal.ts`, `media.ts`, `media/` (16 webp), `fonts/`. New: `stages.tsx`, `truck.tsx`, `numbers.tsx`, `languages.tsx`.

## i18n

- The whole `marketing` block in `packages/i18n/src/en.ts` and `hi.ts` is replaced in one change, about 68 leaf strings. `metaTitle` and `sub` keep their names so `useLocalizedHead` works.
- Every new key is in `packages/i18n/src/public-keys.ts`. Run `bun run --cwd packages/i18n gen:public` after any change. The five `packingList.*` entries are dropped. `common.demoData` stays.
- Demo screen labels stay English and the demo root carries `lang="en"`. `gu` has no marketing block; the header maps `gu` to `en`.
- The three refusal strings in `marketing.floor.*` are copies, because `/` may not import a locale file. A unit test asserts they equal `scan.continuous.wrongCustomerOther` and `scan.continuous.result.rejected` in `en.ts`, `hi.ts` and `gu.ts`.
- A native reader still has to check every Hindi string.

## Tests

Kept unchanged: one h1, hero and close each with Request access and Sign in, skip link, landmarks and heading order, footer link spacing, header radiogroup, Hindi toggle, localized head, `gu` fallback, Hindi heading metrics, lazy dictionary tests, layout sweeps at all widths in both languages, 320 px reflow, text spacing, axe in all four projects, the "Demo data" rule, session redirects, the 250 kB route budget, dictionary parity and signature checks, `public-keys.test.ts` coverage, legal page tests.

Rewritten:

- `marketing.spec.ts` nav test keeps the link names, ids `#flow` and `#floor`, and the `data-flow-step="press"` hook.
- `marketing.spec.ts` mobile action test: on 375 by 812, after scrolling to `#floor`, the header Request access is in view, at least 44 px tall, and leads to `/request-access`.
- `a11y.spec.ts` focus walk: "at least 14" controls instead of "more than 20".
- `a11y.spec.ts` reduced motion: selector `main *`, same opacity and keyframe rule.
- `a11y.spec.ts` images: drop the `img[alt=""]` assertion. The page has no `img`.
- Hindi h1 height: `[data-marketing-hero] h1`, at most 2.05 lines at 1280.
- `public-keys.test.ts` import walk points at the new `hero.tsx`.
- `public.spec.ts`: four snapshots regenerated. Light and dark now differ.
- New: the floor refusal copy test above, and a layout guard that skips sr-only caption spans.

## Acceptance

1. Light canvas in light mode, system theme in dark mode, legal pages included.
2. At 390 the first screen names orrn, says what it is, shows both actions and the top of a product screen.
3. No photographs, no block wordmark, no gradient tiles, no entrance animation.
4. Codes agree everywhere. The scan sheet sums to 156.40 kg. PR-418 is 310.4 in, 234.2 good, 75.5 %. SO-1 line 2 baki is 800 kg (the seed, not the 1,280 kg order total).
5. Every sample number sits in a "Demo data" screen. The 62 % figure carries its date and source.
6. No claim of offline use, e-invoicing, an app store, customers, or Gujarati office screens.
7. No em or en dashes, no curly quotes, sentence case, active voice.
8. The Hindi toggle changes the whole page.
9. All kept tests pass. The `/` closure is 188.4 kB gzip, under the 250 kB budget.
10. Page height about 3,900 px at 1280 and 5,700 px at 390, against 10,487 and 14,145 before.
