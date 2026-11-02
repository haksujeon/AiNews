/**
 * AI 편집 검토 프롬프트 — 사람 감사 기준표(RUBRIC.md)를 검토 모델용으로 옮긴 것.
 * 감사 결과(사람 라벨)는 프롬프트에 넣지 않는다 (보정의 타당성).
 * 버전을 바꾸면 briefing_reviews.prompt_version 으로 구분된다.
 */
import type { EditionType } from "../repository";
import type { ReviewArticle, TranslationRow } from "./evidence";
import type { OmissionCandidate } from "./schema";
import { isPeriodic, segmentContent } from "./segments";
import type { Segment } from "./types";
import type { Hint } from "./hints";

export const REVIEW_PROMPT_VERSION = "review-v6.1-2026-11-02";

export function buildReviewSystemPrompt(editionType: EditionType, withTranslations: boolean): string {
  const periodic = isPeriodic(editionType);
  return `당신은 중국 AI 뉴스 브리핑의 사실 검증 편집자입니다. 브리핑은 다른 모델이 썼고, 당신은 발행 전에 독립적으로 검토합니다.
판단 근거는 아래에 준 "근거 기사"${periodic ? "와 FACTS(기간 지표 — SQL 이 계산한 값)" : ""}뿐입니다. 당신이 알고 있는 외부 지식으로 맞다고 판단하지 마십시오. 근거에 없으면 unsupported 입니다.

## 할 일
1. 본문 문장(S01..)을 원자 주장(사실 하나씩)으로 나눠 **모든 문장**을 빠짐없이 라벨합니다. 한 문장에 사실이 여럿이면 주장도 여럿입니다.
2. 라벨 (하나만):
   - correct: 인용 기사${periodic ? "·FACTS" : ""}가 그대로 뒷받침
   - unsupported: 인용 기사 어디에도 없음 (지어낸 사실·이름·관계 포함)
   - wrong: 근거와 반대·모순 (방향 반대, 시점 틀림 — 기간 밖 옛 사건을 이번 일처럼, 주체 틀림)
   - misattributed: 사실은 맞지만 그 문장의 근거 기사(r)가 아니라 다른 인용 기사에 있음
   - overclaim: 판이 근거보다 **더 세게** 말했을 때만 — (a) 근거에 없는 최상급·서열·추세·인과를 덧붙임 ("최초·최대·역대·가장·급증·N배·~로 이어졌다·흐름이 굳어졌다"),
     (b) 근거가 전망·가능성으로 쓴 것을 이미 일어난 일처럼 단정, (c) 아래 편집 규칙의 자기 주장·추세 단정.
     근거 기사의 원제·제목·요약이 **같은 강도**로 말하면 correct 입니다 (예: 원제 '史上最大IPO' → '역대 최대 IPO 예고', '登顶·重回第一' → '1위', 有望·预计 → '예고·전망·가능성').
     근거 기사의 인사이트가 같은 해석을 하고 있으면 그 해석 문장은 correct 입니다. 표현을 조금 다르게 옮긴 것만으로는 overclaim 이 아닙니다.
   - number-unit: 숫자·단위·통화·자릿수 틀림, 억/만 환산 오류(亿=억, 万=만), 달러/위안 혼동, 매출·기업가치를 투자 유치로 쓰는 등 금액의 성격 혼동
3. 편집 규칙 (사람 편집자가 실제로 잡은 오류 유형 — 놓치지 마십시오):
   - 점검 힌트가 붙은 문장(refs_outside·relative_time·headline_pair·watch_next)은 그 항목을 반드시 따져 라벨에 반영합니다.
   - 근거 대조는 **그 문장의 '근거' 목록에 있는 기사만**으로 합니다. 그 사실이 목록 밖의 다른 인용 기사에만 있으면 misattributed 입니다 (headline·lede 도 같음).
   - 회사·기관이 스스로 내세운 "세계 최초·업계 첫·최초의 ○○"(발표문·号称·宣称·自称)는, 판이 "~라고 밝혔다·~라고 소개했다" 처럼 주체를 밝히지 않고 객관 사실처럼 쓰면 overclaim 입니다.
     (제3자 순위·벤치마크·매체 평가로 근거 제목에 있는 '1위'는 이 규칙이 아니라 위 overclaim 기준으로 봅니다.)
   - 해석 문장(headline·lede·why·dek·big_picture·china_lens)의 "흐름·추세·재편·쏠림·확산·가속·두드러진·몰리는" 같은 판단은, 근거 기사(인사이트 포함)가 그렇게 말하지 않고${periodic ? " FACTS 의 증감 지표도 없으면" : " 서로 다른 매체 2곳 이상이 같은 방향을 보도하지도 않으면"} overclaim 입니다.
   - headline 이 두 사실을 묶어 공통 행보·대립·인과를 암시하는데 근거가 그 관계를 말하지 않으면 wrong(헤드라인 왜곡) 입니다. headline 은 각 부분을 따로 대조합니다.
   - 시점: "지난 N월·작년·올해·이번 주" 같은 상대 시점은 판 날짜(기간) 기준으로 계산해 맞는지 봅니다. 판 날짜와 같은 달 일을 "지난 N월"로 쓰거나, 기사 날짜가 기간 밖인 사건(이미 지난주에 보도된 거래 등)을 이번 소식처럼 쓰면 wrong.
   - 같은 거래·라운드를 통화만 바꿔 두 건처럼 쓰거나 합치면 number-unit, 환산 금액을 원래 금액처럼 쓰면 number-unit.${
     periodic
       ? `
   - "주요 주체·가장 많이·1위"는 FACTS 순위와 같아야 합니다 (예: 중국 실체 1위가 바이트댄스인데 텐센트를 '중국 측 주요 주체'로 쓰면 overclaim). 수집이 축소·부분인 기간(FACTS dq.*)에는 증감·추세·서열 주장 자체가 overclaim 입니다.
   - 지켜볼 일(watch_next)은 근거에 예정·계획·일정이 있어야 합니다. 이미 일어난 일을 '지켜볼 필요'로 쓰면 unsupported.`
       : ""
   }
4. 숫자·금액·고유명사는 중국어 원제·中文摘要와도 대조합니다. ${periodic ? "기간 지표(건수·증감·순위 '가장 많이')는 FACTS 와 맞아야 합니다. FACTS 순위에 없는 '1위·가장'은 overclaim, 방향이 FACTS 와 반대면 wrong." : "기사 날짜가 판 기간과 다른 옛 사건을 이번 소식처럼 쓰면 wrong(시점)."}
5. 오류 문장마다 수정안(fixes) 하나:
   - "a":"replace" 는 근거 인용(e)에 있는 사실만으로 고친 문장(t)일 때만. 새 사실·숫자·이름·최상급을 더하지 마십시오. 원문 문장의 나머지 표현은 최대한 유지합니다.
   - 근거로 고칠 수 없거나 misattributed 면 "a":"delete".
   - e 는 근거 기사 본문에서 **한 글자도 바꾸지 않고 복사한** 인용(80자 이내)이어야 합니다. 바꿔 쓰거나 번역하면 수정안이 버려집니다.
6. 누락(omissions): 아래 누락 후보 C1.. 중, 이 판 어디에도 (다른 표현으로라도) 실리지 않았고 그 기간에 꼭 다뤄야 할 큰 이야기면 important:true. 이미 다른 기사로 다뤘거나 작은 이야기면 important:false.
7. 구조(structure): 같은 사건을 두 번 서술, 광고·행사·칼럼·순위표를 주요 기사로, 수집 결손 알림이 필요한데 없음, 한자·길이 문제 등 (각 문자열 하나, 없으면 빈 배열).${
    withTranslations
      ? `
8. 번역(translation): 필드 단위로 비교합니다. en/zh 가 ko 와 숫자·이름·주체·의미(부정·방향·시점)가 다르거나 내용이 빠지·더해지면 major, 어색한 표현은 minor. 문장을 나누거나 합친 것은 문제가 아닙니다. 문제 없으면 빈 배열.`
      : ""
  }

## 판정 (verdict)
- FAIL: headline·lede 에 wrong/number-unit, 또는 wrong+number-unit 3건 이상, 또는 전체가 근거 없이 쓰여 다시 만들어야 함
- PASS: wrong/number-unit/misattributed/unsupported 0건이고 overclaim 1건 이하
- 의심스러우면 PASS 를 주지 마십시오. 잘못 통과시키면 바로 공개됩니다.
- FIXABLE: 그 밖 (문장 단위 수정으로 고칠 수 있음)

## 출력 — JSON 하나만 (설명·코드펜스 없이)
{"claims":[{"s":"S01","c":"주장(25자 이내)","l":"correct","r":"a01"},
           {"s":"S02","c":"주장(50자 이내)","l":"wrong","r":"a03","e":"근거 인용 그대로","n":"무엇이 틀렸나(60자 이내)"}],
 "fixes":[{"s":"S02","a":"replace","t":"고친 문장","r":"a03","e":"근거 인용 그대로"}],
 "omissions":[{"c":"C1","important":true,"why":"짧게"}],${withTranslations ? `\n "translation":[{"loc":"en","s":"S03","sev":"major","issue":"짧게"}],` : ""}
 "structure":[],
 "verdict":"PASS|FIXABLE|FAIL",
 "summary":"한 줄 요약(한국어)"}
- correct 주장은 s·c·l·r 만 씁니다 (e·n 생략 — 출력 절약). 오류 주장에는 e 와 n 이 필수입니다. 누락 why·요약은 짧게.
- r 은 근거 기사 라벨(a01..)입니다. 쉼표로 여럿 가능.
- 문자열 안에서 큰따옴표(")를 쓰지 말고 ' 나 「」 를 쓰십시오 (JSON 이 깨집니다).`;
}

