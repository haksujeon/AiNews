import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { LOCALE_HTML_LANG, type Locale } from "@/i18n/routing";
import { getSourceName } from "@/lib/news-utils";
import { companyName } from "@/lib/company-names";
import { toCategoryStats } from "@/lib/statistics-utils";
import { BACKFILL_CAPS, weekdayOf } from "@/lib/metrics/period";
import { buildFacts, compactDays } from "@/lib/briefing/periodic/prompt";
import type { PublicPeriodic } from "@/lib/briefing/periodic/public";
import { formatShortDate } from "@/lib/briefing/view";
import { Sources } from "./briefing-view";
import { BriefingDateLink } from "./briefing-date-link";
import { periodicPath } from "./briefing-tabs";
import { ChartFigure, DataTable } from "./charts/chart-figure";
import { StoryContextBox } from "./story-context";
import { EasyBox } from "@/components/easy/easy-box";
import { BriefingGlance } from "./briefing-glance";
import { ShareButton } from "./briefing-media";
import { SubscribeBox } from "@/components/newsletter/subscribe-link";
import { FxNote } from "@/components/fx/fx-note";
import { buildPeriodicGlance } from "@/lib/briefing/periodic/glance";
import { convertAmountText, localizeAmountText, type FxLocale } from "@/lib/fx/convert";
import { BarsTick, DailyColumns, Dumbbell, SmallMultiples, type DayBar } from "./charts/charts";

/*
 * 주간·월간 리포트 본문 (설계 검토서 §1.2·§1.3 구조, §5 Briefing Desk). 공개 페이지(/briefing/weekly/[week],
 * /briefing/monthly/[month])와 관리자 미리보기가 이 컴포넌트 하나로 그린다 (Gate 2). 차트는 판이 가리키는 지표 스냅숏으로만 그린다.
 *  - 월간은 같은 틀에 "한 달의 흐름"(주별 칸)과 기업별 주별 언급(1천 건당, 작은 여러 개)을 더하고, 레일에 그 달의 주간 리포트를 둔다.
 *  - 비교 기간이 없으면(비교 기간이 축소 수집) 덤벨·지난 기간 눈금 대신 이번 기간 막대만 그린다.
 *  - 축소 수집일(보충 상한)·부분 수집일은 데이터 알림에서 따로 설명하고 차트에서 빗금으로 그린다.
 * 리포트 문장은 MVP 에서 한국어만이고, 화면 틀 문구는 messages(ko/en/zh)의 "weekly" 이름공간 + 월간에서 다른 문구만 "monthly".
 */

type T = ReturnType<typeof useTranslations<"weekly">>;
type Vals = Record<string, string | number>;

const fmt = (n: number) => n.toLocaleString("en-US");

function dow(t: T, day: string) {
  return t(`dow_${weekdayOf(day)}` as never);
}

function dayLabel(t: T, day: string, locale: string) {
  return t("dayLabel", { date: formatShortDate(day, locale), dow: dow(t, day) });
}

