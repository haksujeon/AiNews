import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { formatDateGroup } from "@/lib/news-utils";
import type { PublicBriefing } from "@/lib/briefing/public";
import {
  BRIEFING_PATH,
  editorNoteData,
  extraCompanies,
  formatShortDate,
  outletsOf,
  readMinutes,
  sourceLinks,
} from "@/lib/briefing/view";
import { LOCALE_HTML_LANG, type Locale } from "@/i18n/routing";
import type { TopStory } from "@/lib/briefing/types";
import { BriefingDateLink } from "./briefing-date-link";
import { EasyTerms } from "./easy-terms";
import { StoryContextBox } from "./story-context";
import { BriefingAudioProvider, ListenBar, ListenHere, ListenShort, ShareButton } from "./briefing-media";
import { BriefingGlance } from "./briefing-glance";
import { StoryProgress } from "./story-progress";
import { SubscribeBox } from "@/components/newsletter/subscribe-link";
import { buildGlance } from "@/lib/briefing/glance";
import type { CardSpec } from "@/lib/briefing/card-spec";

/*
 * 데일리 브리핑 본문 ("Briefing Desk" 시안 §5.1–5.2).
 * 공개 페이지(/briefing, /briefing/[date])와 관리자 검토 화면이 이 컴포넌트 하나로 그린다 (Gate 2).
 * 홈 날짜 팝업의 간추린 보기(briefing-compact.tsx)는 아래 부품(BriefingCoverage·AiLabel·DataNotice·TopStoryItem·Sources)을
 * 같이 쓴다 — 문구·근거 링크·데이터 알림 규칙을 두 곳에 따로 쓰지 않는다.
 * 클라이언트(팝업)에서도 그려지므로 DB 를 읽는 모듈을 import 하지 않는다 (PublicBriefing 은 type 만).
 * 카드·그림자·둥근 모서리 없이 괘선과 기존 색 토큰(ink/rule/jade)만 쓴다. 원문 썸네일은 쓰지 않는다.
 */

interface Props {
  briefing: PublicBriefing;
  /** 이전·다음 판 날짜 (공개 페이지만) */
  pager?: { prev: string | null; next: string | null };
  /** 한 장 요약 카드의 그림 명세 (한눈에 보기 블록이 같이 쓴다). 없으면 숫자로 보는 하루 값으로 채운다 */
  cardSpec?: CardSpec | null;
}

type Translator = ReturnType<typeof useTranslations<"briefing">>;

export function sectionLabel(t: Translator, code: string): string {
  const key = `section_${code}`;
  return t.has(key as never) ? t(key as never) : code;
}

/** 근거 기사 링크 줄. 데일리·주간 리포트가 같은 부품을 쓴다 (Gate 2) */
export function Sources({
  refs,
  briefing,
  className,
}: {
  refs: string[];
  briefing: Pick<PublicBriefing, "articles">;
  className?: string;
}) {
  const t = useTranslations("briefing");
  const links = sourceLinks(refs, briefing.articles);
  if (!links.length) return null;
  return (
    <p className={cn("text-[13px] leading-relaxed text-ink-3", className)}>
      <span className="mr-1.5">{t("sources")}</span>
      {links.map((s, i) => (
        <span key={s.id}>
          {i > 0 && <span aria-hidden="true"> · </span>}
          <Link
            href={`/news/${s.id}`}
            aria-label={t("sourceAria", { outlet: s.outlet, title: s.title })}
            lang={s.outletIsOriginal ? "zh-CN" : undefined}
            className="rounded-sm text-ink-2 underline decoration-rule decoration-1 underline-offset-4 hover:decoration-ink-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {s.outlet}
          </Link>
        </span>
      ))}
    </p>
  );
}

/** "기사 N건 중 M건 정리 · K분" */
export function BriefingCoverage({ briefing }: { briefing: PublicBriefing }) {
  const t = useTranslations("briefing");
  const c = briefing.content;
  return (
    <span>
      {t("coverage", { total: c.meta?.candidate_count ?? 0, cited: c.meta?.cited_count ?? Object.keys(briefing.articles).length })}
      {" · "}
      {t("readTime", { minutes: readMinutes(c, briefing.locale) })}
    </span>
  );
}

