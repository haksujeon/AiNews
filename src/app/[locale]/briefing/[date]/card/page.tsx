import type { Metadata } from "next";
import { readFile } from "node:fs/promises";
import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/routing";
import { isValidEditionDate } from "@/lib/briefing/generate";
import { getPublishedBriefing } from "@/lib/briefing/public";
import { cardSpecPath } from "@/lib/briefing/media-store";
import type { CardSpec } from "@/lib/briefing/card-spec";
import { BriefingCard } from "@/components/briefing/briefing-card";
import { BriefingInfographic } from "@/components/briefing/infographic";
import { buildGlance } from "@/lib/briefing/glance";
import { outletsOf } from "@/lib/briefing/view";
import { getTranslations } from "next-intl/server";

// "한 장 요약" 카드를 그리는 화면 — scripts/briefing-card.ts 가 Playwright 로 찍어 PNG 를 만든다.
// 그림 명세(card-spec.json)가 있는 판만 열린다. 사람이 볼 화면이 아니므로 색인하지 않는다.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

interface Props {
  params: Promise<{ locale: string; date: string }>;
  /** ?layout=landscape → 가로형(1600px, 페이지 "한눈에 보기"와 같은 칸). 없으면 세로형(1080px) */
  searchParams: Promise<{ layout?: string }>;
}

export default async function BriefingCardPage({ params, searchParams }: Props) {
  const { locale, date } = await params;
  const { layout } = await searchParams;
  if (!isLocale(locale) || !isValidEditionDate(date)) notFound();
  const briefing = await getPublishedBriefing(locale, date);
  if (!briefing) notFound();
  const file = cardSpecPath(date, locale);
  const spec = file ? ((await readFile(file, "utf8").then(JSON.parse).catch(() => null)) as CardSpec | null) : null;
  if (!spec) notFound();
  if (layout === "landscape") {
    const t = await getTranslations({ locale, namespace: "briefing" });
    const c = briefing.content;
    const items = buildGlance(c, spec).map((g) => {
      const s = c.top_stories.find((x) => x.rank === g.rank);
      const key = `section_${g.section}`;
      return { ...g, sectionLabel: t.has(key as never) ? t(key as never) : g.section, outlets: s ? outletsOf(s.refs, briefing.articles).join(" · ") : "" };
    });
    return (
      <main className="min-h-screen bg-paper">
        <BriefingInfographic
          items={items}
          edition_date={briefing.edition_date}
          locale={briefing.locale}
          headline={c.headline}
          moreCount={c.sections.reduce((n, sec) => n + sec.items.length, 0)}
          outlets={outletsOf(Object.keys(briefing.articles), briefing.articles)}
        />
      </main>
    );
  }
  return (
    <main className="min-h-screen bg-white">
      <BriefingCard briefing={briefing} spec={spec} />
    </main>
  );
}
