import { useTranslations } from "next-intl";
import { convertAmountText, type FxLocale, type FxRates } from "@/lib/fx/convert";
import { FxNote } from "@/components/fx/fx-note";
import type { PublicBriefing } from "@/lib/briefing/public";
import { formatDateGroup } from "@/lib/news-utils";
import { outletsOf } from "@/lib/briefing/view";
import type { CardFigure, CardSpec, CardStorySpec } from "@/lib/briefing/card-spec";
import { sectionLabel } from "./briefing-view";
import { GroupLabel } from "./infographic";
import { displayNo, mailStories } from "@/lib/briefing/story-groups";

/*
 * "한 장 요약" 카드 (1080px 폭, 높이는 내용대로). Playwright 가 [data-testid=briefing-card] 를 2배로 찍어 PNG 로 만든다.
 * 사이트 글꼴·색 토큰을 그대로 쓴다 — 강조색 청자 하나 + 회색 (dataviz 색 검사 결과), 값은 글자로 직접.
 * 그림은 card-spec.ts 가 검사한 것만. 숫자 하나뿐인 기사는 큰 숫자만 (채우기용 그림 없음).
 * 밝은 테마로 고정한다 (메일·SNS 에 그대로 나가므로).
 */

const W = 452; // 반 칸 그림 폭
const W_NARROW = 290; // 해외 묶음 세 칸 그림 폭

function Bars({ fig, width }: { fig: Extract<CardFigure, { kind: "bars" }>; width: number }) {
  const labelW = 118;
  const valW = 150;
  const max = Math.max(...fig.items.map((i) => i.value ?? 0));
  const barH = 24;
  const gap = 14;
  const h = fig.items.length * (barH + gap) - gap + 4;
  return (
    <figure>
      <svg viewBox={`0 0 ${width} ${h}`} width={width} height={h} role="img" aria-label={fig.items.map((i) => `${i.label} ${i.raw}`).join(", ")}>
        {fig.items.map((it, i) => {
          const y = i * (barH + gap);
          const w = Math.max(3, ((it.value ?? 0) / max) * (width - labelW - valW));
          const on = i === (fig.emphasis ?? 0);
          return (
            <g key={i}>
              <text x={labelW - 10} y={y + barH / 2 + 5} textAnchor="end" fontSize="14" fill="#43464d">
                {it.label}
              </text>
              <rect x={labelW} y={y} width={w} height={barH} fill={on ? "#0b6457" : "#b9bcc2"} rx="2" />
              <text x={labelW + w + 8} y={y + barH / 2 + 5} fontSize="15" fontWeight="700" fill="#16171a">
                {it.raw}
              </text>
            </g>
          );
        })}
        <line x1={labelW} x2={labelW} y1={0} y2={h - 4} stroke="#16171a" />
      </svg>
    </figure>
  );
}

