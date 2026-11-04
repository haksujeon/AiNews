/**
 * 구독자 아침 메일 (시안, 2026-11-04) — 전날(베이징 날짜) 발행된 데일리 브리핑 한 판을 메일 HTML 로 옮긴다.
 *
 * - 내용은 사이트 브리핑과 같은 판(getPublishedBriefing → hydrate)을 그대로 쓴다: 숨긴 기사 제외·쉬운 AI 설명·히스토리 분석이
 *   화면과 같은 규칙으로 붙은 상태 (Gate 2). 메일이 따로 요약·번역하지 않는다.
 * - 순수 함수: DB·발송 없음. 메일 클라이언트 호환을 위해 표(table) 배치 + 인라인 스타일만 쓴다 (외부 CSS·스크립트 없음).
 * - 제목·머리말은 "오늘"이 아니라 판 날짜("11월 3일(화) 중국 AI 브리핑")로 쓴다 — 아침 7시에 받는 것은 전날 소식이다.
 */
import type { PublicBriefing } from "@/lib/briefing/public";
import type { BriefingLocale } from "@/lib/briefing/types";
import { absoluteUrl } from "@/lib/site";

export interface DailyEmailOptions {
  /** 받는 사람 이름 (없으면 인사 생략) */
  name?: string | null;
  email: string;
  /** 한 번 눌러 끊는 링크 (구독자별 서명 토큰) */
  unsubscribeUrl: string;
}

export interface DailyEmail {
  subject: string;
  /** 받은편지함 목록에 제목 옆으로 보이는 한 줄 */
  preheader: string;
  html: string;
  text: string;
}

