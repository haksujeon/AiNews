import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { LOCALE_HTML_LANG, type Locale } from "@/i18n/routing";
import { getSourceName } from "@/lib/news-utils";
import { toCategoryStats } from "@/lib/statistics-utils";
import { weekdayOf } from "@/lib/metrics/period";
import { buildFacts } from "@/lib/briefing/periodic/prompt";
import type { PublicWeekly } from "@/lib/briefing/periodic/public";
import { briefingDatePath, formatShortDate } from "@/lib/briefing/view";
import { Sources } from "./briefing-view";
import { ChartFigure, DataTable } from "./charts/chart-figure";
import { BarsTick, DailyColumns, Dumbbell, type DayBar } from "./charts/charts";

/*
 * 주간 리포트 본문 (설계 검토서 §1.2 구조, §5 Briefing Desk). 공개 페이지(/briefing/weekly/[week])와
 * 관리자 미리보기가 이 컴포넌트 하나로 그린다 (Gate 2). 차트는 판이 가리키는 지표 스냅숏으로만 그린다.
 * 리포트 문장은 MVP 에서 한국어만이고, 화면 틀 문구는 messages(ko/en/zh)의 "weekly" 이름공간에서 온다.
 */

type T = ReturnType<typeof useTranslations<"weekly">>;

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

