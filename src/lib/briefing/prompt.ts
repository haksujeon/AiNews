/**
 * 브리핑 프롬프트 (버전 관리). 프롬프트를 바꾸면 PROMPT_VERSION 을 올린다 —
 * input_hash 에 들어가므로 버전이 바뀌면 같은 날도 다시 생성된다.
 *
 * v1 (프로토타입 prompt-system.txt) 대비 v2 변경:
 *  - 중국 중심 규칙 (상위 5건 중 3건 이상 중국 기업·기관이 주체)
 *  - clusters 엄격 정의 (같은 주체 + 같은 사건만, 주제 묶음 금지)
 *  - 순위·배수 같은 서열 표현은 원문에 있을 때만 ("2위" 사고)
 *  - refs 에는 그 문장의 사실을 실제로 담은 기사만 (A16 사고)
 *  - 정치·외교 기사 제외
 *  - 짧은 판(물량 3~5건) 모드
 *  - top_stories 에 subject / subject_is_chinese
 */
import type { BriefingContent, CandidateGroup, EditionMode, ValidationIssue } from "./types";

export const PROMPT_VERSION = "ko-v2-2026-10-13";
export const TRANSLATE_PROMPT_VERSION = "tr-v4-2026-10-13";

const SCHEMA = `{
 "headline": "오늘 판 제목, 32자 이내",
 "lede": "오늘의 핵심 2~3문장, 200자 이내",
 "lede_refs": ["A.."],
 "top_stories": [  // 중요도 순 {TOP_RANGE}개
   {"rank":1, "section":"models|products|funding|chips|policy|safety|robotics|research|industry",
    "subject":"이 이야기의 주체 기업·기관 (기사 표기 그대로)", "subject_is_chinese": true,
    "title":"한 줄 제목 40자 이내", "what":"무슨 일인가 2문장 160자 이내",
    "why":"왜 중요한가 1~2문장 120자 이내", "refs":["A.."], "primary_ref":"A.."}
 ],
 "sections": [  // {SECTIONS_RULE}
   {"section":"models|products|funding|chips|policy|safety|robotics|research|industry",
    "items":[{"text":"한 줄 요약 70자 이내","refs":["A.."]}]}
 ],
 "key_numbers": [ {"value":"기사에 나온 그대로의 수치와 단위","label":"무엇의 수치인지 30자 이내","ref":"A.."} ],  // {NUMBERS_RANGE}개
 "companies_to_watch": [ {"name":"기업명","why":"40자 이내","refs":["A.."]} ],  // {COMPANIES_RANGE}개
 "term_of_the_day": {"term":"ARTICLES terms 에 있는 중국어 용어 그대로","pinyin":"그대로","ref":"A.."},
 "clusters": [ {"story":"사건 이름","ids":["A..","A.."]} ],  // 같은 사건을 다룬 2건 이상만
 "excluded": [ {"id":"A..","reason":"짧게"} ]
}`;

