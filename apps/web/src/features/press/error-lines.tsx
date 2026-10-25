/**
 * An error message from `pressErrorText`: the sentence in the person's language, and (only for a
 * refusal this build does not know) the server's own text as a smaller second line.
 */
export function ErrorLines({ message, className }: { message: string; className?: string }) {
  const [text, ...rest] = message.split("\n");
  const detail = rest.join("\n");
  return (
    <p role="alert" className={className}>
      {text}
      {detail ? (
        <span data-slot="error-detail" className="mt-0.5 block text-[13px] font-normal text-muted-foreground">
          {detail}
        </span>
      ) : null}
    </p>
  );
}