function SectionHead({ id, title, sub }: { id: string; title: string; sub?: string }) {
  return (
    <h2 id={id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-rule-strong pb-2.5 pt-7 text-lg font-bold text-ink">
      {title}
      {sub && <span className="text-[13px] font-normal text-ink-3">{sub}</span>}
    </h2>
  );
}

function Chips({ keys, facts, label }: { keys: string[]; facts: Record<string, string>; label: string }) {
  const shown = keys.filter((k) => facts[k]).slice(0, 4);
  if (!shown.length) return null;
  return (
    <p className="mt-2.5 flex flex-wrap gap-1.5" aria-label={label}>
      {shown.map((k) => (
        <span key={k} className="border-l-[3px] border-jade bg-jade-weak px-2 py-0.5 text-[12.5px] text-ink">
          {facts[k]}
        </span>
      ))}
    </p>
  );
}

function Kpi({ label, value, sub, children, small }: { label: string; value: string; sub?: string; children?: React.ReactNode; small?: boolean }) {
  return (
    <div className="min-w-[170px] border-l border-rule px-3.5 first:border-l-0 first:pl-0 @min-[1024px]:min-w-0 @min-[1024px]:border-l-0 @min-[1024px]:border-t @min-[1024px]:px-0 @min-[1024px]:py-2.5 @min-[1024px]:first:border-t-0">
      <p className="text-[12.5px] font-semibold text-ink-3">{label}</p>
      <p className={small ? "mt-0.5 text-xl font-[740] leading-tight tracking-[-0.02em] text-ink" : "mt-0.5 text-[30px] font-[740] leading-tight tracking-[-0.02em] text-ink"}>
        {value}
      </p>
      {sub && <p className="mt-0.5 text-[12.5px] leading-normal text-ink-2">{sub}</p>}
      {children}
    </div>
  );
}

/** metrics/period.ts dealKind 의 값 → 문구 키 */
const MONEY_KIND: Record<string, string> = { 인수: "acq", "부채 조달": "debt", 상장: "ipo", "투자 유치": "raise", 투자: "invest", "자금 조달": "funding", 기타: "other" };

const linkCls = "rounded-sm text-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function PeriodicView({ report }: { report: PublicPeriodic }) {
  const t = useTranslations("weekly");
  const tmo = useTranslations("monthly");
  const tb = useTranslations("briefing");
  const td = useTranslations("detail");
  const monthly = report.edition_type === "monthly";
  /** 월간이면 "monthly" 이름공간에 있는 문구를 먼저 쓴다 (주간과 다른 문구만 둔다) */
  const tp = (k: string, v?: Vals): string => (monthly && tmo.has(k as never) ? tmo(k as never, v as never) : t(k as never, v as never));
  const loc = report.locale;
  const htmlLang = LOCALE_HTML_LANG[loc as Locale] ?? loc;
  const c = report.content;
  const m = report.metrics;
  const facts = buildFacts(m);
  // 지표 문자열(FACTS)·기업 이름표·스냅숏 제목은 한국어로 저장돼 있다 → en·zh 판은 이름은 그 언어로, 지표 칩은 숨긴다 (2026-11-10 영어·중국어판)
  const ko = loc === "ko";
  const nm = (e: { key: string; name_ko: string }) => (ko ? e.name_ko : companyName(e.key, loc));
  // 돈 흐름 표의 거래 유형(지표 dealKind 의 한국어 값) → 화면 언어
  const kindLabel = (k: string) => {
    const code = MONEY_KIND[k];
    return code ? t(`moneyKind_${code}` as never) : k;
  };
  const titleOf = (id: string, fallback: string) => (ko ? fallback : report.snapshot_titles?.[id] ?? fallback);
  const v = m.volume;
  const hasPrev = m.baseline !== null;
  const lfl = v.like_for_like && v.like_for_like.days > 0 ? v.like_for_like : null;
  const gaps = v.daily.filter((d) => d.incomplete);
  const reduced = v.daily.filter((d) => d.reduced);
  const partial = v.daily.filter((d) => d.incomplete && !d.reduced);
  const completeDays = v.daily.filter((d) => !d.incomplete);
  const ent = m.entities.slice(0, 10);
  const top = m.entities[0];
  const termKey = c.term?.term;
  const term = m.terms.top.find((x) => x.term === termKey) ?? m.terms.top[0];
  // v3 스냅숏은 대표 지역 비중(region_share), v2 이전 스냅숏은 언급 기준(china_vs_overseas)
  const rs = m.region_share;
  const cvo = m.china_vs_overseas;
  const visible = new Set(report.snapshot_visible_ids);
  const money = m.money_table.filter((r) => visible.has(r.id));
  const timeline = m.stories.events_top
    .filter((e) => e.sources.length >= 2 && visible.has(e.primary_id))
    .slice(0, monthly ? 10 : 8)
    .sort((a, b) => a.days[0].localeCompare(b.days[0]));
  const outlets = m.sources.map((s) => getSourceName(s.name));
  const arc = c.month_arc ?? [];
  const weeks = m.weeks ?? [];
  const minutes = Math.max(
    1,
    Math.round(
      [c.headline, c.dek, ...c.big_picture.flatMap((b) => [b.title, b.text, b.easy ?? "", b.why ?? ""]), ...arc.map((a) => a.text), ...c.movers.map((x) => x.text), c.money?.text ?? "", c.china_lens?.text ?? ""].join("")
        .length / 500
    ) + (monthly ? 5 : 3)
  );
  const catLabel = new Map(toCategoryStats(m.categories.map((x) => ({ name: x.name, value: x.cur })), loc).map((x) => [x.name, x.label]));
  const periodLabel = monthly
    ? tmo("periodLabel", {
        year: report.period_start.slice(0, 4),
        month: Number(report.period_start.slice(5, 7)),
        start: dayLabel(t, report.period_start, loc),
        end: dayLabel(t, report.period_end, loc),
      })
    : t("periodLabel", {
        year: report.period_key.slice(0, 4),
        week: Number(report.period_key.slice(6)),
        start: dayLabel(t, report.period_start, loc),
        end: dayLabel(t, report.period_end, loc),
      });

  const dayBars: DayBar[] = v.daily.map((d) => {
    const showLabel = !monthly || Number(d.day.slice(8, 10)) === 1 || weekdayOf(d.day) === 1;
    return {
      day: d.day,
      count: d.count,
      incomplete: d.incomplete,
      expected: d.expected,
      quiet: Boolean(d.reduced),
      label: monthly ? (showLabel ? String(Number(d.day.slice(8, 10))) : "") : dow(t, d.day),
      sub: monthly ? (showLabel ? dow(t, d.day) : "") : t("dayOfMonth", { d: Number(d.day.slice(8, 10)) }),
      tip: `${dayLabel(t, d.day, loc)} ${t("countUnit", { count: d.count })}${d.reduced ? ` · ${t("reduced")}` : d.incomplete ? ` · ${t("gap")}` : ""}`,
    };
  });
  const prevBars = hasPrev && !monthly ? v.prev_daily.map((d) => ({ count: d.count, tip: `${t("legendPrev")} ${dayLabel(t, d.day, loc)} ${t("countUnit", { count: d.count })}` })) : [];
  const partialDays = partial.map((d) => dayLabel(t, d.day, loc)).join(", ");
  const reducedRange = reduced.length ? compactDays(reduced.map((d) => d.day)).replace(/\d{4}-(\d{2})-(\d{2})/g, (_, mm, dd) => `${Number(mm)}/${Number(dd)}`) : "";
  const caps = Object.entries(BACKFILL_CAPS)
    .map(([s, n]) => t("capItem", { source: getSourceName(s), n }))
    .join(", ");
  const gapNote = [reduced.length ? t("kpiReducedNote", { range: reducedRange }) : "", partial.length ? t("kpiGapNote", { days: partialDays }) : ""].filter(Boolean).join(" · ");
  const dailyDesc = lfl
    ? `${t("dailyConclusion", { change: lfl.display_change })}${partial.length ? ` ${t("dailyConclusionGap", { days: partialDays })}` : ""}`
    : completeDays.length
      ? `${t("dailyConclusionNoPrev", { avg: v.avg_per_complete_day, days: completeDays.length })}${gaps.length ? ` ${t("dailyConclusionExcluded", { count: gaps.length })}` : ""}`
      : t("dailyConclusionAllReduced");
  const barsDesc = hasPrev ? t("barsDesc") : tp("barsDescNoPrev");
  const multiples = weeks.length
    ? ent.slice(0, 9).map((e) => ({
        key: e.key,
        label: nm(e),
        cn: e.chinese,
        values: weeks.map((w) => w.entities_per_1k[e.key] ?? 0),
        tips: weeks.map((w) => `${nm(e)} ${w.key}: ${t("per1kTip", { n: w.entities_per_1k[e.key] ?? 0, raw: w.entities[e.key] ?? 0, total: w.total })}`),
      }))
    : [];
  const weekAxis = weeks.map((w) => ({ label: w.key, reduced: w.coverage === "reduced" }));
  // 한눈에 보기 (데일리와 같은 부품) — 큰 흐름마다 한 칸, 큰 숫자는 그 흐름이 인용한 지표 값 그대로
  const glance = buildPeriodicGlance(c, ko ? facts : {}).map((g) => ({
    ...g,
    sectionLabel: "",
    // 큰 숫자가 금액이면 그 언어 통화 환산 값을 작은 줄로 (데일리 한눈에 보기와 같은 convertAmountText)
    fx: g.big && report.fx ? convertAmountText(g.big.raw, loc as FxLocale, report.fx) : null,
  }));

  return (
    <article lang={htmlLang} data-testid="weekly" data-edition-type={report.edition_type} className="@container">
      {/* ── 머리 ── */}
      <header className="grid gap-6 border-b-2 border-rule-strong pb-7 pt-6 @min-[640px]:pt-9 @min-[1024px]:grid-cols-[minmax(0,1fr)_300px] @min-[1024px]:items-end @min-[1024px]:gap-12">
        <div className="min-w-0">
          <p className="mb-3.5 flex flex-wrap gap-x-3 gap-y-1 text-[13px] text-ink-3">
            <span className="font-[650] text-jade">{tp("kicker")}</span>
            <time dateTime={report.period_key}>{periodLabel}</time>
            <span>{t("coverage", { total: fmt(v.total), minutes })}</span>
          </p>
          <h1 className="max-w-[44rem] text-[28px] font-[740] leading-[1.25] tracking-[-0.028em] text-ink @min-[640px]:text-[34px] @min-[1024px]:text-[40px]">{c.headline}</h1>
          <p className="mt-4 max-w-[40rem] text-[17px] font-medium leading-[1.75] text-ink-2 @min-[640px]:text-[19px]">{c.dek}</p>
          <Sources refs={c.dek_refs} briefing={report} className="mt-2.5" />
          <p className="mt-4 flex flex-wrap items-baseline gap-2 text-[12.5px] leading-relaxed text-ink-3">
            <span className="rounded-[3px] border border-rule px-1.5 py-px font-semibold text-ink-2" data-testid="ai-label">
              {t("aiLabel")}
            </span>
            <span>{t("aiDisclosure")}</span>
          </p>
        </div>
        <section
          aria-label={tp("kpisLabel")}
          className="-mx-4 flex overflow-x-auto px-4 [scrollbar-width:none] @min-[1024px]:mx-0 @min-[1024px]:block @min-[1024px]:overflow-visible @min-[1024px]:border-l @min-[1024px]:border-rule @min-[1024px]:px-0 @min-[1024px]:pl-5"
          data-testid="weekly-kpis"
        >
          <Kpi
            label={lfl ? t("kpiVolume", { days: lfl.days }) : t("kpiVolumeTotal")}
            value={lfl ? lfl.display_change : t("countUnit", { count: fmt(v.total) })}
            sub={
              lfl
                ? t("kpiVolumeSub", { cur: fmt(lfl.cur), prev: fmt(lfl.prev) })
                : completeDays.length
                  ? t("kpiVolumeAvg", { avg: v.avg_per_complete_day, days: completeDays.length })
                  : t("kpiVolumeAllReduced")
            }
          >
            <svg viewBox={`0 0 ${Math.max(120, v.daily.length * 17)} 30`} className="mt-1.5 block h-[30px] w-[120px]" preserveAspectRatio="none" aria-hidden="true">
              <defs>
                <pattern id="kpi-hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <rect width="5" height="5" className="pc-hatch-bg" />
                  <line x1="0" y1="0" x2="0" y2="5" className="pc-hatch-line" />
                </pattern>
              </defs>
              {v.daily.map((d, i) => {
                const mx = Math.max(1, ...v.daily.map((x) => x.count));
                const h = Math.max(1, (28 * d.count) / mx);
                return (
                  <rect
                    key={d.day}
                    x={i * 17}
                    y={30 - h}
                    width={11}
                    height={h}
                    rx={2}
                    className={d.incomplete ? "pc-gap" : "pc-cur"}
                    fill={d.incomplete ? "url(#kpi-hatch)" : undefined}
                  />
                );
              })}
            </svg>
            {gapNote && <p className="mt-0.5 text-[12.5px] text-ink-2">{gapNote}</p>}
          </Kpi>
          {top && (
            <Kpi
              small
              label={t("kpiTopEntity")}
              value={`${nm(top)} ${t("countUnit", { count: top.cur })}`}
              sub={hasPrev ? tp("kpiTopEntitySub", { prev: top.prev, change: top.display_change }) : t("kpiTopEntitySubNoPrev", { titles: top.title_mentions, sources: top.sources })}
            />
          )}
          <Kpi
            small
            label={t("kpiMulti")}
            value={t("countUnit", { count: m.stories.event_multi_source_count })}
            sub={t("kpiMultiSub", { total: fmt(m.stories.event_count) })}
          />
        </section>
      </header>

      {gaps.length > 0 && (
        <div role="note" className="mt-[18px] border-l-[3px] border-ink-3 bg-surface px-3.5 py-2.5 text-sm leading-[1.65] text-ink-2" data-testid="weekly-data-notice">
          <strong className="mr-2 text-ink">{t("dataNoticeTitle")}</strong>
          {reduced.length > 0 && (
            <span data-testid="data-notice-reduced">{t("dataNoticeReduced", { range: reducedRange, count: reduced.length, caps })} </span>
          )}
          {partial.length > 0 && (
            <span data-testid="data-notice-partial">
              {t("dataNoticePartial", {
                days: partial.map((d) => `${dayLabel(t, d.day, loc)} ${t("countUnit", { count: d.count })}`).join(", "),
                median: partial[0].expected,
              })}{" "}
            </span>
          )}
          {hasPrev ? tp("dataNoticeCompare") : tp("dataNoticeNoCompare")} {t("dataNoticeTail")}
        </div>
      )}

      <BriefingGlance
        items={glance}
        countLabel={t("bigPictureCount", { count: c.big_picture.length })}
        actions={<ShareButton title={c.headline} />}
        className="mt-6"
      />

      <div className="grid gap-6 pb-8 @min-[1024px]:grid-cols-[minmax(0,1fr)_300px] @min-[1024px]:gap-12">
        <div className="min-w-0">
          {/* ── 큰 흐름 ── */}
          <section aria-labelledby="wk-bp">
            <SectionHead id="wk-bp" title={tp("bigPicture")} sub={t("bigPictureCount", { count: c.big_picture.length })} />
            <ol>
              {c.big_picture.map((b, i) => (
                <li key={i} id={`story-${i + 1}`} className="grid scroll-mt-20 grid-cols-[30px_minmax(0,1fr)] gap-2 border-b border-rule py-5 @min-[640px]:grid-cols-[44px_minmax(0,1fr)]">
                  <span aria-hidden="true" className="text-[22px] font-[760] leading-none text-ink @min-[640px]:text-[30px]">
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-[20px] font-bold leading-[1.38] tracking-[-0.02em] text-ink @min-[640px]:text-[22px]">{b.title}</h3>
                    <p className="mt-2 max-w-[40rem] text-base leading-[1.8] text-ink-2 @min-[640px]:text-[17px]">{b.text}</p>
                    {/* 쉽게 풀어보기 (주간 v7) — 기사 상세와 같은 상자 */}
                    <EasyBox
                      easy={b.easy}
                      why={b.why}
                      size="sm"
                      headingTag="h4"
                      className="mt-3 max-w-[40rem]"
                      labels={{ title: td("easyTitle"), saying: td("easySaying"), why: td("easyWhy") }}
                    />
                    {ko && <Chips keys={b.metrics} facts={facts} label={t("metricChips")} />}
                    <Sources refs={b.refs} briefing={report} className="mt-2" />
                    <StoryContextBox contexts={b.story_context} className="mt-3" />
                  </div>
                </li>
              ))}
            </ol>
          </section>

          {/* ── 월간: 한 달의 흐름 (주별 칸) ── */}
          {monthly && weeks.length > 0 && (
            <section aria-labelledby="mo-arc">
              <SectionHead id="mo-arc" title={tmo("arcTitle")} sub={tmo("arcSub")} />
              <ol className="grid gap-x-6 @min-[640px]:grid-cols-2 @min-[1024px]:grid-cols-3" data-testid="monthly-arc">
                {weeks.map((w) => {
                  const a = arc.find((x) => x.week === w.key);
                  return (
                    <li key={w.key} className="min-w-0 border-b border-rule py-3.5">
                      <p className="flex flex-wrap items-baseline justify-between gap-x-2 text-[13px] text-ink-3">
                        <span className="font-bold text-ink">{w.key}</span>
                        <span>
                          {formatShortDate(w.start, loc)}~{formatShortDate(w.end, loc)}
                        </span>
                      </p>
                      <p className="mt-1 text-[15px] font-bold text-ink">
                        {w.weekday_avg !== null ? tmo("arcWeekdayAvg", { n: w.weekday_avg }) : tmo("arcNoAvg")}
                      </p>
                      <p className="text-[12.5px] text-ink-3">
                        {w.coverage === "reduced"
                          ? tmo("arcReduced", { days: w.reduced_days.length, total: w.total })
                          : w.coverage === "partial"
                            ? tmo("arcPartial", { total: w.total })
                            : tmo("arcFull", { total: w.total, days: w.days })}
                      </p>
                      {a && (
                        <>
                          <p className="mt-1.5 text-[15px] leading-[1.6] text-ink-2">{a.text}</p>
                          <Sources refs={a.refs} briefing={report} className="mt-1 text-xs" />
                        </>
                      )}
                    </li>
                  );
                })}
              </ol>
            </section>
          )}

          {/* ── 데이터로 본 한 주 / 한 달 ── */}
          <section aria-labelledby="wk-data">
            <SectionHead id="wk-data" title={tp("dataSection")} sub={hasPrev ? tp("dataSectionSub") : tp("dataSectionSubNoPrev")} />
            <p className="mt-3.5 flex flex-wrap items-center gap-x-3.5 gap-y-1.5 text-[13px] text-ink-2" aria-hidden="true">
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-3 w-3 rounded-[2px] bg-chart-1" />
                {tp("legendCur")}
              </span>
              {prevBars.length > 0 && (
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block h-3 w-3 rounded-[2px] bg-chart-prev" />
                  {tp("legendPrev")}
                </span>
              )}
              {gaps.length > 0 && (
                <span className="inline-flex items-center gap-1.5">
                  <span className="pc-swatch-gap inline-block h-3 w-3 rounded-[2px] border border-ink-3" />
                  {reduced.length ? t("gapLegend") : t("gap")}
                </span>
              )}
            </p>
            <ChartFigure
              testId="chart-daily"
              title={tp("chartDaily")}
              desc={dailyDesc}
              tableLabel={t("tableView")}
              render={(W, ids) => <DailyColumns W={W} ids={ids} cur={dayBars} prev={prevBars.length ? prevBars : null} gapLabel={t("gap")} />}
              table={
                <DataTable
                  head={prevBars.length ? [t("colDay"), tp("legendCur"), tp("legendPrev")] : [t("colDay"), tp("legendCur")]}
                  rows={v.daily.map((d, i) => [
                    dayLabel(t, d.day, loc),
                    d.reduced ? t("reducedCell", { count: d.count }) : d.incomplete ? t("gapCell", { count: d.count }) : d.count,
                    ...(prevBars.length ? [v.prev_daily[i] ? `${v.prev_daily[i].count} (${formatShortDate(v.prev_daily[i].day, loc)})` : "—"] : []),
                  ])}
                />
              }
            />
            {monthly && multiples.length > 0 && (
              <ChartFigure
                testId="chart-multiples"
                title={tmo("chartMultiples", { count: multiples.length })}
                desc={tmo("chartMultiplesDesc", { mark: t("cnMark") })}
                tableLabel={t("tableView")}
                note={weekAxis.some((w) => w.reduced) ? tmo("multiplesReducedNote") : undefined}
                render={(W, ids) => <SmallMultiples W={W} ids={ids} series={multiples} weeks={weekAxis} cnMark={t("cnMark")} />}
                table={
                  <DataTable
                    head={[t("colCompany"), ...weeks.map((w) => (w.coverage === "reduced" ? `${w.key}*` : w.key))]}
                    rows={multiples.map((s) => [`${s.label}${s.cn ? ` (${t("cnMark")})` : ""}`, ...s.values])}
                  />
                }
              />
            )}
            <ChartFigure
              testId="chart-entities"
              title={t("chartEntities", { count: ent.length })}
              desc={hasPrev ? t("chartEntitiesDesc", { mark: t("cnMark") }) : t("chartEntitiesDescNoPrev", { mark: t("cnMark") })}
              tableLabel={t("tableView")}
              note={t("entitiesNote", { count: m.sources.length })}
              render={(W, ids) =>
                hasPrev ? (
                  <Dumbbell
                    W={W}
                    ids={ids}
                    cnMark={t("cnMark")}
                    rows={ent.map((e) => ({
                      key: e.key,
                      label: nm(e),
                      prev: e.prev,
                      cur: e.cur,
                      chg: e.change_pct === null ? null : e.display_change,
                      cn: e.chinese,
                      tip: `${nm(e)}: ${e.prev} → ${e.cur}${e.change_pct === null ? "" : ` (${e.display_change})`}`,
                    }))}
                  />
                ) : (
                  <BarsTick
                    W={W}
                    ids={ids}
                    noPrev
                    rows={ent.map((e) => ({
                      key: e.key,
                      label: `${nm(e)}${e.chinese ? ` ${t("cnMark")}` : ""}`,
                      cur: e.cur,
                      prev: 0,
                      tip: `${nm(e)}: ${e.cur}`,
                    }))}
                  />
                )
              }
              table={
                <DataTable
                  head={hasPrev ? [t("colCompany"), tp("legendPrev"), tp("legendCur"), t("colChange")] : [t("colCompany"), tp("legendCur")]}
                  rows={ent.map((e) => {
                    const name = `${nm(e)}${e.chinese ? ` (${t("cnMark")})` : ""}`;
                    return hasPrev ? [name, e.prev, e.cur, e.display_change] : [name, e.cur];
                  })}
                />
              }
            />
            {hasPrev ? (
              <div className="grid gap-x-8 @min-[860px]:grid-cols-2">
                {(
                  [
                    ["rising", m.terms.rising, tp("chartRising"), tp("chartRisingDesc")],
                    ["falling", m.terms.falling, tp("chartFalling"), tp("chartFallingDesc")],
                  ] as const
                ).map(([k, rows, title, desc]) =>
                  rows.length ? (
                    <ChartFigure
                      key={k}
                      testId={`chart-terms-${k}`}
                      title={title}
                      desc={desc}
                      desktopWidth={420}
                      tableLabel={t("tableView")}
                      render={(W, ids) => (
                        <Dumbbell
                          W={W}
                          ids={ids}
                          pinyin={loc !== "zh"}
                          step={10}
                          rows={rows.map((x) => ({
                            key: x.term,
                            label: x.term,
                            pinyin: x.pinyin,
                            prev: x.prev,
                            cur: x.cur,
                            chg: `${x.delta > 0 ? "+" : ""}${x.delta}`,
                            tip: `${x.term}${x.pinyin ? ` (${x.pinyin})` : ""}: ${x.prev} → ${x.cur}`,
                          }))}
                        />
                      )}
                      table={
                        <DataTable head={[t("colTerm"), t("colPinyin"), tp("legendPrev"), tp("legendCur")]} rows={rows.map((x) => [x.term, x.pinyin || "—", x.prev, x.cur])} />
                      }
                    />
                  ) : null
                )}
              </div>
            ) : (
              m.terms.top.length > 0 && (
                <ChartFigure
                  testId="chart-terms-top"
                  title={t("chartTopTerms", { count: Math.min(8, m.terms.top.length) })}
                  desc={t("chartTopTermsDesc")}
                  tableLabel={t("tableView")}
                  render={(W, ids) => (
                    <BarsTick
                      W={W}
                      ids={ids}
                      noPrev
                      step={20}
                      rows={m.terms.top.slice(0, 8).map((x) => ({ key: x.term, label: x.term, cur: x.cur, prev: 0, tip: `${x.term}${x.pinyin ? ` (${x.pinyin})` : ""}: ${x.cur}` }))}
                    />
                  )}
                  table={<DataTable head={[t("colTerm"), t("colPinyin"), tp("legendCur")]} rows={m.terms.top.slice(0, 8).map((x) => [x.term, x.pinyin || "—", x.cur])} />}
                />
              )
            )}
            <div className="grid gap-x-8 @min-[860px]:grid-cols-2">
              <ChartFigure
                testId="chart-sources"
                title={t("chartSources")}
                desc={barsDesc}
                desktopWidth={420}
                tableLabel={t("tableView")}
                render={(W, ids) => (
                  <BarsTick
                    W={W}
                    ids={ids}
                    noPrev={!hasPrev}
                    rows={m.sources.map((s) => ({
                      key: s.name,
                      label: s.name,
                      cur: s.cur,
                      prev: s.prev,
                      extra: hasPrev ? undefined : s.display_share,
                      chg: hasPrev ? s.display_change : null,
                      tip: hasPrev ? `${s.name}: ${s.cur} (${tp("legendPrev")} ${s.prev}${s.change_pct === null ? "" : `, ${s.display_change}`})` : `${s.name}: ${s.cur} (${s.display_share})`,
                    }))}
                  />
                )}
                table={
                  <DataTable
                    head={hasPrev ? [t("colSource"), tp("legendCur"), tp("legendPrev"), t("colChange")] : [t("colSource"), tp("legendCur"), t("colShare")]}
                    rows={m.sources.map((s) => (hasPrev ? [s.name, s.cur, s.prev, s.display_change] : [s.name, s.cur, s.display_share]))}
                  />
                }
              />
              <ChartFigure
                testId="chart-categories"
                title={t("chartCategories")}
                desc={barsDesc}
                desktopWidth={420}
                tableLabel={t("tableView")}
                render={(W, ids) => (
                  <BarsTick
                    W={W}
                    ids={ids}
                    noPrev={!hasPrev}
                    rows={m.categories.map((s) => ({
                      key: s.name,
                      label: catLabel.get(s.name) ?? s.name,
                      cur: s.cur,
                      prev: s.prev,
                      extra: s.display_share,
                      chg: hasPrev ? s.display_change : null,
                      tip: hasPrev
                        ? `${catLabel.get(s.name) ?? s.name}: ${s.cur} (${tp("legendPrev")} ${s.prev}${s.change_pct === null ? "" : `, ${s.display_change}`})`
                        : `${catLabel.get(s.name) ?? s.name}: ${s.cur} (${s.display_share})`,
                    }))}
                  />
                )}
                table={
                  <DataTable
                    head={hasPrev ? [t("colCategory"), tp("legendCur"), t("colShare"), tp("legendPrev"), t("colChange")] : [t("colCategory"), tp("legendCur"), t("colShare")]}
                    rows={m.categories.map((s) =>
                      hasPrev ? [catLabel.get(s.name) ?? s.name, s.cur, s.display_share, s.prev, s.display_change] : [catLabel.get(s.name) ?? s.name, s.cur, s.display_share]
                    )}
                  />
                }
              />
            </div>
            {/* 논조: 차트 대신 숫자 줄 */}
            <div role="group" aria-labelledby="wk-sent" className="grid grid-cols-3 gap-3 border-b border-rule py-4" data-testid="weekly-sentiment">
              <p id="wk-sent" className="col-span-full text-[15.5px] font-bold text-ink">
                {t("sentimentTitle")} <span className="ml-2 text-[13px] font-normal text-ink-3">{m.sentiment.prev ? tp("sentimentSub") : t("sentimentSubNoPrev")}</span>
              </p>
              {m.sentiment.cur.map((s) => (
                <div key={s.name}>
                  <p className="text-[12.5px] font-semibold text-ink-3">{t(`sent_${s.name}` as never)}</p>
                  <p className="text-[22px] font-[740] tracking-[-0.02em] text-ink">{s.display}</p>
                  {m.sentiment.prev && (
                    <p className="text-[12.5px] text-ink-2">{tp("sentPrev", { value: m.sentiment.prev.find((p) => p.name === s.name)?.display ?? "—" })}</p>
                  )}
                </div>
              ))}
              {m.sentiment.flat && <p className="col-span-full text-[12.5px] text-ink-2">{t("sentFlat")}</p>}
            </div>
          </section>

          {/* ── 중국과 해외 ── */}
          <section aria-labelledby="wk-cn">
            <SectionHead id="wk-cn" title={t("chinaSection")} sub={t("chinaSectionSub")} />
            {c.china_lens && (
              <>
                <p className="mt-3.5 max-w-[40rem] text-base leading-[1.8] text-ink-2">{c.china_lens.text}</p>
                {ko && <Chips keys={c.china_lens.metrics} facts={facts} label={t("metricChips")} />}
                <Sources refs={c.china_lens.refs} briefing={report} className="mt-2" />
              </>
            )}
            {rs ? (
              // v3 스냅숏: 대표 지역 기준 (region_share = regionCounts, 홈 지역 칩·통계 페이지와 같은 함수)
              <ChartFigure
                testId="chart-china"
                title={t("chartRegion")}
                desc={
                  rs.prev
                    ? tp("chartRegionDesc", { cn: rs.cur.cn_pct, us: rs.cur.us_pct, other: rs.cur.other_pct, pcn: rs.prev.cn_pct, pus: rs.prev.us_pct })
                    : t("chartRegionDescNoPrev", { cn: rs.cur.cn_pct, us: rs.cur.us_pct, other: rs.cur.other_pct })
                }
                tableLabel={t("tableView")}
                note={`${t("regionNote", { uschina: rs.cur.us_china, unclassified: rs.cur.unclassified })}${c.china_lens ? "" : ` ${t("chinaLensDropped")}`}`}
                render={(W, ids) => {
                  const rows = [
                    { key: "cn", label: t("regionRowCn"), cur: rs.cur.cn_pct, prev: rs.prev?.cn_pct ?? 0 },
                    { key: "us", label: t("regionRowUs"), cur: rs.cur.us_pct, prev: rs.prev?.us_pct ?? 0 },
                    { key: "ot", label: t("regionRowOther"), cur: rs.cur.other_pct, prev: rs.prev?.other_pct ?? 0 },
                  ];
                  return rs.prev ? (
                    <Dumbbell
                      W={W}
                      ids={ids}
                      unit="%"
                      rows={rows.map((r) => {
                        const d = Math.round((r.cur - r.prev) * 10) / 10;
                        return { ...r, chg: `${d > 0 ? "+" : ""}${d}%p`, tip: `${r.label}: ${r.prev}% → ${r.cur}%` };
                      })}
                    />
                  ) : (
                    <BarsTick W={W} ids={ids} noPrev unit="%" step={25} rows={rows.map((r) => ({ ...r, prev: 0, tip: `${r.label}: ${r.cur}%` }))} />
                  );
                }}
                table={
                  <DataTable
                    head={[t("colGroup"), tp("legendPrev"), tp("legendCur")]}
                    rows={[
                      [t("regionRowCn"), rs.prev ? `${rs.prev.cn_pct}%` : "—", `${rs.cur.cn_pct}%`],
                      [t("regionRowUs"), rs.prev ? `${rs.prev.us_pct}%` : "—", `${rs.cur.us_pct}%`],
                      [t("regionRowOther"), rs.prev ? `${rs.prev.other_pct}%` : "—", `${rs.cur.other_pct}%`],
                    ]}
                  />
                }
              />
            ) : cvo ? (
              <ChartFigure
                testId="chart-china"
                title={t("chartChina")}
                desc={
                  cvo.prev
                    ? tp("chartChinaDesc", { foreign: cvo.cur.foreign_pct, china: cvo.cur.china_pct, pforeign: cvo.prev.foreign_pct, pchina: cvo.prev.china_pct })
                    : t("chartChinaDescNoPrev", { foreign: cvo.cur.foreign_pct, china: cvo.cur.china_pct })
                }
                tableLabel={t("tableView")}
                note={c.china_lens ? t("chinaNote") : `${t("chinaNote")} ${t("chinaLensDropped")}`}
                render={(W, ids) =>
                  cvo.prev ? (
                    <Dumbbell
                      W={W}
                      ids={ids}
                      unit="%"
                      rows={[
                        { key: "cn", label: t("chinaRowCn"), prev: cvo.prev.china_pct, cur: cvo.cur.china_pct },
                        { key: "fo", label: t("chinaRowFo"), prev: cvo.prev.foreign_pct, cur: cvo.cur.foreign_pct },
                      ].map((r) => {
                        const d = Math.round((r.cur - r.prev) * 10) / 10;
                        return { ...r, chg: `${d > 0 ? "+" : ""}${d}%p`, tip: `${r.label}: ${r.prev}% → ${r.cur}%` };
                      })}
                    />
                  ) : (
                    <BarsTick
                      W={W}
                      ids={ids}
                      noPrev
                      unit="%"
                      step={25}
                      rows={[
                        { key: "cn", label: t("chinaRowCn"), cur: cvo.cur.china_pct, prev: 0, tip: `${t("chinaRowCn")}: ${cvo.cur.china_pct}%` },
                        { key: "fo", label: t("chinaRowFo"), cur: cvo.cur.foreign_pct, prev: 0, tip: `${t("chinaRowFo")}: ${cvo.cur.foreign_pct}%` },
                      ]}
                    />
                  )
                }
                table={
                  <DataTable
                    head={[t("colGroup"), tp("legendPrev"), tp("legendCur")]}
                    rows={[
                      [t("chinaRowCn"), cvo.prev ? `${cvo.prev.china_pct}%` : "—", `${cvo.cur.china_pct}%`],
                      [t("chinaRowFo"), cvo.prev ? `${cvo.prev.foreign_pct}%` : "—", `${cvo.cur.foreign_pct}%`],
                    ]}
                  />
                }
              />
            ) : null}
          </section>

          {/* ── 움직인 기업 ── */}
          {c.movers.length > 0 && (
            <section aria-labelledby="wk-mv">
              <SectionHead id="wk-mv" title={t("movers")} />
              <ul className="grid gap-x-8 @min-[860px]:grid-cols-2">
                {c.movers.map((mv, i) => {
                  const e = m.entities.find((x) => x.key === mv.entity);
                  return (
                    <li key={i} className="border-b border-rule py-3.5">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="text-base font-bold text-ink">
                          {e ? nm(e) : mv.entity}
                          {e?.chinese && (
                            <span className="ml-1.5 rounded-[2px] border border-jade px-[3px] align-[2px] text-[11px] font-bold text-jade" title={t("cnMarkLabel")}>
                              {t("cnMark")}
                            </span>
                          )}
                        </p>
                        {e && (
                          <p className="text-[15px] font-bold text-ink">
                            {t("countUnit", { count: e.cur })}{" "}
                            {hasPrev && <span className="text-[12.5px] font-normal text-ink-3">{tp("moverSub", { prev: e.prev, change: e.display_change })}</span>}
                          </p>
                        )}
                      </div>
                      <p className="mt-1 text-[15px] leading-[1.65] text-ink-2">{mv.text}</p>
                      <Sources refs={mv.refs} briefing={report} className="mt-1 text-xs" />
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {/* ── 돈의 흐름 ── */}
          <section aria-labelledby="wk-money">
            <SectionHead id="wk-money" title={t("money")} sub={t("moneySub")} />
            {c.money && (
              <>
                <p className="mt-3.5 max-w-[40rem] text-base leading-[1.8] text-ink-2">{c.money.text}</p>
                <Sources refs={c.money.refs} briefing={report} className="mt-2" />
              </>
            )}
            {money.length ? (
              <div className="mt-3 overflow-x-auto rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" tabIndex={0} role="region" aria-label={t("moneyTable")} data-testid="weekly-money">
                <table className="w-full min-w-[560px] border-collapse text-[13px] @min-[640px]:min-w-0">
                  <thead>
                    <tr className="border-b border-rule-strong text-left text-[12.5px] text-ink-3">
                      <th scope="col" className="py-1.5 pr-2.5 font-semibold">{t("colDate")}</th>
                      <th scope="col" className="py-1.5 pr-2.5 font-semibold">{t("colKind")}</th>
                      <th scope="col" className="py-1.5 pr-2.5 text-right font-semibold">{t("colAmount")}</th>
                      <th scope="col" className="py-1.5 font-semibold">{t("colArticle")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {money.map((r) => (
                      <tr key={r.id} className="border-b border-rule align-top">
                        <td className="whitespace-nowrap py-2 pr-2.5 text-ink-2">{formatShortDate(r.day, loc)}</td>
                        <td className="whitespace-nowrap py-2 pr-2.5 text-ink-2">{kindLabel(r.kind)}</td>
                        <td className="whitespace-nowrap py-2 pr-2.5 text-right font-bold text-ink">{localizeAmountText(r.amount, loc as FxLocale)}</td>
                        <td className="py-2 leading-normal">
                          <Link href={`/news/${r.id}`} className={linkCls}>
                            {titleOf(r.id, r.title_kr)}
                          </Link>{" "}
                          <span className="text-[12.5px] text-ink-3">{getSourceName(r.source)}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="mt-3 text-sm text-ink-3">{t("moneyEmpty")}</p>
            )}
            <p className="mt-1.5 text-[12.5px] leading-[1.55] text-ink-3">{t("moneyNote")}</p>
          </section>

          {/* ── 여러 매체가 함께 다룬 이야기 ── */}
          {timeline.length > 0 && (
            <section aria-labelledby="wk-tl">
              <SectionHead id="wk-tl" title={t("timeline")} sub={t("timelineSub")} />
              <ol data-testid="weekly-timeline">
                {timeline.map((e) => (
                  <li key={e.primary_id} className="grid grid-cols-[92px_minmax(0,1fr)] gap-2.5 border-b border-rule py-2.5 text-[15px] leading-[1.55]">
                    <time dateTime={e.days[0]} className="pt-0.5 text-[13px] text-ink-3">
                      {dayLabel(t, e.days[0], loc)}
                    </time>
                    <div className="min-w-0">
                      <Link href={`/news/${e.primary_id}`} className={linkCls}>
                        {titleOf(e.primary_id, e.title_kr)}
                      </Link>
                      <p className="text-[12.5px] text-ink-3">
                        {e.sources.map(getSourceName).join(" · ")} · {t("timelineOutlets", { count: e.sources.length })}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {c.watch_next.length > 0 && (
            <section aria-labelledby="wk-next">
              <SectionHead id="wk-next" title={tp("watchNext")} />
              <ul>
                {c.watch_next.map((w, i) => (
                  <li key={i} className="border-b border-rule py-3">
                    <p className="text-[15.5px] text-ink">{w.text}</p>
                    <Sources refs={w.refs} briefing={report} className="text-xs" />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        {/* ── 오른쪽 레일 (모바일에서는 본문 아래) ── */}
        <aside className="min-w-0">
          {term && (
            <section className="border-b border-rule pb-4 pt-[22px]">
              <h2 className="mb-3 border-b border-rule-strong pb-2 text-sm font-bold text-ink">{tp("railTerm")}</h2>
              <p lang="zh-CN" aria-label={term.pinyin ? tb("pinyinAria", { term: term.term, pinyin: term.pinyin }) : term.term}>
                {loc === "zh" || !term.pinyin ? (
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
              <p className="mt-1.5 text-sm font-bold text-ink">{hasPrev ? tp("termStat", { cur: term.cur, prev: term.prev }) : t("termStatNoPrev", { cur: term.cur })}</p>
              {term.explanation_kr && loc === "ko" && <p className="mt-1.5 text-sm leading-[1.65] text-ink-2">{term.explanation_kr}</p>}
              {c.term?.why && <p className="mt-1.5 text-sm leading-[1.65] text-ink">{c.term.why}</p>}
              {term.pinyin_variants > 1 && loc !== "zh" && <p className="mt-1.5 text-xs leading-normal text-ink-3">{t("pinyinVariants", { count: term.pinyin_variants })}</p>}
            </section>
          )}
          {monthly ? (
            <section className="border-b border-rule pb-4 pt-[22px]">
              <h2 className="mb-3 border-b border-rule-strong pb-2 text-sm font-bold text-ink">{tmo("railWeeklies")}</h2>
              <ul className="text-sm" data-testid="monthly-weeklies">
                {report.weeklies.map((w) => (
                  <li key={w.key} className="grid grid-cols-[48px_1fr_auto] gap-2 border-t border-rule py-[7px] first:border-t-0">
                    <span className="text-ink">{w.key}</span>
                    <span className="text-[12.5px] text-ink-3">
                      {formatShortDate(w.start, loc)}~{formatShortDate(w.end, loc)}
                    </span>
                    {w.published ? (
                      <Link href={periodicPath("weekly", w.iso_week)} className="rounded-sm font-semibold text-jade hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        {tmo("weeklyOpen")}
                      </Link>
                    ) : (
                      <span className="text-[12.5px] text-ink-3">{tmo("weeklyNone")}</span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ) : (
            <section className="border-b border-rule pb-4 pt-[22px]">
              <h2 className="mb-3 border-b border-rule-strong pb-2 text-sm font-bold text-ink">{t("railDailies")}</h2>
              <ul className="text-sm" data-testid="weekly-dailies">
                {report.dailies.map((d) => {
                  const count = v.daily.find((x) => x.day === d.date)?.count ?? 0;
                  return (
                    <li key={d.date} className="grid grid-cols-[64px_1fr_auto] gap-2 border-t border-rule py-[7px] first:border-t-0">
                      <span className="text-ink">{t("dailyCellDay", { dow: dow(t, d.date), d: Number(d.date.slice(8, 10)) })}</span>
                      <span className="text-[12.5px] text-ink-3">{t("countUnit", { count })}</span>
                      {d.published ? (
                        <BriefingDateLink date={d.date} className="rounded-sm font-semibold text-jade hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                          {t("dailyOpen")}
                        </BriefingDateLink>
                      ) : (
                        <span className="text-[12.5px] text-ink-3">{t("dailyNone")}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
          <section className="border-b border-rule pb-4 pt-[22px]">
            <h2 className="mb-3 border-b border-rule-strong pb-2 text-sm font-bold text-ink">{t("railMethod")}</h2>
            <p className="text-sm leading-[1.65] text-ink-2">{t("methodBody")}</p>
            {monthly && <p className="mt-1.5 text-sm leading-[1.65] text-ink-2">{tmo("methodMonthly")}</p>}
            <p className="mt-1.5 text-xs leading-normal text-ink-3">
              {t("methodMeta", { computed: report.metrics_computed_at, prompt: c.meta?.prompt_version ?? "—" })}
            </p>
          </section>
          <section className="border-b border-rule pb-4 pt-[22px]">
            <h2 className="mb-3 border-b border-rule-strong pb-2 text-sm font-bold text-ink">{t("railFixes")}</h2>
            <p className="text-sm leading-[1.65] text-ink-2">{t("fixesNone")}</p>
          </section>
        </aside>
      </div>

      {/* 구독 신청 — 데일리 브리핑 맨 아래와 같은 상자 */}
      <SubscribeBox source="weekly" className="mb-6" />
      <p className="border-t border-rule pb-12 pt-5 text-[12.5px] leading-[1.7] text-ink-3">
        {t("footer", { count: outlets.length, outlets: outlets.join("·") })}
        {(report.fxApplied || glance.some((g) => g.fx)) && <FxNote fx={report.fx} locale={loc} className="mt-1 block" />}
      </p>
    </article>
  );
}
