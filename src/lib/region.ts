/**
 * 대상 지역(subject region) — 선택지 D: 대표 지역 1개(subject_region) + 여러 지역 태그(region_tags).
 * 설계: ~/ainews-reports/region-taxonomy/report.md §6. DB: scripts/2026-11-02-subject-region.sql.
 *
 * 이 파일이 지역에 관한 단일 진실 공급원이다 (Gate 2):
 *  - 정규화(normalizeRegion): upsert API·백필·감시 스크립트가 같은 함수로 값을 다듬는다.
 *  - 고신뢰 규칙(ruleRegion / highConfidenceRegion): 백필 1단계와 감시 스크립트(규칙 대 LLM 불일치)가 쓴다.
 *  - 칩 → SQL(regionChipSql), 칩 버킷(REGION_BUCKET_SQL / regionBucketOf): 목록 필터·필터 선택지 건수·통계·주간/월간 지표가 쓴다.
 *  - 배지(regionBadges): 카드·리스트·상세의 '미중'·'한국' 작은 글자 배지.
 *
 * 사용자 결정(2026-11-02):
 *  - 대만·홍콩·마카오가 주제인 기사는 대표 지역 CN 으로 저장하고, 태그에 'TW'(대만)·'HK'(홍콩)를 남긴다.
 *  - 공개 칩: 전체 · 중국(CN) · 미국(US) · 그 밖(CN·US 가 아닌 나머지, GLOBAL 포함). 미판정(NULL)은 '전체'에서만 보인다.
 *  - 미중·한국은 칩이 아니라 태그에서 나온 작은 글자 배지 (국기 이모지 없음).
 *
 * 판정 규칙 (분류기 지시문과 사람이 함께 쓰는 문구, 보고서 §6):
 *  1. 대표 지역 = 제목의 주어(기업·기관·정부·인물)가 속한 나라. 제목에 주어가 없으면 요약 첫 문장의 주어.
 *  2. 기업은 본사 국가. 중국 기업의 해외 사업은 CN(+진출 지역 태그), 미국 기업의 중국 사업은 US(+CN 태그). 자회사는 모회사 국가(딥마인드 = US).
 *  3. 번역문의 '국산·국내·우리나라'(원문 国产·国内)는 중국. 위안화 금액·중국 도시·대학·A주·커촹반·홍콩 상장 맥락도 CN.
 *  4. 홍콩·마카오·대만은 CN (+HK/TW 태그).
 *  5. 제재·수출통제·경쟁 기사는 행위를 당하는 쪽이 대표 지역, 반대쪽은 태그 → 미중 기사는 언제나 태그 {CN, US}.
 *  6. GLOBAL = 특정 나라 주체가 없는 일반론, 또는 3개국 이상이 대등. 국적이 본문에 없으면 추측하지 않는다(중국 업계 분석은 CN).
 *  7. 태그 = 대표 지역 + 이야기의 중심인 다른 나라. 지나가는 비교 언급은 넣지 않는다.
 *  8. 다국적 협업은 주도 기업의 국가.
 */
import { ENTITIES, findEntities } from "./briefing/entities";

// ───────────────────────── 코드

/** 대표 지역 (DB CHECK 와 같다). 'TW' 는 대표 지역으로 쓰지 않는다 — CN + TW 태그 */
export const SUBJECT_REGIONS = ["CN", "US", "KR", "JP", "EU", "OTHER", "GLOBAL"] as const;
export type SubjectRegion = (typeof SUBJECT_REGIONS)[number];

/** 태그 (DB CHECK 와 같다). GLOBAL 은 태그로 쓰지 않는다 */
export const REGION_TAGS = ["CN", "US", "KR", "JP", "EU", "TW", "HK", "OTHER"] as const;
export type RegionTag = (typeof REGION_TAGS)[number];

/** region_version 값 — 판정 경로. 감시 스크립트가 경로별로 나눠 본다 */
export const REGION_VERSION = {
  rule: "rule-v1",
  llm: "llm-v1",
  n8n: "n8n-v1",
} as const;

