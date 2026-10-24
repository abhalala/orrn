import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { TextArea } from "@orrn/ui/components/input";
import { Sheet } from "@orrn/ui/components/sheet";
import { TriangleAlert, CircleCheck, Copy } from "lucide-react";
import { useId } from "react";

import type { SignInDetails } from "./types";
import { formatDay, formatTime } from "./format";
import { CopyField, useCopy, useLastValue } from "./ui";

/**
 * The owner's sign-in email, shown for copying. Approval always succeeds, but
 * the email can fail (Resend, Oct 2026), so staff can always take the link and
 * the message and send them by WhatsApp or from their own mail. The message
 * text is the same English text the email carries: it goes to the owner.
 */
export function SignInDetailsSheet({ details, onClose }: { details: SignInDetails | null; onClose(): void }) {
  const { t, locale } = useT();
  const copy = useCopy();
  const messageId = useId();
  // The sheet keeps its words while it slides away.
  const shown = useLastValue(details);
  const expires = shown ? new Date(shown.expiresAt) : null;

  return (
    <Sheet
      open={details !== null}
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={shown?.emailSent ? t("admin.requests.details.sentTitle") : t("admin.requests.details.notSentTitle")}
      description={
        shown && expires
          ? t("admin.requests.details.body", {
              name: shown.requesterName,
              date: `${formatDay(expires, { locale })}, ${formatTime(expires, locale)}`,
            })
          : undefined
      }
      footer={
        <>
          <Button variant="secondary" onPress={onClose}>
            {t("common.done")}
          </Button>
          {shown ? (
            <Button className="pointer-coarse:h-14" onPress={() => void copy(shown.text, t("admin.requests.details.message"))}>
              <Copy aria-hidden="true" strokeWidth={2} />
              {t("admin.requests.details.copyMessage")}
            </Button>
          ) : null}
        </>
      }
    >
      {shown ? (
        <div className="flex min-w-0 flex-col gap-4">
          {shown.emailSent ? (
            <p
              role="status"
              className="m-0 flex items-start gap-2 rounded-input bg-tone-green-tint px-4 py-3 text-[15px] font-semibold text-tone-green-ink"
            >
              <CircleCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0" strokeWidth={2} />
              {t("admin.requests.details.sent", { email: shown.to })}
            </p>
          ) : (
            <p
              role="status"
              className="m-0 flex items-start gap-2 rounded-input bg-tone-amber-tint px-4 py-3 text-[15px] font-semibold text-tone-amber-ink"
            >
              <TriangleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" strokeWidth={2} />
              <span className="min-w-0 [overflow-wrap:anywhere]">
                {t("admin.requests.details.notSent")}
                {shown.emailError ? (
                  <span className="mt-1 block text-[13px] font-medium">
                    {t("admin.requests.details.reason", { reason: shown.emailError })}
                  </span>
                ) : null}
              </span>
            </p>
          )}
          <CopyField label={t("admin.requests.details.to")} value={shown.to} />
          <CopyField label={t("admin.requests.details.subject")} value={shown.subject} />
          <CopyField label={t("admin.requests.details.link")} value={shown.link} />
          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor={messageId} className="text-[14px] font-semibold leading-5 text-foreground">
              {t("admin.requests.details.message")}
            </label>
            <TextArea
              id={messageId}
              readOnly
              rows={9}
              value={shown.text}
              onFocus={(e) => e.currentTarget.select()}
              className="text-[14px] leading-6"
            />
          </div>
        </div>
      ) : null}
    </Sheet>
  );
}