const T = {
  ko: {
    brand: "AI 뉴스 · 중국 AI 데일리",
    title: (d: string) => `${d} 중국 AI 브리핑`,
    subject: (d: string, h: string) => `[중국 AI 브리핑] ${d} · ${h}`,
    coverage: (total: number, cited: number) => `전날 공개 기사 ${total}건 중 ${cited}건 정리 · AI 작성`,
    hello: (n: string) => `${n}님, 좋은 아침입니다.`,
    intro: "어제 중국 AI 업계에서 있었던 주요 소식을 정리해 드립니다.",
    top: "주요 기사",
    why: "왜 중요한가",
    easy: "쉬운 AI 설명",
    story: "회사·관련 주제 히스토리 분석 (시범)",
    storyLink: "사이트에서 지난 흐름 보기",
    onSite: "자세히 보기",
    original: "원문",
    numbers: "숫자로 보는 어제",
    sections: "분야별 소식",
    companies: "주목할 기업",
    term: "어제의 용어",
    cta: "사이트에서 브리핑 전체 보기",
    footReason: (e: string) => `${e} 주소로 '중국 AI 데일리'를 구독하셔서 보내 드리는 메일입니다. 매일 아침 7시(한국 시각)에 전날 소식을 보냅니다.`,
    footAi: "브리핑은 공개된 중국 매체 보도를 바탕으로 AI가 작성하고, 숫자·인용은 근거 기사와 대조해 검사합니다.",
    unsub: "수신 거부",
    unsubNote: "열리는 화면에서 버튼 한 번으로 발송을 멈출 수 있습니다.",
    sender: "보낸 곳: AI 뉴스 (news.aibaseclub.com) · 문의는 이 메일에 회신해 주세요.",
    section: { models: "모델", products: "제품", funding: "투자", chips: "칩·반도체", policy: "정책", safety: "안전", robotics: "로봇", research: "연구", industry: "산업" } as Record<string, string>,
    dow: ["일", "월", "화", "수", "목", "금", "토"],
    date: (m: number, d: number, w: string) => `${m}월 ${d}일(${w})`,
    range: (m: number, d1: number, w1: string, d2: number, w2: string) => `${m}월 ${d1}일(${w1})~${d2}일(${w2})`,
  },
  zh: {
    brand: "AI 新闻 · 中国AI日报",
    title: (d: string) => `${d} 中国AI简报`,
    subject: (d: string, h: string) => `【中国AI简报】${d} · ${h}`,
    coverage: (total: number, cited: number) => `从前一天 ${total} 篇公开报道中整理 ${cited} 篇 · AI撰写`,
    hello: (n: string) => `${n}，早上好。`,
    intro: "为您整理昨天中国AI行业的主要动态。",
    top: "要闻",
    why: "为何重要",
    easy: "AI 术语通俗讲",
    story: "公司与相关主题历史分析（试用）",
    storyLink: "在网站上查看过往脉络",
    onSite: "查看详情",
    original: "原文",
    numbers: "数字看昨天",
    sections: "分领域动态",
    companies: "值得关注的公司",
    term: "昨日术语",
    cta: "在网站上阅读完整简报",
    footReason: (e: string) => `您以 ${e} 订阅了“中国AI日报”，因此收到本邮件。每天早上7点（韩国时间）发送前一天的动态。`,
    footAi: "简报由 AI 根据公开的中国媒体报道撰写，数字和引用均与来源文章核对。",
    unsub: "退订",
    unsubNote: "在打开的页面上点击一次按钮即可停止发送。",
    sender: "发件方：AI 新闻（news.aibaseclub.com）· 如有疑问请直接回复本邮件。",
    section: { models: "模型", products: "产品", funding: "投融资", chips: "芯片", policy: "政策", safety: "安全", robotics: "机器人", research: "研究", industry: "产业" } as Record<string, string>,
    dow: ["日", "一", "二", "三", "四", "五", "六"],
    date: (m: number, d: number, w: string) => `${m}月${d}日（周${w}）`,
    range: (m: number, d1: number, w1: string, d2: number, w2: string) => `${m}月${d1}日（周${w1}）至${d2}日（周${w2}）`,
  },
  en: {
    brand: "AI News · China AI Daily",
    title: (d: string) => `China AI Briefing · ${d}`,
    subject: (d: string, h: string) => `[China AI Briefing] ${d} · ${h}`,
    coverage: (total: number, cited: number) => `${cited} of ${total} public articles from the previous day · AI-written`,
    hello: (n: string) => `Good morning, ${n}.`,
    intro: "Here is what happened in China's AI industry yesterday.",
    top: "Top stories",
    why: "Why it matters",
    easy: "AI terms, simply",
    story: "Company & topic history (beta)",
    storyLink: "See the background on the site",
    onSite: "Read more",
    original: "Source",
    numbers: "Yesterday in numbers",
    sections: "By sector",
    companies: "Companies to watch",
    term: "Term of the day",
    cta: "Read the full briefing on the site",
    footReason: (e: string) => `You receive this because ${e} subscribed to China AI Daily. It arrives every morning at 7:00 KST with the previous day's news.`,
    footAi: "Written by AI from public Chinese media reports; numbers and quotes are checked against the source articles.",
    unsub: "Unsubscribe",
    unsubNote: "One button on the page that opens stops all emails.",
    sender: "From: AI News (news.aibaseclub.com) · Reply to this email with any questions.",
    section: { models: "Models", products: "Products", funding: "Funding", chips: "Chips", policy: "Policy", safety: "Safety", robotics: "Robotics", research: "Research", industry: "Industry" } as Record<string, string>,
    dow: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
    date: (m: number, d: number, w: string) => `${w}, ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]} ${d}`,
    range: (m: number, d1: number, w1: string, d2: number, w2: string) => `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]} ${d1}–${d2} (${w1}–${w2})`,
  },
} satisfies Record<BriefingLocale, unknown>;

const C = {
  ink: "#1f2a2e",
  sub: "#5b6b70",
  faint: "#8a979b",
  line: "#e3e8e6",
  bg: "#f3f5f4",
  card: "#ffffff",
  jade: "#0f7a64",
  jadeSoft: "#e7f3ef",
  amberSoft: "#fbf4e6",
  amber: "#8a5a00",
};
const FONT = `-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Malgun Gothic','PingFang SC','Microsoft YaHei',sans-serif`;

const esc = (s: string | null | undefined) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** "2026-11-03" → 그 언어 날짜 ("11월 3일(화)"). 합본(period_end 다름)은 범위 */
export function editionDateLabel(locale: BriefingLocale, start: string, end?: string): string {
  const t = T[locale];
  const p = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return { m, d, w: t.dow[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] };
  };
  const a = p(start);
  if (!end || end === start) return t.date(a.m, a.d, a.w);
  const b = p(end);
  return a.m === b.m ? t.range(a.m, a.d, a.w, b.d, b.w) : `${t.date(a.m, a.d, a.w)} ~ ${t.date(b.m, b.d, b.w)}`;
}

function heading(text: string) {
  return `<tr><td style="padding:28px 28px 10px;font:700 13px/1.4 ${FONT};letter-spacing:.04em;color:${C.jade};text-transform:uppercase">${esc(text)}</td></tr>`;
}

