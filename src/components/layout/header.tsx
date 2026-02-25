"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Zap, BarChart3 } from "lucide-react";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { ThemeToggle } from "@/components/layout/theme-toggle";

export function Header() {
  const t = useTranslations("common");

  return (
    <header className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl">
      <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
      <div className="container mx-auto flex h-14 items-center justify-between px-4">
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2.5 group">
            <div className="relative flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 group-hover:bg-primary/15 transition-colors">
              <Zap className="h-4 w-4 text-primary" />
              <div className="absolute inset-0 rounded-lg glow-sm opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
            <span className="font-display text-lg font-bold tracking-tight text-foreground">
              AI<span className="text-primary">NEWS</span>
            </span>
          </Link>
          <nav className="flex items-center">
            <Link
              href="/statistics"
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors px-3 py-1.5 rounded-md hover:bg-accent/50"
            >
              <BarChart3 className="w-3.5 h-3.5" />
              {t("statistics")}
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <LanguageSwitcher />
        </div>
      </div>
    </header>
  );
}