export function buildSystemPrompt(mode: EditionMode): string {
  const short = mode === "short";
  const schema = SCHEMA.replace("{TOP_RANGE}", short ? "1~3" : "4~5")
    .replace(
      "{SECTIONS_RULE}",
      short ? "짧은 판이므로 빈 배열 [] 로 둡니다" : "top_stories 에 안 쓴 기사 중 읽을 만한 것, 섹션별 1~3개, 섹션은 3~4개"
    )
    .replace("{NUMBERS_RANGE}", short ? "1~2" : "3~4")
    .replace("{COMPANIES_RANGE}", short ? "1~2" : "3");

  return `당신은 '중국 AI 뉴스' 사이트의 데일리 브리핑 편집자입니다. 한국 독자에게 오늘 중국 AI 업계에서 가장 중요한 흐름을 5분 안에 읽히게 정리합니다.

절대 규칙 (위반 시 출력 전체가 폐기됩니다)
1. 근거는 아래 ARTICLES 에 있는 내용뿐입니다. 사전 지식으로 사실·수치·인물·날짜를 보태지 마십시오.
2. 모든 항목은 refs 에 근거 기사 id(A01 형식)를 1개 이상 답니다. 존재하지 않는 id 를 만들지 마십시오.
3. refs 에는 그 항목의 사실을 실제로 담은 기사만 넣습니다. 그 문장에 나오는 기업·인물·제품 이름이 등장하지 않는 기사는 refs 에 넣지 마십시오.
4. 숫자(금액·%·MW·토큰·인원 등)는 근거 기사 title_kr/summary_kr/insight_kr 에 나온 값과 단위를 그대로 씁니다. 환산·반올림·합산 금지.
5. 순위("2위")·배수("3배")·비교("최초", "최대") 같은 서열 표현은 근거 기사에 그 표현이 그대로 있을 때만 씁니다. "2점 뒤졌다"를 "2위"로 바꾸는 식의 추론을 하지 마십시오.
6. clusters 에는 "같은 주체가 같은 행위를 한 같은 사건"을 다룬 기사만 묶습니다(예: 같은 기업의 같은 모델 발표를 여러 매체가 보도). "칩·메모리", "구현형 AI" 같은 주제 묶음은 금지입니다. 묶인 사건은 하나의 이야기로 쓰고 refs 에 모두 넣습니다.
7. 중국 중심: top_stories 상위 5건 중 3건 이상은 중국 기업·기관이 주체인 이야기여야 합니다. 해외 기업 소식은 중국 시장 영향이나 중국 매체의 시각이 드러나게 씁니다. subject_is_chinese 를 정직하게 표시하십시오.
8. AI·반도체·로봇·AI 비즈니스와 무관한 기사, 특히 정치·외교 기사(정상·총리·대통령 발언 등)는 선정하지 말고 excluded 에 사유와 함께 적습니다. 행사 모집 공고·홍보성 기사도 낮게 봅니다.
9. 한국어 문장에 한자를 쓰지 마십시오(용어 원어는 term_of_the_day.term 에만). 중국 기업·인물명은 기사 title_kr/summary_kr 의 한국어 표기를 따르되 한자 병기는 하지 않습니다.
10. 과장·추측·투자 권유 금지. 논쟁적인 주장은 "~라고 주장"처럼 주체를 밝힙니다. 평가가 엇갈리면 함께 적습니다. 존댓말이 아닌 간결한 평서문(~했다, ~이다)으로 씁니다.
${short ? "\n오늘은 기사가 적은 날입니다(짧은 판). top_stories 1~3건만 쓰고 sections 는 비웁니다. headline 은 \"오늘은 조용한 하루\"처럼 솔직하게 씁니다.\n" : ""}
중요도 판단 기준(높은 순): 여러 매체가 함께 다룬 사건(sources 수) > 대형 모델·칩·인프라의 구체적 발표 > 큰 금액의 투자·인수·상장 > 정책·규제 > 산업 분석/칼럼. 업계 영향이 큰 중국 기업(바이트댄스·알리바바·텐센트·화웨이·딥시크·문샷·지푸·미니맥스·바이두·샤오미 등)을 우선합니다. ARTICLES 는 사전 점수(score) 순으로 정렬되어 있습니다(참고용).

출력: 아래 스키마의 JSON 하나만. 코드 펜스·설명 금지.
${schema}`;
}

export function buildUserPrompt(date: string, groups: CandidateGroup[]): string {
  const lines = groups.map((g) => {
    const a = g.primary;
    const terms = (a.key_terms ?? [])
      .slice(0, 4)
      .filter((t) => t.term)
      .map((t) => `${t.term}(${t.pinyin ?? ""})`)
      .join(", ");
    return JSON.stringify({
      id: g.shortId,
      sources: g.sources,
      score: g.score,
      category: a.category,
      title_kr: a.title_kr,
      title_cn: a.title_cn,
      summary_kr: a.summary_kr,
      insight_kr: a.ai_insights_kr,
      terms,
    });
  });
  return `EDITION_DATE: ${date} (베이징 시간 기준 발행일)\nARTICLES (${lines.length}건, 한 줄에 하나):\n${lines.join("\n")}`;
}

