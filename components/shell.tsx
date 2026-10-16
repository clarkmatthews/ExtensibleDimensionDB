"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { logout } from "@/app/login/actions";
import { HelpTip } from "@/components/help-tip";
import { NAV_MODULES, type NavModuleId } from "@/lib/nav-modules";

type NavLink = { href: string; label: string };

type NavItem = ({ kind: "link" } & NavLink) | { kind: "group"; label: string; children: NavLink[] };

function visibleItems(allowed: Set<string>): NavItem[] {
  const items: NavItem[] = [];
  for (const moduleItem of NAV_MODULES) {
    if (!allowed.has(moduleItem.id)) continue;
    const link = { href: moduleItem.href, label: moduleItem.label };
    if (!moduleItem.group) {
      items.push({ kind: "link", ...link });
      continue;
    }
    const previous = items[items.length - 1];
    if (previous?.kind === "group" && previous.label === moduleItem.group) previous.children.push(link);
    else items.push({ kind: "group", label: moduleItem.group, children: [link] });
  }
  if (allowed.has("ACCESS")) {
    for (const item of items) {
      if (item.kind === "group" && item.label === "People Config") {
        const at = item.children.findIndex((child) => child.href === "/admin/access");
        item.children.splice(at + 1, 0, { href: "/admin/scopes", label: "Scopes" });
      }
    }
  }
  return items;
}

function isCurrent(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function linkClass(active: boolean, nested = false) {
  return `block whitespace-nowrap rounded-md px-3 py-2 text-sm ${nested ? "pl-6" : ""} ${
    active ? "bg-white/15 text-white" : "text-white hover:bg-white/10"
  }`;
}

function MenuIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M3 5h14M3 10h14M3 15h14" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M5 5l10 10M15 5L5 15" />
    </svg>
  );
}

export function Shell({
  name,
  email,
  canChangePassword,
  siteName,
  unread,
  allowedModules,
  children,
}: {
  name: string;
  email: string;
  canChangePassword: boolean;
  siteName: string;
  unread: number;
  allowedModules: NavModuleId[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  // The menu belongs to the page it was opened on, so navigating closes it.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const setOpen = (next: boolean | ((current: boolean) => boolean)) =>
    setOpenOn((current) => {
      const value = typeof next === "function" ? next(current === pathname) : next;
      return value ? pathname : null;
    });
  const items = visibleItems(new Set(allowedModules));

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpenOn(null);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="min-h-screen">
      {open ? (
        <button
          type="button"
          className="fixed inset-0 z-30 bg-black/20"
          aria-label="Close menu"
          onClick={() => setOpen(false)}
        />
      ) : null}
      <header className="sticky top-0 z-40 bg-sidebar text-white">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2">
          <button
            type="button"
            className="inline-flex h-10 w-10 items-center justify-center rounded-md hover:bg-white/10"
            aria-expanded={open}
            aria-controls="app-menu"
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? <CloseIcon /> : <MenuIcon />}
          </button>
          <p className="flex items-center text-base font-semibold">
            {siteName}
            <HelpTip text="Dimension Config defines dimensions, their attributes, and lists. People Config defines who can open each page, who can see and change attributes, and the workflows those people follow. Settings defines the site name, API access, and email delivery." />
          </p>
          <div className="ml-auto">
            <AccountMenu name={name} email={email} canChangePassword={canChangePassword} />
          </div>
        </div>
        {open ? (
          <nav id="app-menu" className="absolute left-0 top-full max-h-[calc(100vh-3.5rem)] w-72 overflow-auto border-r border-b border-white/10 bg-sidebar px-3 py-3 shadow-lg">
            {items.map((item) => {
              if (item.kind === "link") {
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={linkClass(isCurrent(pathname, item.href))}
                    onClick={() => setOpen(false)}
                  >
                    {item.label}
                    {item.href === "/changelog" && unread > 0 ? ` (${unread})` : ""}
                  </Link>
                );
              }
              const childrenLinks = item.children;
              if (!childrenLinks.length) return null;
              return (
                <div key={item.label}>
                  <p className="px-3 py-2 text-sm font-medium text-white">
                    {item.label}
                  </p>
                  {childrenLinks.map((child) => (
                    <Link
                      key={child.href}
                      href={child.href}
                      className={linkClass(isCurrent(pathname, child.href), true)}
                      onClick={() => setOpen(false)}
                    >
                      {child.label}
                    </Link>
                  ))}
                </div>
              );
            })}
          </nav>
        ) : null}
      </header>
      <main className="px-4 py-6 md:px-8">{children}</main>
    </div>
  );
}

/** The person's name in the header opens their account choices. */
function AccountMenu({ name, email, canChangePassword }: { name: string; email: string; canChangePassword: boolean }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const box = useRef<HTMLDivElement>(null);
  // Navigating closes the menu.
  const [openedOn, setOpenedOn] = useState(pathname);
  if (openedOn !== pathname) {
    setOpenedOn(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    function onClick(event: MouseEvent) {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        className="inline-flex max-w-[16rem] items-center gap-1 rounded-md px-2 py-1.5 text-sm text-white hover:bg-white/10"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="account-menu"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="truncate">{name}</span>
        <svg width="14" height="14" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M5 8l5 5 5-5" />
        </svg>
      </button>
      {open ? (
        <div id="account-menu" role="menu" className="absolute right-0 top-full z-50 mt-1 w-60 rounded-md border border-line bg-card py-1 text-sm text-ink shadow-lg">
          <p className="truncate px-3 py-2 text-xs text-muted">{email}</p>
          {canChangePassword ? (
            <Link role="menuitem" className="block px-3 py-2 hover:bg-paper" href="/account/password">
              Change password
            </Link>
          ) : null}
          <form action={logout}>
            <button role="menuitem" className="block w-full px-3 py-2 text-left hover:bg-paper" type="submit">
              Sign out
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
