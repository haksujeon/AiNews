"use client";

import { ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * 펼친 <details> 상자 아래쪽의 "접기" 버튼 (2026-11-04 UI 검토: 휴대폰에서 펼친 히스토리 상자가 2,000px 넘게 길어
 * 맨 위 머리줄까지 올라가야 접을 수 있었다). 상자를 접고 머리줄이 보이게 스크롤을 되돌린다.
 */
export function DetailsCollapse({ label, tone = "light" }: { label: string; tone?: "light" | "dark" }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        const d = e.currentTarget.closest("details");
        if (!d) return;
        d.open = false;
        const summary = d.querySelector("summary");
        summary?.scrollIntoView({ block: "nearest", behavior: "smooth" });
        summary?.focus({ preventScroll: true });
      }}
      className={cn(
        "inline-flex min-h-11 shrink-0 items-center gap-1 rounded-sm px-2 text-[13px] font-semibold focus-visible:outline-none focus-visible:ring-2",
        tone === "dark" ? "text-white/75 hover:text-white focus-visible:ring-jade-bright" : "text-ink-2 hover:text-ink focus-visible:ring-ring"
      )}
      data-testid="details-collapse"
    >
      {label}
      <ChevronUp aria-hidden="true" className="h-4 w-4" />
    </button>
  );
}
