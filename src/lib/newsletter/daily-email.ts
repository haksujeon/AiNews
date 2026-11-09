/**
 * 구독자 아침 메일 (2026-11-04, 화면 개편: PC 880px · 휴대폰 한 칸 · 목차 · 히스토리 분석 요약형) — 전날(베이징 날짜) 발행된 데일리 브리핑 한 판을 메일 HTML 로 옮긴다.
 *
 * - 내용은 사이트 브리핑과 같은 판(getPublishedBriefing → hydrate)을 그대로 쓴다: 숨긴 기사 제외·쉬운 AI 설명·히스토리 분석이
 *   화면과 같은 규칙으로 붙은 상태 (Gate 2). 메일이 따로 요약·번역하지 않는다.
 * - 순수 함수: DB·발송 없음. 메일 클라이언트 호환을 위해 표(table) 배치 + 인라인 스타일만 쓴다 (외부 CSS·스크립트 없음).
 * - 리드 아래 "한눈에 보기"(2026-11-07 사용자 결정 "반영"): 사이트 브리핑 페이지와 같은 buildGlance·카드 명세(card-spec.json)로 다섯 칸(PC)·다섯 줄(휴대폰).
 *   사이트 안 A 와 같이 목차·숫자로 보는 하루·한 장 요약 그림을 이 블록 하나로 합쳤다 (Gate 2).
 * - 주요 기사 묶음(2026-11-09 사용자 결정 "반영"): 묶은 판은 중국 묶음만 본문으로 싣고, 해외 묶음(최대 3건)은 제목만 보여 주며
 *   사이트(브리핑 페이지 #intl)로 보낸다. 묶음·번호는 사이트와 같은 story-groups.ts (Gate 2). 예전 판은 그대로 전부 싣는다.
 * - 제목·머리말은 "오늘"이 아니라 판 날짜("11월 3일(화) 중국 AI 브리핑")로 쓴다 — 아침 7시에 받는 것은 전날 소식이다.
 */
import type { PublicBriefing } from "@/lib/briefing/public";
import type { BriefingLocale, StoryContext } from "@/lib/briefing/types";
import { absoluteUrl } from "@/lib/site";
import { buildGlance } from "@/lib/briefing/glance";
import type { BigNumber, CardFigure, CardSpec } from "@/lib/briefing/card-spec";
import { convertAmountText, fxFootnoteParts, type FxLocale } from "@/lib/fx/convert";
import type { Currency } from "@/lib/briefing/quantity";
import { INTL_ANCHOR, displayNo, mailStories } from "@/lib/briefing/story-groups";

