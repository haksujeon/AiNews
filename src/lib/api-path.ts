/**
 * next.config.ts 의 basePath("/ainews")는 <Link>, router.push, next/image,
 * 정적 자원에만 자동 적용된다. 순수 fetch()에는 적용되지 않으므로
 * 클라이언트에서 내부 API를 호출할 때는 반드시 이 헬퍼를 거쳐야 한다.
 *
 * 잘못: fetch("/api/news")        -> https://news.aibaseclub.com/api/news        (404)
 * 올바름: fetch(apiUrl("/api/news")) -> https://news.aibaseclub.com/ainews/api/news (200)
 */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export function apiUrl(path: string): string {
  return `${BASE_PATH}${path.startsWith("/") ? path : `/${path}`}`;
}
