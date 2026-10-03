import { Loader2 } from "lucide-react";

export default function Loader() {
  return (
    <div
      role="status"
      className="flex h-full min-h-[40vh] flex-col items-center justify-center gap-3 animate-in fade-in-0 duration-200"
    >
      <Loader2 className="size-6 animate-spin text-foreground" aria-hidden="true" />
      <span className="text-[13px] font-medium text-muted-foreground">Loading</span>
    </div>
  );
}