/** 숫자 줄 — 한 사건을 설명하는 서로 다른 단위의 숫자들. 순서·인과를 뜻하지 않으므로 화살표를 쓰지 않는다 */
function Chain({ fig }: { fig: Extract<CardFigure, { kind: "chain" }> }) {
  const small = fig.items.length > 3;
  return (
    <ol className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${fig.items.length}, minmax(0,1fr))` }}>
      {fig.items.map((it, i) => {
        const on = i === fig.emphasis;
        return (
          <li key={i} className={`flex min-h-[78px] min-w-0 flex-col justify-center px-2 py-2 text-center ${on ? "bg-[#0b6457] text-white" : "bg-[#e3efec] text-[#16171a]"}`}>
            <b className={`${small ? "text-[16px]" : "text-[19px]"} font-[800] leading-tight tracking-[-0.02em] [word-break:keep-all]`}>{it.raw}</b>
            <span className={`mt-1 text-[12.5px] leading-snug ${on ? "text-white/85" : "text-[#43464d]"}`}>{it.label}</span>
          </li>
        );
      })}
    </ol>
  );
}

function Timeline({ fig }: { fig: Extract<CardFigure, { kind: "timeline" }> }) {
  const n = fig.items.length;
  return (
    <ol className="relative grid pt-1" style={{ gridTemplateColumns: `repeat(${n}, minmax(0,1fr))` }}>
      <span aria-hidden="true" className="absolute left-[7px] right-[7px] top-[30px] h-[3px] bg-[#b9bcc2]" />
      {fig.items.map((it, i) => (
        <li key={i} className={`relative flex flex-col ${i === 0 ? "items-start text-left" : i === n - 1 ? "items-end text-right" : "items-center text-center"}`}>
          <b className={`text-[14px] font-bold ${i === 0 ? "text-[#0b6457]" : "text-[#16171a]"}`}>{it.when}</b>
          <span aria-hidden="true" className={`my-1.5 h-[14px] w-[14px] rounded-full border-2 ${i === 0 ? "border-[#0b6457] bg-[#0b6457]" : "border-[#61656e] bg-white"}`} />
          <span className="text-[13px] leading-snug text-[#43464d]">{it.label}</span>
        </li>
      ))}
    </ol>
  );
}

function Figure({ fig, width }: { fig: CardFigure; width: number }) {
  if (fig.kind === "bars") return <Bars fig={fig} width={width} />;
  if (fig.kind === "chain") return <Chain fig={fig} />;
  if (fig.kind === "timeline") return <Timeline fig={fig} />;
  return null;
}

/** narrow = 해외 묶음 세 칸 (칸이 좁아 큰 숫자·그림을 한 단계 작게) */
function StoryCell({ s, spec, briefing, wide, narrow = false, fx }: { s: PublicBriefing["content"]["top_stories"][number]; spec: CardStorySpec | undefined; briefing: PublicBriefing; wide: boolean; narrow?: boolean; fx?: FxRates | null }) {
  const t = useTranslations("briefing");
  const outlets = outletsOf(s.refs, briefing.articles).join(" · ");
  const head = (
    <div className="min-w-0">
      <p className="flex items-baseline gap-2.5 text-[13px] text-[#61656e]">
        <span className="text-[22px] font-[800] leading-none text-[#16171a]">{displayNo(s, briefing.content.top_stories)}</span>
        <span className="font-bold text-[#0b6457]">{sectionLabel(t, s.section)}</span>
        <span>{outlets}</span>
      </p>
      <h3 className={`mt-1.5 ${narrow ? "text-[17px]" : "text-[19.5px]"} font-[750] leading-[1.35] tracking-[-0.02em] text-[#16171a]`}>{s.title}</h3>
      {spec?.big && (
        <p className="mt-2.5 flex flex-wrap items-baseline gap-x-2.5">
          <b className={`${narrow ? "text-[29px]" : "text-[36px]"} font-[800] leading-[1.1] tracking-[-0.03em] text-[#0b6457]`}>{spec.big.raw}</b>
          <span className="text-[14.5px] text-[#43464d]">{spec.big.label}</span>
        </p>
      )}
      {spec?.big && fxText(spec.big.raw, briefing.locale, fx) && (
        <p className="mt-0.5 text-[15px] font-semibold text-[#43464d]" data-testid="card-fx">{fxText(spec.big.raw, briefing.locale, fx)}</p>
      )}
      {spec?.note && <p className="mt-2 text-[13.5px] leading-[1.5] text-[#43464d]">{spec.note}</p>}
    </div>
  );
  const fig = spec?.figure && spec.figure.kind !== "none" ? spec.figure : null;
  if (wide) {
    return (
      <div className={`grid items-center gap-7 border-b border-[#e2e2de] py-5 ${fig ? "grid-cols-[minmax(0,1fr)_520px]" : "grid-cols-1"}`} data-rank={s.rank}>
        {head}
        {fig && <Figure fig={fig} width={520} />}
      </div>
    );
  }
  return (
    <div className="flex h-full min-w-0 flex-col gap-3 border-b border-[#e2e2de] py-5" data-rank={s.rank}>
      {head}
      {fig && <Figure fig={fig} width={narrow ? W_NARROW : W} />}
    </div>
  );
}

/** 큰 숫자가 금액이면 환산 값 (페이지 한눈에 보기와 같은 convertAmountText) */
const fxText = (raw: string, locale: string, fx: FxRates | null | undefined) => (fx ? convertAmountText(raw, locale as FxLocale, fx) : null);