const isSubject = (s: string): s is SubjectRegion => (SUBJECT_REGIONS as readonly string[]).includes(s);
const isTag = (s: string): s is RegionTag => (REGION_TAGS as readonly string[]).includes(s);

/** 중국 대표 지역으로 접히는 코드 → 남길 태그 */
const FOLD_TO_CN: Record<string, RegionTag | null> = { TW: "TW", HK: "HK", MO: "HK" };

export interface RegionValue {
  subject_region: SubjectRegion;
  region_tags: RegionTag[];
}

/**
 * 원시 판정(LLM·규칙·n8n) → 저장 값. 알 수 없는 대표 지역이면 null(저장하지 않음 → 나중에 백필).
 *  - TW/HK/MO 대표 지역 → CN, 태그에 CN + TW/HK 를 남긴다. 태그로만 온 TW/HK 는 그대로 두고 CN 을 더하지 않는다.
 *  - 태그: 알려진 코드만, GLOBAL·NONE 제거, 대표 지역(GLOBAL 제외)을 넣는다, 정해진 순서로 중복 없이.
 */
export function normalizeRegion(primary: unknown, tags: unknown = []): RegionValue | null {
  if (typeof primary !== "string") return null;
  let p = primary.trim().toUpperCase();
  const rawTags = (Array.isArray(tags) ? tags : typeof tags === "string" ? tags.split(/[,\s/]+/) : [])
    .filter((t): t is string => typeof t === "string")
    .map((t) => t.trim().toUpperCase())
    .map((t) => (t === "MO" ? "HK" : t));
  const set = new Set<string>(rawTags);
  if (p in FOLD_TO_CN) {
    const tag = FOLD_TO_CN[p];
    if (tag) set.add(tag);
    p = "CN";
  }
  if (!isSubject(p)) return null;
  // 대표 지역(CN 으로 접힌 경우 포함)은 태그에도 넣는다. 대만·홍콩이 '두 번째 지역'일 뿐이면 CN 태그를 붙이지 않는다
  // — 미국 기업 × TSMC 공급망 기사에 '미중' 배지가 뜨지 않도록 (결정 2 는 대만이 '주제'인 기사만 CN 으로 본다).
  if (p !== "GLOBAL") set.add(p);
  return { subject_region: p, region_tags: REGION_TAGS.filter((t) => set.has(t) && isTag(t)) };
}

/** upsert API: 들어온 기사의 지역 세 열을 normalizeRegion 으로 다듬는다. 대표 지역이 없거나 틀리면 세 열을 모두 뺀다 */
export function sanitizeRegionFields(item: Record<string, unknown>): void {
  const touched = "subject_region" in item || "region_tags" in item || "region_version" in item;
  if (!touched) return;
  const v = normalizeRegion(item.subject_region, item.region_tags);
  delete item.subject_region;
  delete item.region_tags;
  const version = typeof item.region_version === "string" ? item.region_version.trim().slice(0, 40) : "";
  delete item.region_version;
  if (!v) return;
  item.subject_region = v.subject_region;
  item.region_tags = v.region_tags;
  if (version) item.region_version = version;
}

// ───────────────────────── 칩 (공개 필터)

export const REGION_CHIPS = ["ALL", "CN", "US", "OTHER"] as const;
export type RegionChip = (typeof REGION_CHIPS)[number];

/** URL 값 → 칩. 모르는 값(예전 링크 등)은 ALL */
export function parseRegionChip(v: string | null | undefined): RegionChip {
  const s = (v ?? "").trim().toUpperCase();
  return (REGION_CHIPS as readonly string[]).includes(s) ? (s as RegionChip) : "ALL";
}

/**
 * 칩 → WHERE 조각 (상수만, 사용자 입력 없음). ALL 이면 null (조건 없음 — NULL 행 포함).
 * 그 밖 = 판정이 있고 CN·US 가 아닌 나머지 전부(GLOBAL 포함). NULL 은 '전체'에서만 보인다.
 */
export function regionChipSql(chip: RegionChip, col = "subject_region"): string | null {
  if (chip === "CN") return `${col} = 'CN'`;
  if (chip === "US") return `${col} = 'US'`;
  if (chip === "OTHER") return `(${col} IS NOT NULL AND ${col} NOT IN ('CN','US'))`;
  return null;
}

