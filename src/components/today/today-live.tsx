import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { LatestBatch } from "@/lib/today";
import { getTitle } from "@/lib/news-utils";

/** 수집 시각은 수집 일정(09·14·23시 KST)과 같은 한국 시간으로 보인다 */
function kstStamp(iso: string): string {
  const d = new Date(iso);
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d);
  const g = (k: string) => p.find((x) => x.type === k)?.value ?? "";
  return `${g("month")}.${g("day")} ${g("hour")}:${g("minute")}`;
}

/**
 * "오늘" 홈 맨 위 LIVE 띠: 마지막 수집 회차 시각·건수 + 최신 제목 (lib/today.ts fetchLatestBatch).
 * 움직이는 마퀴 대신 넘치면 잘리는 한 줄 (움직임 줄이기 설정·스크린리더 배려). 제목은 기사로 연결된다.
 */
export async function TodayLive({ batch, locale }: { batch: LatestBatch; locale: string }) {
  if (!batch.lastAt) return null;
  const t = await getTranslations({ locale, namespace: "today" });
  return (
    <div className="bg-console text-white" data-testid="today-live">
      <div className="container mx-auto flex h-10 items-center gap-3 overflow-hidden px-4 text-[13px]">
        <span className="flex shrink-0 items-center gap-1.5 font-mono font-semibold text-jade-bright">
          <span aria-hidden="true" className="h-2 w-2 rounded-full bg-jade-bright" />
          LIVE
        </span>
        <span className="hidden shrink-0 font-mono text-white/60 sm:inline">{t("lastBatch", { time: kstStamp(batch.lastAt), count: batch.count })}</span>
        <span aria-hidden="true" className="hidden shrink-0 text-white/25 sm:inline">
          |
        </span>
        <ul className="flex min-w-0 gap-7 overflow-hidden whitespace-nowrap" aria-label={t("latestLabel")}>
          {batch.items.map((it, i) => (
            // 첫 제목이 늘 가장 넓게(최소 12rem, 나머지의 두 배 비율) 보이고, 나머지는 넓은 화면에서만 칸을 나눠 말줄임
            // (QA E-03: 768·1024px 에서 첫 제목이 0px 로 사라졌다 / E-15: 1440px 에서 첫 제목이 가장 좁았다)
            <li key={it.id} className={i > 0 ? "hidden min-w-0 flex-[1_1_0%] truncate xl:block" : "min-w-[12rem] flex-[2_1_0%] truncate"}>
              <Link href={`/news/${it.id}`} className="rounded-sm text-white/90 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-jade-bright">
                {getTitle(it, locale)}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