export interface DailyEmailOptions {
  /** 받는 사람 이름 (없으면 인사 생략) */
  name?: string | null;
  email: string;
  /** 한 번 눌러 끊는 링크 (구독자별 서명 토큰) */
  unsubscribeUrl: string;
  /** 카드 그림 명세 (한눈에 보기 큰 숫자·그림). 없으면 판의 숫자로 보는 하루 값으로 채운다 (glance.ts) */
  cardSpec?: CardSpec | null;
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
    story: "회사·관련 주제 히스토리 분석",
    beta: "시범",
    lens: { company: "회사 흐름", topic: "관련 주제 흐름" } as Record<string, string>,
    now: "이번 기사",
    earlier: (d: string, n: number) => `${d}부터 ${n}건 더`,
    storyMore: (n: number) => `지난 흐름 ${n}건 전체와 근거 기사 보기`,
    storyLink: "사이트에서 지난 흐름 보기",
    listen: (m: number) => `▶ ${m}분 듣기 · AI 음성`,
    glance: "한눈에 보기",
    glanceCount: (n: number) => `주요 ${n}건`,
    intlTitle: "해외 주요 기사",
    intlCount: (n: number) => `${n}건 · 사이트에서 보기`,
    intlNo: (n: number) => `해외 ${n}`,
    intlMore: "해외 기사 자세히 보기",
    storyNote: "히스토리 분석은 지난 보도를 AI가 날짜순으로 엮은 시범 기능이며, 항목마다 근거 기사가 있습니다.",
    onSite: "자세히 보기",
    original: "원문",
    sections: "분야별 소식",
    companies: "주목할 기업",
    term: "어제의 용어",
    // 월요일 아침 토·일 합본 (period_end > edition_date) — "어제"가 아니라 주말
    weekend: {
      coverage: (total: number, cited: number) => `주말(토·일) 공개 기사 ${total}건 중 ${cited}건 정리 · AI 작성`,
      intro: "지난 주말(토·일) 중국 AI 업계에서 있었던 주요 소식을 정리해 드립니다.",
      term: "주말의 용어",
    },
    cta: "사이트에서 브리핑 전체 보기",
    footReason: (e: string) => `${e} 주소로 '중국 AI 데일리'를 구독하셔서 보내 드리는 메일입니다. 매일 아침 7시(한국 시각)에 전날 소식을 보냅니다(월요일은 토·일 합본).`,
    footAi: "브리핑은 공개된 중국 매체 보도를 바탕으로 AI가 작성하고, 숫자·인용은 근거 기사와 대조해 검사합니다.",
    // 금액 환산 각주 (사이트 briefing.fxNote 와 같은 문구)
    fxNote: (d: string, r: string) => `괄호 안 ‘약 …원’은 ${d} ECB 기준 환율(${r})로 바꾼 참고값입니다.`,
    fxRate: (from: Currency, rate: string) => `${({ USD: "1달러", CNY: "1위안", HKD: "1홍콩달러", JPY: "1엔", EUR: "1유로", KRW: "1원" } as const)[from]} = ${rate}원`,
    unsub: "수신 거부",
    unsubNote: "열리는 화면에서 버튼 한 번으로 발송을 멈출 수 있습니다.",
    recommend: "동료에게 추천하기 (구독 신청 화면)",
    forwarded: "이 메일을 전달받으셨나요?",
    forwardedCta: "직접 받아 보기",
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
    story: "公司与相关主题历史分析",
    beta: "试用",
    lens: { company: "公司脉络", topic: "相关主题脉络" } as Record<string, string>,
    now: "本条新闻",
    earlier: (d: string, n: number) => `${d}起还有 ${n} 条`,
    storyMore: (n: number) => `查看全部 ${n} 条过往脉络和来源文章`,
    storyLink: "在网站上查看过往脉络",
    listen: (m: number) => `▶ 收听 ${m}分钟 · AI 语音`,
    glance: "一览",
    glanceCount: (n: number) => `要闻${n}条`,
    intlTitle: "海外要闻",
    intlCount: (n: number) => `${n}条 · 在网站上查看`,
    intlNo: (n: number) => `海外${n}`,
    intlMore: "查看海外要闻详情",
    storyNote: "历史分析由 AI 按时间顺序整理过往报道，为试用功能，每一条都有来源文章。",
    onSite: "查看详情",
    original: "原文",
    sections: "分领域动态",
    companies: "值得关注的公司",
    term: "昨日术语",
    weekend: {
      coverage: (total: number, cited: number) => `从周末（周六、周日）${total} 篇公开报道中整理 ${cited} 篇 · AI撰写`,
      intro: "为您整理上周末（周六、周日）中国AI行业的主要动态。",
      term: "周末术语",
    },
    cta: "在网站上阅读完整简报",
    footReason: (e: string) => `您以 ${e} 订阅了“中国AI日报”，因此收到本邮件。每天早上7点（韩国时间）发送前一天的动态（周一为周六、周日合刊）。`,
    footAi: "简报由 AI 根据公开的中国媒体报道撰写，数字和引用均与来源文章核对。",
    fxNote: (d: string, r: string) => `括号内“约…元”按${d}欧洲央行参考汇率（${r}）换算，仅供参考。`,
    fxRate: (from: Currency, rate: string) => `${({ USD: "1美元", CNY: "1元", HKD: "1港元", JPY: "1日元", EUR: "1欧元", KRW: "1韩元" } as const)[from]} = ${rate}元`,
    unsub: "退订",
    unsubNote: "在打开的页面上点击一次按钮即可停止发送。",
    recommend: "推荐给同事（订阅页面）",
    forwarded: "这封邮件是转发给您的吗？",
    forwardedCta: "直接订阅",
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
    story: "Company & topic history",
    beta: "beta",
    lens: { company: "Company thread", topic: "Related topic" } as Record<string, string>,
    now: "This story",
    earlier: (d: string, n: number) => `${n} more since ${d}`,
    storyMore: (n: number) => `See all ${n} past events and sources`,
    storyLink: "See the background on the site",
    listen: (m: number) => `▶ Listen · ${m} min · AI audio`,
    glance: "At a glance",
    glanceCount: (n: number) => `Top ${n}`,
    intlTitle: "Global top stories",
    intlCount: (n: number) => `${n} · on the site`,
    intlNo: (n: number) => `Global ${n}`,
    intlMore: "Read the global stories",
    storyNote: "The history analysis is a beta feature: AI arranges past reports by date, and every entry cites a source article.",
    onSite: "Read more",
    original: "Source",
    sections: "By sector",
    companies: "Companies to watch",
    term: "Term of the day",
    weekend: {
      coverage: (total: number, cited: number) => `${cited} of ${total} public articles from the weekend (Sat–Sun) · AI-written`,
      intro: "Here is what happened in China's AI industry over the weekend.",
      term: "Term of the weekend",
    },
    cta: "Read the full briefing on the site",
    footReason: (e: string) => `You receive this because ${e} subscribed to China AI Daily. It arrives every morning at 7:00 KST with the previous day's news (Mondays: Sat–Sun combined).`,
    footAi: "Written by AI from public Chinese media reports; numbers and quotes are checked against the source articles.",
    fxNote: (d: string, r: string) => `Figures marked “about $…” are converted at the ECB reference rate of ${d} (${r}), for reference only.`,
    fxRate: (from: Currency, rate: string) => `${({ USD: "$1", CNY: "1 yuan", HKD: "HK$1", JPY: "¥1", EUR: "€1", KRW: "1 won" } as const)[from]} = $${rate}`,
    unsub: "Unsubscribe",
    unsubNote: "One button on the page that opens stops all emails.",
    recommend: "Recommend to a colleague (signup page)",
    forwarded: "Was this email forwarded to you?",
    forwardedCta: "Get it yourself",
    sender: "From: AI News (news.aibaseclub.com) · Reply to this email with any questions.",
    section: { models: "Models", products: "Products", funding: "Funding", chips: "Chips", policy: "Policy", safety: "Safety", robotics: "Robotics", research: "Research", industry: "Industry" } as Record<string, string>,
    dow: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
    date: (m: number, d: number, w: string) => `${w}, ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]} ${d}`,
    range: (m: number, d1: number, w1: string, d2: number, w2: string) => `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]} ${d1}–${d2} (${w1}–${w2})`,
  },
} satisfies Record<BriefingLocale, unknown>;