export function buildRepairPrompt(
  draft: BriefingContent,
  fatal: ValidationIssue[],
  extra: string[]
): string {
  const problems = [
    ...fatal.map((f) => `- [${f.rule}] ${f.path}: ${f.detail}`),
    ...extra.map((e) => `- ${e}`),
  ].join("\n");
  return `아래 JSON 은 당신이 방금 쓴 브리핑입니다. 자동 검증에서 다음 문제가 나왔습니다.

${problems}

문제가 된 항목만 고쳐서 같은 스키마의 JSON 전체를 다시 출력하십시오.
- 근거 기사에 없는 숫자·서열 표현은 기사에 나온 표현으로 바꾸거나 문장에서 뺍니다.
- 존재하지 않거나 무관한 ref 는 빼고, 실제 근거 기사 id 로 바꿉니다.
- 중국 중심 규칙을 어겼다면 ARTICLES 에서 중국 기업·기관이 주체인 이야기를 상위로 올립니다.
- 문제가 없는 항목은 그대로 둡니다. 코드 펜스·설명 없이 JSON 하나만 출력합니다.

${JSON.stringify(draft)}`;
}

const LOCALE_NAME = { en: "English", zh: "简体中文" } as const;

export function buildTranslateSystemPrompt(target: "en" | "zh"): string {
  const zh = target === "zh";
  return `You translate a Korean daily briefing about the Chinese AI industry into ${LOCALE_NAME[target]}.

Rules (violations are rejected automatically):
1. Input is JSON. Output the SAME JSON structure: same keys, same array lengths, same order. Translate ONLY the string values of these keys: headline, lede, title, what, why, text, label, name, subject, story, reason, value.
2. Never change ids (A01...), refs, primary_ref, ref, rank, section codes, subject_is_chinese, term, pinyin.
3. Keep every number exactly as written in Arabic digits. ${
    zh
      ? "Korean 억 = 亿 and 만 = 万 (same magnitude), so '23억 위안' → '23亿元', '57.2만 개' → '57.2万个'."
      : "Convert Korean large-number units by magnitude: 억 = 100 million, 만 = 10 thousand (e.g. '23억 위안' → '2.3 billion yuan', '57.2만 개' → '572,000 units'). Do not round."
  }
4. ${
    zh
      ? "Write Simplified Chinese only; no Korean (Hangul) characters may remain. For company and person names use the Chinese name given in NAME_HINTS (taken from the original Chinese headlines) when available."
      : "Write English only; no Korean (Hangul) or Chinese characters may remain — not even inside quotes or 《》 titles. Write Chinese company, product and person names in their common English name or Hanyu Pinyin (e.g. 바이트댄스 → ByteDance, 량원펑 → Liang Wenfeng, 千问Go → Qwen Go, 《不问凡尘》 → \"Bu Wen Fan Chen\", 無問芯穹 → Infinigence)."
  }
5. Plain, neutral news style. No additions, no omissions, no hype.
6. NAME_HINTS are ONLY for spelling names. Never copy facts, years, ranks or numbers from NAME_HINTS into the translation — if the Korean text has no year or rank, the translation must not have one either.
Output only the JSON, no code fences.`;
}

export function buildTranslateUserPrompt(
  koPayload: unknown,
  nameHints: { ref: string; title_kr: string; title_cn: string }[]
): string {
  return `NAME_HINTS (Korean headline → original Chinese headline):\n${nameHints
    .map((h) => `${h.ref}: ${h.title_kr} ⇢ ${h.title_cn}`)
    .join("\n")}\n\nBRIEFING_JSON:\n${JSON.stringify(koPayload)}`;
}

export function buildTranslateRepairPrompt(problems: string[]): string {
  return `Automatic checks rejected your translation:\n${problems.map((p) => `- ${p}`).join("\n")}\nFix only those fields and output the full JSON again (same structure), no code fences.
For "number set differs": the translated field must contain exactly the numbers of the Korean field — delete any number, year or rank that is not in the Korean text, and restore any that is missing.`;
}
