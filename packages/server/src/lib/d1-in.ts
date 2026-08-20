export const D1_IN_CHUNK = 50;

export function chunk<T>(items: readonly T[], size = D1_IN_CHUNK): T[][] {
  if (!Number.isInteger(size) || size < 1) throw new RangeError("Chunk size must be positive");
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}
