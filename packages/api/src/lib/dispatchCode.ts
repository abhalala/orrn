export function formatDispatchCode(seq: number): string {
  return `DSP-${String(seq).padStart(6, "0")}`;
}