export type RegionBucket = "CN" | "US" | "OTHER";

/** 대표 지역 → 칩 버킷 (NULL → null). regionChipSql 과 같은 규칙 */
export function regionBucketOf(subject: string | null | undefined): RegionBucket | null {
  if (!subject) return null;
  if (subject === "CN" || subject === "US") return subject;
  return "OTHER";
}

/** SQL 버킷 식: 'CN' | 'US' | 'OTHER' | NULL (regionBucketOf 와 같은 규칙) */
export const REGION_BUCKET_SQL = `CASE WHEN subject_region IS NULL THEN NULL WHEN subject_region IN ('CN','US') THEN subject_region ELSE 'OTHER' END`;

// ───────────────────────── 배지·라벨

export type RegionBadge = "us_china" | "korea";

/**
 * 태그 → 배지. 미중 = 태그 ⊇ {CN, US}. 한국 = 'KR' ∈ 태그 (대표 지역이 이미 한국이면 라벨이 한국이므로 생략).
 * SQL 로는 region_tags @> '{CN,US}' / 'KR' = ANY(region_tags).
 */
export function regionBadges(subject: string | null | undefined, tags: readonly string[] | null | undefined): RegionBadge[] {
  const t = new Set(tags ?? []);
  const out: RegionBadge[] = [];
  if (t.has("CN") && t.has("US")) out.push("us_china");
  if (t.has("KR") && subject !== "KR") out.push("korea");
  return out;
}

export const REGION_BADGE_SQL = {
  us_china: `region_tags @> ARRAY['CN','US']::text[]`,
  korea: `'KR' = ANY(region_tags)`,
} as const;

const REGION_LABELS: Record<SubjectRegion, Record<string, string>> = {
  CN: { ko: "중국", en: "China", zh: "中国" },
  US: { ko: "미국", en: "US", zh: "美国" },
  KR: { ko: "한국", en: "Korea", zh: "韩国" },
  JP: { ko: "일본", en: "Japan", zh: "日本" },
  EU: { ko: "유럽", en: "Europe", zh: "欧洲" },
  OTHER: { ko: "기타 국가", en: "Other", zh: "其他国家" },
  GLOBAL: { ko: "글로벌", en: "Global", zh: "全球" },
};

const BADGE_LABELS: Record<RegionBadge, Record<string, string>> = {
  us_china: { ko: "미중", en: "US–China", zh: "中美" },
  korea: { ko: "한국", en: "Korea", zh: "韩国" },
};

/** 카드·상세 한 줄 메타의 지역 라벨 ("미국 · 36氪"). 판정이 없으면 "" */
export function regionLabel(subject: string | null | undefined, locale: string): string {
  if (!subject || !isSubject(subject)) return "";
  return REGION_LABELS[subject][locale] ?? REGION_LABELS[subject].ko;
}

export function regionBadgeLabel(b: RegionBadge, locale: string): string {
  return BADGE_LABELS[b][locale] ?? BADGE_LABELS[b].ko;
}

// ───────────────────────── 고신뢰 규칙 (report rule.ts 이식 + 보고서가 요구한 수정)

type RawRegion = "CN" | "US" | "KR" | "JP" | "EU" | "TW" | "OTHER";

// entities.ts 실체 → 지역 (chinese=true → CN, 나머지는 본사 국가). 딥마인드는 google 별칭 → US (자회사 = 모회사)
const ENT_REGION: Record<string, RawRegion> = { tsmc: "TW", samsung: "KR", "1x": "OTHER" };
for (const e of ENTITIES) if (!(e.key in ENT_REGION)) ENT_REGION[e.key] = e.chinese ? "CN" : "US";

/**
 * 실체 별칭이 흔한 낱말·다른 고유명사와 겹치는 경우 지역 판정에서는 다시 확인한다 (entities.ts 는 브리핑·관련 기사도 쓰므로 고치지 않는다).
 *  - samsung: '삼성' 이 영화 《삼성두(三星堆)》·'삼성퇴'에 걸린다 (보고서 §1 오탐 5건).
 */
