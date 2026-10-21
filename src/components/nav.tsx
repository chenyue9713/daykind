"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { EveningIcon, HistoryIcon, MorningIcon, ReportIcon, SettingsIcon, TodayIcon } from "./icons";

interface NavItem {
  href: string;
  label: string;
  shortLabel: string;
  icon: ReactNode;
}

export const navItems: NavItem[] = [
  { href: "/", label: "Today", shortLabel: "Today", icon: <TodayIcon /> },
  { href: "/check-in/morning", label: "Morning check-in", shortLabel: "Morning", icon: <MorningIcon /> },
  { href: "/check-in/evening", label: "Evening check-in", shortLabel: "Evening", icon: <EveningIcon /> },
  { href: "/history", label: "History", shortLabel: "History", icon: <HistoryIcon /> },
  { href: "/report", label: "Weekly report", shortLabel: "Report", icon: <ReportIcon /> },
  { href: "/settings", label: "Settings", shortLabel: "Settings", icon: <SettingsIcon /> },
];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function SidebarNav() {
  const pathname = usePathname();
  return (
    <ul>
      {navItems.map((item) => (
        <li key={item.href}>
          <Link
            className="nav-link"
            href={item.href}
            aria-current={isActive(pathname, item.href) ? "page" : undefined}
          >
            {item.icon}
            {item.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function BottomNav() {
  const pathname = usePathname();
  return (
    <ul>
      {navItems.map((item) => (
        <li key={item.href}>
          <Link
            href={item.href}
            aria-label={item.label}
            aria-current={isActive(pathname, item.href) ? "page" : undefined}
          >
            {item.icon}
            <span aria-hidden="true">{item.shortLabel}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
