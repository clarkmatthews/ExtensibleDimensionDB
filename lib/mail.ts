import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import type { MailSecurity, MailSettings } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertAuthSecret } from "@/lib/session-token";

const SETTINGS_ID = "default";

export type MailView = Omit<MailSettings, "password"> & { passwordSet: boolean };

export type ResolvedMail = {
  saved: boolean;
  settings: MailView;
};

function mailKey() {
  assertAuthSecret();
  const secret = process.env.AUTH_SECRET?.trim() ?? "";
  return Buffer.from(hkdfSync("sha256", secret, "dimension-mail", "smtp-password", 32));
}

export function encryptSecret(plain: string) {
  if (!plain) return "";
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", mailKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(":");
}

export function decryptSecret(stored: string) {
  if (!stored) return "";
  const [version, iv, tag, data] = stored.split(":");
  if (version !== "v1" || !iv || !tag || !data) {
    throw new Error("The saved mail password could not be read. Enter it again.");
  }
  const decipher = createDecipheriv("aes-256-gcm", mailKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

function environmentSettings(): MailView {
  const port = Number(process.env.SMTP_PORT || 587);
  const host = process.env.SMTP_HOST?.trim() ?? "";
  return {
    id: SETTINGS_ID,
    enabled: Boolean(host),
    host,
    port: Number.isInteger(port) && port > 0 ? port : 587,
    security: port === 465 ? "TLS" : "STARTTLS",
    rejectUnauthorized: true,
    username: process.env.SMTP_USER?.trim() ?? "",
    fromName: "",
    fromEmail: process.env.SMTP_FROM?.trim() ?? "",
    replyTo: "",
    updatedAt: new Date(),
    passwordSet: Boolean(process.env.SMTP_PASSWORD),
  };
}

function viewSettings(row: MailSettings): MailView {
  const { password, ...rest } = row;
  return { ...rest, passwordSet: Boolean(password) };
}

export async function resolveMailSettings(): Promise<ResolvedMail> {
  const row = await prisma.mailSettings.findUnique({ where: { id: SETTINGS_ID } });
  if (row) return { saved: true, settings: viewSettings(row) };
  return { saved: false, settings: environmentSettings() };
}

async function settingsForDelivery(): Promise<MailSettings | null> {
  const row = await prisma.mailSettings.findUnique({ where: { id: SETTINGS_ID } });
  if (row) return { ...row, password: decryptSecret(row.password) };
  const view = environmentSettings();
  return {
    ...view,
    password: process.env.SMTP_PASSWORD ?? "",
  };
}

export function fromHeader(settings: Pick<MailSettings, "fromName" | "fromEmail">) {
  const email = settings.fromEmail.trim();
  const name = settings.fromName.trim().replaceAll('"', "");
  if (name && email) return `"${name}" <${email}>`;
  return email;
}

export function transportOptions(settings: MailSettings) {
  const security: MailSecurity = settings.security;
  return {
    host: settings.host.trim(),
    port: settings.port,
    secure: security === "TLS",
    requireTLS: security === "STARTTLS",
    ignoreTLS: security === "NONE",
    auth: settings.username.trim()
      ? { user: settings.username.trim(), pass: settings.password }
      : undefined,
    tls: { rejectUnauthorized: settings.rejectUnauthorized },
  };
}

export async function deliverMail(message: { to: string[]; subject: string; text: string }) {
  let settings: MailSettings | null;
  try {
    settings = await settingsForDelivery();
  } catch (error) {
    const detail = error instanceof Error ? error.message : "The saved mail password could not be read.";
    return { sent: false as const, error: detail };
  }
  if (!settings || !settings.enabled || !settings.host.trim() || !settings.fromEmail.trim()) {
    return { sent: false as const, error: "Email delivery is not configured." };
  }
  const recipients = message.to.map((address) => address.trim()).filter(Boolean);
  if (!recipients.length) return { sent: false as const, error: "No recipient address." };
  const nodemailer = await import("nodemailer");
  const transport = nodemailer.createTransport(transportOptions(settings));
  try {
    await transport.sendMail({
      from: fromHeader(settings),
      to: recipients,
      replyTo: settings.replyTo.trim() || undefined,
      subject: message.subject,
      text: message.text,
    });
    return { sent: true as const };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "The mail server rejected the message.";
    return { sent: false as const, error: detail };
  }
}