export function PeriodicView({ weekly }: { weekly: PublicWeekly }) {
  const t = useTranslations("weekly");
  const tb = useTranslations("briefing");
  const loc = weekly.locale;
  const htmlLang = LOCALE_HTML_LANG[loc as Locale] ?? loc;
  const c = weekly.content;
  const m = weekly.metrics;
  const facts = buildFacts(m);
  const v = m.volume;
  const lfl = v.like_for_like;
  const gaps = v.daily.filter((d) => d.incomplete);
  const ent = m.entities.slice(0, 10);
  const top = m.entities[0];
  const termKey = c.term?.term;
  const term = m.terms.top.find((x) => x.term === termKey) ?? m.terms.top[0];
  const cvo = m.china_vs_overseas;
  const visible = new Set(weekly.snapshot_visible_ids);
  const money = m.money_table.filter((r) => visible.has(r.id));
  const timeline = m.stories.events_top
    .filter((e) => e.sources.length >= 2 && visible.has(e.primary_id))
    .slice(0, 8)
    .sort((a, b) => a.days[0].localeCompare(b.days[0]));
  const outlets = m.sources.map((s) => getSourceName(s.name));
  const minutes = Math.max(
    1,
    Math.round(
      [c.headline, c.dek, ...c.big_picture.flatMap((b) => [b.title, b.text]), ...c.movers.map((x) => x.text), c.money?.text ?? "", c.china_lens?.text ?? ""].join("")
        .length / 500
    ) + 3
  );
  const [y, wk] = weekly.iso_week.split("-W");
  const catLabel = new Map(toCategoryStats(m.categories.map((x) => ({ name: x.name, value: x.cur })), loc).map((x) => [x.name, x.label]));

  const dayBars: DayBar[] = v.daily.map((d) => ({
    day: d.day,
    count: d.count,
    incomplete: d.incomplete,
    expected: d.expected,
    label: dow(t, d.day),
    sub: t("dayOfMonth", { d: Number(d.day.slice(8, 10)) }),
    tip: `${dayLabel(t, d.day, loc)} ${t("countUnit", { count: d.count })}${d.incomplete ? ` · ${t("gap")}` : ""}`,
  }));
  const prevBars = v.prev_daily.map((d) => ({ count: d.count, tip: `${t("legendPrev")} ${dayLabel(t, d.day, loc)} ${t("countUnit", { count: d.count })}` }));
  const gapDays = gaps.map((d) => dayLabel(t, d.day, loc)).join(", ");
  const dailyDesc = lfl
    ? `${t("dailyConclusion", { change: lfl.display_change })}${gaps.length ? ` ${t("dailyConclusionGap", { days: gapDays })}` : ""}`
    : undefined;

  return (
    <article lang={htmlLang} data-testid="weekly" className="@container">
      {/* ── 머리 ── */}
      <header className="grid gap-6 border-b-2 border-rule-strong pb-7 pt-6 @min-[640px]:pt-9 @min-[1024px]:grid-cols-[minmax(0,1fr)_300px] @min-[1024px]:items-end @min-[1024px]:gap-12">
        <div className="min-w-0">
          <p className="mb-3.5 flex flex-wrap gap-x-3 gap-y-1 text-[13px] text-ink-3">
            <span className="font-[650] text-jade">{t("kicker")}</span>
            <time dateTime={weekly.iso_week}>
              {t("periodLabel", { year: y, week: Number(wk), start: dayLabel(t, weekly.period_start, loc), end: dayLabel(t, weekly.period_end, loc) })}
            </time>
            <span>{t("coverage", { total: fmt(v.total), minutes })}</span>
          </p>
          <h1 className="max-w-[44rem] text-[28px] font-[740] leading-[1.25] tracking-[-0.028em] text-ink @min-[640px]:text-[34px] @min-[1024px]:text-[40px]">{c.headline}</h1>
          <p className="mt-4 max-w-[40rem] text-[17px] font-medium leading-[1.75] text-ink-2 @min-[640px]:text-[19px]">{c.dek}</p>
          <Sources refs={c.dek_refs} briefing={weekly} className="mt-2.5" />
          <p className="mt-4 flex flex-wrap items-baseline gap-2 text-[12.5px] leading-relaxed text-ink-3">
            <span className="rounded-[3px] border border-rule px-1.5 py-px font-semibold text-ink-2" data-testid="ai-label">
              {t("aiLabel")}
            </span>
            <span>{t("aiDisclosure")}</span>
          </p>
        </div>
        <section
          aria-label={t("kpisLabel")}
          className="-mx-4 flex overflow-x-auto px-4 [scrollbar-width:none] @min-[1024px]:mx-0 @min-[1024px]:block @min-[1024px]:overflow-visible @min-[1024px]:border-l @min-[1024px]:border-rule @min-[1024px]:px-0 @min-[1024px]:pl-5"
          data-testid="weekly-kpis"
        >
          {lfl && (
            <Kpi label={t("kpiVolume", { days: lfl.days })} value={lfl.display_change} sub={t("kpiVolumeSub", { cur: fmt(lfl.cur), prev: fmt(lfl.prev) })}>
              <svg viewBox="0 0 120 30" className="mt-1.5 block h-[30px] w-[120px]" aria-hidden="true">
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
              {gaps.length > 0 && <p className="mt-0.5 text-[12.5px] text-ink-2">{t("kpiGapNote", { days: gapDays })}</p>}
            </Kpi>
          )}
          {top && (
            <Kpi
              small
              label={t("kpiTopEntity")}
              value={`${top.name_ko} ${t("countUnit", { count: top.cur })}`}
              sub={t("kpiTopEntitySub", { prev: top.prev, change: top.display_change })}
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
        <p role="note" className="mt-[18px] border-l-[3px] border-ink-3 bg-surface px-3.5 py-2.5 text-sm leading-[1.65] text-ink-2" data-testid="weekly-data-notice">
          <strong className="mr-2 text-ink">{t("dataNoticeTitle")}</strong>
          {t("dataNotice", {
            days: gaps.map((d) => `${dayLabel(t, d.day, loc)} ${t("countUnit", { count: d.count })}`).join(", "),
            median: gaps[0].expected,
          })}
        </p>
      )}

      <div className="grid gap-6 pb-8 @min-[1024px]:grid-cols-[minmax(0,1fr)_300px] @min-[1024px]:gap-12">
        <div className="min-w-0">
          {/* ── 큰 흐름 ── */}
          <section aria-labelledby="wk-bp">
            <SectionHead id="wk-bp" title={t("bigPicture")} sub={t("bigPictureCount", { count: c.big_picture.length })} />
            <ol>
              {c.big_picture.map((b, i) => (
                <li key={i} className="grid grid-cols-[30px_minmax(0,1fr)] gap-2 border-b border-rule py-5 @min-[640px]:grid-cols-[44px_minmax(0,1fr)]">
                  <span aria-hidden="true" className="text-[22px] font-[760] leading-none text-ink @min-[640px]:text-[30px]">
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-[20px] font-bold leading-[1.38] tracking-[-0.02em] text-ink @min-[640px]:text-[22px]">{b.title}</h3>
                    <p className="mt-2 max-w-[40rem] text-base leading-[1.8] text-ink-2 @min-[640px]:text-[17px]">{b.text}</p>
                    <Chips keys={b.metrics} facts={facts} label={t("metricChips")} />
                    <Sources refs={b.refs} briefing={weekly} className="mt-2" />
                  </div>
                </li>
              ))}
            </ol>
          </section>

          {/* ── 데이터로 본 한 주 ── */}
          <section aria-labelledby="wk-data">
            <SectionHead id="wk-data" title={t("dataSection")} sub={t("dataSectionSub")} />
            <p className="mt-3.5 flex flex-wrap items-center gap-x-3.5 gap-y-1.5 text-[13px] text-ink-2" aria-hidden="true">
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-3 w-3 rounded-[2px] bg-chart-1" />
                {t("legendCur")}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-3 w-3 rounded-[2px] bg-chart-prev" />
                {t("legendPrev")}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="pc-swatch-gap inline-block h-3 w-3 rounded-[2px] border border-ink-3" />
                {t("gap")}
              </span>
            </p>
            <ChartFigure
              testId="chart-daily"
              title={t("chartDaily")}
              desc={dailyDesc}
              tableLabel={t("tableView")}
              render={(W, ids) => <DailyColumns W={W} ids={ids} cur={dayBars} prev={prevBars.length ? prevBars : null} gapLabel={t("gap")} />}
              table={
                <DataTable
                  head={[t("colDay"), t("legendCur"), t("legendPrev")]}
                  rows={v.daily.map((d, i) => [
                    dayLabel(t, d.day, loc),
                    d.incomplete ? t("gapCell", { count: d.count }) : d.count,
                    v.prev_daily[i] ? `${v.prev_daily[i].count} (${formatShortDate(v.prev_daily[i].day, loc)})` : "—",
                  ])}
                />
              }
            />
            <ChartFigure
              testId="chart-entities"
              title={t("chartEntities", { count: ent.length })}
              desc={t("chartEntitiesDesc", { mark: t("cnMark") })}
              tableLabel={t("tableView")}
              note={t("entitiesNote", { count: m.sources.length })}
              render={(W, ids) => (
                <Dumbbell
                  W={W}
                  ids={ids}
                  cnMark={t("cnMark")}
                  rows={ent.map((e) => ({
                    key: e.key,
                    label: e.name_ko,
                    prev: e.prev,
                    cur: e.cur,
                    chg: e.change_pct === null ? null : e.display_change,
                    cn: e.chinese,
                    tip: `${e.name_ko}: ${e.prev} → ${e.cur}${e.change_pct === null ? "" : ` (${e.display_change})`}`,
                  }))}
                />
              )}
              table={
                <DataTable
                  head={[t("colCompany"), t("legendPrev"), t("legendCur"), t("colChange")]}
                  rows={ent.map((e) => [`${e.name_ko}${e.chinese ? ` (${t("cnMark")})` : ""}`, e.prev, e.cur, e.display_change])}
                />
              }
            />
            <div className="grid gap-x-8 @min-[860px]:grid-cols-2">
              {(
                [
                  ["rising", m.terms.rising, t("chartRising"), t("chartRisingDesc")],
                  ["falling", m.terms.falling, t("chartFalling"), t("chartFallingDesc")],
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
                      <DataTable head={[t("colTerm"), t("colPinyin"), t("legendPrev"), t("legendCur")]} rows={rows.map((x) => [x.term, x.pinyin || "—", x.prev, x.cur])} />
                    }
                  />
                ) : null
              )}
            </div>
            <div className="grid gap-x-8 @min-[860px]:grid-cols-2">
              <ChartFigure
                testId="chart-sources"
                title={t("chartSources")}
                desc={t("barsDesc")}
                desktopWidth={420}
                tableLabel={t("tableView")}
                render={(W, ids) => (
                  <BarsTick
                    W={W}
                    ids={ids}
                    rows={m.sources.map((s) => ({
                      key: s.name,
                      label: s.name,
                      cur: s.cur,
                      prev: s.prev,
                      chg: s.display_change,
                      tip: `${s.name}: ${s.cur} (${t("legendPrev")} ${s.prev}${s.change_pct === null ? "" : `, ${s.display_change}`})`,
                    }))}
                  />
                )}
                table={<DataTable head={[t("colSource"), t("legendCur"), t("legendPrev"), t("colChange")]} rows={m.sources.map((s) => [s.name, s.cur, s.prev, s.display_change])} />}
              />
              <ChartFigure
                testId="chart-categories"
                title={t("chartCategories")}
                desc={t("barsDesc")}
                desktopWidth={420}
                tableLabel={t("tableView")}
                render={(W, ids) => (
                  <BarsTick
                    W={W}
                    ids={ids}
                    rows={m.categories.map((s) => ({
                      key: s.name,
                      label: catLabel.get(s.name) ?? s.name,
                      cur: s.cur,
                      prev: s.prev,
                      extra: s.display_share,
                      chg: s.display_change,
                      tip: `${catLabel.get(s.name) ?? s.name}: ${s.cur} (${t("legendPrev")} ${s.prev}${s.change_pct === null ? "" : `, ${s.display_change}`})`,
                    }))}
                  />
                )}
                table={
                  <DataTable
                    head={[t("colCategory"), t("legendCur"), t("colShare"), t("legendPrev"), t("colChange")]}
                    rows={m.categories.map((s) => [catLabel.get(s.name) ?? s.name, s.cur, s.display_share, s.prev, s.display_change])}
                  />
                }
              />
            </div>
            {/* 논조: 차트 대신 숫자 줄 */}
            <div role="group" aria-labelledby="wk-sent" className="grid grid-cols-3 gap-3 border-b border-rule py-4" data-testid="weekly-sentiment">
              <p id="wk-sent" className="col-span-full text-[15.5px] font-bold text-ink">
                {t("sentimentTitle")} <span className="ml-2 text-[13px] font-normal text-ink-3">{t("sentimentSub")}</span>
              </p>
              {m.sentiment.cur.map((s) => (
                <div key={s.name}>
                  <p className="text-[12.5px] font-semibold text-ink-3">{t(`sent_${s.name}` as never)}</p>
                  <p className="text-[22px] font-[740] tracking-[-0.02em] text-ink">{s.display}</p>
                  {m.sentiment.prev && (
                    <p className="text-[12.5px] text-ink-2">{t("sentPrev", { value: m.sentiment.prev.find((p) => p.name === s.name)?.display ?? "—" })}</p>
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
                <Chips keys={c.china_lens.metrics} facts={facts} label={t("metricChips")} />
                <Sources refs={c.china_lens.refs} briefing={weekly} className="mt-2" />
              </>
            )}
            <ChartFigure
              testId="chart-china"
              title={t("chartChina")}
              desc={
                cvo.prev
                  ? t("chartChinaDesc", { foreign: cvo.cur.foreign_pct, china: cvo.cur.china_pct, pforeign: cvo.prev.foreign_pct, pchina: cvo.prev.china_pct })
                  : t("chartChinaDescNoPrev", { foreign: cvo.cur.foreign_pct, china: cvo.cur.china_pct })
              }
              tableLabel={t("tableView")}
              note={c.china_lens ? t("chinaNote") : `${t("chinaNote")} ${t("chinaLensDropped")}`}
              render={(W, ids) => (
                <Dumbbell
                  W={W}
                  ids={ids}
                  unit="%"
                  rows={[
                    { key: "cn", label: t("chinaRowCn"), prev: cvo.prev?.china_pct ?? cvo.cur.china_pct, cur: cvo.cur.china_pct },
                    { key: "fo", label: t("chinaRowFo"), prev: cvo.prev?.foreign_pct ?? cvo.cur.foreign_pct, cur: cvo.cur.foreign_pct },
                  ].map((r) => {
                    const d = Math.round((r.cur - r.prev) * 10) / 10;
                    return { ...r, chg: `${d > 0 ? "+" : ""}${d}%p`, tip: `${r.label}: ${r.prev}% → ${r.cur}%` };
                  })}
                />
              )}
              table={
                <DataTable
                  head={[t("colGroup"), t("legendPrev"), t("legendCur")]}
                  rows={[
                    [t("chinaRowCn"), cvo.prev ? `${cvo.prev.china_pct}%` : "—", `${cvo.cur.china_pct}%`],
                    [t("chinaRowFo"), cvo.prev ? `${cvo.prev.foreign_pct}%` : "—", `${cvo.cur.foreign_pct}%`],
                  ]}
                />
              }
            />
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
                          {e?.name_ko ?? mv.entity}
                          {e?.chinese && (
                            <span className="ml-1.5 rounded-[2px] border border-jade px-[3px] align-[2px] text-[11px] font-bold text-jade" title={t("cnMarkLabel")}>
                              {t("cnMark")}
                            </span>
                          )}
                        </p>
                        {e && (
                          <p className="text-[15px] font-bold text-ink">
                            {t("countUnit", { count: e.cur })}{" "}
                            <span className="text-[12.5px] font-normal text-ink-3">{t("moverSub", { prev: e.prev, change: e.display_change })}</span>
                          </p>
                        )}
                      </div>
                      <p className="mt-1 text-[15px] leading-[1.65] text-ink-2">{mv.text}</p>
                      <Sources refs={mv.refs} briefing={weekly} className="mt-1 text-xs" />
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
                <Sources refs={c.money.refs} briefing={weekly} className="mt-2" />
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
                        <td className="whitespace-nowrap py-2 pr-2.5 text-ink-2">{r.kind}</td>
                        <td className="whitespace-nowrap py-2 pr-2.5 text-right font-bold text-ink">{r.amount}</td>
                        <td className="py-2 leading-normal">
                          <Link href={`/news/${r.id}`} className="rounded-sm text-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                            {r.title_kr}
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
                      <Link href={`/news/${e.primary_id}`} className="rounded-sm text-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        {e.title_kr}
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
              <SectionHead id="wk-next" title={t("watchNext")} />
              <ul>
                {c.watch_next.map((w, i) => (
                  <li key={i} className="border-b border-rule py-3">
                    <p className="text-[15.5px] text-ink">{w.text}</p>
                    <Sources refs={w.refs} briefing={weekly} className="text-xs" />
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
              <h2 className="mb-3 border-b border-rule-strong pb-2 text-sm font-bold text-ink">{t("railTerm")}</h2>
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
              <p className="mt-1.5 text-sm font-bold text-ink">{t("termStat", { cur: term.cur, prev: term.prev })}</p>
              {term.explanation_kr && loc === "ko" && <p className="mt-1.5 text-sm leading-[1.65] text-ink-2">{term.explanation_kr}</p>}
              {c.term?.why && <p className="mt-1.5 text-sm leading-[1.65] text-ink">{c.term.why}</p>}
              {term.pinyin_variants > 1 && loc !== "zh" && <p className="mt-1.5 text-xs leading-normal text-ink-3">{t("pinyinVariants", { count: term.pinyin_variants })}</p>}
            </section>
          )}
          <section className="border-b border-rule pb-4 pt-[22px]">
            <h2 className="mb-3 border-b border-rule-strong pb-2 text-sm font-bold text-ink">{t("railDailies")}</h2>
            <ul className="text-sm" data-testid="weekly-dailies">
              {weekly.dailies.map((d) => {
                const count = v.daily.find((x) => x.day === d.date)?.count ?? 0;
                return (
                  <li key={d.date} className="grid grid-cols-[64px_1fr_auto] gap-2 border-t border-rule py-[7px] first:border-t-0">
                    <span className="text-ink">{t("dailyCellDay", { dow: dow(t, d.date), d: Number(d.date.slice(8, 10)) })}</span>
                    <span className="text-[12.5px] text-ink-3">{t("countUnit", { count })}</span>
                    {d.published ? (
                      <Link href={briefingDatePath(d.date)} className="rounded-sm font-semibold text-jade hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        {t("dailyOpen")}
                      </Link>
                    ) : (
                      <span className="text-[12.5px] text-ink-3">{t("dailyNone")}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
          <section className="border-b border-rule pb-4 pt-[22px]">
            <h2 className="mb-3 border-b border-rule-strong pb-2 text-sm font-bold text-ink">{t("railMethod")}</h2>
            <p className="text-sm leading-[1.65] text-ink-2">{t("methodBody")}</p>
            <p className="mt-1.5 text-xs leading-normal text-ink-3">
              {t("methodMeta", { computed: weekly.metrics_computed_at, prompt: c.meta?.prompt_version ?? "—" })}
            </p>
          </section>
          <section className="border-b border-rule pb-4 pt-[22px]">
            <h2 className="mb-3 border-b border-rule-strong pb-2 text-sm font-bold text-ink">{t("railFixes")}</h2>
            <p className="text-sm leading-[1.65] text-ink-2">{t("fixesNone")}</p>
          </section>
        </aside>
      </div>

      <p className="border-t border-rule pb-12 pt-5 text-[12.5px] leading-[1.7] text-ink-3">{t("footer", { count: outlets.length, outlets: outlets.join("·") })}</p>
    </article>
  );
}
