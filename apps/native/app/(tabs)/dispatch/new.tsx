import { useT } from "@orrn/i18n";
import { useMutation } from "@tanstack/react-query";
import { Stack, useRouter } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Screen } from "@/components/ui/screen";
import { announce } from "@/lib/a11y";
import { zoneOf } from "@/lib/format";
import { feedback } from "@/lib/feedback";
import { saveErrorText } from "@/lib/save-error";
import { useMe } from "@/utils/me";
import { queryClient, trpc } from "@/utils/trpc";

import { ActionBar } from "@/features/dispatch/action-bar";
import { ChoiceChips } from "@/features/dispatch/choice-chips";
import { CustomerPicker, type PickedCustomer } from "@/features/dispatch/customer-picker";
import { shipDateFromChoice, type ShipDateChoice } from "@/features/dispatch/ship-date";

type ShipKind = ShipDateChoice["kind"];

/**
 * New dispatch: pick the customer, say when it ships (no date, today,
 * tomorrow or a typed day) and add a note. Create opens the new dispatch to
 * build. `dispatch.create` takes no request id, so when a save is unsure the
 * person is told to look in the Dispatch list before trying again.
 */
export default function NewDispatchScreen() {
  const { t } = useT();
  const router = useRouter();
  const me = useMe();
  const create = useMutation(trpc.dispatch.create.mutationOptions());
  const [customer, setCustomer] = useState<PickedCustomer | null>(null);
  const [kind, setKind] = useState<ShipKind>("none");
  const [typed, setTyped] = useState("");
  const [notes, setNotes] = useState("");
  const [tried, setTried] = useState(false);
  const [problem, setProblem] = useState<{ title: string; body: string; unsure: boolean } | null>(null);

  const choice: ShipDateChoice = kind === "typed" ? { kind, text: typed } : { kind };
  const shipDate = shipDateFromChoice(choice, new Date(), zoneOf(me.data?.company?.settings as { [key: string]: unknown } | null | undefined));
  const dateError = kind === "typed" && shipDate === undefined && (tried || typed.trim() !== "") ? t("native.dispatch.dateInvalid") : null;
  const customerError = tried && !customer ? t("native.dispatch.customerRequired") : null;

  const submit = async () => {
    setTried(true);
    setProblem(null);
    if (!customer || shipDate === undefined) return;
    try {
      const created = await create.mutateAsync({ customerId: customer.id, shipDate, notes: notes.trim() || null });
      feedback.success();
      announce(t("native.dispatch.createdNote"));
      void queryClient.invalidateQueries(trpc.dispatch.pathFilter());
      router.replace({ pathname: "/dispatch/[id]", params: { id: created.id } });
    } catch (error) {
      feedback.error();
      const text = saveErrorText(t, error);
      announce(`${text.title}. ${text.body}`, { shownInLiveRegion: true });
      setProblem({ title: text.title, body: text.body, unsure: text.kind === "unsure" });
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: t("dispatch.new.title") }} />
      <View className="flex-1 bg-canvas">
        <Screen>
          <CustomerPicker selected={customer} onSelect={setCustomer} onClear={() => setCustomer(null)} error={customerError} />

          <View className="gap-2">
            <Text className="font-sans-medium text-sm text-ink">{t("dispatch.new.shipDate")}</Text>
            <ChoiceChips
              label={t("dispatch.new.shipDate")}
              value={kind}
              onChange={setKind}
              options={[
                { value: "none", label: t("native.dispatch.noDate") },
                { value: "today", label: t("common.today") },
                { value: "tomorrow", label: t("native.dispatch.tomorrow") },
                { value: "typed", label: t("native.dispatch.typedDate") },
              ]}
            />
            {kind === "typed" ? (
              <Field
                label={t("native.dispatch.typedDate")}
                hint={t("native.dispatch.dateHint")}
                error={dateError}
                value={typed}
                onChangeText={setTyped}
                keyboardType="numbers-and-punctuation"
                placeholder="15-10-2026"
                mono
                maxLength={10}
              />
            ) : null}
          </View>

          <Field
            label={t("dispatch.new.notes")}
            hint={t("native.dispatch.notesHint")}
            value={notes}
            onChangeText={setNotes}
            multiline
            maxLength={500}
            textAlignVertical="top"
            inputClassName="min-h-24 py-3"
          />

          {problem ? (
            <View accessibilityLiveRegion="polite" className="gap-1 rounded-card bg-tone-red-tint p-4">
              <Text className="font-sans-semibold text-base text-tone-red-ink">{problem.title}</Text>
              <Text className="font-sans text-[15px] leading-6 text-tone-red-ink">{problem.body}</Text>
              {problem.unsure ? (
                <Button className="mt-2" variant="secondary" label={t("dispatch.title")} onPress={() => router.replace("/dispatch")} />
              ) : null}
            </View>
          ) : null}
        </Screen>
        <ActionBar>
          <Button size="lg" label={t("dispatch.new.submit")} loadingLabel={t("native.dispatch.creating")} loading={create.isPending} onPress={() => void submit()} />
        </ActionBar>
      </View>
    </>
  );
}