/**
 * AI 작성 라벨 — 한 줄(라벨 + "작성 방식")이고 고지 전문은 펼쳐서 (안 A, 2026-11-05: 리드와 기사 사이 고지 두 줄 → 한 줄).
 * 브리핑 페이지·날짜 팝업이 같이 쓴다 (Gate 2).
 */
export function AiLabel({ className }: { className?: string }) {
  const t = useTranslations("briefing");
  return (
    <details className={cn("group text-[12.5px] leading-relaxed text-ink-3", className)}>
      <summary className="inline-flex min-h-8 cursor-pointer list-none items-center gap-2 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <span className="rounded-[3px] border border-rule px-1.5 py-px font-semibold text-ink-2" data-testid="ai-label">
          {t("aiLabel")}
        </span>
        <span className="underline decoration-rule underline-offset-4 group-open:no-underline">{t("aiDisclosureMore")}</span>
      </summary>
      <p className="mt-1 max-w-[40rem]">{t("aiDisclosure")}</p>
    </details>
  );
}

/** 수집 품질 (주간·월간과 같은 결손일 판정): 축소·부분 수집일이 있으면 데이터 알림 */
export function DataNotice({ briefing, className }: { briefing: PublicBriefing; className?: string }) {
  const t = useTranslations("briefing");
  const loc = briefing.locale;
  const dqDays = briefing.content.meta?.data_quality?.days ?? [];
  if (!dqDays.length) return null;
  return (
    <p role="note" className={cn("border-l-[3px] border-ink-3 bg-surface px-3.5 py-2.5 text-sm leading-[1.65] text-ink-2", className)} data-testid="briefing-data-notice">
      <strong className="mr-2 text-ink">{t("dataNoticeTitle")}</strong>
      {dqDays
        .map((d) =>
          d.reduced
            ? t("dataNoticeReduced", { date: formatShortDate(d.day, loc), count: d.count })
            : t("dataNoticePartial", { date: formatShortDate(d.day, loc), count: d.count, median: d.expected })
        )
        .join(" ")}{" "}
      {t("dataNoticeTail")}
    </p>
  );
}

/**
 * 주요 기사 한 건. page = 브리핑 페이지(앵커·"왜 중요한가" 포함), compact = 팝업(분야·제목·what·근거만).
 */
