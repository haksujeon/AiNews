/**
 * 신뢰 페이지 설정 (서버 전용, P0-6).
 *
 *  - CONTACT_EMAIL: 문의 주소. 기본값은 자리표시 주소다 — 사용자 확인 전 (결정 D5).
 *  - CONSENT_VERSION: 개인정보 처리방침 판 문자열. 뉴스레터(P0-4)가 동의 기록(consent_version)에
 *    같은 값을 저장한다. 처리방침 본문(content/legal/*\/privacy.md)을 바꾸면 이 값도 올린다.
 *  - 초안 띠: SHOW_LEGAL_DRAFT=1 일 때만 보인다(개발 서버). NODE_ENV 로 가르지 않는다 — next start 도 production 이다.
 */
export const CONTACT_EMAIL = (process.env.CONTACT_EMAIL || "contact@aibaseclub.com").trim();

export const CONSENT_VERSION = "2026-11-05-draft"; // 2026-11-05: 회사·이름 필수, 직책 선택, 신청 경로, 수탁자 Gmail

/** 처리방침 판의 시행일(표시용). 법무 승인 후 확정 */
export const PRIVACY_EFFECTIVE_DATE = "2026-11-05";

/** 브리핑·요약에 쓰는 모델(공개 표기). LiteLLM 별칭이 아니라 제공사·계열로 적는다 */
export const MODEL_DISCLOSURE = "Anthropic Claude (Haiku)";

export function showLegalDraft(): boolean {
  return process.env.SHOW_LEGAL_DRAFT === "1";
}
