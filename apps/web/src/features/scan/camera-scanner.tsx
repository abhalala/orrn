import { useT } from "@orrn/i18n";
import { Button, IconButton } from "@orrn/ui/components/button";
import { cn } from "@orrn/ui/lib/utils";
import { Camera, CameraOff, Flashlight, FlashlightOff, Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { loadDetector, type Detector } from "./detector";

type CameraState =
  | "checking"
  | "explain"
  | "starting"
  | "live"
  | "blocked"
  | "noCamera"
  | "failed"
  | "unsupported";

export type CameraScannerProps = {
  /** Every value the camera reads, raw. De-duping is the caller's (one rule for camera and test seam). */
  onDetect(raw: string): void;
  /** False while the sheet is closing: the stream stops at once, not after the exit animation. */
  active: boolean;
  /** Start without asking again when the browser already allows the camera (phones and iPads). */
  autoStart: boolean;
  /** Primary button (camera-first devices) or secondary (laptops, where the field leads). */
  emphasis: "primary" | "secondary";
  className?: string;
};

/** How often the frame is read. Fast enough to feel instant, light on a phone battery. */
const SCAN_INTERVAL_MS = 120;

type TorchCapabilities = MediaTrackCapabilities & { torch?: boolean };

/**
 * Camera barcode reader for phones and iPads. It explains why it wants the
 * camera before the browser asks (nothing calls `getUserMedia` until the
 * person taps "Turn on camera", unless the camera is already allowed), reads
 * QR and Code 128 with the native `BarcodeDetector` or the lazy ponyfill,
 * offers the torch where the camera has one, and stops the stream when the
 * sheet closes, the component unmounts or the page is hidden (it resumes when
 * the page comes back). Blocked, missing or failing cameras say what to do;
 * the manual field next to it always works.
 */
export function CameraScanner({ onDetect, active, autoStart, emphasis, className }: CameraScannerProps) {
  const { t } = useT();
  const [state, setState] = useState<CameraState>("checking");
  const [torch, setTorch] = useState<{ supported: boolean; on: boolean }>({ supported: false, on: false });
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const runRef = useRef(0);
  const resumeRef = useRef(false);
  const onDetectRef = useRef(onDetect);
  onDetectRef.current = onDetect;

  const stop = useCallback(() => {
    runRef.current += 1;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setTorch({ supported: false, on: false });
  }, []);

  const start = useCallback(async () => {
    stop();
    const run = runRef.current;
    setState("starting");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
    } catch (error) {
      if (run !== runRef.current) return;
      const name = error instanceof DOMException ? error.name : "";
      setState(
        name === "NotAllowedError" || name === "SecurityError"
          ? "blocked"
          : name === "NotFoundError" || name === "OverconstrainedError"
            ? "noCamera"
            : "failed",
      );
      return;
    }
    // Closed or restarted while the browser was asking.
    if (run !== runRef.current) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    streamRef.current = stream;
    setState("live");
    const track = stream.getVideoTracks()[0];
    const caps = (track?.getCapabilities?.() ?? {}) as TorchCapabilities;
    setTorch({ supported: Boolean(caps.torch), on: false });

    let detector: Detector;
    try {
      detector = await loadDetector();
    } catch {
      if (run === runRef.current) {
        stop();
        setState("failed");
      }
      return;
    }
    const tick = async () => {
      if (run !== runRef.current) return;
      const video = videoRef.current;
      if (video && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0) {
        try {
          const codes = await detector.detect(video);
          if (run !== runRef.current) return;
          for (const code of codes) if (code.rawValue) onDetectRef.current(code.rawValue);
        } catch {
          // A frame that can't be read (camera warming up); the next one will do.
        }
      }
      if (run === runRef.current) timerRef.current = window.setTimeout(tick, SCAN_INTERVAL_MS);
    };
    void tick();
  }, [stop]);

  // The live stream goes into the <video> once it is rendered.
  useEffect(() => {
    const video = videoRef.current;
    if (state !== "live" || !video || !streamRef.current) return;
    if (video.srcObject !== streamRef.current) video.srcObject = streamRef.current;
    void video.play().catch(() => {});
  }, [state]);

  // First look: can this browser use a camera at all, and is it already allowed?
  useEffect(() => {
    let cancelled = false;
    if (!navigator.mediaDevices?.getUserMedia) {
      setState("unsupported");
      return;
    }
    const check = async () => {
      let permission: PermissionState | "unknown" = "unknown";
      try {
        permission = (await navigator.permissions?.query({ name: "camera" as PermissionName }))?.state ?? "unknown";
      } catch {
        // Safari before 16 and Firefox don't know the "camera" permission name.
      }
      if (cancelled) return;
      if (permission === "denied") setState("blocked");
      else if (permission === "granted" && autoStart) void start();
      else setState("explain");
    };
    void check();
    return () => {
      cancelled = true;
    };
    // Only on mount: `autoStart` is fixed for the sheet's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Closing the sheet stops the camera straight away.
  useEffect(() => {
    if (active) return;
    if (streamRef.current) stop();
  }, [active, stop]);

  // A hidden page (app switch, screen lock) never keeps the camera on.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        if (streamRef.current) {
          resumeRef.current = true;
          stop();
          setState("explain");
        }
      } else if (resumeRef.current && active) {
        resumeRef.current = false;
        void start();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [active, start, stop]);

  useEffect(() => stop, [stop]);

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torch.on;
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] });
      setTorch({ supported: true, on: next });
    } catch {
      setTorch({ supported: false, on: false });
    }
  };

  const turnOff = () => {
    stop();
    setState("explain");
  };

  const message =
    state === "blocked"
      ? t("scan.cameraBlocked")
      : state === "noCamera" || state === "unsupported"
        ? t("scan.noCamera")
        : state === "failed"
          ? t("scan.cameraFailed")
          : null;

  return (
    <div data-slot="camera-scanner" data-state={state} className={cn("min-w-0", className)}>
      {state === "live" || state === "starting" ? (
        <div className="flex flex-col gap-2">
          <div className="relative aspect-[4/3] max-h-[36dvh] w-full overflow-hidden rounded-card bg-tone-neutral text-tone-neutral-on">
            <video
              ref={videoRef}
              aria-hidden="true"
              muted
              playsInline
              autoPlay
              className="absolute inset-0 size-full object-cover"
            />
            {state === "starting" ? (
              <div className="absolute inset-0 flex items-center justify-center gap-2 text-[15px] font-medium">
                <Loader2 aria-hidden="true" className="size-5 animate-spin" strokeWidth={2} />
                <span>{t("scan.cameraStarting")}</span>
              </div>
            ) : (
              <ViewfinderFrame />
            )}
          </div>
          <div className="flex min-h-11 items-center gap-2">
            <p className="m-0 min-w-0 flex-1 text-[14px] leading-5 text-muted-foreground">{t("scan.pointAtLabel")}</p>
            {torch.supported ? (
              <IconButton
                variant="secondary"
                label={torch.on ? t("scan.torchOff") : t("scan.torchOn")}
                aria-pressed={torch.on}
                icon={torch.on ? <FlashlightOff strokeWidth={2} /> : <Flashlight strokeWidth={2} />}
                onClick={() => void toggleTorch()}
              />
            ) : null}
            <IconButton
              variant="secondary"
              label={t("scan.cameraOff")}
              icon={<CameraOff strokeWidth={2} />}
              onClick={turnOff}
            />
          </div>
        </div>
      ) : state === "checking" ? (
        <div aria-hidden="true" className="h-[132px] rounded-card border border-border bg-card" />
      ) : (
        <div className="flex flex-col gap-3 rounded-card border border-border bg-card p-4">
          <div className="flex items-start gap-3">
            <span
              aria-hidden="true"
              className="flex size-11 shrink-0 items-center justify-center rounded-full bg-tone-neutral-tint text-tone-neutral-ink"
            >
              <Camera className="size-5" strokeWidth={2} />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <h3 className="m-0 text-[16px] font-semibold leading-snug">{t("scan.cameraTitle")}</h3>
              <p className="m-0 text-[14px] leading-5 text-muted-foreground">{t("scan.cameraBody")}</p>
            </div>
          </div>
          {/* Announced when it appears: the person just tapped and is waiting for the camera. */}
          <p aria-live="polite" className="m-0 text-[14px] leading-5 font-medium text-destructive empty:hidden">
            {message}
          </p>
          {state !== "unsupported" && state !== "noCamera" ? (
            <Button
              variant={emphasis}
              size={emphasis === "primary" ? "lg" : "md"}
              className="w-full sm:w-auto sm:self-start"
              onClick={() => void start()}
            >
              <Camera strokeWidth={2} aria-hidden="true" />
              {t("scan.allowCamera")}
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}

/** Four corner marks over the video so people know where to put the label. Static: no ambient motion. */
function ViewfinderFrame() {
  const corner = "absolute size-9 border-tone-neutral-on";
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-[14%]">
      <span className={cn(corner, "top-0 left-0 border-t-[3px] border-l-[3px]")} />
      <span className={cn(corner, "top-0 right-0 border-t-[3px] border-r-[3px]")} />
      <span className={cn(corner, "bottom-0 left-0 border-b-[3px] border-l-[3px]")} />
      <span className={cn(corner, "right-0 bottom-0 border-r-[3px] border-b-[3px]")} />
    </div>
  );
}
