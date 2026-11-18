import type { CompanyModule } from "@orrn/domain";
import { LOCALE_NAMES, LOCALES, type Locale, type MessageKey } from "@orrn/i18n";
import { can, canAny, type Me } from "@orrn/server/lib/permissions";
import {
  ArrowUpDown,
  Building2,
  Flame,
  History,
  Languages,
  ListChecks,
  LogOut,
  Monitor,
  Moon,
  PackagePlus,
  Printer,
  ScanLine,
  Sun,
  Thermometer,
  Truck,
  UploadCloud,
  type LucideIcon,
} from "lucide-react";

import { TENANT_MORE, TENANT_PRIMARY, visibleItems } from "../nav-items";
import { canArrangeMenu } from "../nav-order";
import { switcherPlants } from "../plant-switcher-model";
import { PAGE_SECTIONS, type PageSection } from "./page-index";

/**
 * Quick actions and commands for the palette (owner decision 2026-11-18, brief item 4). Each command shows only to
 * people the target screen would let in: the parent nav item's rule (`visibleItems`: `canAny` + company modules) and
 * the action the screen itself checks before it shows its form. The run functions call the shell's existing logic
 * (passed in as `CommandEffects`); nothing here talks to the server.
 */

export type ThemeChoice = "system" | "light" | "dark";

/** What the commands are built from. */
export type CommandEnv = {
  me: Me | null | undefined;
  locale: Locale;
  /** next-themes `theme` ("system", "light", "dark" or undefined). */
  theme: string | undefined;
  /** The global scan sheet is mounted (`useScan().available`). */
  scanAvailable: boolean;
  /** The shell has registered its "Arrange menu" opener. */
  arrangeAvailable: boolean;
  hasRecents: boolean;
};

/** The shell's existing behaviour, called by the commands. */
export type CommandEffects = {
  navigate(to: string): void;
  openScan(): void;
  switchPlant(companyId: string): void;
  setLocale(locale: Locale): void;
  setTheme(theme: ThemeChoice): void;
  openArrange(): void;
  signOut(): void;
  clearRecent(): void;
};

export type PaletteCommand = {
  id: string;
  labelKey: MessageKey;
  labelVars?: Readonly<Record<string, string>>;
  icon: LucideIcon;
  /** A real keyboard shortcut for this command, shown on the row. Only set when one exists. */
  hint?: string;
  /** Words that find this command besides its label (English plant words). */
  aliases?: readonly string[];
  /** The route a navigation command opens; the palette hides a page section that opens the same route. */
  to?: string;
  /** Opens another dialog or sheet: run it after the palette has closed. */
  deferred?: boolean;
  run(fx: CommandEffects): void;
};

export function toThemeChoice(value: string | undefined): ThemeChoice {
  return value === "light" || value === "dark" ? value : "system";
}

const LOCALE_WORDS: Record<Locale, readonly string[]> = {
  en: ["english", "angrezi"],
  hi: ["hindi"],
  gu: ["gujarati"],
};

function moduleOn(me: Me | null | undefined, module: CompanyModule): boolean {
  const modules = (me?.company?.modules ?? []).map((m) => m.toLowerCase());
  return modules.length === 0 || modules.includes(module);
}

/**
 * Page sections this person may open: the parent nav item is visible (`visibleItems`), and the section's own
 * stricter rules pass when it has them (`requires` via `canAny`, `module` via the company modules).
 */
export function visibleSections(me: Me | null | undefined, sections: readonly PageSection[] = PAGE_SECTIONS): PageSection[] {
  const nav = new Set(visibleItems([...TENANT_PRIMARY, ...TENANT_MORE], me).map((item) => item.key));
  return sections.filter(
    (s) => nav.has(s.parentKey) && (!s.requires || canAny(me, s.requires)) && (!s.module || moduleOn(me, s.module)),
  );
}

