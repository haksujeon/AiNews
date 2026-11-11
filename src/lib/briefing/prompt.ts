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
import type { PreviousEdition } from "./repository";
import { HEADLINE_MAX, WHY_MAX } from "./validate";
import { isChinaCandidate } from "./rules";

// v3: headline 32자 엄수(수리 대상), lede 실체 근거·"중국 내" 귀속 규칙
// v4 (2026-11-02 편집 QA): 헤드라인 = 1위 기사, 원문 수식어 보존, 예전 사건 시점 표시, 직전 판 반복 표시,
//   매출·가치 금액을 거래처럼 쓰지 않기, 매체 수 그대로, 지시문 누출 금지, 사건 단위 매체 수(event_sources)
// v4.1: ARTICLES 에 cn(중국 주체 후보) 표시, 같은 사건을 두 칸에 나누지 않기, 상위 5건 중국 주체 수를 세어 보기
// v4.2: 중국 주체 목표 4건(최소 3건) — 검증에서 중국 주체 기사 1건이 빠져도 판이 살아남게
// v4.3: 중국 주체 = 기사 대상 지역(region: CN, 대만·홍콩 포함) — ARTICLES 에 region 표시, cn 은 region 기준(없을 때만 제목 실체),
//   subject 는 근거 기사에 나온 주체만 (근거 없는 주체·항목은 치명)
// v4.4 (재감사 round 2): 삭제 전 부분 수리(문제 칸만 다시 씀), "지난 N월" 금지(판과 같은 달), 같은 기사를 두 주요 기사에 쓰지 않기
// v4.5 (2026-11-03 결정 D3·S2): 중국 주체는 믿을 만한 후보가 있을 때만 3건 이상 — 모자라면 지어내지 말고 있는 만큼(반려하지 않음),
//   ARTICLES 상위 묶음에 body_kr(본문 요지) 추가, insight_kr 은 AI 해설이라 사실·평가 근거가 아님, 근거 없는 분석 덧붙이기 금지
// v4.6 (2026-11-03 사용자 요청): why 를 쉬운 말로 — "무엇이 달라지는가", 업계 용어·약어 풀어 쓰기, 숫자는 what 에 (규칙 20)
// v5.0 (2026-11-09 사용자 결정 "반영"): 주요 기사 = 중국 묶음(1~5위, 중국 주체 최대 5건) + 해외 묶음(6~8위, 최대 3건).
//   헤드라인·lede 는 중국 묶음 이야기로만(아침 메일은 중국 묶음만 싣는다), 후보 줄 recent = 최근 3개 판에 실린 같은 회사 이야기
//   (새 숫자·새 발표가 있을 때만 "후속:"), 해외 묶음은 해외 후보 중 중요도 순
// v5.1 (2026-11-11 사용자 결정): why 를 "배경 → 그래서 의미" 짜임으로 쉽게 (규칙 20 — 기사 말 줄여 옮기기·남의 판단 인용으로 끝내기 금지,
//   조언·일반화·숫자 금지, 주체 이름 유지), why 150자, body_kr 450→1200자 (11-10 펑터우거 why — 핵심 문장이 450자 밖에서 잘렸다)
export const PROMPT_VERSION = "ko-v5.1-2026-11-11";
// v6: 이름 힌트에 중국어 요약 앞부분(고유명사 표기용), 범위 "7~10%" 를 "7%至10%" 로 써도 됨
// v7 (2026-11-02 재감사 round 2): NAME_GLOSSARY(entities.ts 이름표 ko = en = zh) — 번역본 이름을 이름표와 대조, 작은 수·소수점 표기도 대조
export const TRANSLATE_PROMPT_VERSION = "tr-v7-2026-11-02";

