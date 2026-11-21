/**
 * What the sign-in screen says first after the app signed the person out because a plant requires
 * secure sign-in (council round 1, A4): "<Plant> needs a passkey, Google or your authenticator code.
 * Sign in with one of them." Held in memory only: a cold start is not that moment. The screen takes it
 * once, so it never shows twice. Kept free of React Native imports (bun tests load it).
 */
type Notice = { plant: string | null };
let pending: Notice | null = null;
let busy = false;

export const signInNotice = {
  set(notice: Notice): void {
    pending = notice;
  },
  /** The pending notice, cleared as it is read. */
  take(): Notice | null {
    const notice = pending;
    pending = null;
    return notice;
  },
};

/**
 * The handler the root layout registers with `registerStrongSignInHandler`: leave the notice, then sign
 * out once (a screen fires several calls at once and each is refused).
 */
export function createStrongSignInSignOut(signOut: () => Promise<void>) {
  return async (refusal: { plant: string | null }): Promise<void> => {
    if (busy) return;
    busy = true;
    signInNotice.set({ plant: refusal.plant });
    try {
      await signOut();
    } catch {
      // The gate still reads auth.me; the notice waits on the sign-in screen.
    } finally {
      busy = false;
    }
  };
}

type NoticeText =
  | { key: "auth.login.strongSignInNeeded" | "auth.login.strongSignInNeededPhone"; params: { plant: string } }
  | { key: "auth.login.strongSignInNeededPlant" | "auth.login.strongSignInNeededPhonePlant"; params?: undefined };

/**
 * The notice's words (council round 2, Claude N-M2). When this phone offers both a passkey and Google, the
 * plain words do; when it offers only one or neither (Android hides Google, a build without the passkey
 * association hides passkeys), it also says where to get the authenticator code: the web's Settings.
 */
export function strongNoticeText(notice: Notice, offered: { passkey: boolean; google: boolean }): NoticeText {
  const phone = !(offered.passkey && offered.google);
  if (notice.plant) {
    return { key: phone ? "auth.login.strongSignInNeededPhone" : "auth.login.strongSignInNeeded", params: { plant: notice.plant } };
  }
  return { key: phone ? "auth.login.strongSignInNeededPhonePlant" : "auth.login.strongSignInNeededPlant" };
}
