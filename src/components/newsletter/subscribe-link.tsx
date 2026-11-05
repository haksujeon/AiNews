import { useTranslations } from "next-intl";
import { Mail } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

/**
 * 구독 신청 화면으로 가는 링크 — 상단 메뉴·브리핑 하단 상자·소개 화면이 같은 부품 (Gate 2).
 * source 는 어디서 왔는지(관리자 출처별 현황): header · briefing · landing
 */
export function SubscribeLink({ source, variant, className }: { source: string; variant: "nav" | "button"; className?: string }) {
  const t = useTranslations("subscribe");
  const href = { pathname: "/subscribe", query: { src: source } } as const;
  if (variant === "nav")
    return (
      <Link
        href={href}
        data-testid="nav-subscribe"
        className={cn(
          "inline-flex min-h-9 items-center gap-1.5 rounded-[4px] border border-jade/40 px-2.5 text-[13.5px] font-semibold text-jade hover:bg-jade-weak focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          className
        )}
      >
        <Mail aria-hidden="true" className="h-3.5 w-3.5" />
        {t("navSubscribe")}
      </Link>
    );
  return (
    <Link
      href={href}
      data-testid={`subscribe-cta-${source}`}
      className={cn(
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-[4px] bg-jade px-5 text-[15px] font-bold text-paper hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        className
      )}
    >
      <Mail aria-hidden="true" className="h-4 w-4" />
      {t("ctaButton")}
    </Link>
  );
}