const SCHEMA = `{
 "headline": "오늘 판 제목, 공백 포함 ${HEADLINE_MAX}자 이내 (엄수)",
 "lede": "오늘의 핵심 2~3문장, 200자 이내",
 "lede_refs": ["A.."],
 "top_stories": [  // {TOP_RANGE}
   {"rank":1, "section":"models|products|funding|chips|policy|safety|robotics|research|industry",
    "subject":"이 이야기의 주체 기업·기관 (기사 표기 그대로)", "subject_is_chinese": true,
    "title":"한 줄 제목 40자 이내", "what":"무슨 일인가 2문장 160자 이내",
    "why":"왜 중요한가: 이 소식이 누구에게 무엇을 뜻하는지 쉬운 말로 1~2문장 ${WHY_MAX}자 이내 (규칙 20)", "refs":["A.."], "primary_ref":"A.."}
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

/**
 * why·lede 규칙 19·20 (v4.6, v5.1 에서 규칙 20 짜임). 생성 프롬프트와 발행본 why 다시 쓰기(scripts/briefing-why-rewrite.ts)가 같은 문장을 쓴다 (Gate 2).
 * 규칙 4 = 숫자는 근거 기사 값·단위 그대로.
 */
export const WHY_RULES = `19. body_kr 은 기사 본문 요지(원문에서 만든 사실 요약)로, 사실·숫자 근거로 씁니다. insight_kr 은 AI가 쓴 해설이라 사실 근거가 아닙니다. why·lede 에는 기사에 나온 사실에서 읽히는 의미만 쓰고, 기사에 없는 평가·비교·전망(경쟁 판도 변화, 격차 분석, "독립 검증이 필요하다", "장벽을 낮춘다" 등)을 덧붙이지 마십시오. 의미를 말할 근거가 없으면 새 평가를 지어내지 말고, 기사에 나온 사실이 무엇을 뜻하는지 쉬운 말로 풀어 쓰십시오(규칙 20).
20. why(왜 중요한가)는 AI·경제를 잘 모르는 일반 독자(중학생)가 what 을 읽고 "그래서 그게 왜?"라고 물을 때의 대답입니다.
   - 짜임: ① 독자가 모르면 뜻이 안 통하는 배경 한 가지를 쉬운 말로(필요할 때만) → ② "그래서" 누가(사용자·회사·투자자 등) 무엇을 얻거나 잃는지, 또는 무엇을 따져 보게 되는지. ①과 ②는 "그래서"를 넣어 읽어도 자연스럽게 이어져야 합니다. what 을 되풀이하거나 사실을 하나 더 늘어놓지 마십시오.
   - 배경(①)도 근거 기사에 나온 사실로만 씁니다. 기사가 밝히지 않은 까닭("~이기 때문이다")·속사정·평가를 지어 넣지 마십시오. 기사에 배경이 없으면 ①을 빼고 ②만 씁니다.
   - ②도 기사에 나온 사실이 곧바로 뜻하는 것만 씁니다. 기사에 없는 조언·당부("~해야 한다", "~을 알아 둘 필요가 있다"), 일반화("반복 업무가 줄어든다"), 예전 상태 짐작("전에는 ~했다"), 정해지지 않은 선택을 단정("~로 옮겨 가야 한다")은 쓰지 않습니다. "투자자가 따져 보게 된다"는 기사가 그 질문·쟁점을 말할 때만 씁니다.
   - 쉬운 풀이는 낱말 뜻풀이(예: "강화학습 = AI가 시행착오로 배우는 방법")까지만 허용합니다. 사전 지식으로 사실을 보태지 않습니다.
   - 원문의 단서("일부 왜곡이 있었지만", "가능성", "계획", "알려졌다")를 지우지 말고, what 의 핵심 사건에서 다른 사실로 주제를 바꾸지 마십시오.
   - 의미가 여러 가지면 독자에게 가장 크게 와닿는 것부터 최대 두 가지(예: 쓰는 사람에게 + 돈을 내는 회사에게).
   - 기사 문장을 줄여 옮기지 말고 풀어 씁니다. summary_kr·insight_kr 의 압축된 말("핵심 쟁점", "직접 판매 여부", "구조", "가능성")을 그대로 가져오지 마십시오. 대비가 숨은 말은 대비를 드러냅니다(예: "A를 거쳐 쓰인다" → "회사들이 직접 사지 않고 A에서 빌려 쓴다").
   - "기사는 ~라고 본다"처럼 남의 판단만 옮기고 끝내지 마십시오. 기사의 판단을 쓸 때는 그 판단이 나온 까닭을 함께 씁니다.
   - 쉬운 낱말로 씁니다. 토큰·API·라운드·KOL·IPO·비반복성 손익·밸류에이션 같은 업계 용어와 영문 약어는 쓰지 말고 풀어 씁니다(예: "토큰 사용량" → "AI가 처리하는 글의 양", "라운드" → "투자 유치", "IPO" → "주식시장 상장"). 회사·제품 이름은 그대로 둡니다.
   - why 에는 숫자(금액·%·배수·횟수·기간, "백 번"처럼 말로 쓴 수 포함)를 쓰지 않습니다. 숫자는 what 에 있습니다. 비교가 꼭 필요하면 "절반도 안 되는 값", "크게 싸졌다"처럼 말로 풉니다(근거 기사에 그 비교가 있을 때만).
   - 주체 이름은 subject·what 과 같은 이름을 씁니다(자회사를 모회사 이름으로, 제품을 회사 이름으로 바꾸지 않습니다).
   - 근거는 규칙 19와 같습니다: 기사에 없는 전망·비교·평가·인과·추세("흐름", "경쟁 가열")를 보태지 않습니다. 쉬운 풀이는 허용되지만 새 사실이 되어서는 안 됩니다.
   - 다 쓴 뒤 점검: 이 why 만 읽은 중학생이 "그래서 누구에게 뭐가 달라지는데?"에 답할 수 있습니까? 뜻을 모를 낱말이 하나라도 있습니까? 답할 수 없거나 모를 말이 있으면 다시 씁니다.
   - 좋은 예: "개발자가 일일이 지시하지 않아도 AI가 스스로 문제를 찾아 고치게 하려는 시도다. 딥시크는 이미 사내 개발에 이를 쓰고 있다."
   - 나쁜 예(사실 나열): "연구개발비는 3분기 1.27억 위안으로 249.58% 늘었다." / 나쁜 예(근거 없는 전망): "업계 판도를 바꿀 것이다." / 나쁜 예(기사 말 줄여 옮기기): "B사 제품은 대부분 C를 거쳐 팔린다. 기사는 직접 판매 여부가 핵심 쟁점이라고 본다." — 왜 그게 문제인지, 누가 따지는지가 없다.`;

export function buildSystemPrompt(mode: EditionMode): string {
  const short = mode === "short";
  const schema = SCHEMA.replace(
    "{TOP_RANGE}",
    short ? "중요도 순 1~3개" : "중국 묶음(중국 주체 이야기, 중요도 순 최대 5개)을 먼저, 그다음 해외 묶음(해외 이야기, 중요도 순 최대 3개). rank 는 1부터 이어서"
  )
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
4. 숫자(금액·%·MW·토큰·인원 등)는 근거 기사 title_kr/summary_kr/body_kr 에 나온 값과 단위를 그대로 씁니다. 환산·반올림·합산 금지.
5. 순위("2위")·배수("3배")·비교("최초", "최대") 같은 서열 표현은 근거 기사에 그 표현이 그대로 있을 때만 씁니다. "2점 뒤졌다"를 "2위"로 바꾸는 식의 추론을 하지 마십시오.
6. clusters 에는 "같은 주체가 같은 행위를 한 같은 사건"을 다룬 기사만 묶습니다(예: 같은 기업의 같은 모델 발표를 여러 매체가 보도). "칩·메모리", "구현형 AI" 같은 주제 묶음은 금지입니다. 묶인 사건은 하나의 이야기로 쓰고 refs 에 모두 넣습니다.
7. 묶음: top_stories 는 두 묶음입니다. ① 중국 묶음 — 중국 기업·기관이 주체인 이야기를 중요도 순으로 5건(목표). 근거가 충분한 중국 이야기가 모자란 날에는 억지로 채우지 말고 있는 만큼만 쓰십시오(해외 이야기로 채우지 않습니다. 판은 반려되지 않으며, 그런 날의 안내 문장은 시스템이 붙이므로 lede 에 해외 소식 비중에 대한 말을 쓰지 마십시오). 중국 묶음은 3건 이상이어야 합니다(믿을 만한 중국 후보가 그보다 적은 날은 예외). 근거 기사에 없는 중국 항목을 만들면 판 전체가 반려됩니다. ② 해외 묶음 — 중국 밖 기업·기관이 주체인 이야기를 중요도 순으로 최대 3건. 해외 후보 가운데 여러 매체가 다룬 사건·큰 발표를 먼저 고르고, 다른 해외 기사를 고를 때는 더 중요한 해외 후보를 건너뛰지 마십시오. 중국 묶음을 모두 쓴 뒤 해외 묶음을 이어서 씁니다(rank 1부터 이어서). "중국 주체"는 근거 기사의 region(기사 대상 지역)이 CN 인 이야기입니다(대만·홍콩 기사도 CN). ARTICLES 의 cn:true 는 region 이 CN 인 후보(region 이 없으면 제목에 중국 기업·기관이 나오는 후보)입니다. region 이 CN 이 아닌 기사(US 등)를 근거로 쓴 이야기는 subject_is_chinese:true 로 표시해도 중국 주체로 세지 않습니다. 다 쓴 뒤 중국 묶음의 subject_is_chinese:true 수를 세어 보십시오. subject 에는 refs 기사에 실제로 나오는 주체만 씁니다(근거 기사에 없는 기업을 주체로 만들면 그 항목이 폐기됩니다). 같은 사건(같은 주체의 같은 발표·같은 서류)을 top_stories 두 칸에 나누지 마십시오. 해외 기업 소식은 중국 시장 영향이나 중국 매체의 시각이 드러나게 씁니다. subject_is_chinese 를 정직하게 표시하십시오.
8. AI·반도체·로봇·AI 비즈니스와 무관한 기사, 특히 정치·외교 기사(정상·총리·대통령 발언 등)는 선정하지 말고 excluded 에 사유와 함께 적습니다. 행사 모집 공고·홍보성 기사도 낮게 봅니다.
9. 한국어 문장에 한자를 쓰지 마십시오(용어 원어는 term_of_the_day.term 에만). 중국 기업·인물명은 기사 title_kr/summary_kr 의 한국어 표기를 따르되 한자 병기는 하지 않습니다.
10. 과장·추측·투자 권유 금지. 논쟁적인 주장은 "~라고 주장"처럼 주체를 밝힙니다. 평가가 엇갈리면 함께 적습니다. 존댓말이 아닌 간결한 평서문(~했다, ~이다)으로 씁니다.
11. headline 은 공백 포함 ${HEADLINE_MAX}자 이내입니다(넘으면 반려). 쓰고 나서 글자 수를 세어 보십시오. top_stories 1위 이야기(중국 묶음 1위, 필요하면 2위까지)의 사건만 담고, 1위 이야기의 주체 이름을 넣습니다. "~로 무게 이동", "~ 경쟁 가열" 같은 추세 문장은 쓰지 않습니다.
12. lede 의 모든 기업·인물·제품 이름은 lede_refs 기사에 나와야 합니다. lede 에 쓴 이야기의 근거 기사를 모두 lede_refs 에 넣으십시오. lede 는 중국 묶음 이야기로만 씁니다(아침 메일에는 중국 묶음만 실리므로 해외 묶음 이야기를 lede 에 쓰지 마십시오).
13. "중국 내", "중국에서는" 같은 표현에는 중국 기업·기관의 중국 안 사실만 담습니다. 해외 기업(Anthropic·OpenAI·Meta 등)의 해외 사업(일본 데이터센터 등)을 "중국 내" 흐름으로 묶지 마십시오.
14. 원문 수식어를 지우지 마십시오: "경량 모델 중 최고"의 '중', "IPO가 될 전망"의 '전망', '예정·계획·가능성·~로 알려졌다', "OpenRouter에서 처음" 같은 플랫폼·데이터 범위, 기간(1분기 등). 회사가 스스로 내세운 "세계 최초"는 "~라고 밝혔다"로 씁니다.
15. 시점: 기사가 오늘 이전 날짜의 사건(예: "9월 8일 공개한 증명")을 다루면 "9월 8일 공개한 ~"처럼 기사의 날짜를 밝히고 오늘 일어난 일처럼 쓰지 마십시오. 판과 같은 달의 일을 "지난 ○월"이라고 쓰지 마십시오(지난해 일로 읽힙니다). 앞으로 있을 일("11월 4일 베타 시작")은 예정으로 씁니다. 같은 기사를 주요 기사 두 칸의 근거로 쓰지 말고, 주요 기사에 쓴 사건을 sections 에 다시 쓰지 마십시오.
16. PREVIOUS_EDITION 에 이미 나온 사건은 새 사실이 있을 때만 쓰고, 그때는 title 을 "후속:"으로 시작합니다. ARTICLES 의 recent 는 최근 3개 판에 실린 같은 회사의 비슷한 이야기입니다(같은 사건이 아닐 수도 있습니다). recent 가 붙은 후보가 그 판 이야기와 같은 사건이면 새 숫자·새 발표가 있을 때만 후속으로 싣고, 같은 내용의 반복이면 주요 기사로 고르지 마십시오.
17. 매출·영업이익·손실·기업가치·시가총액 금액을 "확보·유치·조달" 같은 거래 금액처럼 쓰지 마십시오. 금액은 단위까지 기사 그대로("162억 9,000만 달러"를 "162억 달러"로 자르지 않음).
18. "두 매체가 전했다"처럼 매체 수를 쓸 때는 그 기사의 sources 수 그대로 씁니다. 출력 문장에 지시·메모(괄호 설명, "~ 대신 ~")를 남기지 마십시오.
${WHY_RULES}
${short ? "\n오늘은 기사가 적은 날입니다(짧은 판). top_stories 1~3건만 쓰고 sections 는 비웁니다. headline 은 \"오늘은 조용한 하루\"처럼 솔직하게 씁니다.\n" : ""}
중요도 판단 기준(높은 순): 여러 매체가 함께 다룬 사건(event_sources = 같은 사건을 다룬 매체 수, 제목이 달라도 같은 사건이면 함께 셈) > 대형 모델·칩·인프라의 구체적 발표 > 큰 금액의 투자·인수·상장 > 정책·규제 > 산업 분석/칼럼. 업계 영향이 큰 중국 기업(바이트댄스·알리바바·텐센트·화웨이·딥시크·문샷AI·지푸·미니맥스·바이두·샤오미 등)을 우선합니다. 한 매체만 다룬 해외 연구 논문은 주요 기사에 넣지 않습니다. ARTICLES 는 사전 점수(score) 순으로 정렬되어 있습니다(참고용).

출력: 아래 스키마의 JSON 하나만. 코드 펜스·설명 금지.
${schema}`;
}