/** 메일 색·글꼴 — 아침 메일과 구독 확인·환영 메일(signup-email.ts)이 같이 쓴다 */
export const C = {
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
  hist: "#f6f8f7",
};
export const FONT = `-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Malgun Gothic','PingFang SC','Microsoft YaHei',sans-serif`;

export const esc = (s: string | null | undefined) =>
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

/** PC 본문 폭 (2026-11-04 사용자 결정 880px). 480px 이하(휴대폰)는 한 칸 — 620 에서 낮춤: 전달 팝업·좁은 읽기 창에서도 2열 (사용자 결정 2026-11-04) · 좌우 18px */
export const MAIL_WIDTH = 880;
/** Gmail 은 HTML 102KB 를 넘으면 잘라서 아래(수신 거부 포함)를 숨긴다 → 넘으면 뒤 기사부터 히스토리를 줄인다 */
export const MAIL_SIZE_LIMIT = 95_000;
/** 메일 히스토리 연대기는 최근 몇 건만 (요약형, 사용자 결정 2026-11-04). 앞선 항목은 "N건 더" + 사이트 링크 */
export const MAIL_TIMELINE_RECENT = 3;
const PX = 44;

type Tr = (typeof T)[BriefingLocale];

function heading(text: string) {
  return `<tr><td class="px" style="padding:30px ${PX}px 10px;font:700 13px/1.4 ${FONT};letter-spacing:.04em;color:${C.jade};text-transform:uppercase">${esc(text)}</td></tr>`;
}

function link(href: string | null | undefined, text: string, color = C.jade) {
  if (!href) return "";
  return `<a href="${esc(href)}" style="color:${color};text-decoration:none;font-weight:600">${esc(text)}</a>`;
}

const md = (d: string) => d.slice(5).replace("-", ".");

/** 히스토리 한 관점 (배경 → "N건 더" → 최근 3건 → 이번 기사) */
function lensBlock(t: Tr, x: StoryContext, siteArticle: (id: string) => string) {
  const recent = x.timeline.slice(-MAIL_TIMELINE_RECENT);
  const hidden = x.timeline.length - recent.length;
  const row = (left: string, right: string, strong = false) =>
    `<tr><td style="width:46px;vertical-align:top;font:12px/1.6 ui-monospace,Menlo,monospace;color:${strong ? C.jade : C.faint};border-left:2px solid ${strong ? C.jade : "#9fcfc2"};padding:0 0 8px 10px">${left}</td><td style="vertical-align:top;font:13.5px/1.6 ${FONT};color:${C.ink};padding:0 0 8px">${right}</td></tr>`;
  return `<div style="font:700 11.5px/1.4 ${FONT};letter-spacing:.03em;color:${C.jade}">${esc(t.lens[x.lens] ?? x.lens)}</div>
  <div style="padding-top:3px;font:700 15px/1.45 ${FONT};color:${C.ink}">${esc(x.title)}</div>
  <div style="padding-top:6px;font:13.5px/1.65 ${FONT};color:${C.sub}">${esc(x.background)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px">${
    hidden ? row("⋯", `<span style="color:${C.faint};font-size:12.5px">${esc(t.earlier(md(x.timeline[0].date), hidden))}</span>`) : ""
  }${recent
    .map((it) => row(md(it.date), `<a href="${esc(siteArticle(it.refs[0].id))}" style="color:${C.ink};text-decoration:none">${esc(it.text)}</a>`))
    .join("")}${row("◆", `<b style="color:${C.jade}">${esc(t.now)}</b> ${esc(x.now)}`, true)}</table>${
    x.caution ? `<div style="padding-top:4px;font:12px/1.55 ${FONT};color:${C.faint}">※ ${esc(x.caution)}</div>` : ""
  }`;
}

