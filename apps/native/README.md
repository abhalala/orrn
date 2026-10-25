# orrn native app (Expo)

The phone and tablet app for the plant floor, the die room, the press and the office. Same server and
permissions as the web app; the app never works out a weight, a drift or a baki figure itself.

## Run it

```bash
bun install                                   # repo root, once
bun run --cwd apps/server dev:local           # local API on this worktree's API port (see docs/LOCAL_DEV.md)
cp apps/native/.env.example apps/native/.env  # then set EXPO_PUBLIC_SERVER_URL (below)
bun run --cwd apps/native dev                 # Metro
```

The app has a native module that Expo Go does not carry (`expo-speech`), so it needs a development build:

```bash
cd apps/native
bunx expo run:android      # needs Android Studio (SDK + emulator) and a JDK 17
bunx expo run:ios          # macOS with Xcode
```

`EXPO_PUBLIC_SERVER_URL` from an Android emulator: `localhost` is the emulator itself. Use
`http://10.0.2.2:<api port>` or run `adb reverse tcp:<api port> tcp:<api port>` and keep `http://localhost:<api port>`.
A real phone needs the computer's LAN address. Seed accounts and the shared password are in `docs/LOCAL_DEV.md`
(`owner@`, `office@`, `supervisor@`, `press@`, `dieroom@` and `operator@orrn.local`).

## Checks

```bash
bun run --cwd apps/native test          # unit and static tests (no device)
bun run --cwd apps/native check-types
cd apps/native && bunx expo export --platform android   # bundle smoke
```

Things the tests pin that are easy to break:

- `__tests__/server-refusal.test.ts` reads the die room and orders routers and fails when a server sentence has no
  Hindi and Gujarati wording. Add the pattern to `lib/server-refusal.ts` and the key to `native/refusal.{en,hi,gu}.ts`
  in `packages/i18n`. The phone never shows or speaks the server's English.
- `__tests__/replay-audit.test.ts` lists every write the app can send twice and how it is protected.
- `__tests__/press-role.test.ts` pins the press role's tab bar, routes and read-only screens.

## Maestro flows (`/.maestro/flows`)

**None of these flows has ever been run.** They were written alongside the screens. The machine that built this
branch had no Android SDK, no emulator, no JDK and no Maestro, so they are untested against a real screen.
Expect to fix selectors (text, indexes) on the first run. Treat a failure as "the flow needs a fix" until it has
passed once.

| Flow | Role | What it does | Run state |
| --- | --- | --- | --- |
| `native-home.yaml` | none | fresh install opens on sign-in | never run |
| `native-sign-in-validation.yaml` | none | field checks before the server is called; language switch | never run |
| `sign-in.yaml` | owner | seeded account lands on Today | never run |
| `pack.yaml` | owner | pack one bundle in three steps | never run |
| `dispatch-paste.yaml` | owner | paste more than 12 serials into a building dispatch | never run |
| `dispatch-capacity.yaml` | owner | scan into a dispatch, capacity banner, spoken refusal, dispatch with a reason | never run |
| `die-room.yaml` | die room | Dies tab, a card, a reading on the keypad | never run |
| `orders-office.yaml` | office | book an order one line at a time | never run |
| `press-phone.yaml` | press | Press tab, line queue read only, downtime start and stop | never run |
| `release-gate.yaml` | owner | release gate, language switch, version and build number | never run |

### How to run them

1. Install the tools once: a JDK 17, Android Studio (SDK platform 35, an arm64 or x86_64 Pixel image) and Maestro
   (`curl -fsSL "https://get.maestro.mobile.dev" | bash`, then `maestro --version`).
2. Create and start an emulator: `emulator -list-avds`, then `emulator -avd <name>`; check with `adb devices`.
3. Start the API and seed it (`docs/LOCAL_DEV.md`), set `EXPO_PUBLIC_SERVER_URL` as above, build and install the app
   with `bunx expo run:android` (bundle id `in.orrn.app`), leave Metro running.
4. From the repo root, one flow at a time, using the command in the flow's header, for example:

```bash
maestro test -e MAESTRO_EMAIL=owner@orrn.local -e MAESTRO_PASSWORD="$ORRN_LOCAL_PASSWORD" .maestro/flows/sign-in.yaml
maestro test -e MAESTRO_EMAIL=press@orrn.local -e MAESTRO_PASSWORD="$ORRN_LOCAL_PASSWORD" .maestro/flows/press-phone.yaml
maestro test -e MAESTRO_EMAIL=dieroom@orrn.local -e MAESTRO_PASSWORD="$ORRN_LOCAL_PASSWORD" -e COPY=14701-1 .maestro/flows/die-room.yaml
maestro test -e MAESTRO_EMAIL=office@orrn.local -e MAESTRO_PASSWORD="$ORRN_LOCAL_PASSWORD" -e CUSTOMER="KD Extrusion" -e DIE=14701 .maestro/flows/orders-office.yaml
maestro test .maestro/flows   # the whole folder, after each flow passes alone
```

5. When a flow passes, change its header comment from "never run" to the date, the device and the build, and update
   the table above. Do not mark a flow run from a machine that did not run it.

Sound is not asserted: the refusal text on screen is what the voice reads.

## Gujarati

The Gujarati strings written for `native.press.*`, `native.pack.*`, `native.stock.*` and `refusal.*` have not
been read by a Gujarati speaker. They are listed in `.fp-build/reports/gu-review-list.md` for review.
