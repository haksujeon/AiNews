"use client";

import { usePathname, useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  Zap,
  Mail,
  Users,
  LogOut,
  ArrowLeft,
  Menu,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
} from "@/components/ui/sheet";

const navItems = [
  { key: "send-history", icon: Mail, label: "Send History" },
  { key: "subscribers", icon: Users, label: "Subscribers" },
];

function NavContent({ locale, pathname, onLogout }: {
  locale: string;
  pathname: string;
  onLogout: () => void;
}) {
  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-border/50">
        <Link href={`/${locale}/admin`} className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <Zap className="w-4 h-4 text-primary" />
          </div>
          <span className="font-bold text-sm">ADMIN</span>
        </Link>
      </div>
      <nav className="flex-1 p-3 space-y-1">
        {navItems.map((item) => {
          const href = `/${locale}/admin/${item.key}`;
          const isActive = pathname.includes(item.key);
          return (
            <Link
              key={item.key}
              href={href}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                isActive
                  ? "bg-primary/10 text-primary font-medium"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              <item.icon className="w-4 h-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="p-3 border-t border-border/50 space-y-1">
        <Link
          href={`/${locale}`}
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Site
        </Link>
        <button
          onClick={onLogout}
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors w-full"
        >
          <LogOut className="w-4 h-4" />
          Logout
        </button>
      </div>
    </div>
  );
}

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const params = useParams();
  const router = useRouter();
  const locale = params.locale as string;

  const handleLogout = async () => {
    await fetch("/api/admin/logout", { method: "POST" });
    router.push(`/${locale}/admin/login`);
  };

  return (
    <div className="min-h-screen flex bg-background">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex w-56 border-r border-border/50 bg-card/30 flex-col flex-shrink-0">
        <NavContent locale={locale} pathname={pathname} onLogout={handleLogout} />
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile header */}
        <header className="lg:hidden flex items-center gap-3 p-3 border-b border-border/50 bg-card/30">
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <Menu className="w-4 h-4" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-56 p-0">
              <NavContent locale={locale} pathname={pathname} onLogout={handleLogout} />
            </SheetContent>
          </Sheet>
          <span className="font-bold text-sm">ADMIN</span>
        </header>

        <main className="flex-1 p-4 lg:p-6 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
