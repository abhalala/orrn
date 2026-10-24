import { useT, type MessageKey } from "@orrn/i18n";
import { useQuery } from "@tanstack/react-query";
import { useColorScheme } from "nativewind";
import { useState, type ReactNode } from "react";
import { Text, View } from "react-native";

import { LanguageSwitch } from "@/components/language-switch";
import { PageHeader } from "@/components/ui/page-header";
import { Screen } from "@/components/ui/screen";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { ErrorBlock, LoadingBlock } from "@/components/ui/state";
import { sortMembers, TEAM_ACTIONS } from "@/features/settings/team";
import { THEME_PREFS, type ThemePref } from "@/lib/theme-pref";
import { readThemePref, storeThemePref } from "@/lib/theme-store";
import { useFormat } from "@/lib/use-format";
import { can, canAny, useMe } from "@/utils/me";
import { trpc } from "@/utils/trpc";

const THEME_LABEL: Record<ThemePref, MessageKey> = {
  system: "common.themeSystem",
  light: "common.themeLight",
  dark: "common.themeDark",
};

/**
 * Settings on the phone: language and colours for this phone, the company's
 * length unit and time zone (read only), and the team. Company settings and
 * team changes are made on the web.
 */
export default function SettingsScreen() {
  const { t } = useT();
  const { data: me } = useMe();
  const { setColorScheme } = useColorScheme();
  const [theme, setTheme] = useState<ThemePref>(readThemePref);
  const company = me?.company;
  const unit = company?.settings?.lengthUnit === "inch" ? t("settings.company.unitInch") : t("settings.company.unitMm");
  const timezone = typeof company?.settings?.timezone === "string" ? company.settings.timezone : null;

  return (
    <Screen>
      <PageHeader title={t("settings.title")} />

      <Section title={t("native.more.appearance")}>
        <LanguageSwitch />
        <View className="gap-2">
          <Text className="font-sans-medium text-sm text-ink">{t("common.theme")}</Text>
          <SegmentedControl
            label={t("common.theme")}
            options={THEME_PREFS.map((p) => ({ value: p, label: t(THEME_LABEL[p]) }))}
            value={theme}
            onChange={(next) => {
              setTheme(next);
              setColorScheme(next);
              storeThemePref(next);
            }}
          />
        </View>
      </Section>

      {company ? (
        <Section title={t("settings.tabs.company")}>
          <Fact label={t("settings.company.name")} value={company.name} />
          <Fact label={t("settings.company.lengthUnit")} value={unit} />
          {timezone ? <Fact label={t("settings.company.timezone")} value={timezone} /> : null}
          <Text className="font-sans text-sm text-ink-muted">{`${t("settings.company.readOnly")} ${t("native.more.changeOnWeb")}`}</Text>
        </Section>
      ) : null}

      {canAny(me, TEAM_ACTIONS) ? <Team /> : null}
    </Screen>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View className="gap-4 rounded-card border border-hairline bg-surface p-5">
      <Text accessibilityRole="header" className="font-display-bold text-[17px] text-ink">
        {title}
      </Text>
      {children}
    </View>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View accessible accessibilityLabel={`${label}, ${value}`} className="gap-0.5">
      <Text className="font-sans-medium text-[13px] text-ink-muted">{label}</Text>
      <Text className="font-sans-semibold text-base text-ink">{value}</Text>
    </View>
  );
}

function Team() {
  const { t } = useT();
  const { data: me } = useMe();
  const format = useFormat();
  const members = useQuery(trpc.company.membersList.queryOptions());
  const canInvite = can(me, "member.invite");
  const pending = useQuery({ ...trpc.invite.list.queryOptions(), enabled: canInvite });
  const role = (r: string) => t(`roles.${r}` as MessageKey);

  return (
    <Section title={t("settings.team.members")}>
      {members.data === undefined ? (
        members.isError ? (
          <ErrorBlock error={members.error} onRetry={() => void members.refetch()} retrying={members.isFetching} />
        ) : (
          <LoadingBlock />
        )
      ) : (
        <View className="gap-3">
          {sortMembers(members.data).map((m) => {
            const mine = m.user.id === me?.user.id;
            return (
              <View
                key={m.id}
                accessible
                accessibilityLabel={[m.user.name, m.user.email, role(m.role), mine ? t("settings.team.you") : null].filter(Boolean).join(", ")}
                className="min-h-11 flex-row items-center justify-between gap-3"
              >
                <View className="min-w-0 flex-1">
                  <Text className="font-sans-semibold text-base text-ink">
                    {m.user.name}
                    {mine ? ` (${t("settings.team.you")})` : ""}
                  </Text>
                  <Text className="font-sans text-sm text-ink-muted">{m.user.email}</Text>
                </View>
                <Text className="font-sans-medium text-sm text-ink">{role(m.role)}</Text>
              </View>
            );
          })}
        </View>
      )}

      {pending.data && pending.data.length > 0 ? (
        <View className="gap-3 border-t border-hairline pt-4">
          <Text className="font-sans-semibold text-[13px] text-ink-muted">{t("settings.team.pending")}</Text>
          {pending.data.map((inv) => (
            <View key={inv.id} accessible className="gap-0.5">
              <Text className="font-sans-semibold text-base text-ink">{t("native.more.pendingInvite", { email: inv.email, role: role(inv.role) })}</Text>
              <Text className="font-sans text-sm text-ink-muted">{t("settings.team.expires", { date: format.day(inv.expiresAt) ?? "" })}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </Section>
  );
}