export function buildCommands(env: CommandEnv): PaletteCommand[] {
  const { me } = env;
  if (!me?.company) return [];
  const nav = new Set(visibleItems([...TENANT_PRIMARY, ...TENANT_MORE], me).map((item) => item.key));
  const out: PaletteCommand[] = [];
  const go = (to: string) => (fx: CommandEffects) => fx.navigate(to);

  // Create / start work. Each pairs the nav item's rule with the check the target screen makes.
  if (nav.has("dispatch") && can(me, "dispatch.create")) {
    out.push({ id: "new-dispatch", labelKey: "dispatch.new.title", icon: Truck, aliases: ["challan", "truck", "create dispatch"], to: "/dispatch/new", run: go("/dispatch/new") });
  }
  if (nav.has("orders") && can(me, "order.manage") && moduleOn(me, "orders")) {
    out.push({ id: "new-order", labelKey: "orders.new", icon: ListChecks, aliases: ["po", "purchase order", "sales order", "order book"], to: "/orders/new", run: go("/orders/new") });
  }
  if (nav.has("pack") && can(me, "bundle.pack")) {
    out.push({ id: "new-pack", labelKey: "pack.new.title", icon: PackagePlus, aliases: ["start packing", "new pack", "new bundle", "maal"], to: "/pack/new", run: go("/pack/new") });
  }
  if (nav.has("ingest") && can(me, "ingest.upload")) {
    out.push({ id: "upload-import", labelKey: "nav.cmd.uploadImport", icon: UploadCloud, aliases: ["import", "upload", "excel", "sheet", "csv"], to: "/ingest", run: go("/ingest") });
  }
  // Same rule as the shell's Scan button (app-shell.tsx `scanOn`).
  if (env.scanAvailable && moduleOn(me, "bundles")) {
    out.push({ id: "scan-bundle", labelKey: "nav.cmd.scanBundle", icon: ScanLine, aliases: ["scan", "qr", "serial", "camera", "label", "sticker"], deferred: true, run: (fx) => fx.openScan() });
  }
  if (nav.has("foundry") && can(me, "cast.enter")) {
    out.push({ id: "new-cast", labelKey: "foundry.newCast.title", icon: Flame, aliases: ["new cast", "melt", "heat", "furnace"], to: "/casts/new", run: go("/casts/new") });
  }
  if (nav.has("ageing") && can(me, "ageing.load")) {
    out.push({ id: "load-ageing", labelKey: "ageing.load.title", icon: Thermometer, aliases: ["load ageing", "ageing", "aging", "oven", "trolley"], to: "/ageing/load", run: go("/ageing/load") });
  }
  if (nav.has("printing")) {
    out.push({ id: "print-queue", labelKey: "nav.cmd.printQueue", icon: Printer, aliases: ["print", "printer", "label", "sticker", "queue"], to: "/printing", run: go("/printing") });
  }

  // Switch and settings.
  for (const plant of switcherPlants(me) ?? []) {
    if (plant.current) continue;
    out.push({
      id: `switch-plant-${plant.companyId}`,
      labelKey: "nav.cmd.switchPlant",
      labelVars: { name: plant.name },
      icon: Building2,
      aliases: ["switch plant", "plant", "company", "factory"],
      run: (fx) => fx.switchPlant(plant.companyId),
    });
  }
  for (const locale of LOCALES) {
    if (locale === env.locale) continue;
    out.push({
      id: `language-${locale}`,
      labelKey: "nav.cmd.language",
      labelVars: { name: LOCALE_NAMES[locale] },
      icon: Languages,
      aliases: ["language", "bhasha", ...LOCALE_WORDS[locale]],
      run: (fx) => fx.setLocale(locale),
    });
  }
  const theme = toThemeChoice(env.theme);
  const themes: readonly { value: ThemeChoice; labelKey: MessageKey; icon: LucideIcon; words: readonly string[] }[] = [
    { value: "light", labelKey: "nav.cmd.themeLight", icon: Sun, words: ["light mode", "day"] },
    { value: "dark", labelKey: "nav.cmd.themeDark", icon: Moon, words: ["dark mode", "night"] },
    { value: "system", labelKey: "nav.cmd.themeSystem", icon: Monitor, words: ["system", "device", "auto"] },
  ];
  for (const option of themes) {
    if (option.value === theme) continue;
    out.push({
      id: `theme-${option.value}`,
      labelKey: option.labelKey,
      icon: option.icon,
      aliases: ["theme", "appearance", ...option.words],
      run: (fx) => fx.setTheme(option.value),
    });
  }
  if (env.arrangeAvailable && canArrangeMenu(me)) {
    out.push({ id: "arrange-menu", labelKey: "nav.arrange", icon: ArrowUpDown, aliases: ["side menu", "sidebar", "rearrange", "reorder"], deferred: true, run: (fx) => fx.openArrange() });
  }
  if (env.hasRecents) {
    out.push({ id: "clear-recent", labelKey: "nav.cmd.clearRecent", icon: History, aliases: ["recent", "history"], run: (fx) => fx.clearRecent() });
  }
  out.push({ id: "sign-out", labelKey: "nav.signOut", icon: LogOut, aliases: ["log out", "logout"], run: (fx) => fx.signOut() });
  return out;
}
