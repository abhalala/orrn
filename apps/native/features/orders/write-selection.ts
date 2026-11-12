export function selectionInItems(selected: ReadonlySet<string>, items: readonly { id: string }[]): Set<string> {
  const visible = new Set(items.map((item) => item.id));
  return new Set([...selected].filter((id) => visible.has(id)));
}

export function claimWrite(writing: { current: boolean }): boolean {
  if (writing.current) return false;
  writing.current = true;
  return true;
}