export function BriefingCard({ briefing, spec, fx }: { briefing: PublicBriefing; spec: CardSpec; fx?: FxRates | null }) {
  const t = useTranslations("briefing");
  const tm = useTranslations("meta");
  const c = briefing.content;
  const byRank = new Map(spec.stories.map((s) => [s.rank, s]));
  // 묶은 판(2026-11-09~): 중국 묶음(1위 넓게 + 두 칸) 아래 해외 묶음 세 칸. 예전 판은 그대로 (mailStories: 예전 판은 main = 전부)
  const { main, intl } = mailStories(c.top_stories);
  const grouped = intl.length > 0 || c.top_stories.every((x) => x.group);
  const [first, ...rest] = main;
  const more = c.sections.flatMap((sec) => sec.items.map((it) => ({ section: sec.section, text: it.text }))).slice(0, 6);
  const outlets = outletsOf(Object.keys(briefing.articles), briefing.articles);
  return (
    <div
      data-testid="briefing-card"
      className="w-[1080px] bg-white px-[52px] pb-6 text-[#16171a] [color-scheme:light] [font-feature-settings:'tnum'] [word-break:keep-all]"
    >
      <div className="flex items-baseline justify-between border-b border-[#16171a] border-t-[8px] border-t-[#0b6457] pb-3 pt-5 text-[16.5px]">
        <p>
          <span className="mr-2.5 font-bold text-[#0b6457]">{tm("brand")}</span>
          <b className="text-[18.5px]">{t("kicker")}</b>
        </p>
        <span className="text-[#43464d]">
          {formatDateGroup(briefing.edition_date, briefing.locale)} · {t("tocTitle", { count: c.top_stories.length })}
        </span>
      </div>
      <h1 className="mt-5 text-[40px] font-[800] leading-[1.25] tracking-[-0.03em]">{c.headline}</h1>
      <p className="mt-2.5 max-w-[940px] text-[17px] leading-[1.6] text-[#43464d]">{c.lede}</p>

      {grouped && <GroupLabel group="cn" count={main.length} className="mt-5 text-[16px]" />}
      <div className={`${grouped ? "mt-2" : "mt-5"} border-t-2 border-[#16171a]`}>
        {first && <StoryCell s={first} spec={byRank.get(first.rank)} briefing={briefing} wide fx={fx} />}
        <div className="grid grid-cols-2">
          {rest.map((s, i) => (
            <div key={s.rank} className={i % 2 === 0 ? "border-r border-[#e2e2de] pr-[22px]" : "pl-[22px]"}>
              <StoryCell s={s} spec={byRank.get(s.rank)} briefing={briefing} wide={false} fx={fx} />
            </div>
          ))}
        </div>
      </div>

      {intl.length > 0 && (
        <>
          <GroupLabel group="intl" count={intl.length} className="mt-6 text-[16px]" />
          <div className="mt-2 grid grid-cols-3 border-t-2 border-[#16171a]">
            {intl.map((s, i) => (
              <div key={s.rank} className={`min-w-0 ${i < 2 ? "border-r border-[#e2e2de] pr-[18px]" : ""} ${i > 0 ? "pl-[18px]" : ""}`}>
                <StoryCell s={s} spec={byRank.get(s.rank)} briefing={briefing} wide={false} narrow fx={fx} />
              </div>
            ))}
          </div>
        </>
      )}

      {more.length > 0 && (
        <section className="mt-5">
          <h2 className="border-b border-[#16171a] pb-1.5 text-[16px] font-[750]">{t("moreNews")}</h2>
          <ul className="grid grid-cols-2 gap-x-7">
            {more.map((m, i) => (
              <li key={i} className="border-b border-[#e2e2de] py-2 text-[14.5px] leading-[1.5]">
                <span className="mr-2 text-[13px] font-bold text-[#0b6457]">{sectionLabel(t, m.section)}</span>
                {m.text}
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="mt-6 flex justify-between gap-5 border-t border-[#16171a] pt-2.5 text-[12.5px] text-[#61656e]">
        <span>
          <b className="text-[#16171a]">{t("sources")}</b> {outlets.join("·")} · {t("aiLabel")}
        </span>
        {/* 카드에는 검사(card-spec.ts validate*)를 통과한 숫자만 들어간다 */}
        <span className="whitespace-nowrap">{t("cardChecked")}</span>
      </p>
      {fx && c.top_stories.some((x) => { const b = byRank.get(x.rank)?.big; return b && fxText(b.raw, briefing.locale, fx); }) && (
        <FxNote fx={fx} locale={briefing.locale} className="mt-1 block text-[12.5px] text-[#61656e]" />
      )}
    </div>
  );
}