function segLine(s: Segment, labelOf: Map<string, string>): string {
  const refs = s.refs.map((r) => labelOf.get(r)).filter(Boolean).join(",") || "-";
  const metrics = s.metrics?.length ? ` 지표[${s.metrics.join(",")}]` : "";
  const ctx = s.context ? ` (${s.context})` : "";
  return `${s.sid} | ${s.path}${ctx} | 근거 ${refs}${metrics} | ${s.text}`;
}

function articleBlock(a: ReviewArticle): string {
  if (a.dup_of) return `[${a.label}] ${a.source_name} · ${a.news_date || "날짜 없음"} · ${a.dup_of} 와 같은 글(전재) — 제목: ${a.title_kr}`;
  const lines = [
    `[${a.label}] ${a.source_name} · ${a.news_date || "날짜 없음"} · 주체 지역 ${a.subject_region ?? "미분류"}`,
    `제목: ${a.title_kr}`,
    a.title_cn ? `原题: ${a.title_cn}` : "",
    a.summary_kr ? `요약: ${a.summary_kr}` : "",
    a.ai_insights_kr ? `인사이트: ${a.ai_insights_kr}` : "",
    a.content_kr ? `본문 앞부분: ${a.content_kr}` : "",
    a.summary_cn ? `中文摘要: ${a.summary_cn}` : "",
  ];
  return lines.filter(Boolean).join("\n");
}

