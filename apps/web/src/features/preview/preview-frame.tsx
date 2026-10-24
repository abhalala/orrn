import { Badge } from "@orrn/ui/components/badge";
import { PageHeader } from "@orrn/ui/components/page-header";
import type { ReactNode } from "react";

export type PreviewFrameProps = {
  title: string;
  summary?: string;
  featureIds: string[];
  specPath: string;
  actions?: ReactNode;
  children: ReactNode;
};

/**
 * Shared chrome for `/preview` demo pages. Sample data only: nothing here
 * writes to the company. Page agents fill `children`; they do not restyle
 * this bar. Feature IDs and the spec path sit in a collapsed footer so a
 * plant owner sees the screen first.
 */
export function PreviewFrame({ title, summary, featureIds, specPath, actions, children }: PreviewFrameProps) {
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <p
        role="status"
        className="m-0 rounded-card border border-border bg-surface-sunken px-3 py-2 text-[13px] font-medium leading-5 text-muted-foreground"
      >
        Preview · sample data · nothing is saved
      </p>
      <PageHeader
        title={title}
        subtitle={summary}
        actions={actions}
        back={{ to: "/preview", label: "All previews" }}
      />
      <div className="min-w-0">{children}</div>
      {featureIds.length > 0 || specPath ? (
        <details className="border-t border-border pt-3 text-[12px] text-muted-foreground">
          <summary className="min-h-11 cursor-pointer content-center font-medium">Design reference</summary>
          {featureIds.length > 0 ? (
            <ul className="m-0 mt-2 flex list-none flex-wrap gap-1.5 p-0">
              {featureIds.map((id) => (
                <li key={id}>
                  <Badge tone="neutral" size="sm" className="font-mono tabular-nums">
                    {id}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="m-0 mt-2 break-all font-mono leading-5">{specPath}</p>
        </details>
      ) : null}
    </div>
  );
}
