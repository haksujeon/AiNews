/**
 * 한국어 본문의 회사 이름 표기를 하나로 맞춘다 (한국 언론 표기).
 *
 * 한자 사전(han-glossary)은 한자 덩어리만 바꾸므로, 한글로 음차된 표기("월지암면")는 여기서 고친다.
 * 데일리·주간·월간(validate.ts glossHanText), 히스토리 분석(story-gen toKoRow), 기사 한국어 필드 일괄 정리가 이 함수 하나를 쓴다 (Gate 2).
 *
 * - 긴 표기부터 바꾼다: 월지암면 → 월지암 → 문샷 AI → 맨 "문샷".
 * - 여러 번 돌려도 같은 결과(멱등).
 * - 받침이 있던 "월지암면·문샷" 뒤 조사(이·은·을·과·으로)는 "AI"(받침 없음)에 맞게 가·는·를·와·로로 바꾼다.
 * - 바꾼 뒤 "문샷AI(문샷AI)" 처럼 같은 이름이 괄호로 겹치면 하나로 줄인다 (원문 "문샷(月之暗面)" 이 한자 사전을 지난 경우).
 */
const KO_NAME_RULES: [RegExp, string][] = [
  // Moonshot AI (月之暗面) — 2026-11-05 사용자 결정: "문샷AI"
  [/월지암면|월지암|월의\s?어두운\s?면/g, "문샷AI"], // "월의 어두운 면" = 月之暗面을 글자대로 옮긴 말 (2026-11-05 발견)
  [/문샷\s+AI/g, "문샷AI"],
  [/문샷(?!AI)/g, "문샷AI"],
];

const PARTICLE: Record<string, string> = { 이: "가", 은: "는", 을: "를", 과: "와", 으로: "로" };

export function normalizeKoNames(text: string): string {
  if (!text) return text;
  let out = text;
  for (const [re, to] of KO_NAME_RULES) out = out.replace(re, to);
  out = out.replace(/문샷AI\(\s*문샷AI\s*\)/g, "문샷AI");
  // 조사 뒤가 낱말 경계(공백·문장부호·끝)일 때만 — "문샷AI이번" 같은 우연한 붙음은 건드리지 않는다
  // "문샷AI(Moonshot AI)은" 처럼 괄호 설명이 끼어도 조사는 문샷AI 에 맞춘다
  return out.replace(
    /문샷AI(\([^()]{0,40}\))?(으로|이|은|을|과)(?=[\s,.·…!?)'"’”\]]|$)/g,
    (_, par: string | undefined, j: string) => `문샷AI${par ?? ""}${PARTICLE[j]}`
  );
}
