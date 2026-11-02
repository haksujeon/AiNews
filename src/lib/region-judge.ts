/**
 * 대상 지역 판정 — 백필(scripts/region-backfill.ts)·일일 재판정(/api/internal/region/rejudge)·금 표본 평가가
 * 같은 함수 rejudgeRegions 를 쓴다 (Gate 2). 서버 전용 (LiteLLM 호출). DB 를 import 하지 않는다.
 *
 *  1단계 고신뢰 규칙(region.ts highConfidenceRegion): 제목에 지역이 하나이고 제재·관세 기사가 아니면 그 값
 *  2단계 LLM: LiteLLM anthropic-api-haiku-5-5, 사고 기능 끔, temperature 없음, 20건 묶음, 제목 앞 10자 메아리로 정렬 확인
 *     (틀린 기사만 최대 2번 다시 묻는다). 비용은 응답 헤더 x-litellm-response-cost 를 더해 상한에서 멈춘다.
 * 보고서: ~/ainews-reports/region-taxonomy/report.md §3·§6 (금 표본: 규칙 → LLM 94%).
 * n8n 분류기(n8n-v1, 81~84%)와 판정 규칙 문구(region.ts 머리말)는 같고, 경로만 다르다.
 */
import { REGION_VERSION, highConfidenceRegion, regionFromLlm, titleEchoMatches, type RegionValue } from "./region";

export const REGION_LLM_MODEL = "anthropic-api-haiku-5-5";
export const REGION_BATCH = 20;

// ───────────────────────── 지시문 (보고서 llm.ts v1 + 수정: 국산·국내 = 중국, 대만 기업 목록, 제재 규칙 5)

export const SYSTEM = `당신은 AI 뉴스 기사의 "대상 지역"(어느 나라의 AI 이야기인가)을 판정합니다. 기사는 모두 중국 매체 기사를 한국어로 옮긴 것입니다(매체 국가가 아니라 기사 내용의 주체로 판정).
지역 코드: CN(중국 본토·홍콩·마카오), US(미국), KR(한국), JP(일본), EU(유럽연합·영국·스위스 등 유럽), TW(대만: TSMC·폭스콘/홍하이·UMC·미디어텍·PSMC 등 대만 기업), OTHER(그 밖의 나라: 인도·중동·싱가포르 등), GLOBAL(특정 나라 주체가 없는 일반 기술·산업 분석, 또는 여러 나라가 대등하게 섞인 세계 동향).
규칙:
0. 한국어 번역문의 '국산'·'국내'·'우리나라'는 원문 国产·国内 의 번역이므로 중국(CN)을 뜻합니다. 한국(KR)은 한국 기업·기관·정부·한국 시장이 실제로 나올 때만 씁니다.
1. primary = 제목의 주어(기업·기관·정부·인물)가 속한 나라. 제목에 없으면 요약 첫 문장의 주체.
2. 기업은 본사 국가로 판정: 중국 기업의 해외 사업(TikTok 미국, Shein, 해외 진출)도 CN. 미국 기업의 중국 사업(엔비디아 중국 판매, 애플 중국 매출)은 primary=US, secondary=CN. 자회사는 모회사 국가(딥마인드=US).
3. 주체 기업명이 낯설어도 위안화 금액·중국 도시·중국 대학·중국 증시(A주·커촹반·홍콩 상장)·'국내'(=중국) 맥락이면 CN.
4. 특정 주체 없이 기술 개념·업계 일반론이면 GLOBAL. 단 중국 시장/중국 업계에 대한 분석이면 CN. 주체 국적이 본문에 없으면 추측하지 않습니다.
5. 제재·수출통제·관세 기사는 행위를 당하는 쪽이 primary, 행위를 한 쪽이 secondary 입니다(미국이 중국 기업을 제재 → primary CN, secondary US).
6. secondary = 두 번째로 비중 있는 지역(없으면 NONE).
7. uc(미중 동시) = 미국과 중국이 둘 다 이야기의 중심일 때만 true: 미중 경쟁·비교·수출통제·제재·관세, 또는 미국과 중국 주체가 함께 주인공(예: 중국 모델이 GPT를 앞섬). 단순히 비교 대상으로 한 번 언급되면 false.
출력: 입력 번호마다 한 줄 JSON, 다른 말 없이. {"i":번호,"t":"제목 앞 10글자 그대로","p":"코드","s":"코드 또는 NONE","uc":true/false}`;

