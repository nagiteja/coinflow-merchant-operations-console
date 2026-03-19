"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Moon, Sun } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const THEME_KEY = "coinflow-theme";

function applyStoredTheme(mode: "light" | "dark") {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", mode === "dark");
  try {
    localStorage.setItem(THEME_KEY, mode);
  } catch {
    /* ignore */
  }
}

export function ThemeToggle() {
  const [mounted, setMounted] = useState(false);
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    setMounted(true);
    setIsDark(document.documentElement.classList.contains("dark"));
  }, []);

  if (!mounted) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-9 w-9 shrink-0 rounded-full"
        aria-hidden
        disabled
      >
        <Sun className="h-4 w-4 opacity-40" />
      </Button>
    );
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="h-9 w-9 shrink-0 rounded-full border border-border/60 bg-background/40 text-foreground shadow-sm backdrop-blur transition hover:bg-accent"
      onClick={() => {
        const nextDark = !isDark;
        applyStoredTheme(nextDark ? "dark" : "light");
        setIsDark(nextDark);
      }}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
}

function navLinkClass(active: boolean) {
  return cn(
    "rounded-full px-3 py-1.5 text-sm font-medium transition-all duration-200",
    active
      ? "bg-primary/12 text-primary shadow-sm ring-1 ring-primary/20 dark:bg-primary/20 dark:ring-primary/30"
      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
  );
}

export function SiteHeader() {
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  return (
    <header className="sticky top-0 z-30 border-b border-border/70 bg-background/75 backdrop-blur-xl supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-6 py-3.5">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href="/"
            className={cn(
              "truncate rounded-lg px-2 py-1 text-sm font-semibold tracking-tight transition hover:bg-accent",
              isActive("/") && "text-primary"
            )}
          >
            Coinflow Merchant Ops
          </Link>
          <span className="hidden h-4 w-px shrink-0 bg-border sm:block" aria-hidden />
          <span className="hidden text-xs font-medium text-muted-foreground sm:inline">Operations console</span>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <nav className="flex items-center gap-1" aria-label="Main">
            <Link href="/go-live" className={navLinkClass(isActive("/go-live"))}>
              Go-Live
            </Link>
            <Link href="/payments" className={navLinkClass(isActive("/payments"))}>
              Payments
            </Link>
            <Link href="/webhooks" className={navLinkClass(isActive("/webhooks"))}>
              Webhooks
            </Link>
          </nav>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