/** 기사 하나의 히스토리 상자. full=false 면 흐름 제목 한 줄 + 링크 (크기 초과 때) */
function historyBlock(t: Tr, ctx: StoryContext[] | undefined, href: string, full: boolean, siteArticle: (id: string) => string) {
  if (!ctx?.length) return "";
  const total = ctx.reduce((n, x) => n + x.timeline.length, 0);
  const head = `<div style="font:700 13px/1.4 ${FONT};color:${C.ink};padding-bottom:${full ? 10 : 4}px">🕘 ${esc(t.story)} <span style="display:inline-block;font:600 11px/1.5 ${FONT};color:${C.faint};border:1px solid ${C.line};border-radius:3px;padding:0 5px;margin-left:4px">${esc(t.beta)}</span></div>`;
  const body = !full
    ? `<div style="font:13px/1.6 ${FONT};color:${C.sub}">${esc(ctx.map((x) => x.title).join(" · "))}</div>`
    : ctx.length > 1
      ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${ctx
          .map((x, i) => `<td class="col" width="50%" style="vertical-align:top;padding:${i ? "0 0 0 14px" : "0 14px 0 0"};${i ? `border-left:1px solid ${C.line};` : ""}">${lensBlock(t, x, siteArticle)}</td>`)
          .join("")}</tr></table>`
      : lensBlock(t, ctx[0], siteArticle);
  return `<tr><td style="padding:14px 0 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.hist};border:1px solid ${C.line};border-radius:8px"><tr><td style="padding:14px 16px 12px">
    ${head}${body}
    <div style="padding-top:10px;margin-top:10px;border-top:1px solid ${C.line};font:12.5px/1.5 ${FONT}">${link(href, (full ? t.storyMore(total) : t.storyLink) + " →")}</div>
  </td></tr></table></td></tr>`;
}

/** 분야 색 (사이트 globals.css --sec-* 밝은 테마 값). 메일은 아이콘(SVG)을 못 쓰므로 색 ■ + 분야 이름 */
const SEC_COLOR: Record<string, string> = { funding: "#2f7d5b", products: "#4a6a8c", models: "#7a5a8c", robotics: "#8a6d3b", industry: "#5f6b73", research: "#8a4f5f", chips: "#3f7480", policy: "#7a6a3f", safety: "#9a5a2f" };
const GRAY = "#eef1f0";
function gBig(big: BigNumber, px: number) {
  const size = big.raw.length > 14 ? Math.round(px * 0.8) : px;
  if (big.dir) {
    const up = big.dir === "up";
    return `<span style="display:inline-block;background:${up ? C.jadeSoft : GRAY};color:${up ? C.jade : C.sub};border-radius:3px;padding:0 4px;font:800 ${size}px/1.2 ${FONT}"><span style="font-size:.6em;vertical-align:.15em">${up ? "▲" : "▼"}</span> ${esc(big.raw)}</span>`;
  }
  return `<span style="font:800 ${size}px/1.2 ${FONT};color:${C.jade}">${esc(big.raw)}</span>`;
}
function gBar(pct: number, color: string, h: number) {
  const w = Math.min(100, Math.max(2, Math.round(pct)));
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${C.line}"><tr><td width="${w}%" height="${h}" style="background:${color};font-size:0;line-height:0">&nbsp;</td>${w < 100 ? `<td style="background:${GRAY};font-size:0;line-height:0">&nbsp;</td>` : ""}</tr></table>`;
}
/** 휴대폰 한 줄: 큰 숫자가 없는 칸의 일정·숫자 목록 (사이트 InfographicRow 와 같은 규칙) */
function gFigureLine(fig: CardFigure) {
  if (fig.kind === "timeline") return fig.items.map((x) => x.when).join(" → ");
  if (fig.kind === "chain") return fig.items.map((x) => x.raw).join(" · ");
  return "";
}
function gFigure(fig: CardFigure) {
  if (fig.kind === "bars") {
    const max = Math.max(...fig.items.map((i) => i.value ?? 0)) || 1;
    return fig.items.map((it, i) => {
      const on = i === (fig.emphasis ?? 0);
      return `<div style="padding-top:6px;font:12px/1.4 ${FONT};color:${C.sub}">${esc(it.label)} <b style="color:${on ? C.jade : C.ink}">${esc(it.raw)}</b></div>${gBar(((it.value ?? 0) / max) * 100, on ? C.jade : "#b9c4c1", 7)}`;
    }).join("");
  }
  if (fig.kind === "chain")
    return fig.items.map((it, i) => `<div style="margin-top:5px;padding-left:7px;border-left:2px solid ${i === fig.emphasis ? C.jade : C.line};font:12px/1.45 ${FONT};color:${C.sub}"><b style="color:${i === fig.emphasis ? C.jade : C.ink}">${esc(it.raw)}</b> ${esc(it.label)}</div>`).join("");
  if (fig.kind === "timeline")
    return fig.items.map((it, i) => `<div style="margin-top:5px;padding-left:8px;border-left:2px solid ${i === 0 ? C.jade : "#b9c4c1"};font:12px/1.45 ${FONT};color:${C.sub}"><b style="color:${i === 0 ? C.jade : C.ink}">${esc(it.when)}</b><br>${esc(it.label)}</div>`).join("");
  return "";
}

