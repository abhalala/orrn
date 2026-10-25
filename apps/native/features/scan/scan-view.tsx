import Feather from "@expo/vector-icons/Feather";
import { useT } from "@orrn/i18n";
import { cn } from "@orrn/ui/lib/utils";
import { useMutation } from "@tanstack/react-query";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useIsFocused, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Linking, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Field } from "@/components/ui/field";
import { ScreenTitle } from "@/components/ui/screen-title";
import { LoadingBlock } from "@/components/ui/state";
import { announce } from "@/lib/a11y";
import { toEntering } from "@/lib/entering";
import { feedback } from "@/lib/feedback";
import { popEntering } from "@/lib/motion";
import { AnimatedView } from "@/lib/nativewind-interop";
import { useReduceMotion } from "@/lib/reduced-motion";
import { writeFailureKind } from "@/lib/request-timeout";
import { saveErrorText } from "@/lib/save-error";
import { useThemeColor } from "@/lib/theme";
import { reachableTabs } from "@/lib/nav";
import { useMe } from "@/utils/me";
import { queryClient, trpc } from "@/utils/trpc";

import { copyCodeQuery, copyIdFromLink, looksLikeCopyCode } from "@/features/dies/copy-model";

import { createDeduper } from "./dedupe";
import { addOutcome, renderScanMessage, scanErrorKey } from "./outcome";
import {
  dedupeKey,
  lookupTarget,
  needsResolve,
  pushScanLog,
  readSerial,
  scanLogEntry,
  scanMode,
  type ResolveHit,
  type ScanLogEntry,
  type ScanLogKind,
} from "./scan-flow";

type Candidate = { bundleId: string; number: string; year: number };
type LineTone = "progress" | "success" | "neutral" | "error";
type Line = { id: number; tone: LineTone; message: string; serial?: string };

const LINE_ICON = { progress: "loader", success: "check-circle", neutral: "info", error: "alert-circle" } as const;
const LINE_TEXT: Record<LineTone, string> = {
  progress: "text-ink-muted",
  success: "text-tone-green-ink",
  neutral: "text-ink",
  error: "text-destructive",
};
const LOG_TONE = { added: "green", already: "neutral", rejected: "red", notFound: "amber", opened: "blue", error: "red" } as const;

/**
 * The Scan tab. Lookup mode (no params): a read opens the bundle page.
 * Dispatch mode (`dispatchId` and `code` params, set by the dispatch screen):
 * every read is added to that building dispatch, and the screen stays open
 * with a running count until "Done scanning". The camera and the typed entry
 * feed one handler; the camera is paused whenever the tab is not in front.
 */
