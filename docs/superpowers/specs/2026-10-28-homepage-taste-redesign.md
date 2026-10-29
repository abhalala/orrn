# Homepage redesign (taste-skill v2, Emil Kowalski motion)

## Direction

- Dealt with `design-taste-frontend` v2: direction `one-motif`, seed 408732773, sector saas, tone technical, `--keep palette`.
- One redraw: type. The dealt Pilcrow Rounded is a toy-like rounded face; the page uses General Sans (400/500/700, self-hosted woff2 in `apps/web/src/features/marketing/fonts/`).
- Palette is the brand's: ink `#0c0c0e`, paper `#f4f4f1`, surface `#1c1c20`, amber accent. The gradient `orrn-mark` stays as the brand asset (inspector runs with `--allow gradient`).

## Idea

The square module of a bundle's QR label and of the orrn mark runs the page. The hero is the thermal bundle label orrn prints. The many-into-one diagram presses loose squares (separate registers) into a three-square ribbon (one record) and lays them out as 2×2 bundle blocks. The footer builds the wordmark from the mark's four tiles.

## Live thing

The stock-list slider (`audit.tsx`): the visitor sets the bundles on their list and reads how many may already be gone at the 62% rate from orrn's first plant yard audit. The copy states the source.

## Sections

| Section | File | Layout |
| --- | --- | --- |
| Hero + seven-stage chain | `hero.tsx`, `flow.tsx` | split, sticky photo frame that changes per stage |
| Stock-list figure | `audit.tsx` | paper field, slider and figure |
| Many into one | `record.tsx` | band diagram, three columns |
| Jobs on the floor | `floor.tsx` | board of interface close-ups |
| One bundle, three views | `office.tsx` | square plate and tabs |
| Close | `cta.tsx` | amber tile between a photo and a flat tile |
| Footer | `footer.tsx` | block-built mark, links, photo credits |

## Motion

Hero lines rise in a mask, then the sentence, actions and label (done by about 1.2 s). The sticky frame fades the outgoing photo in 320 ms and brings in the next over 1.1 s. Sections enter once on screens 768px and wider. Every hidden state sits under `prefers-reduced-motion: no-preference`; reduced motion shows the final state.

## Pictures

Wikimedia Commons, credited in the homepage footer (`media.ts` holds titles, authors, licences and source pages). None shows an orrn customer's plant.

## Sample content to confirm before launch

Bundle `26J4086`, heat `H-1142 · 6063`, die copy `12170-1`, press run `R-0418`, `1,840 kg` baki, `84.2%` recovery and the `Fourcubes Extrusions` packing list are demo values, marked "Demo data" where shown.
