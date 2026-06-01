import { Loader2 } from "lucide-react";

export default function Loader() {
  return (
    <div className="flex h-full min-h-[40vh] flex-col items-center justify-center gap-3 animate-in fade-in-0 duration-200">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
      <span className="text-xs uppercase tracking-wider text-muted-foreground">Loading</span>
    </div>
  );
}