/** body_kr 을 넣는 상위 묶음 수와 글자 상한 (S2). 2026-11-11 450→1200: 기사의 '그래서' 문장이 앞부분 뒤에 오는 일이 많다 */
export const BODY_GROUPS = 25;
export const BODY_MAX = 1200;
/** 생성 입력의 body_kr 과 같은 자르기 — AI 검토 근거(review/evidence.ts)도 이것을 써서 "본 근거 = 검토 근거" (S2) */
export function clipBody(t: string): string {
  const x = t.replace(/\s+/g, " ").trim();
  if (x.length <= BODY_MAX) return x;
  // 문장 끝에서 자른다 (말줄임표 없이)
  const cut = x.slice(0, BODY_MAX);
  const end = cut.lastIndexOf(". ");
  return end > BODY_MAX * 0.5 ? cut.slice(0, end + 1) : cut;
}

export function buildUserPrompt(date: string, groups: CandidateGroup[], previous: PreviousEdition | null = null, mustInclude: string[] = []): string {
  const lines = groups.map((g, i) => {
    const a = g.primary;
    const terms = (a.key_terms ?? [])
      .slice(0, 4)
      .filter((t) => t.term)
      .map((t) => `${t.term}(${t.pinyin ?? ""})`)
      .join(", ");
    return JSON.stringify({
      id: g.shortId,
      sources: g.sources,
      ...(g.eventSources && g.eventSources.length > g.sources.length ? { event_sources: g.eventSources.length } : {}),
      ...(a.subject_region ? { region: a.subject_region } : {}),
      ...(isChinaCandidate(a) ? { cn: true } : {}),
      score: g.score,
      // P4: 최근 3개 판에 실린 같은 회사 이야기 (점수에는 넣지 않음)
      ...(g.recent ? { recent: g.recent } : {}),
      category: a.category,
      title_kr: a.title_kr,
      title_cn: a.title_cn,
      summary_kr: a.summary_kr,
      insight_kr: a.ai_insights_kr,
      // S2: 점수 상위 묶음만 본문 요지 (입력 길이 상한 — 후보 40건 전부면 호출당 약 1만 토큰 늘어난다)
      ...(i < BODY_GROUPS && a.content_kr ? { body_kr: clipBody(a.content_kr) } : {}),
      terms,
    });
  });
  const prev = previous
    ? `PREVIOUS_EDITION (${previous.date} 판 — 같은 사건이면 새 사실만, title 을 "후속:"으로): ${[previous.headline, ...previous.titles].join(" / ")}\n`
    : "";
  // 누락 재생성 (2026-11-03): 앞선 판 AI 검토가 "중요한데 빠졌다"고 지적한 사건
  const must = mustInclude.length
    ? `MUST_INCLUDE: ${mustInclude.join(", ")} — 앞선 판 검토에서 중요한데 빠졌다고 지적된 사건입니다. 근거 기사로 확인되는 사실만으로 top_stories 또는 sections 에 반드시 넣으십시오 (중국 중심 규칙과 다른 규칙은 그대로).\n`
    : "";
  return `EDITION_DATE: ${date} (베이징 시간 기준 발행일)\n${prev}${must}ARTICLES (${lines.length}건, 한 줄에 하나):\n${lines.join("\n")}`;
}

