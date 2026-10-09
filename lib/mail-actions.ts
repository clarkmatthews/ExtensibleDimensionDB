"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { MailSecurity } from "@prisma/client";
import { deliverMail, encryptSecret, resolveMailSettings } from "@/lib/mail";
import { emailError } from "@/lib/passwords";
import { canEditModule, loadAccess } from "@/lib/permissions";
import { audited } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { siteName } from "@/lib/site";

const SETTINGS_ID = "default";

function text(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

async function editor() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const access = await loadAccess(user);
  if (!canEditModule(access, "EMAIL_CONFIG")) redirect("/admin/email?error=You%20cannot%20change%20email%20settings.");
  return user;
}

function securityValue(value: string): MailSecurity | null {
  if (value === "NONE" || value === "STARTTLS" || value === "TLS") return value;
  return null;
}

export async function saveMailSettings(formData: FormData) {
  return audited("mail.saveMailSettings", [formData], async () => {
    await editor();
    const enabled = formData.get("enabled") === "on";
    const host = text(formData, "host");
    const port = Number(text(formData, "port"));
    const security = securityValue(text(formData, "security"));
    const username = text(formData, "username");
    const fromName = text(formData, "fromName");
    const fromEmail = text(formData, "fromEmail");
    const replyTo = text(formData, "replyTo");
    if (!security) redirect("/admin/email?error=Choose%20a%20connection%20security.");
    if (!Number.isInteger(port) || port < 1 || port > 65535) redirect("/admin/email?error=Enter%20a%20port%20from%201%20to%2065535.");
    if (host.length > 253) redirect("/admin/email?error=The%20server%20name%20is%20too%20long.");
    if (fromName.length > 100) redirect("/admin/email?error=The%20sender%20name%20must%20be%20100%20characters%20or%20fewer.");
    if (enabled && !host) redirect("/admin/email?error=A%20server%20name%20is%20required%20when%20email%20is%20enabled.");
    if (enabled && !fromEmail) redirect("/admin/email?error=A%20sender%20address%20is%20required%20when%20email%20is%20enabled.");
    const fromProblem = fromEmail ? emailError(fromEmail) : null;
    if (fromProblem) redirect(`/admin/email?error=${encodeURIComponent(fromProblem)}`);
    const replyProblem = replyTo ? emailError(replyTo) : null;
    if (replyProblem) redirect(`/admin/email?error=${encodeURIComponent("Reply-to must be a valid email address.")}`);

    const existing = await prisma.mailSettings.findUnique({ where: { id: SETTINGS_ID } });
    const typedPassword = text(formData, "password");
    const clearPassword = formData.get("clearPassword") === "on";
    const password = clearPassword
      ? ""
      : typedPassword
        ? encryptSecret(typedPassword)
        : existing?.password || (!existing && process.env.SMTP_PASSWORD ? encryptSecret(process.env.SMTP_PASSWORD) : "");

    await prisma.mailSettings.upsert({
      where: { id: SETTINGS_ID },
      create: {
        id: SETTINGS_ID,
        enabled,
        host,
        port,
        security,
        rejectUnauthorized: formData.get("rejectUnauthorized") === "on",
        username,
        password,
        fromName,
        fromEmail,
        replyTo,
      },
      update: {
        enabled,
        host,
        port,
        security,
        rejectUnauthorized: formData.get("rejectUnauthorized") === "on",
        username,
        password,
        fromName,
        fromEmail,
        replyTo,
      },
    });
    revalidatePath("/admin/email");
    redirect("/admin/email?saved=1");
  });
}

export async function sendTestEmail() {
  return audited("mail.sendTestEmail", [], async () => {
    const user = await editor();
    const { settings } = await resolveMailSettings();
    if (!settings.enabled || !settings.host.trim() || !settings.fromEmail.trim()) {
      redirect("/admin/email?error=Save%20an%20enabled%20server%20and%20sender%20address%20before%20sending%20a%20test.");
    }
    const result = await deliverMail({
      to: [user.email],
      subject: `${await siteName()} test`,
      text: "This is a test message from Email Config.",
    });
    if (!result.sent) redirect(`/admin/email?error=${encodeURIComponent(result.error)}`);
    redirect("/admin/email?saved=test");
  });
}
