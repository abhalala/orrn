import Feather from "@expo/vector-icons/Feather";
import { useT } from "@orrn/i18n";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useEffect, useRef, useState } from "react";
import { Linking, Text, View } from "react-native";

import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { LoadingBlock } from "@/components/ui/state";
import { useThemeColor } from "@/lib/theme";

import { photoFits, PHOTO_QUALITIES } from "./foundry-model";
import { Note } from "./ui";

/**
 * Take a photo of the spectro printout with the camera the scanner already uses (no extra native module).
 * The photo is a JPEG kept under the server's 1 MB cap: the best quality that fits is sent. Permission
 * states match the scanner: not asked, blocked (open the phone's settings), no camera.
 */
export function CameraSheet({ visible, onClose, onCaptured }: { visible: boolean; onClose: () => void; onCaptured: (base64: string) => void }) {
  const { t } = useT();
  const ink = useThemeColor("background");
  const [permission, requestPermission] = useCameraPermissions();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [ready, setReady] = useState(false);
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

  const take = async () => {
    if (!camera.current || taking) return;
    setTaking(true);
    setTooBig(false);
    setFailed(false);
    try {
      for (const quality of PHOTO_QUALITIES) {
        const picture = await camera.current.takePictureAsync({ quality, base64: true, exif: false });
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
            {visible ? <CameraView ref={camera} style={{ flex: 1 }} facing="back" onCameraReady={() => setReady(true)} onMountError={() => setFailed(true)} /> : null}
            {visible && !ready ? (
              <View pointerEvents="none" className="absolute inset-0 items-center justify-center">
                <Text className="font-sans-medium text-sm text-ink-muted">{t("scan.cameraStarting")}</Text>
              </View>
            ) : null}
          </View>
          {tooBig ? <Note tone="red">{t("foundry.spectro.fileTooBig")}</Note> : null}
          {failed ? <Note tone="red">{t("scan.cameraFailed")}</Note> : null}
          <Button size="lg" label={t("foundry.spectro.attachFile")} loading={taking} disabled={!ready} icon={<Feather name="camera" size={20} color={ink} />} onPress={() => void take()} />
        </View>
      ) : null}
    </Sheet>
  );
}