const REG = ["CN", "US", "KR", "JP", "EU", "TW", "HK", "OTHER", "GLOBAL"];
const clean = (s: string | null | undefined) => String(s ?? "").replace(/\s+/g, " ").trim();
const norm = (s: string) => s.replace(/[\s'"‘’“”`·…]/g, "");
export const head8 = (s: string) => [...norm(s)].slice(0, 8).join("");

export interface JudgeRow {
  id: string;
  title_kr: string | null;
  title_cn: string | null;
  summary_kr: string | null;
}

interface LlmOut {
  i: number;
  t?: string;
  p?: string;
  s?: string;
  uc?: boolean;
}

/** 실행 하나의 LLM 사용량 (요청마다 새로 만든다 — 장기 실행 서버에서 누적되지 않게) */
export interface JudgeUsage {
  calls: number;
  costUsd: number;
  errors: string[];
}

export type JudgeStage = "rule" | "llm";

export interface JudgeResult {
  /** id → 판정 (판정 못 한 기사는 없음) */
  got: Map<string, { value: RegionValue; stage: JudgeStage }>;
  /** 규칙·LLM 모두 판정 못 한 id (LLM 실패·메아리 불일치·상한 도달) */
  unresolved: string[];
  usage: JudgeUsage;
}

export interface JudgeOptions {
  /** 1단계 규칙 (기본 true) */
  rules?: boolean;
  /** 2단계 LLM (기본 true) */
  llm?: boolean;
  /** LLM 비용 상한 USD (기본 0.10) */
  capUsd?: number;
  /** LiteLLM user 필드·태그 (호출 경로 구분) */
  caller?: string;
  /** 동시 묶음 수 (기본 4) */
  concurrency?: number;
  onProgress?: (done: number, total: number, usage: JudgeUsage, labelled: number) => void;
  debug?: boolean;
}

async function callBatch(items: JudgeRow[], usage: JudgeUsage, caller: string): Promise<LlmOut[]> {
  const base = process.env.LITELLM_BASE_URL?.replace(/\/+$/, "") || "http://127.0.0.1:4100";
  const user = items
    .map((x, k) => `${k + 1}. 제목: ${clean(x.title_kr)}${x.title_cn ? `\n   원제목: ${clean(x.title_cn)}` : ""}\n   요약: ${[...clean(x.summary_kr)].slice(0, 300).join("")}`)
    .join("\n");
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.LITELLM_API_KEY}` },
    signal: AbortSignal.timeout(120_000),
    body: JSON.stringify({
      model: REGION_LLM_MODEL,
      max_tokens: 3000,
      thinking: { type: "disabled" },
      user: caller,
      metadata: { tags: [caller, REGION_VERSION.llm] },
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: user },
      ],
    }),
  });
  usage.calls++;
  const cost = Number(res.headers.get("x-litellm-response-cost") ?? "0");
  if (Number.isFinite(cost)) usage.costUsd += cost;
  const j = (await res.json().catch(() => ({}))) as { error?: unknown; choices?: { message?: { content?: string } }[] };
  if (!res.ok) {
    const e = j.error as { message?: string } | string | undefined;
    throw new Error(typeof e === "string" ? e : e?.message ?? `HTTP ${res.status}`);
  }
  const text = j.choices?.[0]?.message?.content ?? "";
  const out: LlmOut[] = [];
  for (const m of text.matchAll(/\{[^{}]*\}/g)) {
    try {
      out.push(JSON.parse(m[0]));
    } catch {
      /* 형식이 틀린 줄은 버리고 다시 묻는다 */
    }
  }
  return out;
}

/** 메아리 검사: 정규화 후 메아리 앞 5~8자가 제목 앞부분과 같아야 한다. 번역 찌꺼기 "X → 제목: Y" 는 Y 로도 맞춰 본다 */
function echoOk(o: LlmOut, a: JudgeRow): boolean {
  const e = head8(o.t ?? "");
  const t = a.title_kr ?? "";
  const hs = [t, ...(t.includes("제목:") ? [t.split("제목:").pop() ?? ""] : [])].map(head8);
  if (hs.some((h) => h.length > 0 && e.length >= Math.min(5, h.length) && h.startsWith(e))) return true;
  // 모델이 원제목(중국어)을 메아리로 돌려주는 경우 — 원제목과 맞춰 본다
  return titleEchoMatches(o.t, a.title_cn);
}

/** LLM 묶음 판정 + 어긋난 기사만 최대 2번 재질문 */
async function classifyLlm(rows: JudgeRow[], opts: Required<Pick<JudgeOptions, "capUsd" | "caller" | "concurrency">> & JudgeOptions, usage: JudgeUsage) {
  const got = new Map<string, RegionValue>();
  const batches: JudgeRow[][] = [];
  for (let k = 0; k < rows.length; k += REGION_BATCH) batches.push(rows.slice(k, k + REGION_BATCH));
  async function run(b: JudgeRow[], attempt = 0): Promise<void> {
    if (usage.costUsd >= opts.capUsd) return;
    const out = await callBatch(b, usage, opts.caller);
    const bad: JudgeRow[] = [];
    b.forEach((a, k) => {
      const o = out.find((x) => x.i === k + 1);
      const v = o && typeof o.p === "string" && REG.includes(o.p.toUpperCase()) && echoOk(o, a) ? regionFromLlm(o) : null;
      if (v) got.set(a.id, v);
      else {
        bad.push(a);
        if (opts.debug) console.error("MISS", attempt, JSON.stringify(head8(a.title_kr ?? "")), JSON.stringify(o ?? null));
      }
    });
    if (bad.length && attempt < 2) await run(bad, attempt + 1);
  }
  let idx = 0;
  let done = 0;
  await Promise.all(
    Array.from({ length: Math.max(1, opts.concurrency) }, async () => {
      while (idx < batches.length && usage.costUsd < opts.capUsd) {
        const b = batches[idx++];
        try {
          await run(b);
        } catch (e) {
          usage.errors.push((e as Error).message);
        }
        done++;
        opts.onProgress?.(done, batches.length, usage, got.size);
      }
    })
  );
  return got;
}

/**
 * 기사 묶음의 대상 지역 판정: 고신뢰 규칙 → 나머지 LLM. 백필·일일 재판정·금 표본이 이 함수 하나를 쓴다.
 * DB 를 쓰지 않는다 — 결과를 받은 쪽이 저장(조건부 갱신)한다.
 */
export async function rejudgeRegions(rows: JudgeRow[], options: JudgeOptions = {}): Promise<JudgeResult> {
  const opts = { capUsd: 0.1, caller: "region-rejudge", concurrency: 4, ...options };
  const usage: JudgeUsage = { calls: 0, costUsd: 0, errors: [] };
  const got = new Map<string, { value: RegionValue; stage: JudgeStage }>();
  const rest: JudgeRow[] = [];
  for (const a of rows) {
    const v = opts.rules !== false ? highConfidenceRegion(a) : null;
    if (v) got.set(a.id, { value: v, stage: "rule" });
    else rest.push(a);
  }
  if (opts.llm !== false && rest.length) {
    const llm = await classifyLlm(rest, opts, usage);
    for (const [id, value] of llm) got.set(id, { value, stage: "llm" });
  }
  usage.costUsd = Math.round(usage.costUsd * 1e6) / 1e6;
  return { got, unresolved: rows.filter((r) => !got.has(r.id)).map((r) => r.id), usage };
}

/** 수집 시간대(13:45–14:45, 23:45–00:45 UTC = 22:45–23:45, 08:45–09:45 KST) — LLM 묶음 판정을 시작하지 않는다 */
export function inIngestWindow(now = new Date()): boolean {
  const m = now.getUTCHours() * 60 + now.getUTCMinutes();
  return (m >= 13 * 60 + 45 && m <= 14 * 60 + 45) || m >= 23 * 60 + 45 || m <= 45;
}
