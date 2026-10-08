"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
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
  siteName,
  unread,
  allowedModules,
  children,
}: {
  name: string;
  siteName: string;
  unread: number;
  allowedModules: NavModuleId[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const items = visibleItems(new Set(allowedModules));

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
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
            <HelpTip text="Form Config defines dimensions, their attributes, and lists. People Config defines who can open each page, who can see and change attributes, and the workflows those people follow. Settings defines the site name, API access, and email delivery." />
          </p>
          <div className="ml-auto flex items-center gap-4">
            <p className="truncate text-sm text-white">{name}</p>
            <form action={logout}>
              <button className="btn-quiet border-white/40 bg-transparent text-white" type="submit">
                Sign out
              </button>
            </form>
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
              const groupActive = childrenLinks.some((child) => isCurrent(pathname, child.href));
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
