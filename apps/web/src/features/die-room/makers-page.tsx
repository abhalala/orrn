import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, TextInput } from "@orrn/ui/components/field";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Sheet } from "@orrn/ui/components/sheet";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { Can } from "@/shared/components/can";
import { INLINE_ERROR_META } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import { shortDate } from "./die-room-model";
import { useRefreshDieRoom, useRefusal } from "./use-die-room";

/** `/dies/makers`: the die makers the plant uses, and the copies that are with them now. */
export function MakersPage() {
  const { t } = useT();
  const refresh = useRefreshDieRoom();
  const refusal = useRefusal();
  const [adding, setAdding] = useState(false);

  const makers = useQuery({ ...trpc.dieInstance.maker.list.queryOptions(), meta: INLINE_ERROR_META });
  const jobs = useQuery({
    ...trpc.dieInstance.maker.jobs.list.queryOptions({ status: "sent" }),
    meta: INLINE_ERROR_META,
  });
  const archive = useMutation({
    ...trpc.dieInstance.maker.archive.mutationOptions(),
    onSuccess: async () => {
      await refresh();
      toast.success(t("dieRoom.makers.archived"));
    },
    onError: (e) => toast.error(refusal(e)),
  });

  return (
    <>
      <PageHeader
        back={{ to: "/dies", label: t("nav.dies") }}
        title={t("dieRoom.maker.makers")}
        subtitle={t("dieRoom.makers.subtitle")}
        actions={
          <Can do={["die.maker", "masters.publish"]}>
            <Button onClick={() => setAdding(true)}>{t("dieRoom.maker.addMaker")}</Button>
          </Can>
        }
      />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <section className="flex min-w-0 flex-col gap-3" aria-labelledby="makers-list">
          <h2 id="makers-list" className="m-0 text-[17px] leading-6 font-semibold">
            {t("dieRoom.maker.makers")}
          </h2>
          {makers.isSuccess && makers.data.length === 0 ? (
            <EmptyState title={t("dieRoom.makers.empty")} body={t("dieRoom.makers.emptyBody")} />
          ) : (
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {(makers.data ?? []).map((m) => (
                <li key={m.id} className="flex min-w-0 flex-wrap items-center gap-3 rounded-card border border-border bg-card p-4">
                  <div className="min-w-0 flex-1">
                    <p className="m-0 text-[15px] font-semibold">{m.name}</p>
                    <p className="m-0 text-[13px] text-muted-foreground">{[m.city, m.phone].filter(Boolean).join(" · ")}</p>
                  </div>
                  <Can do={["die.maker", "masters.publish"]}>
                    <Button variant="secondary" loading={archive.isPending && archive.variables?.id === m.id} onClick={() => archive.mutate({ id: m.id })}>
                      {t("dieRoom.makers.archive")}
                    </Button>
                  </Can>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="flex min-w-0 flex-col gap-3" aria-labelledby="makers-jobs">
          <h2 id="makers-jobs" className="m-0 text-[17px] leading-6 font-semibold">
            {t("dieRoom.makers.withMakers")}
          </h2>
          {jobs.isSuccess && jobs.data.length === 0 ? (
            <EmptyState title={t("dieRoom.makers.noJobs")} body={t("dieRoom.makers.noJobsBody")} />
          ) : (
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {(jobs.data ?? []).map((j) => (
                <li key={j.id} className="flex min-w-0 flex-col gap-1 rounded-card border border-border bg-card p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[15px] font-semibold tabular-nums">{j.number}</span>
                    <Link
                      to="/dies/copies/$copyId"
                      params={{ copyId: j.dieInstanceId }}
                      search={{ tab: "maker" }}
                      className="inline-flex min-h-11 items-center font-mono text-[15px] font-semibold text-foreground no-underline"
                    >
                      {j.code}
                    </Link>
                  </div>
                  <p className="m-0 text-[13px] text-muted-foreground">
                    {j.makerName} · {t(`dieRoom.maker.${j.purpose}`)} · {shortDate(j.sentAt)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <AddMakerSheet open={adding} onOpenChange={setAdding} />
    </>
  );
}

function AddMakerSheet({ open, onOpenChange }: { open: boolean; onOpenChange(open: boolean): void }) {
  const { t } = useT();
  const refresh = useRefreshDieRoom();
  const refusal = useRefusal();
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    ...trpc.dieInstance.maker.create.mutationOptions(),
    onSuccess: async () => {
      await refresh();
      toast.success(t("dieRoom.makers.added"));
      setName("");
      setCity("");
      setPhone("");
      setError(null);
      onOpenChange(false);
    },
    onError: (e) => setError(refusal(e)),
  });

  const submit = () => {
    if (!name.trim()) return setError(t("dieRoom.makers.nameRequired"));
    create.mutate({
      name: name.trim(),
      ...(city.trim() ? { city: city.trim() } : {}),
      ...(phone.trim() ? { phone: phone.trim() } : {}),
    });
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("dieRoom.maker.addMaker")}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={submit} loading={create.isPending}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label={t("dieRoom.makers.name")}>
          <TextInput value={name} onChangeText={setName} maxLength={120} autoComplete="off" />
        </Field>
        <Field label={t("dieRoom.makers.city")} hint={t("common.optional")}>
          <TextInput value={city} onChangeText={setCity} maxLength={80} autoComplete="off" />
        </Field>
        <Field label={t("dieRoom.makers.phone")} hint={t("common.optional")}>
          <TextInput value={phone} onChangeText={setPhone} maxLength={30} inputMode="tel" autoComplete="off" />
        </Field>
        {error ? (
          <p role="alert" className="m-0 text-[14px] leading-5 font-medium text-destructive">
            {error}
          </p>
        ) : null}
      </form>
    </Sheet>
  );
}