const ENT_RECHECK: Record<string, RegExp> = {
  samsung: /삼성(?!두|퇴)|Samsung|三星(?!堆)/i,
};

// 추가 이름표 (entities.ts 에 없는 실체·지명). 보고서 §1 에서 오탐을 낸 별칭(유수·무시·지리·모모·파리·선전·나스닥)은 넣지 않는다.
const EXTRA: Record<RawRegion, (string | RegExp)[]> = {
  CN: [/중국(?!어)/, "中国", "国产", "国内", "국산", /국내(?!외)/, "우리나라", "베이징", "상하이", "항저우", "광저우", "北京", "上海", "深圳", "杭州", "广州",
    "샤오펑", "小鹏", "리오토", "理想汽车", "니오", "蔚来", "吉利", "OPPO", "vivo", "아너", "荣耀", "레노버", "联想", "하이크비전",
    "모어스레드", "摩尔线程", "沐曦", "하이곤", "海光", "비런", "壁仞", "MiniMax", "Manus", "마누스", "핀둬둬", "拼多多", "테무", "Temu",
    "쉬인", "Shein", "SHEIN", "틱톡", "TikTok", "抖音", "더우인", "DJI", "大疆", "CATL", "宁德", "Zeekr", "지커", "아이치이", "爱奇艺", "빌리빌리", "哔哩哔哩",
    "샤오홍슈", "小红书", "샤오훙슈", "위안", "亿元", "万元", "커촹반", "科创板", "홍콩", "香港", "港股", "푸단", "复旦", "저장대", "浙江", "중관촌", "中关村", "우수커지", "넷이즈", "网易", "치후360", "360集团", "滴滴", "디디", "Momenta", "华大", "중국과학", "인민", "习近平", "시진핑", "위안화"],
  US: ["미국", "美国", "실리콘밸리", "硅谷", "워싱턴", "트럼프", "特朗普", "아마존", "Amazon", "AWS", "亚马逊", "xAI", "Grok", "그록", "머스크", "马斯克",
    "퀄컴", "Qualcomm", "高通", "Perplexity", "퍼플렉시티", "오라클", "Oracle", "甲骨文", "Salesforce", "Cursor", "커서", "브로드컴", "Broadcom", "博通",
    "마이크론", "Micron", "美光", "IBM", "Cerebras", "Groq", "Scale AI", "Databricks", "Palantir", "팔란티어", "올트먼", "Altman", "奥特曼", "젠슨 황", "黄仁勋",
    "나델라", "피차이", "Waymo", "웨이모", "Netflix", "넷플릭스", "Uber", "Adobe", "어도비", "스탠퍼드", "Stanford", "MIT", "하버드", "버클리", "CoreWeave", "SSI", "Thinking Machines", "Character.AI", "Midjourney", "Runway", "Mira Murati", "Ilya", "일리야",
    "뉴욕", "캘리포니아", "Github", "GitHub"],
  KR: ["한국", "韩国", /삼성(?!두|퇴)/, "SK하이닉스", "하이닉스", "SK海力士", "海力士", "네이버", "Naver", "카카오", "Kakao", "LG", "현대차", "现代汽车", "서울", "首尔", "업스테이지", "퓨리오사", "리벨리온"],
  JP: ["일본", "日本", "소프트뱅크", "SoftBank", "软银", "손정의", "孙正义", "소니", "Sony", "索尼", "토요타", "도요타", "丰田", "닌텐도", "任天堂", "도쿄", "东京", "Sakana", "파나소닉", "라피더스"],
  EU: ["유럽", "欧洲", "欧盟", /\bEU\b/, "영국", "英国", "독일", "德国", "프랑스", "法国", "네덜란드", "荷兰", "ASML", "阿斯麦", "Mistral", "미스트랄", "SAP", "Arm", "ARM", "安谋", "스위스", "이탈리아", "스웨덴", "런던", "伦敦", "Spotify", "Nokia", "노키아", "에릭슨", "지멘스", "Siemens", "BMW", "폭스바겐", "大众", "벤츠", "奔驰", "Stability AI", "DeepL"],
  // 대만 기업(TSMC 는 entities.ts) — 대표 지역은 normalizeRegion 이 CN 으로 접고 TW 태그를 남긴다
  TW: ["대만", "台湾", "타이완", "폭스콘", "Foxconn", "富士康", "홍하이", "鸿海", "Hon Hai", "미디어텍", "MediaTek", "联发科", "Quanta", "广达", "에이수스", "ASUS", "华硕", "에이서", "宏碁",
    "UMC", "联电", "롄뎬", "PSMC", "力积电", "리지뎬"],
  OTHER: ["인도", "印度", "중동", "中东", "사우디", "沙特", "UAE", "아랍에미리트", "阿联酋", "이스라엘", "以色列", "싱가포르", "新加坡", "캐나다", "加拿大", "호주", "澳大利亚", "러시아", "俄罗斯", "브라질", "베트남", "越南", "인도네시아", "말레이시아", "동남아", "东南亚", "Cohere", "G42", "카타르", "튀르키예", "아프리카", "멕시코"],
};

