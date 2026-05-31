export function formatGroupCode(seq: number): string {
  return `BG-${String(seq).padStart(6, "0")}`;
}

export function formatBundleSerial(groupCode: string, idx: number): string {
  return `${groupCode}-B${String(idx).padStart(3, "0")}`;
}
