import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Sheet } from "@orrn/ui/components/sheet";
import { useState } from "react";

/**
 * A new device token, shown once. The token lives only in the props of this sheet: the caller drops it when the
 * sheet closes, nothing here stores it, and it is never logged. Copy it to the edge box before closing.
 */
export function TokenSheet({ code, token, onDone }: { code: string; token: string | null; onDone(): void }) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(token ?? "");
      setCopied(true);
    } catch {
      // The box is selectable: the person can copy by hand.
    }
  };
  return (
    <Sheet
      open={token !== null}
      onOpenChange={(o) => (o ? undefined : onDone())}
      title={t("dev3.token.title", { code })}
      description={t("dev3.token.shownOnce")}
      dismissible={false}
      footer={
        <Button size="lg" onClick={onDone} data-testid="dev3-token-done">
          {t("dev3.token.done")}
        </Button>
      }
    >
      <div className="flex min-w-0 flex-col gap-3 pt-1">
        <p role="note" data-testid="dev3-token-note" className="m-0 rounded-card bg-tone-amber-tint px-4 py-3 text-[15px] font-semibold text-tone-amber-ink">
          {t("dev3.token.shownOnce")}
        </p>
        <code data-testid="dev3-token" className="block rounded-card border border-border bg-card px-4 py-3 font-mono text-[14px] break-all select-all">
          {token}
        </code>
        <Button variant="secondary" onClick={() => void copy()} data-testid="dev3-token-copy">
          {copied ? t("dev3.token.copied") : t("dev3.token.copy")}
        </Button>
      </div>
    </Sheet>
  );
}
