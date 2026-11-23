/** `/hr`: the people register: search, active or left, and add. A row opens the person. */
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, TextInput } from "@orrn/ui/components/field";
import { PageHeader } from "@orrn/ui/components/page-header";
import { ResponsiveList, type ResponsiveListColumn } from "@orrn/ui/components/responsive-list";
import { SegmentedControl } from "@orrn/ui/components/segmented-control";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useState } from "react";

import { Can } from "@/shared/components/can";
import { useFmt } from "@/shared/lib/fmt";
import { bookDateText } from "@/shared/lib/fmt-text";
import { trpc } from "@/shared/utils/trpc";

import { PersonSheet } from "./person-sheet";
import { HrGate, HrTabs, LoadError, useDebounced } from "./ui";

type StatusTab = "active" | "left" | "all";
const PAGE = 50;

export function PeoplePage() {
  const { t } = useT();
  const fmt = useFmt();
  const navigate = useNavigate();
  const [status, setStatus] = useState<StatusTab>("active");
  const [text, setText] = useState("");
  const [offset, setOffset] = useState(0);
  const [adding, setAdding] = useState(false);
  const q = useDebounced(text.trim());

  const list = useQuery({
    ...trpc.hr.people.list.queryOptions({ status, q: q || undefined, limit: PAGE, offset }),
    placeholderData: keepPreviousData,
  });
  type Row = NonNullable<typeof list.data>["items"][number];

  const columns: ResponsiveListColumn<Row>[] = [
    { key: "name", header: t("hr.people.name"), cell: (r) => <span className="font-semibold">{r.name}</span> },
    { key: "code", header: t("hr.people.code"), cell: (r) => <span className="font-mono">{r.code}</span> },
    { key: "dept", header: t("hr.people.department"), cell: (r) => [r.department, r.designation].filter(Boolean).join(" · ") || <span className="text-muted-foreground">-</span> },
    { key: "kind", header: t("hr.people.kind"), hideOnPhone: true, cell: (r) => t(`hr.kind.${r.kind}`) },
    { key: "joined", header: t("hr.people.joined"), hideOnPhone: true, cell: (r) => bookDateText(fmt, r.joinedOn) },
    { key: "bank", header: t("hr.people.bank"), hideOnPhone: true, cell: (r) => (r.bankAccountMasked ? <span className="font-mono">{r.bankAccountMasked}</span> : <span className="text-muted-foreground">-</span>) },
    {
      key: "status",
      header: t("hr.people.status"),
      phoneWide: true,
      cell: (r) => (r.status === "left" ? <Chip tone="neutral" truncate={false}>{t("hr.status.left")}</Chip> : <Chip tone="green" truncate={false}>{t("hr.status.active")}</Chip>),
    },
  ];

  return (
    <HrGate needs={["hr.view"]}>
      <PageHeader
        title={t("hr.title")}
        subtitle={t("hr.people.subtitle")}
        actions={
          <Can do="hr.manage">
            <Button className="max-md:h-14 max-md:w-full max-md:text-[17px]" onClick={() => setAdding(true)}>
              <Plus aria-hidden="true" strokeWidth={2} />
              {t("hr.people.add")}
            </Button>
          </Can>
        }
      />
      <HrTabs current="people" />
      <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-end">
        <Field label={t("hr.people.search")} className="lg:w-80">
          <TextInput
            type="search"
            value={text}
            onChangeText={(v) => {
              setText(v);
              setOffset(0);
            }}
            placeholder={t("hr.people.searchHint")}
            maxLength={60}
          />
        </Field>
        <SegmentedControl
          label={t("hr.people.statusLabel")}
          value={status}
          onChange={(v) => {
            setStatus(v);
            setOffset(0);
          }}
          options={[
            { value: "active" as StatusTab, label: t("hr.status.active") },
            { value: "left" as StatusTab, label: t("hr.status.left") },
            { value: "all" as StatusTab, label: t("hr.people.all") },
          ]}
        />
      </div>
      {list.isError && !list.data ? (
        <LoadError onRetry={() => void list.refetch()} />
      ) : (
        <ResponsiveList<Row>
          label={t("hr.people.label")}
          rows={list.data?.items ?? []}
          rowKey={(r) => r.id}
          rowHref={(r) => `/hr/${r.id}`}
          columns={columns}
          loading={list.isFetching}
          total={list.data?.total}
          page={{ offset, limit: PAGE, onChange: setOffset }}
          empty={
            <EmptyState
              title={q ? t("hr.people.noMatch") : t("hr.people.empty")}
              action={
                <Can do="hr.manage">
                  <Button onClick={() => setAdding(true)}>{t("hr.people.add")}</Button>
                </Can>
              }
            />
          }
        />
      )}
      <PersonSheet open={adding} onOpenChange={setAdding} onSaved={(id) => void navigate({ to: "/hr/$id" as never, params: { id } as never })} />
    </HrGate>
  );
}
