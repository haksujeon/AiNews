import { useTranslations } from "next-intl";
import { Mail } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

/**
 * 구독 신청 화면으로 가는 링크 — 상단 메뉴·브리핑 하단 상자·소개 화면이 같은 부품 (Gate 2).
 * source 는 어디서 왔는지(관리자 출처별 현황): header · briefing · landing
 */
export function SubscribeLink({ source, variant, className }: { source: string; variant: "nav" | "button" | "dark"; className?: string }) {
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
        {/* 360px 미만에서는 글자를 숨겨 아이콘만(낭독기에는 그대로) — 사이트 이름이 잘리지 않게 (QA E-13) */}
        <span className="max-[359px]:sr-only">{t("navSubscribe")}</span>
      </Link>
    );
  if (variant === "dark")
    // 홈 어두운 카드 버튼 줄 (옆 "지난 브리핑"·"듣기" 버튼과 같은 테두리 모양)
    return (
      <Link
        href={href}
        data-testid={`subscribe-cta-${source}`}
        className={cn(
          "inline-flex min-h-11 items-center gap-2 rounded-[4px] border border-white/25 px-4 text-[15px] text-white/90 hover:border-white/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white",
          className
        )}
      >
        <Mail aria-hidden="true" className="h-4 w-4 text-jade-bright" />
        {t("ctaButtonShort")}
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

/**
 * 본문 아래 신청 상자 — 데일리 브리핑 하단·기사 상세(페이지·팝업) 하단이 같은 상자 (Gate 2).
 * 출처: briefing · article · article-modal
 */
export function SubscribeBox({ source, className }: { source: string; className?: string }) {
  const t = useTranslations("subscribe");
  return (
    <section className={cn("flex flex-wrap items-center justify-between gap-4 border-y border-rule bg-surface px-5 py-5", className)} data-testid={`subscribe-box-${source}`}>
      <div className="min-w-0">
        <p className="text-[17px] font-[750] text-ink">{t("ctaTitle")}</p>
        <p className="mt-1 text-[14px] text-ink-2">{t("ctaBody")}</p>
      </div>
      <SubscribeLink source={source} variant="button" />
    </section>
  );
}
