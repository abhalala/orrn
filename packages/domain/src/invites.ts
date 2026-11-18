/**
 * Only an owner hands out the owner role: by inviting, or by resending an owner's invite (plan
 * 2026-11-18, Task 8). `invite.create`, `invite.resend` and the Team tab all ask this one rule, so the
 * Team tab never offers a button the server refuses. Whether the person may invite at all is the
 * `member.invite` permission, checked separately.
 */
export function mayHandOutRole(actorRole: string | null | undefined, role: string): boolean {
  return role !== "owner" || actorRole === "owner";
}
