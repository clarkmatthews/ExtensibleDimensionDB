import type { SsoSettings, User } from "@prisma/client";

type Person = Pick<User, "isAdmin" | "oidcSubject" | "mustChangePassword">;
type Sso = Pick<SsoSettings, "enabled" | "passwordAdminOnly"> | null;

/**
 * True when single sign-on applies to this person: it is turned on, and either they have signed in
 * through the provider or password sign-in is limited to administrators and they are not one.
 */
export function usesSso(person: Person, sso: Sso) {
  if (!sso?.enabled) return false;
  return Boolean(person.oidcSubject) || (sso.passwordAdminOnly && !person.isAdmin);
}

/** People who sign in with a password manage it themselves. */
export function managesOwnPassword(person: Person, sso: Sso) {
  return !usesSso(person, sso);
}

/** A non-administrator whose password someone else chose must pick their own before going on. */
export function mustChooseOwnPassword(person: Person, sso: Sso) {
  return person.mustChangePassword && !person.isAdmin && managesOwnPassword(person, sso);
}