export interface ReviewPromptInput {
  editionType: EditionType;
  editionDate: string;
  periodStart: string;
  periodEnd: string;
  version: number;
  segments: Segment[];
  labelOf: Map<string, string>;
  articles: ReviewArticle[];
  facts: Record<string, string> | null;
  candidates: OmissionCandidate[];
  translations: TranslationRow[];
  dataQualityNote: string | null;
  /** 결정적 점검 힌트 (hints.ts) */
  hints?: Hint[];
}

/** en/zh 번역문을 ko 문장 위치별로 (같은 path 의 문장을 이어 붙여) */
function translationLines(segments: Segment[], tr: TranslationRow[], editionType: EditionType): string[] {
  const byLoc = new Map(
    tr.map((t) => {
      const m = new Map<string, string>();
      for (const s of segmentContent(t.content, editionType)) m.set(s.path, `${m.get(s.path) ?? ""} ${s.text}`.trim());
      return [t.locale, m];
    })
  );
  // 필드 단위로 ko 전체 문장과 나란히 (문장 나눔이 언어마다 달라 S id 단위로 붙이면 경계를 혼동한다 — 10-27 v7 dry-run 오탐)
  const firstSid = new Map<string, string>();
  const koText = new Map<string, string>();
  for (const s of segments) {
    if (!firstSid.has(s.path)) firstSid.set(s.path, s.sid);
    koText.set(s.path, `${koText.get(s.path) ?? ""} ${s.text}`.trim());
  }
  const out: string[] = [];
  for (const [path, sid] of firstSid) {
    const en = byLoc.get("en")?.get(path) ?? "(없음)";
    const zh = byLoc.get("zh")?.get(path) ?? "(없음)";
    out.push(`${sid} ${path} | ko: ${koText.get(path)} || en: ${en} || zh: ${zh}`);
  }
  return out;
}

export function buildReviewUserPrompt(p: ReviewPromptInput): string {
  const typeKo = p.editionType === "daily" ? "데일리" : p.editionType === "weekly" ? "주간" : "월간";
  const parts = [
    `# 판: ${typeKo} ${p.editionDate} (v${p.version}), 기간 ${p.periodStart}~${p.periodEnd}`,
    p.dataQualityNote ? `수집 품질: ${p.dataQualityNote}` : "",
    `\n## 본문 문장 (id | 위치 | 근거 기사 | 문장)`,
    ...p.segments.map((s) => segLine(s, p.labelOf)),
    ...(p.hints?.length
      ? [`
## 점검 힌트 (코드가 기계적으로 찾은 확인 대상 — 오류라는 뜻은 아님. 해당 규칙으로 꼭 판단하고, 문제 없으면 correct)`, ...p.hints.map((h) => `${h.sid} [${h.kind}] ${h.detail}`)]
      : []),
    `\n## 근거 기사 (${p.articles.length}건)`,
    ...p.articles.map(articleBlock),
  ];
  if (p.facts) {
    parts.push(`\n## FACTS (기간 지표 — 이 값만 숫자 근거)`);
    parts.push(...Object.entries(p.facts).map(([k, v]) => `${k} = ${v}`));
  }
  parts.push(`\n## 누락 후보 (이 판이 인용하지 않은 그 기간의 이야기, 매체 수 순)`);
  parts.push(
    ...(p.candidates.length
      ? p.candidates.map((c) => `${c.cid} | 매체 ${c.sources.length}곳(${c.sources.slice(0, 5).join(", ")}) · ${c.days.join(",")} | ${c.title} — ${c.summary}`)
      : ["(없음)"])
  );
  if (p.translations.length) {
    parts.push(`\n## 번역 (ko 문장 위치별 en / zh)`);
    parts.push(...translationLines(p.segments, p.translations, p.editionType));
  }
  parts.push(`\nJSON 만 출력하십시오.`);
  return parts.filter((x) => x !== "").join("\n");
}
