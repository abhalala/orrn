import Feather from "@expo/vector-icons/Feather";
import { useT } from "@orrn/i18n";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useEffect, useRef, useState } from "react";
import { Linking, Text, View } from "react-native";

import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { LoadingBlock } from "@/components/ui/state";
import { useThemeColor } from "@/lib/theme";

import { photoFits, pickPictureSize, PHOTO_QUALITIES } from "./foundry-model";
import { Note } from "./ui";

/**
 * Take a photo of the spectro printout with the camera the scanner already uses (no extra native module).
 * The photo is a JPEG kept under the server's 1 MB cap. The camera is set to a picture size of about 2 MP
 * (never the sensor's full frame), ONE picture is taken, and it is re-encoded from that one capture at lower
 * qualities until it fits: the person takes one photo, not one per step. Permission states match the
 * scanner: not asked, blocked (open the phone's settings), no camera. Needs a check on a real Android phone
 * and an iPhone (the size list and the re-encode are native).
 */
export function CameraSheet({ visible, onClose, onCaptured }: { visible: boolean; onClose: () => void; onCaptured: (base64: string) => void }) {
  const { t } = useT();
  const ink = useThemeColor("background");
  const [permission, requestPermission] = useCameraPermissions();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [ready, setReady] = useState(false);
  const [pictureSize, setPictureSize] = useState<string | undefined>(undefined);
  // The shutter waits for the picture size to be chosen (success or not), so the photo is never a full-sensor frame by accident.
  const [sizeKnown, setSizeKnown] = useState(false);
  const sizeAsked = useRef(false);
  const [taking, setTaking] = useState(false);
  const [tooBig, setTooBig] = useState(false);
  const [failed, setFailed] = useState(false);
  const camera = useRef<CameraView>(null);

  useEffect(() => {
    let live = true;
    CameraView.isAvailableAsync()
      .then((ok) => live && setAvailable(ok))
      .catch(() => live && setAvailable(true));
    return () => {
      live = false;
    };
  }, []);

  const cameraReady = () => {
    setReady(true);
    if (sizeAsked.current) return;
    sizeAsked.current = true;
    camera.current
      ?.getAvailablePictureSizesAsync()
      .then((sizes) => setPictureSize(pickPictureSize(sizes)))
      .catch(() => undefined)
      .finally(() => setSizeKnown(true));
    if (!camera.current) setSizeKnown(true);
  };

  const take = async () => {
    if (!camera.current || taking) return;
    setTaking(true);
    setTooBig(false);
    setFailed(false);
    try {
      // One capture; the JPEG is then encoded again from it at each quality, best first.
      const shot = await camera.current.takePictureAsync({ pictureRef: true, exif: false });
      for (const quality of PHOTO_QUALITIES) {
        const picture = await shot.savePictureAsync({ quality, base64: true });
        const base64 = (picture.base64 ?? "").replace(/^data:[^,]*,/, "");
        if (photoFits(base64)) {
          onCaptured(base64);
          return;
        }
      }
      setTooBig(true);
    } catch {
      setFailed(true);
    } finally {
      setTaking(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={t("foundry.spectro.attachFile")}>
      {available === false ? <Note>{t("scan.noCamera")}</Note> : null}
      {available !== false && (!permission || available === null) ? <LoadingBlock /> : null}
      {available !== false && permission && !permission.granted ? (
        permission.canAskAgain ? (
          <View className="gap-3">
            <Text className="font-sans text-[15px] leading-6 text-ink-muted">{t("scan.cameraBody")}</Text>
            <Button size="lg" label={t("scan.allowCamera")} onPress={() => void requestPermission()} />
          </View>
        ) : (
          <View className="gap-3">
            <Text className="font-sans text-[15px] leading-6 text-ink-muted">{t("native.scan.cameraBlockedPhone")}</Text>
            <Button label={t("native.scan.openSettings")} onPress={() => void Linking.openSettings()} />
          </View>
        )
      ) : null}
      {available !== false && permission?.granted ? (
        <View className="gap-3">
          <View accessible accessibilityLabel={t("native.scan.cameraView")} className="aspect-[4/3] w-full overflow-hidden rounded-block bg-surface-sunken">
            {visible ? <CameraView ref={camera} style={{ flex: 1 }} facing="back" pictureSize={pictureSize} onCameraReady={cameraReady} onMountError={() => setFailed(true)} /> : null}
            {visible && !ready ? (
              <View pointerEvents="none" className="absolute inset-0 items-center justify-center">
                <Text className="font-sans-medium text-sm text-ink-muted">{t("scan.cameraStarting")}</Text>
              </View>
            ) : null}
          </View>
          {tooBig ? <Note tone="red">{t("foundry.spectro.fileTooBig")}</Note> : null}
          {failed ? <Note tone="red">{t("scan.cameraFailed")}</Note> : null}
          <Button size="lg" label={t("foundry.spectro.attachFile")} loading={taking} disabled={!ready || !sizeKnown} icon={<Feather name="camera" size={20} color={ink} />} onPress={() => void take()} />
        </View>
      ) : null}
    </Sheet>
  );
}