/**
 * 부분 수리 (삭제 전 마지막 시도): 남은 치명 칸만 보여 주고 그 칸의 새 문장만 받는다 (전체 JSON 을 다시 쓰지 않아 싸고, 다른 칸을 건드리지 않는다).
 * 응답: {"<path>": "새 문장", ...}. 고칠 수 없으면 그 칸을 빼고 답한다 (그 항목은 삭제된다).
 */
export function buildTargetedRepairPrompt(fields: { path: string; text: string; limit?: number; problems: string[] }[]): string {
  const lines = fields
    .map((f) => `- ${f.path}${f.limit ? ` (최대 ${f.limit}자)` : ""}: ${JSON.stringify(f.text)}\n  문제: ${f.problems.join(" / ")}`)
    .join("\n");
  return `자동 검증에서 아래 칸들이 아직 문제입니다. 이 칸들만 고친 새 문장을 주십시오. 고칠 수 없으면 그 칸은 답에서 빼십시오(그 항목은 삭제됩니다).
${lines}

규칙: 근거 기사(ARTICLES)에 있는 사실·숫자·표현만, 한자 금지(한국어 표기), 글자 수 상한 엄수, 원문 수식어 유지, 지시문·메모 금지.
사실을 뒤집거나 새 사실을 보태지 말고, 문제가 된 표현을 빼거나 기사 표현으로 바꾸십시오.
출력: {"칸 경로": "새 문장"} 형태의 JSON 하나만. 코드 펜스·설명 금지.`;
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
- headline 이 ${HEADLINE_MAX}자를 넘었다면 뜻을 유지한 채 ${HEADLINE_MAX}자 이내로 다시 씁니다 (말줄임표로 자르지 않습니다).
- unsupported_entity / china_attribution 이 나온 문장은 근거 기사에 있는 사실만 남기고, 해외 기업의 해외 사업을 "중국 내" 로 묶지 않게 고칩니다.
- headline_not_top_story: headline 을 top_stories 1위 이야기(주체 이름 포함)로 다시 쓰거나, 헤드라인의 이야기를 1위로 올립니다.
- qualifier_dropped / superlative_unsupported / trend_unsupported: 기사에 있는 표현과 한정어('중', '전망', 플랫폼 범위)를 그대로 쓰거나 그 표현을 뺍니다.
- stale_event: 예전 사건은 "지난 ○월 공개한 ~" 처럼 시점을 밝힙니다. money_not_deal / currency_mismatch / amount_not_in_source: 매출·가치를 거래처럼 쓰지 말고, 금액·통화는 기사 그대로.
- length: 글자 수 상한 안으로 줄입니다 (말줄임표로 자르지 않습니다).
- 고친 결과만 씁니다. "~ 대신 ~", "(수정)" 같은 지시문·메모를 본문에 남기지 마십시오.
- 문제가 없는 항목은 그대로 둡니다. 코드 펜스·설명 없이 JSON 하나만 출력합니다.

${JSON.stringify(draft)}`;
}

const LOCALE_NAME = { en: "English", zh: "简体中文" } as const;

/** 번역 규칙 3~8 (숫자·이름·문체) — 데일리 번역과 주간·월간 번역(periodic/translate.ts)이 같이 쓴다 (Gate 2) */
export function translateCommonRules(target: "en" | "zh"): string {
  const zh = target === "zh";
  return `3. Numbers: ${
    zh
      ? "copy every number VERBATIM — the same digits in the same order. Only swap the unit character 1:1: 억 → 亿, 만 → 万, 조 → 万亿, 천 → 千 (e.g. '23억 위안' → '23亿元', '57.2만 개' → '57.2万个', '5억 3,700만 명' → '5亿3700万人'). Never rewrite the digits (no 53700万, no 0.23万亿), never use k/K, never convert currencies."
      : "keep every value exactly. Korean 억/만/조 have no English unit, so state the SAME value with million/billion/trillion (억 = 100 million, 만 = 10 thousand, 조 = trillion): '23억 위안' → '2.3 billion yuan', '57.2만 개' → '572,000 units', '5억 3,700만 명' → '537 million people'. Never round, never abbreviate with k/K, never write long raw digits like 2300000000, never convert currencies. Numbers without a Korean unit (1,600 / 34% / 500MW) stay exactly as written."
  }
   Never add a number, year, date or rank that is not in the Korean field — not even when it seems helpful context.
4. ${
    zh
      ? "Write Simplified Chinese only; no Korean (Hangul) characters may remain. For company and person names use the Chinese name given in NAME_HINTS (taken from the original Chinese headlines) when available."
      : "Write English only; no Korean (Hangul) or Chinese characters may remain — not even inside quotes or 《》 titles. Write Chinese company, product and person names in their common English name or Hanyu Pinyin (e.g. 바이트댄스 → ByteDance, 량원펑 → Liang Wenfeng, 千问Go → Qwen Go, 《不问凡尘》 → \"Bu Wen Fan Chen\", 無問芯穹 → Infinigence)."
  }
5. Plain, neutral news style. No additions, no omissions, no hype.
6. NAME_HINTS are ONLY for spelling names (their digits are masked as #). Never copy facts from NAME_HINTS into the translation. NAME_GLOSSARY lines are "Korean = English = Chinese": when a Korean name in the glossary appears, write exactly the glossary spelling for your language (e.g. 천가오 = Tiangai = 天垓, 즈지동력 = LimX Dynamics = 逐际动力) — never invent a pinyin spelling for a name in the glossary.
8. Copy version numbers and small numbers exactly (Feishu 8.0 stays 8.0, Gemini 4 stays 4).
7. Translate each field on its own: the translated field must contain exactly the facts and numbers of the same Korean field — do not move information between fields.`;
}

export function buildTranslateSystemPrompt(target: "en" | "zh"): string {
  return `You translate a Korean daily briefing about the Chinese AI industry into ${LOCALE_NAME[target]}.

Rules (violations are rejected automatically):
1. Input is JSON. Output the SAME JSON structure: same keys, same array lengths, same order. Translate ONLY the string values of these keys: headline, lede, title, what, why, text, label, name, subject, story, reason, value.
2. Never change ids (A01...), refs, primary_ref, ref, rank, section codes, subject_is_chinese, term, pinyin.
${translateCommonRules(target)}
Output only the JSON, no code fences.`;
}

export function buildTranslateUserPrompt(
  koPayload: unknown,
  nameHints: { ref: string; title_kr: string; title_cn: string; summary_cn?: string }[],
  glossary: string[] = []
): string {
  return `${glossary.length ? `NAME_GLOSSARY (Korean = English = Chinese):\n${glossary.join("\n")}\n\n` : ""}NAME_HINTS (Korean headline → original Chinese headline [| start of the original Chinese summary, for names only]):\n${nameHints
    .map((h) => `${h.ref}: ${h.title_kr} ⇢ ${h.title_cn}${h.summary_cn ? ` | ${h.summary_cn}` : ""}`)
    .join("\n")}\n\nBRIEFING_JSON:\n${JSON.stringify(koPayload)}`;
}

export function buildTranslateRepairPrompt(problems: string[]): string {
  return `Automatic checks rejected your translation:\n${problems.map((p) => `- ${p}`).join("\n")}\nFix only those fields and output the full JSON again (same structure), no code fences.
For "number set differs": the translated field must contain exactly the numbers of the Korean field — delete any number, year or rank that is not in the Korean text, and restore any that is missing.`;
}