export function TopStoryItem({
  story: s,
  briefing,
  variant = "page",
  titleTag: Title = "h3",
}: {
  story: TopStory;
  briefing: PublicBriefing;
  variant?: "page" | "compact";
  /** 팝업은 DialogTitle(h2) 아래 "주요 기사"(h3) 밑이라 h4 */
  titleTag?: "h3" | "h4";
}) {
  const t = useTranslations("briefing");
  const outlets = outletsOf(s.refs, briefing.articles).length;
  const compact = variant === "compact";
  return (
    <li
      id={compact ? undefined : `story-${s.rank}`}
      className={
        compact
          ? "grid grid-cols-[28px_minmax(0,1fr)] gap-1.5 border-b border-rule py-4 sm:grid-cols-[36px_minmax(0,1fr)] sm:py-[18px]"
          : "grid scroll-mt-20 grid-cols-[30px_minmax(0,1fr)] gap-2 border-b border-rule py-5 sm:grid-cols-[44px_minmax(0,1fr)] sm:py-6"
      }
    >
      <span aria-hidden="true" className={cn("font-[760] text-ink", compact ? "text-[20px] sm:text-[24px]" : "text-[22px] sm:text-[30px]", "leading-none")}>
        {s.rank}
      </span>
      <div className="min-w-0">
        <p className={cn("flex flex-wrap gap-x-3 text-[13px] text-ink-3", compact ? "mb-1" : "mb-1.5")}>
          <span className="font-semibold text-jade">{sectionLabel(t, s.section)}</span>
          {outlets >= 2 && <span>{t("outlets", { count: outlets })}</span>}
        </p>
        <Title
          className={
            compact
              ? "text-[18px] font-bold leading-[1.4] tracking-[-0.02em] text-ink sm:text-[19px]"
              : "text-[20px] font-bold leading-[1.38] tracking-[-0.02em] text-ink sm:text-[23px]"
          }
        >
          {s.title}
        </Title>
        <p className={compact ? "mt-2 text-[15.5px] leading-[1.75] text-ink-2" : "mt-2.5 max-w-[40rem] text-base leading-[1.8] text-ink-2 sm:text-[17px]"}>
          {s.what}
        </p>
        {!compact && s.why && (
          // AI 인사이트 블록(article-body.tsx)과 같은 모양: 3px 청자 선 + 옅은 배경
          <div className="mt-3.5 max-w-[40rem] border-l-[3px] border-jade bg-jade-weak px-4 py-2.5">
            <p className="mb-0.5 text-[12.5px] font-[650] text-jade">{t("whyItMatters")}</p>
            <p className="text-base leading-[1.7] text-ink">{s.why}</p>
          </div>
        )}
        {/* 도구 줄 (안 A): 근거 기사 + 이 부분 듣기(음성이 있는 판의 페이지만) 한 줄 */}
        <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-1.5", compact ? "mt-2" : "mt-3")}>
          <Sources refs={s.refs} briefing={briefing} />
          {!compact && <ListenHere rank={s.rank} />}
        </div>
        <StoryMore story={s} locale={briefing.locale} className={compact ? "mt-3" : "mt-3 max-w-[40rem]"} />
      </div>
    </li>
  );
}

/**
 * 기사 아래 "더 알아보기": 쉬운 AI 설명 · 히스토리 분석 상자를 나란히 (접힌 상태에서 한 줄).
 * 펼친 상자는 줄 전체로 넓어진다(open:basis-full). 페이지·날짜 팝업·홈 히어로가 같은 부품 (Gate 2).
 */
export function StoryMore({
  story: s,
  locale,
  tone = "light",
  className,
}: {
  story: Pick<TopStory, "easy_terms" | "story_context">;
  locale: string;
  tone?: "light" | "dark";
  className?: string;
}) {
  if (!s.easy_terms?.length && !s.story_context?.length) return null;
  const item = "min-w-[min(100%,15rem)] flex-1 open:basis-full";
  return (
    <div className={cn("flex flex-wrap items-start gap-2", className)}>
      <EasyTerms terms={s.easy_terms} locale={locale} tone={tone} className={item} />
      <StoryContextBox contexts={s.story_context} tone={tone} className={item} />
    </div>
  );
}

