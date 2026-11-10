import { cn } from "@/lib/utils";

/**
 * "쉽게 풀어보기" 상자 — 기사 상세(article-body)와 주간·월간 큰 흐름(periodic-view)이 같이 쓴다 (Gate 2, 2026-11-10 사용자 결정).
 * 쉽게 말하면 · 왜 중요할까 두 칸. 한 칸이 비면(검사·AI 검토에서 지워짐) 그 칸만 뺀다. 둘 다 없으면 그리지 않는다.
 * 훅을 쓰지 않아 서버·클라이언트 어디서나 그린다 — 문구는 부르는 쪽이 번역해서 넘긴다.
 */
export function EasyBox({
  easy,
  why,
  labels,
  headingTag: Heading = "h2",
  size = "md",
  id,
  className,
  children,
}: {
  easy?: string | null;
  why?: string | null;
  labels: { title: string; saying: string; why: string };
  headingTag?: "h2" | "h3" | "h4" | "p";
  /** md = 기사 상세, sm = 주간 큰 흐름 안 */
  size?: "md" | "sm";
  id?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  if (!easy && !why) return null;
  const body = size === "md" ? "text-[16px] leading-[1.8] text-ink" : "text-[15px] leading-[1.75] text-ink";
  return (
    <section
      id={id}
      className={cn(
        "border-l-[3px] border-jade bg-jade-weak",
        size === "md" ? "scroll-mt-20 px-5 py-4 sm:px-6 sm:py-5" : "px-4 py-3 sm:px-5 sm:py-4",
        className
      )}
      data-testid="easy-box"
    >
      <Heading className={cn("font-bold text-jade", size === "md" ? "mb-3 text-[13px]" : "mb-2 text-[12.5px]")}>{labels.title}</Heading>
      <div className={size === "md" ? "space-y-4" : "space-y-3"}>
        {easy && (
          <div>
            <p className="mb-1 text-xs font-semibold text-ink-2">{labels.saying}</p>
            <p className={body}>{easy}</p>
          </div>
        )}
        {why && (
          <div>
            <p className="mb-1 text-xs font-semibold text-ink-2">{labels.why}</p>
            <p className={body}>{why}</p>
          </div>
        )}
      </div>
      {children}
    </section>
  );
}