export function ScanView() {
  const { t } = useT();
  const router = useRouter();
  const params = useLocalSearchParams<{ dispatchId?: string; code?: string }>();
  const mode = useMemo(() => scanMode(params), [params]);
  const focused = useIsFocused();
  const reduceMotion = useReduceMotion();
  const ink = useThemeColor("foreground");

  const [torch, setTorch] = useState(false);
  const [cameraOn, setCameraOn] = useState(true);
  const [line, setLine] = useState<Line | null>(null);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [log, setLog] = useState<ScanLogEntry[]>([]);
  const [count, setCount] = useState(0);
  const [lastAdded, setLastAdded] = useState<string | null>(null);
  const [typed, setTyped] = useState("");

  const dedupe = useMemo(() => createDeduper(), []);
  const seq = useRef(0);
  const countRef = useRef(0);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  // A die label opens the copy card only for people who can open the Dies screens; for anyone else it is just a bundle lookup.
  const { data: me } = useMe();
  const diesRef = useRef(false);
  diesRef.current = reachableTabs(me).includes("dies");
  // Reads are handled one after another, in the order they were made, so a quick burst never races itself on the server.
  const queue = useRef<Promise<void>>(Promise.resolve());

  const add = useMutation(trpc.dispatch.addBundlesBySerial.mutationOptions());
  const addRef = useRef(add);
  addRef.current = add;

  // Leaving the tab: torch off, and the same label may be read again when the person comes back.
  useEffect(() => {
    if (!focused) {
      setTorch(false);
      dedupe.reset();
    }
  }, [focused, dedupe]);

  // A different dispatch (or lookup) starts a fresh count.
  const modeKey = mode.kind === "dispatch" ? mode.dispatchId : "lookup";
  useEffect(() => {
    countRef.current = 0;
    setCount(0);
    setLastAdded(null);
    setLine(null);
    setCandidates(null);
    setLog([]);
  }, [modeKey]);

  const remember = useCallback((serial: string, kind: ScanLogKind) => {
    setLog((list) => pushScanLog(list, scanLogEntry({ serial, kind }, ++seq.current)));
  }, []);

  const fail = useCallback(
    (id: number, message: string, serial?: string) => {
      feedback.error();
      announce(serial ? `${message}. ${serial}` : message, { shownInLiveRegion: true });
      setLine({ id, tone: "error", message, serial });
    },
    [],
  );

  const resolveCode = useCallback(
    (code: string) => queryClient.fetchQuery({ ...trpc.resolve.byCode.queryOptions({ code }), staleTime: 0 }) as Promise<ResolveHit>,
    [],
  );

  const refreshDispatches = useCallback(() => {
    void queryClient.invalidateQueries(trpc.dispatch.pathFilter());
    void queryClient.invalidateQueries(trpc.bundle.pathFilter());
  }, []);

  const lookup = useCallback(
    async (id: number, serial: string) => {
      setLine({ id, tone: "progress", message: t("ui.searching") });
      try {
        const target = lookupTarget(await resolveCode(serial));
        if (target.kind === "open") {
          feedback.success();
          announce(t("bundle.title", { serial }), { shownInLiveRegion: false });
          remember(serial, "opened");
          setLine(null);
          router.push(target.href);
        } else if (target.kind === "choose") {
          setLine({ id, tone: "neutral", message: t("scan.ambiguous"), serial });
          announce(t("scan.ambiguous"), { shownInLiveRegion: true });
          setCandidates(target.candidates);
        } else {
          remember(serial, "notFound");
          fail(id, t(target.key), serial);
        }
      } catch (error) {
        remember(serial, "error");
        fail(id, t(scanErrorKey(error, "lookup")), serial);
      }
    },
    [fail, remember, resolveCode, router, t],
  );

  const addToDispatch = useCallback(
    async (id: number, scanned: string, dispatchId: string) => {
      let serial = scanned;
      setLine({ id, tone: "progress", message: t("scan.continuous.adding", { serial }) });
      try {
        // Old month-only numbers and legacy ids: find the bundle's own number first.
        if (needsResolve(serial)) {
          const hit = await resolveCode(serial);
          if (hit.kind === "ambiguous") {
            setLine({ id, tone: "neutral", message: t("scan.ambiguous"), serial });
            announce(t("scan.ambiguous"), { shownInLiveRegion: true });
            setCandidates(hit.candidates);
            return;
          }
          if (hit.kind === "not_found") {
            remember(serial, "notFound");
            fail(id, t("scan.notFound"), serial);
            return;
          }
          serial = hit.number;
        }
        const report = await addRef.current.mutateAsync({ id: dispatchId, serials: [serial] });
        const outcome = addOutcome(report, serial);
        switch (outcome.kind) {
          case "added": {
            countRef.current += 1;
            setCount(countRef.current);
            setLastAdded(serial);
            feedback.success();
            const said = `${t("scan.continuous.added", { serial })}. ${t("scan.continuous.count", { count: countRef.current })}`;
            announce(said, { shownInLiveRegion: true });
            setLine({ id, tone: "success", message: t("scan.continuous.added", { serial }), serial });
            remember(serial, "added");
            refreshDispatches();
            break;
          }
          case "already":
            // Calm: a second read of a bundle already on the list is not an error.
            announce(t("scan.continuous.already"), { shownInLiveRegion: true });
            setLine({ id, tone: "neutral", message: t("scan.continuous.already"), serial });
            remember(serial, "already");
            break;
          case "rejected":
            remember(serial, "rejected");
            fail(id, renderScanMessage(t, outcome.message), serial);
            break;
          case "notFound":
            remember(serial, "notFound");
            fail(id, t("scan.notFound"), serial);
            break;
        }
      } catch (error) {
        remember(serial, "error");
        // A save that did not answer may have gone through: say so, never retry on the person's behalf.
        const message = writeFailureKind(error) === "unsure" ? saveErrorText(t, error).body : t(scanErrorKey(error, "dispatch"));
        fail(id, message, serial);
        if (writeFailureKind(error) === "unsure") refreshDispatches();
      }
    },
    [fail, refreshDispatches, remember, resolveCode, t],
  );

  /**
   * Lookup mode, die room: a die copy label (a card link, or a code like 12170-2 that names a live
   * copy) opens the copy's card. Anything else is a bundle and goes on to the normal lookup.
   */
  const openDieCopy = useCallback(
    async (id: number, raw: string): Promise<boolean> => {
      const open = (copyId: string, code: string) => {
        feedback.success();
        announce(t("dieRoom.card.title"), { shownInLiveRegion: false });
        remember(code, "opened");
        setLine(null);
        router.push({ pathname: "/dies/[id]", params: { id: copyId } });
      };
      const linked = copyIdFromLink(raw);
      if (linked) {
        open(linked, linked);
        return true;
      }
      const code = copyCodeQuery(raw).toUpperCase();
      if (!looksLikeCopyCode(code)) return false;
      try {
        const res = await queryClient.fetchQuery({ ...trpc.dieInstance.list.queryOptions({ search: code, limit: 5 }), staleTime: 0 });
        const hit = res.items.find((c) => c.code.toUpperCase() === code);
        if (!hit) return false;
        setLine({ id, tone: "progress", message: t("ui.searching") });
        open(hit.id, hit.code);
        return true;
      } catch {
        // The copy lookup failed: the bundle lookup below reports the network problem if there is one.
        return false;
      }
    },
    [remember, router, t],
  );

  const handle = useCallback(
    async (raw: string) => {
      const id = ++seq.current;
      if (modeRef.current.kind === "lookup" && diesRef.current && (await openDieCopy(id, raw))) return;
      const read = readSerial(raw);
      if (read.kind === "unrecognised") {
        fail(id, t("scan.unrecognised"));
        return;
      }
      const current = modeRef.current;
      if (current.kind === "dispatch") await addToDispatch(id, read.serial, current.dispatchId);
      else await lookup(id, read.serial);
    },
    [addToDispatch, fail, lookup, openDieCopy, t],
  );

  const onScan = useCallback(
    (raw: string) => {
      setCandidates(null);
      // One read that throws must never stall the ones queued behind it.
      queue.current = queue.current.then(() => handle(raw)).catch(() => undefined);
    },
    [handle],
  );

  // The camera reads the label on every frame: one read per label per 1.5 s, and none while the tab is not in front.
  const onDetect = useCallback(
    (raw: string) => {
      const value = raw.trim();
      if (!value) return;
      if (!dedupe.accept(dedupeKey(value))) return;
      onScan(value);
    },
    [dedupe, onScan],
  );

  const submitTyped = () => {
    const value = typed.trim();
    if (!value) return;
    setTyped("");
    // Typed entries are deliberate: they skip the de-dupe.
    onScan(value);
  };

  const pick = (c: Candidate) => {
    setCandidates(null);
    if (mode.kind === "dispatch") onScan(c.number);
    else router.push(`/b/${encodeURIComponent(c.number)}`);
  };

  const done = () => {
    const dispatchId = mode.kind === "dispatch" ? mode.dispatchId : null;
    router.setParams({ dispatchId: undefined, code: undefined });
    if (dispatchId) router.navigate({ pathname: "/dispatch/[id]", params: { id: dispatchId } });
  };

  const title = mode.kind === "dispatch" && mode.code ? t("scan.continuous.title", { code: mode.code }) : t("scan.title");
  const logWord: Record<ScanLogKind, string> = {
    added: t("scan.continuous.result.added"),
    already: t("scan.continuous.result.already"),
    rejected: t("scan.continuous.result.rejected"),
    notFound: t("scan.continuous.result.notFound"),
    opened: t("native.scan.opened"),
    error: t("native.scan.failed"),
  };

  return (
    <SafeAreaView className="flex-1 bg-canvas" edges={["top", "left", "right"]}>
      <ScrollView contentContainerClassName="gap-4 px-4 pb-12 pt-4" keyboardShouldPersistTaps="handled">
        <View className="w-full max-w-[720px] gap-4 self-center">
          <ScreenTitle>{title}</ScreenTitle>

          {mode.kind === "dispatch" ? (
            <AnimatedView
              key={count}
              entering={count > 0 ? toEntering(popEntering(reduceMotion)) : undefined}
              accessible
              accessibilityLabel={t("scan.continuous.count", { count })}
              className={cn("min-h-[88px] flex-row flex-wrap items-end justify-between gap-x-4 gap-y-1 rounded-block p-[18px]", count > 0 ? "bg-tone-green" : "border border-hairline bg-surface")}
            >
              <Text className={cn("font-display-extrabold text-[34px] leading-[46px]", count > 0 ? "text-tone-green-on" : "text-ink")}>
                {t("scan.continuous.count", { count })}
              </Text>
              {lastAdded ? <Text className="shrink font-mono-semibold text-[15px] text-tone-green-on">{lastAdded}</Text> : null}
            </AnimatedView>
          ) : null}

          <CameraPanel focused={focused} cameraOn={cameraOn} torch={torch} onDetect={onDetect} onToggleCamera={() => setCameraOn((v) => !v)} onToggleTorch={() => setTorch((v) => !v)} ink={ink} />

          <View accessibilityLiveRegion="polite" className="min-h-6">
            {line ? (
              <View key={line.id} className="flex-row items-start gap-2">
                <Feather name={LINE_ICON[line.tone]} size={18} color={ink} importantForAccessibility="no" />
                <Text className={cn("min-w-0 flex-1 font-sans-semibold text-[15px] leading-6", LINE_TEXT[line.tone])}>
                  {line.message}
                  {line.serial ? <Text className="font-mono text-ink-muted">{`  ${line.serial}`}</Text> : null}
                </Text>
              </View>
            ) : null}
          </View>

          {candidates ? (
            <View accessibilityLabel={t("scan.ambiguous")} className="gap-2">
              {candidates.map((c) => (
                <Button
                  key={c.bundleId}
                  variant="secondary"
                  label={`${c.number}, ${t("scan.madeIn", { year: c.year })}`}
                  onPress={() => pick(c)}
                />
              ))}
            </View>
          ) : null}

          <View className="gap-2">
            <Field
              label={t("scan.manualLabel")}
              hint={t("scan.manualHint")}
              mono
              value={typed}
              onChangeText={setTyped}
              placeholder="26I4086"
              autoCapitalize="characters"
              autoCorrect={false}
              autoComplete="off"
              spellCheck={false}
              returnKeyType="search"
              onSubmitEditing={submitTyped}
            />
            <Button label={t("scan.find")} variant="secondary" disabled={!typed.trim()} onPress={submitTyped} />
          </View>

          {log.length > 0 ? (
            <View accessibilityLabel={t("scan.recent")} className="gap-2">
              <Text accessibilityRole="header" className="font-display-bold text-lg text-ink">
                {t("scan.recent")}
              </Text>
              {log.map((entry) => (
                <View key={entry.id} accessible accessibilityLabel={`${entry.serial}, ${logWord[entry.kind]}`} className="min-h-12 flex-row items-center justify-between gap-3 border-b border-hairline py-2">
                  <Text className="min-w-0 flex-1 font-mono text-[15px] text-ink">{entry.serial}</Text>
                  <Chip tone={LOG_TONE[entry.kind]} label={logWord[entry.kind]} />
                </View>
              ))}
            </View>
          ) : mode.kind === "dispatch" ? (
            <Text className="font-sans text-sm text-ink-muted">{t("scan.continuous.empty")}</Text>
          ) : null}

          {mode.kind === "dispatch" ? <Button size="lg" label={t("scan.continuous.done")} onPress={done} /> : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

type CameraPanelProps = {
  focused: boolean;
  cameraOn: boolean;
  torch: boolean;
  onDetect: (raw: string) => void;
  onToggleCamera: () => void;
  onToggleTorch: () => void;
  ink: string;
};

/**
 * Camera permission flow and the viewfinder. States: asking for the camera
 * (not asked yet), blocked (denied for good: open the phone's settings), no
 * camera, starting, failed, and running. Every state leaves the typed entry
 * below usable.
 */
function CameraPanel({ focused, cameraOn, torch, onDetect, onToggleCamera, onToggleTorch, ink }: CameraPanelProps) {
  const { t } = useT();
  const [permission, requestPermission] = useCameraPermissions();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    CameraView.isAvailableAsync()
      .then((ok) => live && setAvailable(ok))
      .catch(() => live && setAvailable(true));
    return () => {
      live = false;
    };
  }, []);

  if (available === false) return <Notice body={t("scan.noCamera")} />;
  if (!permission || available === null) return <LoadingBlock />;

  if (!permission.granted) {
    if (permission.canAskAgain) {
      return (
        <Notice title={t("scan.cameraTitle")} body={t("scan.cameraBody")}>
          <Button size="lg" label={t("scan.allowCamera")} onPress={() => void requestPermission()} />
        </Notice>
      );
    }
    return (
      <Notice body={t("native.scan.cameraBlockedPhone")}>
        <Button label={t("native.scan.openSettings")} onPress={() => void Linking.openSettings()} />
      </Notice>
    );
  }

  if (failed) {
    return (
      <Notice body={t("scan.cameraFailed")}>
        <Button
          label={t("common.retry")}
          onPress={() => {
            setFailed(false);
            setReady(false);
            setAttempt((n) => n + 1);
          }}
        />
      </Notice>
    );
  }

  if (!cameraOn) {
    return (
      <Notice body={t("scan.pointAtLabel")}>
        <Button variant="secondary" label={t("scan.allowCamera")} onPress={onToggleCamera} />
      </Notice>
    );
  }

  return (
    <View className="gap-3">
      <View accessible accessibilityLabel={t("native.scan.cameraView")} className="aspect-[4/3] w-full overflow-hidden rounded-block bg-surface-sunken">
        {focused ? (
          <CameraView
            key={attempt}
            style={{ flex: 1 }}
            facing="back"
            enableTorch={torch}
            barcodeScannerSettings={{ barcodeTypes: ["qr", "code128"] }}
            onBarcodeScanned={({ data }) => onDetect(data)}
            onCameraReady={() => setReady(true)}
            onMountError={() => setFailed(true)}
          />
        ) : null}
        {focused && !ready ? (
          <View pointerEvents="none" className="absolute inset-0 items-center justify-center">
            <Text className="font-sans-medium text-sm text-ink-muted">{t("scan.cameraStarting")}</Text>
          </View>
        ) : null}
      </View>
      <View className="flex-row gap-2">
        <Button
          className="flex-1"
          variant="secondary"
          label={torch ? t("scan.torchOff") : t("scan.torchOn")}
          icon={<Feather name={torch ? "zap-off" : "zap"} size={18} color={ink} />}
          onPress={onToggleTorch}
        />
        <Button className="flex-1" variant="ghost" label={t("scan.cameraOff")} onPress={onToggleCamera} />
      </View>
    </View>
  );
}

function Notice({ title, body, children }: { title?: string; body: string; children?: ReactNode }) {
  return (
    <View className="gap-3 rounded-card border border-hairline bg-surface p-5">
      {title ? (
        <Text accessibilityRole="header" className="font-display-bold text-lg text-ink">
          {title}
        </Text>
      ) : null}
      <Text className="font-sans text-[15px] leading-6 text-ink-muted">{body}</Text>
      {children}
    </View>
  );
}
