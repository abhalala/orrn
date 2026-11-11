const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;

export function redactAuthLog(value: unknown): unknown {
  if (typeof value === "string") return value.replace(EMAIL_PATTERN, "[redacted email]");
  if (Array.isArray(value)) return value.map(redactAuthLog);
  if (value instanceof Error) {
    const copy = new Error(redactAuthLog(value.message) as string);
    copy.name = value.name;
    if (value.stack) copy.stack = redactAuthLog(value.stack) as string;
    return copy;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactAuthLog(item)]));
  }
  return value;
}

export function writeAuthLog(level: "debug" | "info" | "warn" | "error", message: string, ...args: unknown[]): void {
  console[level](redactAuthLog(message), ...args.map(redactAuthLog));
}