export function BriefingView({ briefing, pager, cardSpec }: Props) {
  const t = useTranslations("briefing");
  const c = briefing.content;
  const loc = briefing.locale;
  const htmlLang = LOCALE_HTML_LANG[loc as Locale] ?? loc;
  const note = c.editor_note ? null : editorNoteData(briefing);
  const allOutlets = outletsOf(Object.keys(briefing.articles), briefing.articles);
  const term = c.term_of_the_day;
  const media = briefing.media ?? {};
  // 주목할 기업은 주요 기사에 없는 정보만 (최근 12판 21건 중 18건이 겹침 — 사용자 확인 2026-11-05)
  const companies = extraCompanies(c);
  // 한눈에 보기: 목차·숫자로 보는 하루·한 장 요약을 한 블록으로 (안 A, 사용자 결정 2026-11-05)
  const glance = buildGlance(c, cardSpec).map((g) => {
    const st = c.top_stories.find((x) => x.rank === g.rank);
    return { ...g, sectionLabel: sectionLabel(t, g.section), outlets: st ? outletsOf(st.refs, briefing.articles).join(" · ") : "" };
  });

  const body = (
    <article lang={htmlLang} data-testid="briefing">
      {/* ── 머리: 날짜 줄 · h1 · 리드 · 근거 · AI 작성 · 듣기 ── */}
      <header className="pb-5 pt-6 sm:pb-6 sm:pt-9">
        <p className="mb-3.5 flex flex-wrap gap-x-3 gap-y-1 text-[13px] text-ink-3">
          <span className="font-[650] text-jade">{t("kicker")}</span>
          <time dateTime={briefing.edition_date}>{formatDateGroup(briefing.edition_date, loc)}</time>
          <BriefingCoverage briefing={briefing} />
        </p>
        <h1 className="max-w-[48rem] text-[28px] font-[740] leading-[1.25] tracking-[-0.028em] text-ink sm:text-[34px] lg:text-[40px]">{c.headline}</h1>
        <p className="mt-4 max-w-[46rem] text-[17px] font-medium leading-[1.75] text-ink-2 sm:text-[19px]">{c.lede}</p>
        <div className="mt-2.5 flex flex-wrap items-center gap-x-5 gap-y-1">
          <Sources refs={c.lede_refs} briefing={briefing} />
          <AiLabel />
        </div>
        {/* 음성 (승인본만, 관리자 검토 화면은 검토본도): 데스크톱 = 듣기 막대, 휴대폰 = 짧은 듣기 */}
        {media.audio && (
          <>
            <ListenBar className="mt-4 hidden max-w-[46rem] lg:block" />
            <ListenShort className="mt-4 w-full lg:hidden" />
          </>
        )}
      </header>

      <DataNotice briefing={briefing} className="mb-5" />

      <BriefingGlance
        items={glance}
        actions={<ShareButton title={c.headline} />}
      />

      <div className="grid gap-6 pb-10 pt-4 lg:grid-cols-[minmax(0,1fr)_280px] lg:gap-12">
        {/* ── 본문 칼럼 ── */}
        <div className="min-w-0">
          <h2 className="flex items-baseline justify-between border-b border-rule-strong pb-2.5 pt-6 text-lg font-bold text-ink">
            {t("topStories")}
            <span className="text-[13px] font-normal text-ink-3">{t("byImportance")}</span>
          </h2>
          <ol>
            {c.top_stories.map((s) => (
              <TopStoryItem key={s.rank} story={s} briefing={briefing} />
            ))}
          </ol>

          {c.sections.length > 0 && (
            <section>
              <h2 className="flex items-baseline justify-between border-b border-rule-strong pb-2.5 pt-7 text-lg font-bold text-ink">
                {t("moreNews")}
                <span className="text-[13px] font-normal text-ink-3">{t("bySection")}</span>
              </h2>
              <div className="grid gap-x-10 sm:grid-cols-2">
                {c.sections.map((sec, j) => (
                  <section key={j} className="min-w-0">
                    <h3 className="pb-1.5 pt-4 text-sm font-[650] text-jade">{sectionLabel(t, sec.section)}</h3>
                    <ul>
                      {sec.items.map((it, k) => (
                        <li key={k} className="border-t border-rule py-2.5">
                          <p className="text-[15.5px] leading-[1.6] text-ink">{it.text}</p>
                          <Sources refs={it.refs} briefing={briefing} className="text-[12.5px]" />
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            </section>
          )}
        </div>

        {/* ── 오른쪽 칸: 읽는 위치(데스크톱, 따라 내려옴) · 용어 · 편집 노트 · 주요 기사에 없는 기업. 휴대폰은 본문 아래 ── */}
        <aside className="min-w-0 lg:sticky lg:top-16 lg:max-h-[calc(100vh-5rem)] lg:self-start lg:overflow-y-auto lg:[scrollbar-width:thin]">
          <div className="hidden lg:block">
            <StoryProgress stories={c.top_stories.map((s) => ({ rank: s.rank, title: s.title }))} />
          </div>

          {term && (
            <section className="border-b border-rule pb-4 pt-6">
              <h2 className="mb-3 border-b border-rule-strong pb-2 text-sm font-bold text-ink">{t("term")}</h2>
              <p lang="zh-CN" aria-label={t("pinyinAria", { term: term.term, pinyin: term.pinyin })}>
                {loc === "zh" || !term.pinyin ? (
                  // zh 판은 병음을 빼고 한자만
                  <span className="font-han text-[34px] font-semibold leading-tight tracking-[0.04em] text-ink">{term.term}</span>
                ) : (
                  <ruby className="font-han text-[34px] font-semibold leading-tight tracking-[0.04em] text-ink [ruby-position:over]">
                    {term.term}
                    <rp>(</rp>
                    <rt className="pb-1 font-sans text-xs font-normal tracking-[0.02em] text-jade">{term.pinyin}</rt>
                    <rp>)</rp>
                  </ruby>
                )}
              </p>
              {term.explanation && <p className="mt-2.5 text-sm leading-[1.65] text-ink-2">{term.explanation}</p>}
              <Sources refs={[term.ref]} briefing={briefing} className="mt-1 text-xs" />
            </section>
          )}

          {(c.editor_note || note) && (
            <section className="border-b border-rule pb-4 pt-6">
              <h2 className="mb-2 border-b border-rule-strong pb-2 text-sm font-bold text-ink">{t("editorNote")}</h2>
              <p className="text-sm leading-[1.6] text-ink-2">
                {c.editor_note ?? t("editorNoteAuto", { story: note!.story, outlets: note!.outlets })}
              </p>
            </section>
          )}

          {companies.length > 0 && (
            <section className="border-b border-rule pb-4 pt-6" data-testid="extra-companies">
              <h2 className="mb-1.5 border-b border-rule-strong pb-2 text-sm font-bold text-ink">{t("companies")}</h2>
              <ul>
                {companies.map((co, i) => (
                  <li key={i} className="border-t border-rule py-2.5 first:border-t-0">
                    <p className="text-[15.5px] font-bold text-ink">{co.name}</p>
                    <p className="text-sm leading-[1.55] text-ink-2">{co.why}</p>
                    <Sources refs={co.refs} briefing={briefing} className="text-xs" />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>

      {/* 구독 신청 (2026-11-05) — 페이지 맨 아래, 이전·다음 판 앞. 기사 상세 하단과 같은 상자 */}
      <SubscribeBox source="briefing" className="mb-8" />

      {pager && (
        <nav
          aria-label={t("archiveTitle")}
          className="grid grid-cols-2 gap-4 border-t-2 border-rule-strong py-5 text-sm sm:grid-cols-3"
        >
          <span>
            {pager.prev && (
              <BriefingDateLink date={pager.prev} className="rounded-sm text-ink-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {t("prev", { date: formatShortDate(pager.prev, loc) })}
              </BriefingDateLink>
            )}
          </span>
          <span className="order-last col-span-2 text-center sm:order-none sm:col-span-1">
            <BriefingDateLink path={`${BRIEFING_PATH}/archive`} className="rounded-sm text-ink-2 underline decoration-rule underline-offset-4 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {t("archiveLink")}
            </BriefingDateLink>
          </span>
          <span className="text-right">
            {pager.next && (
              <BriefingDateLink date={pager.next} className="rounded-sm text-ink-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {t("next", { date: formatShortDate(pager.next, loc) })}
              </BriefingDateLink>
            )}
          </span>
        </nav>
      )}

      <p className="border-t border-rule pb-12 pt-5 text-[12.5px] leading-[1.7] text-ink-3">
        {t("footerNote", { outlets: allOutlets.join("·") })}
      </p>
    </article>
  );
  if (!media.audio) return body;
  // 재생기는 판에 하나 — 듣기 막대·목차 시각·"이 부분 듣기"·아래 재생 막대가 같은 재생기를 움직인다 (Gate 2)
  return (
    <BriefingAudioProvider audio={media.audio} stories={c.top_stories.map((s) => ({ rank: s.rank, title: s.title }))}>
      {body}
    </BriefingAudioProvider>
  );
}
