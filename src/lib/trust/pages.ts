/**
 * 신뢰 페이지(P0-6) 목록. footer 링크·sitemap·e2e 가 모두 이 목록을 쓴다 (Gate 2).
 * 클라이언트 컴포넌트(footer)도 가져다 쓰므로 서버 전용 코드(env·fs·DB)를 두지 않는다.
 */
export const TRUST_PAGES = [
  { key: "about", path: "/about" },
  { key: "methodology", path: "/methodology" },
  { key: "corrections", path: "/corrections" },
  { key: "privacy", path: "/privacy" },
] as const;

export type TrustPageKey = (typeof TRUST_PAGES)[number]["key"];

export function trustPath(key: TrustPageKey): string {
  return TRUST_PAGES.find((p) => p.key === key)!.path;
}