/** 제재·수출통제·관세 기사 — 규칙 5(당하는 쪽이 대표 지역)는 규칙으로 못 가린다 → LLM 으로 넘긴다 */
const SANCTION_RE = /제재|수출\s?통제|수출\s?규제|블랙리스트|실체\s?목록|엔티티\s?리스트|관세|制裁|出口管制|实体清单|关税|黑名单/;

// 오탐 방지: '인도' ↔ '인도네시아'·'인도하', 짧은 영문 ↔ 긴 낱말 (Arm ↔ Army, LG ↔ LGBT, MIT ↔ MITx)
function hit(a: string | RegExp, t: string): boolean {
  if (a instanceof RegExp) return a.test(t);
  if (a === "인도") return /인도(?!네시아|하|해|록|적)/.test(t);
  if (/^[A-Za-z]+$/.test(a) && a.length <= 5) return new RegExp(`(?<![A-Za-z])${a}(?![A-Za-z])`).test(t);
  return t.includes(a);
}

function regionsIn(t: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const e of findEntities(t)) {
    if (ENT_RECHECK[e.key] && !ENT_RECHECK[e.key].test(t)) continue;
    const r = ENT_REGION[e.key];
    counts[r] = (counts[r] ?? 0) + 1;
  }
  for (const [r, list] of Object.entries(EXTRA)) for (const a of list) if (hit(a, t)) counts[r] = (counts[r] ?? 0) + 1;
  return counts;
}

export interface RegionArticle {
  title_kr?: string | null;
  title_cn?: string | null;
  summary_kr?: string | null;
}

export interface RuleResult {
  /** 원시 지역(TW 포함) 또는 MULTI(여러 지역)·NONE(단서 없음) */
  region: RawRegion | "MULTI" | "NONE";
  /** 0.9 / 0.7 = 제목에 지역이 하나. 그 밖은 LLM 으로 넘길 낮은 신뢰도 */
  conf: number;
  scores: Record<string, number>;
  /** 제목·요약 첫 문장에 나온 지역 (태그 후보) */
  lead_regions: string[];
  sanction: boolean;
}