export function renderDailyEmail(b: PublicBriefing, opts: DailyEmailOptions): DailyEmail {
  // 요약형으로 그려 보고, 102KB 잘림에 가까우면 뒤 기사부터 히스토리를 한 줄로 줄인다
  const n = mailStories(b.content.top_stories).main.length;
  let mail = renderWith(b, opts, n);
  for (let fullUpTo = n - 1; fullUpTo >= 0 && Buffer.byteLength(mail.html) > MAIL_SIZE_LIMIT; fullUpTo--) mail = renderWith(b, opts, fullUpTo);
  return mail;
}

/** fullUpTo: 앞에서 몇 번째 기사까지 히스토리를 요약형으로 (나머지는 한 줄) */
function renderWith(b: PublicBriefing, opts: DailyEmailOptions, fullUpTo: number): DailyEmail {
  const base = T[b.locale];
  // 토·일 합본(월요일 아침 메일)은 "어제" 대신 주말 문구 (판 범위 = period_start~period_end, sla.ts)
  const weekend = !!b.period_end && b.period_end !== b.edition_date;
  const t = weekend ? { ...base, ...base.weekend } : base;
  const c = b.content;
  const dateLabel = editionDateLabel(b.locale, b.edition_date, b.period_end);
  const briefingUrl = absoluteUrl(b.locale, `/briefing/${b.edition_date}`);
  const siteArticle = (id: string) => absoluteUrl(b.locale, `/news/${id}`);
  const art = (id: string) => b.articles[id];
  const sectionName = (s: string) => t.section[s] ?? s;
  // 묶은 판은 중국 묶음만 본문 (해외 묶음은 아래 제목 상자), 예전 판은 전부
  const { main: mainStories, intl: intlStories } = mailStories(c.top_stories);
  const hasHistory = mainStories.some((s) => s.story_context?.length);
  // 음성은 승인본만 PublicBriefing 에 붙는다 (media-store.ts). 메일 안에서는 재생되지 않으므로 페이지 #listen 으로 보낸다
  const audio = b.media?.audio;
  const listenRow = audio
    ? `<tr><td class="px" style="padding:14px ${PX}px 0"><a href="${esc(`${briefingUrl}#listen`)}" style="display:inline-block;border:1px solid ${C.line};border-left:3px solid ${C.jade};color:${C.ink};text-decoration:none;font:700 15px/1 ${FONT};padding:13px 18px;border-radius:0 8px 8px 0">${esc(t.listen(Math.max(1, Math.round(audio.duration_sec / 60))))}</a></td></tr>`
    : "";
  // 한눈에 보기: 사이트 페이지와 같은 buildGlance + 같은 convertAmountText 환산 줄 (Gate 2)
  // 카드 명세는 판 전체(8건) 기준이라 전체로 만든 뒤 해외 칸을 뺀다 (glance.ts 의 길이 검사를 지키려고)
  const gItems = buildGlance(c, opts.cardSpec).filter((g) => g.group !== "intl").map((g) => ({ ...g, fx: g.big && b.fx ? convertAmountText(g.big.raw, b.locale as FxLocale, b.fx) : null, st: c.top_stories.find((x) => x.rank === g.rank) }));
  const glanceRow = !gItems.length ? "" : `<tr><td class="px" style="padding:22px ${PX}px 0">
    <div style="border-bottom:2px solid ${C.ink};padding-bottom:7px;font:700 15px/1.4 ${FONT};color:${C.ink}">${esc(t.glance)} <span style="font-weight:400;font-size:13px;color:${C.faint}">${esc(t.glanceCount(gItems.length))}</span></div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${gItems.map((g, i) => {
      const href = g.st ? siteArticle(g.st.primary_ref) : briefingUrl;
      const col = SEC_COLOR[g.section] ?? C.jade;
      const pad = i === 0 ? "14px 10px 16px 0" : i === gItems.length - 1 ? "14px 0 16px 10px" : "14px 10px 16px";
      return `<td class="gcell" width="${Math.floor(100 / gItems.length)}%" valign="top" style="vertical-align:top;padding:${pad};${i < gItems.length - 1 ? `border-right:1px solid ${C.line};` : ""}">
        <div style="font:12px/1.4 ${FONT};color:${C.faint}"><b style="font:800 17px/1 ${FONT};color:${C.ink};vertical-align:-1px">${g.no}</b>&nbsp; <span style="color:${col};font-weight:700">■ ${esc(sectionName(g.section))}</span></div>
        <div style="padding-top:6px;font:700 14.5px/1.42 ${FONT}"><a href="${esc(href)}" style="color:${C.ink};text-decoration:none">${esc(g.title)}</a>${g.st?.story_context?.length ? ` <span style="color:${C.faint};font-size:12px;font-weight:400">🕘</span>` : ""}</div>
        ${g.big ? `<div style="padding-top:10px">${gBig(g.big, 20)}</div>${g.fx ? `<div style="font:600 12.5px/1.4 ${FONT};color:${C.sub}">${esc(g.fx)}</div>` : ""}<div style="padding-top:2px;font:12px/1.45 ${FONT};color:${C.sub}">${esc(g.big.label)}</div>${g.big.meter != null ? `<div style="padding-top:7px">${gBar(g.big.meter, C.jade, 9)}</div>` : ""}` : ""}
        ${!g.big && g.figure && g.figure.kind !== "bars" ? `<div class="mb" style="display:none;max-height:0;overflow:hidden;font:600 12.5px/1.45 ${FONT};color:${C.jade}">${esc(gFigureLine(g.figure))}</div>` : ""}
        ${g.figure ? `<div class="dk" style="padding-top:8px">${gFigure(g.figure)}</div>` : ""}
        ${g.note ? `<div class="dk" style="padding-top:10px;font:12px/1.5 ${FONT};color:${C.faint}">${esc(g.note)}</div>` : ""}
      </td>`;
    }).join("")}</tr></table>
  </td></tr>`;

  const stories = mainStories
    .map((s, idx) => {
      const a = art(s.primary_ref);
      const easy = (s.easy_terms ?? []).slice(0, 2);
      const easyHtml = easy.length
        ? `<tr><td style="padding:10px 0 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.amberSoft};border-radius:8px"><tr><td style="padding:10px 15px;font:13.5px/1.6 ${FONT};color:${C.ink}">
            <div style="font-weight:700;color:${C.amber};margin-bottom:2px">${esc(t.easy)}</div>
            ${easy.map((e) => `<div><b>${esc(e.name)}</b>${e.term && e.term !== e.name ? ` <span style="color:${C.faint}">${esc(e.term)}</span>` : ""} — ${esc(e.easy)}</div>`).join("")}
          </td></tr></table></td></tr>`
        : "";
      const links = [link(siteArticle(s.primary_ref), t.onSite + " →"), a?.source_url ? link(a.source_url, `${t.original} · ${a.source_name}`, C.sub) : ""]
        .filter(Boolean)
        .join(`<span style="color:${C.line}">&nbsp;&nbsp;|&nbsp;&nbsp;</span>`);
      return `<tr><td class="px" style="padding:0 ${PX}px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${C.line}"><tr><td style="padding:24px 0">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr><td style="font:600 12px/1.4 ${FONT};color:${C.faint}"><span style="display:inline-block;background:${C.jade};color:#fff;border-radius:10px;padding:1px 8px;margin-right:6px">${displayNo(s, c.top_stories)}</span>${esc(sectionName(s.section))} · ${esc(s.subject)}</td></tr>
          <tr><td style="padding:8px 0 0;font:700 20px/1.42 ${FONT};color:${C.ink}"><a href="${esc(siteArticle(s.primary_ref))}" style="color:${C.ink};text-decoration:none">${esc(s.title)}</a></td></tr>
          <tr><td style="padding:8px 0 0;font:15.5px/1.75 ${FONT};color:${C.ink}">${esc(s.what)}</td></tr>
          <tr><td style="padding:12px 0 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.jadeSoft};border-left:3px solid ${C.jade};border-radius:0 8px 8px 0"><tr><td style="padding:11px 15px;font:14.5px/1.7 ${FONT};color:${C.ink}"><b style="color:${C.jade}">${esc(t.why)}</b><br>${esc(s.why)}</td></tr></table></td></tr>
          ${easyHtml}
          ${historyBlock(t, s.story_context, `${briefingUrl}#story-${s.rank}`, idx < fullUpTo, siteArticle)}
          <tr><td style="padding:12px 0 0;font:13px/1.5 ${FONT}">${links}</td></tr>
        </table></td></tr></table></td></tr>`;
    })
    .join("");

  // 해외 묶음: 제목만 + 사이트 바로가기 (본문은 사이트에서)
  const intlBox = intlStories.length
    ? `<tr><td class="px" style="padding:6px ${PX}px 8px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${C.line};border-radius:10px"><tr><td style="padding:16px 18px">
    <div style="font:700 15px/1.4 ${FONT};color:${C.ink}">${esc(t.intlTitle)} <span style="font-weight:400;font-size:13px;color:${C.faint}">${esc(t.intlCount(intlStories.length))}</span></div>
    ${intlStories
      .map(
        (s) =>
          `<div style="padding-top:9px;font:14.5px/1.55 ${FONT}"><b style="color:${C.jade}">${esc(t.intlNo(displayNo(s, c.top_stories)))}</b>&nbsp; <span style="color:${C.faint};font-size:12.5px">${esc(sectionName(s.section))}</span>&nbsp; <a href="${esc(siteArticle(s.primary_ref))}" style="color:${C.ink};text-decoration:none">${esc(s.title)}</a></div>`
      )
      .join("")}
    <div style="padding-top:14px">${link(`${briefingUrl}#${INTL_ANCHOR}`, `${t.intlMore} →`)}</div>
  </td></tr></table></td></tr>`
    : "";

  const sections = c.sections.length
    ? heading(t.sections) +
      `<tr><td class="px" style="padding:0 ${PX}px">${c.sections
        .map(
          (sec) =>
            `<div style="padding:9px 0;border-top:1px solid ${C.line}"><div style="font:700 13px/1.5 ${FONT};color:${C.sub};padding-bottom:2px">${esc(sectionName(sec.section))}</div>${sec.items
              .map(
                (it) =>
                  `<div style="font:14.5px/1.65 ${FONT};color:${C.ink};padding:2px 0">· <a href="${esc(siteArticle(it.refs[0]))}" style="color:${C.ink};text-decoration:none">${esc(it.text)}</a></div>`
              )
              .join("")}</div>`
        )
        .join("")}</td></tr>`
    : "";

  const companies = c.companies_to_watch.length
    ? heading(t.companies) +
      `<tr><td class="px" style="padding:0 ${PX}px;font:14.5px/1.65 ${FONT};color:${C.ink}">${c.companies_to_watch
        .map((co) => `<div style="padding:7px 0;border-top:1px solid ${C.line}"><b>${esc(co.name)}</b> <span style="color:${C.sub}">— ${esc(co.why)}</span></div>`)
        .join("")}</td></tr>`
    : "";

  const term = c.term_of_the_day
    ? heading(t.term) +
      `<tr><td class="px" style="padding:0 ${PX}px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${C.line};border-radius:8px"><tr><td style="padding:13px 17px;font:14.5px/1.65 ${FONT};color:${C.ink}"><span style="font-size:19px;font-weight:700">${esc(c.term_of_the_day.term)}</span> <span style="color:${C.faint}">${esc(c.term_of_the_day.pinyin)}</span><br>${esc(c.term_of_the_day.explanation ?? "")}</td></tr></table></td></tr>`
    : "";

  const fxFoot =
    b.fx && (b.fxApplied || gItems.some((g) => g.fx))
      ? `<br>${esc(t.fxNote(editionDateLabel(b.locale, b.fx.date), fxFootnoteParts(b.locale as FxLocale, b.fx).map((p) => t.fxRate(p.from, p.rate)).join(" · ")))}`
      : "";
  const total = c.meta.candidate_count;
  const cited = c.meta.cited_count;
  const preheader = c.lede;
  const subject = t.subject(dateLabel, c.headline);

  // Outlook PC 는 max-width 를 무시한다. 고정 폭(ghost table)을 두면 좁은 읽기 창에서 가로 스크롤이 생겨 두지 않는다(그때는 창 폭에 맞춰 늘어남)
  const html = `<!doctype html>
<html lang="${b.locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(subject)}</title>
<style>
@media only screen and (max-width:480px){
  .px{padding-left:18px!important;padding-right:18px!important}
  .col{display:block!important;width:100%!important;padding:0 0 14px!important;border-left:0!important}
  .wrap{border-radius:0!important}
  .outer{padding:0!important}
  .gcell{display:block!important;width:100%!important;border-right:0!important;border-bottom:1px solid #e3e8e6!important;padding:12px 0!important}
  .dk{display:none!important}
  .mb{display:block!important;max-height:none!important;padding-top:6px}
}
</style></head>
<body style="margin:0;padding:0;background:${C.bg}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg}"><tr><td class="outer" align="center" style="padding:24px 12px">
<table class="wrap" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:${MAIL_WIDTH}px;background:${C.card};border-radius:12px;overflow:hidden">
  <tr><td class="px" style="padding:30px ${PX}px 0;font:700 12px/1.4 ${FONT};letter-spacing:.06em;color:${C.jade}">${esc(t.brand)}</td></tr>
  <tr><td class="px" style="padding:6px ${PX}px 0;font:800 27px/1.32 ${FONT};color:${C.ink}">${esc(t.title(dateLabel))}</td></tr>
  <tr><td class="px" style="padding:6px ${PX}px 0;font:13px/1.5 ${FONT};color:${C.faint}">${esc(t.coverage(total, cited))}</td></tr>
  <tr><td class="px" style="padding:4px ${PX}px 0;font:12.5px/1.5 ${FONT};color:${C.faint}">${esc(t.forwarded)} <a href="${esc(`${absoluteUrl(b.locale, "/subscribe")}?src=forward`)}" style="color:${C.jade};font-weight:700;text-decoration:none">${esc(t.forwardedCta)} →</a></td></tr>
  <tr><td class="px" style="padding:20px ${PX}px 0;font:15.5px/1.7 ${FONT};color:${C.sub}">${opts.name ? esc(t.hello(opts.name)) + " " : ""}${esc(t.intro)}</td></tr>
  <tr><td class="px" style="padding:16px ${PX}px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.jadeSoft};border-radius:10px"><tr><td style="padding:18px 20px">
    <div style="font:800 20px/1.45 ${FONT};color:${C.ink}">${esc(c.headline)}</div>
    <div style="padding-top:8px;font:15.5px/1.75 ${FONT};color:${C.ink}">${esc(c.lede)}</div>
  </td></tr></table></td></tr>
  ${listenRow}
  ${glanceRow}
  ${heading(t.top)}
  ${stories}
  ${intlBox}
  ${sections}
  ${companies}
  ${term}
  <tr><td align="center" class="px" style="padding:34px ${PX}px 30px"><a href="${esc(briefingUrl)}" style="display:inline-block;background:${C.jade};color:#fff;text-decoration:none;font:700 15px/1 ${FONT};padding:15px 28px;border-radius:8px">${esc(t.cta)} →</a></td></tr>
</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:${MAIL_WIDTH}px"><tr><td class="px" style="padding:18px 24px;font:12px/1.7 ${FONT};color:${C.faint}">
  ${esc(t.footReason(opts.email))}<br>${esc(t.footAi)}${hasHistory ? `<br>${esc(t.storyNote)}` : ""}${fxFoot}<br>
  <a href="${esc(opts.unsubscribeUrl)}" style="color:${C.sub};font-weight:700">${esc(t.unsub)}</a> — ${esc(t.unsubNote)}<br>
  <a href="${esc(`${absoluteUrl(b.locale, "/subscribe")}?src=mail`)}" style="color:${C.jade};font-weight:700">${esc(t.recommend)} →</a><br>${esc(t.sender)}
</td></tr></table>
</td></tr></table>
</body></html>`;

  const text = [
    t.title(dateLabel),
    t.coverage(total, cited),
    "",
    c.headline,
    c.lede,
    ...(audio ? [`${t.listen(Math.max(1, Math.round(audio.duration_sec / 60)))}: ${briefingUrl}#listen`] : []),
    "",
    ...mainStories.flatMap((s) => [
      `${displayNo(s, c.top_stories)}. ${s.title}`,
      s.what,
      `${t.why}: ${s.why}`,
      ...(s.story_context ?? []).map((x) => `${t.lens[x.lens] ?? x.lens}: ${x.title} — ${x.now}`),
      siteArticle(s.primary_ref),
      "",
    ]),
    ...(intlStories.length
      ? [`${t.intlTitle} (${t.intlCount(intlStories.length)})`, ...intlStories.map((s) => `${t.intlNo(displayNo(s, c.top_stories))}. ${s.title} ${siteArticle(s.primary_ref)}`), `${t.intlMore}: ${briefingUrl}#${INTL_ANCHOR}`, ""]
      : []),
    `${t.cta}: ${briefingUrl}`,
    "",
    `${t.unsub}: ${opts.unsubscribeUrl}`,
  ].join("\n");

  return { subject, preheader, html, text };
}
