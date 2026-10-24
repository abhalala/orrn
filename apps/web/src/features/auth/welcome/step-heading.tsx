import type { Ref } from "react";

/**
 * Title and one line for a welcome step. The h1 takes focus when the step
 * changes (`tabIndex={-1}`, no ring: see globals.css), so screen readers hear
 * where they are and keyboard users continue from the top of the step.
 */
export function StepHeading({ title, body, headingRef }: { title: string; body?: string; headingRef?: Ref<HTMLHeadingElement> }) {
  return (
    <div className="flex flex-col gap-2">
      <h1 ref={headingRef} tabIndex={-1} className="orrn-auth-title">
        {title}
      </h1>
      {body ? <p className="m-0 max-w-[52ch] text-[15px] leading-6 text-muted-foreground">{body}</p> : null}
    </div>
  );
}