/** 점수: 제목 ×3, 요약 첫 문장 ×2, 요약 전체 ×1 (지역별 최대 2회). 보고서 rule.ts 와 같은 계산 */
export function ruleRegion(a: RegionArticle): RuleResult {
  const title = `${a.title_kr ?? ""} ${a.title_cn ?? ""}`;
  const sum = a.summary_kr ?? "";
  const first = sum.split(/(?<=[.다])\s/)[0] ?? "";
  const T = regionsIn(title);
  const F = regionsIn(first);
  const S = regionsIn(sum);
  const score: Record<string, number> = {};
  for (const [src, w] of [[T, 3], [F, 2], [S, 1]] as const) for (const [r, n] of Object.entries(src)) score[r] = (score[r] ?? 0) + w * Math.min(n, 2);
  const ranked = Object.entries(score).sort((x, y) => y[1] - x[1]);
  const tRegions = Object.keys(T);
  let region: RuleResult["region"];
  let conf: number;
  if (!ranked.length) {
    region = "NONE";
    conf = 0;
  } else if (tRegions.length === 1) {
    region = tRegions[0] as RawRegion;
    conf = ranked[0][0] === region && (ranked[1]?.[1] ?? 0) <= score[region] / 2 ? 0.9 : 0.7;
  } else if (tRegions.length >= 2) {
    const top = [...tRegions].sort((x, y) => score[y] - score[x]);
    region = score[top[0]] >= 2 * score[top[1]] ? (top[0] as RawRegion) : "MULTI";
    conf = region === "MULTI" ? 0.6 : 0.65;
  } else {
    const [r1, s1] = ranked[0];
    const s2 = ranked[1]?.[1] ?? 0;
    if (s1 >= 2 * s2 && s1 >= 2) {
      region = r1 as RawRegion;
      conf = 0.6;
    } else if (s2 > 0 && s1 < 2 * s2) {
      region = "MULTI";
      conf = 0.4;
    } else {
      region = r1 as RawRegion;
      conf = 0.4;
    }
  }
  const lead = [...new Set([...tRegions, ...Object.keys(F)])];
  return { region, conf, scores: score, lead_regions: lead, sanction: SANCTION_RE.test(title) };
}

/** 고신뢰 기준: 제목에 지역이 정확히 하나 (보고서 §3: 규칙(≥0.7) → LLM 이 가장 정확) */
export const RULE_MIN_CONF = 0.7;

/**
 * 고신뢰 규칙 판정. 제목에 지역이 하나이고 제재·관세 기사가 아니면 저장 값, 아니면 null(LLM 으로).
 * 태그 = 대표 지역 + 제목·요약 첫 문장에 나온 다른 지역.
 */
export function highConfidenceRegion(a: RegionArticle): RegionValue | null {
  const r = ruleRegion(a);
  if (r.conf < RULE_MIN_CONF || r.region === "MULTI" || r.region === "NONE" || r.sanction) return null;
  return normalizeRegion(r.region, r.lead_regions);
}

/** LLM 한 줄 판정 {p, s, uc} → 저장 값 (백필·금 표본 평가 공용). uc(미중 동시) = 태그 CN·US */
export function regionFromLlm(o: { p?: unknown; s?: unknown; uc?: unknown }): RegionValue | null {
  const tags: string[] = [];
  if (typeof o.s === "string" && o.s.toUpperCase() !== "NONE") tags.push(o.s);
  if (o.uc === true) tags.push("CN", "US");
  return normalizeRegion(o.p, tags);
}

/**
 * n8n 'AI Relevance Classifier' 줄 끝의 지역 열: "... | <Y|N> | <category> | <REGION> | <TAGS> | <title echo>".
 * 'Apply AI Filter' 코드 노드가 같은 규칙을 그대로 옮겨 쓴다(노드는 이 파일을 import 할 수 없다).
 * 지역 열이 없거나 메아리가 원제목 앞부분과 맞지 않으면 null (관련성 판정에는 영향 없음).
 */
export function parseClassifierRegion(line: string, titleCn: string): RegionValue | null {
  const cols = line.split("|").map((c) => c.trim());
  // id | subject | Y/N | category | region | tags | echo
  if (cols.length < 7) return null;
  const [, , yn, , region, tags, echo] = cols;
  if (!/^[YN]$/i.test(yn)) return null;
  if (!titleEchoMatches(echo, titleCn)) return null;
  return normalizeRegion(region, tags === "-" || /^none$/i.test(tags) ? [] : tags);
}

const ECHO_STRIP = /[\s'"‘’“”`·…「」【】《》！？｜:：,，。.、()（）\[\]-]/g;

/** 메아리(원제목 앞 8자) 검사: 문장부호·공백을 지운 뒤 앞 min(4, 제목 길이)자 이상이 원제목 앞부분과 같아야 한다 */
export function titleEchoMatches(echo: string | null | undefined, title: string | null | undefined): boolean {
  const e = [...String(echo ?? "").replace(ECHO_STRIP, "")].slice(0, 8).join("");
  const h = [...String(title ?? "").replace(ECHO_STRIP, "")].slice(0, 8).join("");
  if (!h) return false;
  return e.length >= Math.min(4, h.length) && h.startsWith(e);
}
