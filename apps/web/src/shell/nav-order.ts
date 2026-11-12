import type { MemberNavOrder } from "@orrn/server/lib/permissions";

import type { NavItem } from "./nav-items";

export const NAV_MORE_ROW = "orrn-nav-more";

export type NavGroups = {
  primary: NavItem[];
  more: NavItem[];
};

export type NavEditorRow =
  | { id: string; kind: "item"; item: NavItem }
  | { id: typeof NAV_MORE_ROW; kind: "divider" };

/**
 * The saved order is one flat list of nav keys. `moreFrom` is the first key below
 * the More divider. Null leaves More empty. Undefined keeps default group membership.
 */
export function orderedNavItems({
  defaultPrimary,
  defaultMore,
  visiblePrimary,
  visibleMore,
  saved,
}: {
  defaultPrimary: readonly NavItem[];
  defaultMore: readonly NavItem[];
  visiblePrimary: readonly NavItem[];
  visibleMore: readonly NavItem[];
  saved: MemberNavOrder | null | undefined;
}): NavGroups {
  if (!saved || saved.order.length === 0) {
    return { primary: [...visiblePrimary], more: [...visibleMore] };
  }

  const defaultAll = [...defaultPrimary, ...defaultMore];
  const visibleAll = [...visiblePrimary, ...visibleMore];
  const visibleByKey = new Map(visibleAll.map((item) => [item.key, item]));
  const seen = new Set<string>();
  const ordered: NavItem[] = [];

  for (const key of saved.order) {
    const item = visibleByKey.get(key);
    if (!item || seen.has(key)) continue;
    seen.add(key);
    ordered.push(item);
  }
  for (const item of [...defaultAll, ...visibleAll]) {
    if (!visibleByKey.has(item.key) || seen.has(item.key)) continue;
    seen.add(item.key);
    ordered.push(item);
  }

  const divider = saved.moreFrom;
  if (divider === null) return { primary: ordered, more: [] };
  if (typeof divider === "string" && saved.order.includes(divider)) {
    const index = ordered.findIndex((item) => item.key === divider);
    if (index >= 0) return { primary: ordered.slice(0, index), more: ordered.slice(index) };
  }

  const primaryKeys = new Set(defaultPrimary.map((item) => item.key));
  return {
    primary: ordered.filter((item) => primaryKeys.has(item.key)),
    more: ordered.filter((item) => !primaryKeys.has(item.key)),
  };
}

export function navRowsFromGroups(groups: NavGroups): NavEditorRow[] {
  return [
    ...groups.primary.map((item) => ({ id: item.key, kind: "item" as const, item })),
    { id: NAV_MORE_ROW, kind: "divider" },
    ...groups.more.map((item) => ({ id: item.key, kind: "item" as const, item })),
  ];
}

export function navGroupsFromRows(rows: readonly NavEditorRow[]): NavGroups {
  const divider = rows.findIndex((row) => row.kind === "divider");
  const split = divider < 0 ? rows.length : divider;
  const items = (list: readonly NavEditorRow[]) =>
    list.flatMap((row) => (row.kind === "item" ? [row.item] : []));
  return { primary: items(rows.slice(0, split)), more: items(rows.slice(split + 1)) };
}

export function navOrderFromRows(rows: readonly NavEditorRow[]): MemberNavOrder {
  const groups = navGroupsFromRows(rows);
  return {
    order: [...groups.primary, ...groups.more].map((item) => item.key),
    moreFrom: groups.more[0]?.key ?? null,
  };
}

export function moveNavRow(rows: readonly NavEditorRow[], activeId: string, overId: string): NavEditorRow[] {
  const from = rows.findIndex((row) => row.id === activeId);
  const to = rows.findIndex((row) => row.id === overId);
  if (from < 0 || to < 0 || from === to) return [...rows];
  const next = [...rows];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}

export function moveNavRowBy(rows: readonly NavEditorRow[], activeId: string, delta: number): NavEditorRow[] {
  const from = rows.findIndex((row) => row.id === activeId);
  if (from < 0) return [...rows];
  const to = Math.max(0, Math.min(rows.length - 1, from + delta));
  if (from === to) return [...rows];
  const next = [...rows];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}
