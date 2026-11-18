import type { Ref } from "react";

/**
 * Title and one line for a welcome step. The h1 takes focus when the step
 * changes (`tabIndex={-1}`, no ring: see globals.css), so screen readers hear
 * where they are and keyboard users continue from the top of the step.
 * `level={3}`: the same step inside a page that has its own h1 (Settings > Sign-in).
 */
export function StepHeading({
  title,
  body,
  headingRef,
  level = 1,
}: {
  title: string;
  body?: string;
  headingRef?: Ref<HTMLHeadingElement>;
  level?: 1 | 3;
}) {
  return (
    <div className="flex flex-col gap-2">
      {level === 1 ? (
        <h1 ref={headingRef} tabIndex={-1} className="orrn-auth-title">
          {title}
        </h1>
      ) : (
        <h3 ref={headingRef} tabIndex={-1} className="m-0 text-[17px] font-semibold leading-6">
          {title}
        </h3>
      )}
      {body ? <p className="m-0 max-w-[52ch] text-[15px] leading-6 text-muted-foreground">{body}</p> : null}
    </div>
  );
}
