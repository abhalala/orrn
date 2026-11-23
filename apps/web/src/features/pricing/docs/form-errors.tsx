/** The lines a refused write says, in a red block inside a sheet or under a form. */
export function FormErrors({ lines }: { lines: string[] }) {
  if (lines.length === 0) return null;
  return (
    <div role="alert" className="flex flex-col gap-1 rounded-card bg-tone-red-tint px-4 py-3">
      {lines.map((l) => (
        <p key={l} className="m-0 text-[14px] font-medium text-tone-red-ink break-words">
          {l}
        </p>
      ))}
    </div>
  );
}
