export const PASSWORD_RULES = [
  "Use 12 to 128 characters.",
  "Include an uppercase letter, a lowercase letter, a number, and a symbol.",
  "Do not include the person's name or email address.",
];

export function passwordError(password: string, identity: { name: string; email: string }): string | null {
  if (password.length < 12 || password.length > 128) return "Use a password of 12 to 128 characters.";
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
    return "Include an uppercase letter, a lowercase letter, a number, and a symbol.";
  }
  const lowered = password.toLowerCase();
  const email = identity.email.toLowerCase();
  const local = email.split("@")[0] ?? "";
  const name = identity.name.toLowerCase().trim();
  if (
    lowered.includes(email) ||
    (local.length >= 3 && lowered.includes(local)) ||
    (name.length >= 3 && lowered.includes(name))
  ) {
    return "The password must not include the person's name or email address.";
  }
  return null;
}

export function emailError(email: string): string | null {
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return "Enter a valid email address.";
  }
  return null;
}

export function nameError(name: string): string | null {
  if (!name || name.length > 100) return "Enter a name of 1 to 100 characters.";
  if (/[\u0000-\u001F]/.test(name)) return "Name cannot include control characters.";
  return null;
}