function link(href: string | null | undefined, text: string, color = C.jade) {
  if (!href) return "";
  return `<a href="${esc(href)}" style="color:${color};text-decoration:none;font-weight:600">${esc(text)}</a>`;
}

export function renderDailyEmail(b: PublicBriefing, opts: DailyEmailOptions): DailyEmail {
  const t = T[b.locale];
  const c = b.content;
  const dateLabel = editionDateLabel(b.locale, b.edition_date, b.period_end);
  const briefingUrl = absoluteUrl(b.locale, `/briefing/${b.edition_date}`);
  const siteArticle = (id: string) => absoluteUrl(b.locale, `/news/${id}`);
  const art = (id: string) => b.articles[id];
  const sectionName = (s: string) => t.section[s] ?? s;

  const stories = c.top_stories
    .map((s) => {
      const a = art(s.primary_ref);
      const easy = (s.easy_terms ?? []).slice(0, 2);
      const easyHtml = easy.length
        ? `<tr><td style="padding:12px 0 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.amberSoft};border-radius:8px"><tr><td style="padding:10px 14px;font:13px/1.6 ${FONT};color:${C.ink}">
            <div style="font-weight:700;color:${C.amber};margin-bottom:2px">${esc(t.easy)}</div>
            ${easy.map((e) => `<div><b>${esc(e.name)}</b>${e.term && e.term !== e.name ? ` <span style="color:${C.faint}">${esc(e.term)}</span>` : ""} — ${esc(e.easy)}</div>`).join("")}
          </td></tr></table></td></tr>`
        : "";
      const storyHtml = s.story_context?.length
        ? `<tr><td style="padding:10px 0 0;font:13px/1.6 ${FONT};color:${C.sub}">🕘 ${esc(t.story)}: ${esc(s.story_context.map((x) => x.title).join(" · "))} — ${link(`${briefingUrl}#story-${s.rank}`, t.storyLink + " →")}</td></tr>`
        : "";
      const links = [link(siteArticle(s.primary_ref), t.onSite + " →"), a?.source_url ? link(a.source_url, `${t.original} · ${a.source_name}`, C.sub) : ""]
        .filter(Boolean)
        .join(`<span style="color:${C.line}">&nbsp;&nbsp;|&nbsp;&nbsp;</span>`);
      return `<tr><td style="padding:0 28px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${C.line}"><tr><td style="padding:20px 0">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr><td style="font:600 12px/1.4 ${FONT};color:${C.faint}"><span style="display:inline-block;background:${C.jade};color:#fff;border-radius:10px;padding:1px 8px;margin-right:6px">${s.rank}</span>${esc(sectionName(s.section))} · ${esc(s.subject)}</td></tr>
          <tr><td style="padding:8px 0 0;font:700 18px/1.45 ${FONT};color:${C.ink}"><a href="${esc(siteArticle(s.primary_ref))}" style="color:${C.ink};text-decoration:none">${esc(s.title)}</a></td></tr>
          <tr><td style="padding:8px 0 0;font:15px/1.7 ${FONT};color:${C.ink}">${esc(s.what)}</td></tr>
          <tr><td style="padding:12px 0 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.jadeSoft};border-left:3px solid ${C.jade};border-radius:0 8px 8px 0"><tr><td style="padding:10px 14px;font:14px/1.65 ${FONT};color:${C.ink}"><b style="color:${C.jade}">${esc(t.why)}</b><br>${esc(s.why)}</td></tr></table></td></tr>
          ${easyHtml}
          ${storyHtml}
          <tr><td style="padding:12px 0 0;font:13px/1.5 ${FONT}">${links}</td></tr>
        </table></td></tr></table></td></tr>`;
    })
    .join("");

  const numbers = c.key_numbers.length
    ? heading(t.numbers) +
      `<tr><td style="padding:0 28px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${c.key_numbers
        .map(
          (k) =>
            `<tr><td style="padding:8px 0;border-top:1px solid ${C.line};width:34%;vertical-align:top;font:700 17px/1.4 ${FONT};color:${C.jade}">${esc(k.value)}</td><td style="padding:8px 0 8px 12px;border-top:1px solid ${C.line};font:14px/1.55 ${FONT};color:${C.ink}"><a href="${esc(siteArticle(k.ref))}" style="color:${C.ink};text-decoration:none">${esc(k.label)}</a></td></tr>`
        )
        .join("")}</table></td></tr>`
    : "";

  const sections = c.sections.length
    ? heading(t.sections) +
      `<tr><td style="padding:0 28px">${c.sections
        .map(
          (sec) =>
            `<div style="padding:8px 0;border-top:1px solid ${C.line}"><div style="font:700 13px/1.5 ${FONT};color:${C.sub};padding-bottom:2px">${esc(sectionName(sec.section))}</div>${sec.items
              .map(
                (it) =>
                  `<div style="font:14px/1.65 ${FONT};color:${C.ink};padding:2px 0">· <a href="${esc(siteArticle(it.refs[0]))}" style="color:${C.ink};text-decoration:none">${esc(it.text)}</a></div>`
              )
              .join("")}</div>`
        )
        .join("")}</td></tr>`
    : "";

  const companies = c.companies_to_watch.length
    ? heading(t.companies) +
      `<tr><td style="padding:0 28px;font:14px/1.65 ${FONT};color:${C.ink}">${c.companies_to_watch
        .map((co) => `<div style="padding:6px 0;border-top:1px solid ${C.line}"><b>${esc(co.name)}</b> <span style="color:${C.sub}">— ${esc(co.why)}</span></div>`)
        .join("")}</td></tr>`
    : "";

  const term = c.term_of_the_day
    ? heading(t.term) +
      `<tr><td style="padding:0 28px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${C.line};border-radius:8px"><tr><td style="padding:12px 16px;font:14px/1.65 ${FONT};color:${C.ink}"><span style="font-size:18px;font-weight:700">${esc(c.term_of_the_day.term)}</span> <span style="color:${C.faint}">${esc(c.term_of_the_day.pinyin)}</span><br>${esc(c.term_of_the_day.explanation ?? "")}</td></tr></table></td></tr>`
    : "";

  const total = c.meta.candidate_count;
  const cited = c.meta.cited_count;
  const preheader = c.lede;
  const subject = t.subject(dateLabel, c.headline);

  const html = `<!doctype html>
<html lang="${b.locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:${C.bg}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:${C.card};border-radius:12px;overflow:hidden">
  <tr><td style="padding:22px 28px 0;font:700 12px/1.4 ${FONT};letter-spacing:.06em;color:${C.jade}">${esc(t.brand)}</td></tr>
  <tr><td style="padding:6px 28px 0;font:800 24px/1.35 ${FONT};color:${C.ink}">${esc(t.title(dateLabel))}</td></tr>
  <tr><td style="padding:6px 28px 0;font:13px/1.5 ${FONT};color:${C.faint}">${esc(t.coverage(total, cited))}</td></tr>
  <tr><td style="padding:20px 28px 0;font:15px/1.7 ${FONT};color:${C.sub}">${opts.name ? esc(t.hello(opts.name)) + " " : ""}${esc(t.intro)}</td></tr>
  <tr><td style="padding:16px 28px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.jadeSoft};border-radius:10px"><tr><td style="padding:16px 18px">
    <div style="font:800 19px/1.45 ${FONT};color:${C.ink}">${esc(c.headline)}</div>
    <div style="padding-top:8px;font:15px/1.7 ${FONT};color:${C.ink}">${esc(c.lede)}</div>
  </td></tr></table></td></tr>
  ${heading(t.top)}
  ${stories}
  ${numbers}
  ${sections}
  ${companies}
  ${term}
  <tr><td align="center" style="padding:32px 28px 28px"><a href="${esc(briefingUrl)}" style="display:inline-block;background:${C.jade};color:#fff;text-decoration:none;font:700 15px/1 ${FONT};padding:14px 26px;border-radius:8px">${esc(t.cta)} →</a></td></tr>
</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px"><tr><td style="padding:18px 20px;font:12px/1.7 ${FONT};color:${C.faint}">
  ${esc(t.footReason(opts.email))}<br>${esc(t.footAi)}<br>
  <a href="${esc(opts.unsubscribeUrl)}" style="color:${C.sub};font-weight:700">${esc(t.unsub)}</a> — ${esc(t.unsubNote)}<br>${esc(t.sender)}
</td></tr></table>
</td></tr></table>
</body></html>`;

  const text = [
    t.title(dateLabel),
    t.coverage(total, cited),
    "",
    c.headline,
    c.lede,
    "",
    ...c.top_stories.flatMap((s) => [`${s.rank}. ${s.title}`, s.what, `${t.why}: ${s.why}`, siteArticle(s.primary_ref), ""]),
    `${t.cta}: ${briefingUrl}`,
    "",
    `${t.unsub}: ${opts.unsubscribeUrl}`,
  ].join("\n");

  return { subject, preheader, html, text };
}
