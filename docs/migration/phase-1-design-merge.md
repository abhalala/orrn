# Phase 1: Merge `@orrn/design` → `@orrn/ui`

## Why

`@orrn/design` is consumed by exactly 2 import sites, both in `@orrn/ui`:
- `packages/ui/src/provider.tsx` — imports `tamaguiConfig`
- `packages/ui/src/components/badge.tsx` — imports `bundleStatusTones`, `dispatchStatusTones`, `roleTones`, `StatusTone`

Design tokens are a subset of the UI package. Merging eliminates a package boundary with zero behavior change.

## Steps

### 1. Move files

```
packages/design/src/tokens.ts          → packages/ui/src/tokens.ts
packages/design/src/tamagui.config.ts  → packages/ui/src/tamagui.config.ts
packages/design/src/index.ts           → (merge into packages/ui/src/index.ts)
```

### 2. Update internal imports in `@orrn/ui`

| File | Old import | New import |
|------|-----------|------------|
| `packages/ui/src/provider.tsx:1` | `from "@orrn/design"` | `from "./tamagui.config"` |
| `packages/ui/src/components/badge.tsx:3-8` | `from "@orrn/design"` | `from "../tokens"` |

### 3. Update `packages/ui/src/index.ts`

Add re-exports from the old `@orrn/design` index:

```typescript
export * from "tamagui";
export { OrrnUiProvider } from "./provider";
export { default as tamaguiConfig, type OrrnTamaguiConfig } from "./tamagui.config";
export {
  brand,
  neutrals,
  semantic,
  dispatchStatusTones,
  bundleStatusTones,
  roleTones,
  space,
  radii,
  fontSizes,
  shadows,
  type StatusTone,
} from "./tokens";
```

### 4. Update `packages/ui/package.json`

- Remove `"@orrn/design": "workspace:*"` from dependencies
- Add `"@tamagui/config": "catalog:"` to dependencies (was in design's deps)
- Add export subpaths:
  ```json
  "./tamagui.config": "./src/tamagui.config.ts",
  "./tokens": "./src/tokens.ts"
  ```

### 5. Update Vite config tamagui paths

| File | Old path | New path |
|------|---------|----------|
| `apps/web/vite.config.ts` | `../../packages/design/src/tamagui.config.ts` | `../../packages/ui/src/tamagui.config.ts` |
| `apps/admin/vite.config.ts` | `../../packages/design/src/tamagui.config.ts` | `../../packages/ui/src/tamagui.config.ts` |
| `apps/erp/vite.config.ts` | `../../packages/design/src/tamagui.config.ts` | `../../packages/ui/src/tamagui.config.ts` |

### 6. Update native babel config

| File | Old path | New path |
|------|---------|----------|
| `apps/native/babel.config.js` | `../../packages/design/src/tamagui.config.ts` | `../../packages/ui/src/tamagui.config.ts` |

### 7. Update `tamagui.build.ts` (root)

If the root `tamagui.build.ts` references `@orrn/design`, update it to `@orrn/ui`.

### 8. Update `packages/ui/src/styles/globals.css`

The comment on line 5 references `@orrn/design/tokens`. Update to reference `@orrn/ui/tokens`.

### 9. Update root `package.json`

Remove `@orrn/design` from the `catalog` section (it had no catalog entries, but verify).

### 10. Delete `packages/design/`

Remove the entire directory.

### 11. Update `turbo.json`

Remove any build task references to `packages/design` if present.

### 12. Run `bun install` + `bun run check-types`

## Rollback

Reverse the file moves and import path changes. All changes are structural — no logic changes.

## Files affected

- **Created**: `packages/ui/src/tokens.ts`, `packages/ui/src/tamagui.config.ts`
- **Modified**: `packages/ui/src/index.ts`, `packages/ui/src/provider.tsx`, `packages/ui/src/components/badge.tsx`, `packages/ui/package.json`, `apps/web/vite.config.ts`, `apps/admin/vite.config.ts`, `apps/erp/vite.config.ts`, `apps/native/babel.config.js`, `packages/ui/src/styles/globals.css`
- **Deleted**: `packages/design/` (entire directory)