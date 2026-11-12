import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useT } from "@orrn/i18n";
import type { MemberNavOrder } from "@orrn/server/lib/permissions";
import { Button } from "@orrn/ui/components/button";
import { Sheet } from "@orrn/ui/components/sheet";
import { cn } from "@orrn/ui/lib/utils";
import { useMutation } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, GripVertical } from "lucide-react";
import { useState, type CSSProperties, type KeyboardEvent } from "react";
import { toast } from "sonner";

import { trpc } from "@/shared/utils/trpc";

import type { NavItem } from "./nav-items";
import {
  moveNavRow,
  moveNavRowBy,
  navOrderFromRows,
  navRowsFromGroups,
  type NavEditorRow,
  type NavGroups,
} from "./nav-order";

const silentAnnouncements = {
  onDragStart: () => "",
  onDragOver: () => "",
  onDragEnd: () => "",
  onDragCancel: () => "",
};

export default function NavArrangeEditor({
  open,
  onOpenChange,
  groups,
  onSaved,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  groups: NavGroups;
  onSaved(order: MemberNavOrder | null): void;
}) {
  const { t } = useT();
  const [rows, setRows] = useState<NavEditorRow[]>(() => navRowsFromGroups(groups));
  const [picked, setPicked] = useState<{ id: string; before: NavEditorRow[] } | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const [busy, setBusy] = useState<"save" | "reset" | null>(null);
  const save = useMutation(trpc.auth.setNavOrder.mutationOptions());
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const cancel = () => {
    if (!busy) onOpenChange(false);
  };

  const announce = (item: NavItem, next: NavEditorRow[]) => {
    const items = next.flatMap((row) => (row.kind === "item" ? [row.item] : []));
    const position = items.findIndex((candidate) => candidate.key === item.key) + 1;
    setAnnouncement(t("nav.moved", { name: t(item.labelKey), position, total: items.length }));
  };

  const moveBy = (item: NavItem, delta: number) => {
    const next = moveNavRowBy(rows, item.key, delta);
    if (next.every((row, index) => row.id === rows[index]?.id)) return;
    setRows(next);
    announce(item, next);
  };

  const dragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const item = rows.find((row) => row.id === active.id && row.kind === "item");
    if (!item || item.kind !== "item") return;
    const next = moveNavRow(rows, String(active.id), String(over.id));
    setRows(next);
    announce(item.item, next);
  };

  const handleKey = (event: KeyboardEvent<HTMLButtonElement>, item: NavItem) => {
    if (event.key === "Escape" && picked?.id === item.key) {
      event.preventDefault();
      event.stopPropagation();
      setRows(picked.before);
      setPicked(null);
      setAnnouncement("");
      return;
    }
    if ((event.key === " " || event.key === "Enter") && (!picked || picked.id === item.key)) {
      event.preventDefault();
      event.stopPropagation();
      setPicked((current) => (current ? null : { id: item.key, before: rows }));
      return;
    }
    if (picked?.id === item.key && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault();
      event.stopPropagation();
      moveBy(item, event.key === "ArrowUp" ? -1 : 1);
    }
  };

  const finish = async (order: MemberNavOrder | null, kind: "save" | "reset") => {
    setBusy(kind);
    try {
      await save.mutateAsync(order ?? { order: [] });
      onSaved(order);
      toast.success(t("nav.orderSaved"));
      onOpenChange(false);
    } catch {
      toast.error(t("nav.orderSaveFailed"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) cancel();
      }}
      title={t("nav.arrange")}
      onEscapeKeyDown={(event) => {
        if (!picked) return;
        event.preventDefault();
        setRows(picked.before);
        setPicked(null);
        setAnnouncement("");
      }}
      dismissible={!busy}
      footer={
        <>
          <Button variant="secondary" disabled={!!busy} onClick={cancel}>
            {t("nav.cancel")}
          </Button>
          <Button loading={busy === "save"} disabled={!!busy} onClick={() => void finish(navOrderFromRows(rows), "save")}>
            {t("nav.done")}
          </Button>
        </>
      }
    >
      <DndContext
        sensors={sensors}
        accessibility={{ announcements: silentAnnouncements, screenReaderInstructions: { draggable: "" } }}
        onDragEnd={dragEnd}
      >
        <SortableContext items={rows.map((row) => row.id)} strategy={verticalListSortingStrategy}>
          <ul data-slot="nav-arrange-list" className="m-0 flex list-none flex-col gap-1 p-0">
            {rows.map((row) => (
              <ArrangeRow
                key={row.id}
                row={row}
                picked={picked?.id === row.id}
                onKey={handleKey}
                onMove={moveBy}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>

      <div className="mt-5 border-t border-border pt-4">
        {confirmReset ? (
          <div className="flex flex-col gap-3" role="alert">
            <p className="m-0 text-[14px]">{t("nav.resetConfirm")}</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" disabled={!!busy} onClick={() => setConfirmReset(false)}>
                {t("nav.cancel")}
              </Button>
              <Button variant="danger" loading={busy === "reset"} disabled={!!busy} onClick={() => void finish(null, "reset")}>
                {t("nav.resetDefault")}
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="ghost" disabled={!!busy} onClick={() => setConfirmReset(true)}>
            {t("nav.resetDefault")}
          </Button>
        )}
      </div>
      <p data-testid="nav-order-announcement" role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </p>
    </Sheet>
  );
}

function ArrangeRow({
  row,
  picked,
  onKey,
  onMove,
}: {
  row: NavEditorRow;
  picked: boolean;
  onKey(event: KeyboardEvent<HTMLButtonElement>, item: NavItem): void;
  onMove(item: NavItem, delta: number): void;
}) {
  const { t } = useT();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, isDragging } = useSortable({
    id: row.id,
    disabled: row.kind === "divider" ? { draggable: true, droppable: false } : false,
    transition: null,
  });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
  };

  if (row.kind === "divider") {
    return (
      <li
        ref={setNodeRef}
        style={style}
        data-slot="nav-more-divider"
        className="motion-reduce:transition-none flex items-center gap-3 py-2 text-[13px] font-medium text-muted-foreground"
      >
        <span aria-hidden="true" className="h-px flex-1 bg-border" />
        {t("nav.more")}
        <span aria-hidden="true" className="h-px flex-1 bg-border" />
      </li>
    );
  }

  const item = row.item;
  const Icon = item.icon;
  return (
    <li
      ref={setNodeRef}
      style={style}
      data-nav-key={item.key}
      className={cn(
        "motion-reduce:transition-none flex min-w-0 items-center gap-1 rounded-card border border-border bg-card px-1 py-1",
        (isDragging || picked) && "z-10 border-primary shadow-md",
      )}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        {...attributes}
        {...listeners}
        aria-label={t("nav.dragToMove", { name: t(item.labelKey) })}
        aria-pressed={picked}
        onKeyDown={(event) => onKey(event, item)}
        className="motion-reduce:transition-none flex size-11 shrink-0 cursor-grab touch-none items-center justify-center rounded-full text-muted-foreground transition-colors duration-[var(--dur-fast)] hover:bg-accent hover:text-foreground active:cursor-grabbing"
      >
        <GripVertical aria-hidden="true" className="size-5" />
      </button>
      <Icon aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate px-1 text-[15px] font-medium">{t(item.labelKey)}</span>
      <button
        type="button"
        aria-label={t("nav.moveUp")}
        title={t("nav.moveUp")}
        data-slot="nav-move-up"
        onClick={() => onMove(item, -1)}
        className="motion-reduce:transition-none flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors duration-[var(--dur-fast)] hover:bg-accent hover:text-foreground"
      >
        <ArrowUp aria-hidden="true" className="size-5" />
      </button>
      <button
        type="button"
        aria-label={t("nav.moveDown")}
        title={t("nav.moveDown")}
        data-slot="nav-move-down"
        onClick={() => onMove(item, 1)}
        className="motion-reduce:transition-none flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors duration-[var(--dur-fast)] hover:bg-accent hover:text-foreground"
      >
        <ArrowDown aria-hidden="true" className="size-5" />
      </button>
    </li>
  );
}
