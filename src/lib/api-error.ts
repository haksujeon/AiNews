/**
 * 실패한 fetch 응답에서 사용자에게 보여줄 메시지를 안전하게 뽑는다.
 * - 본문이 JSON 이 아니어도(nginx 502 HTML 등) 던지지 않는다.
 * - error 가 문자열이든 {message} 객체든 항상 string 을 돌려준다 (React 에 객체를 넣지 않기 위함).
 */
export async function extractErrorMessage(res: Response, fallback: string): Promise<string> {
  const data: unknown = await res.json().catch(() => null);
  const err = (data as { error?: unknown } | null)?.error;
  if (typeof err === "string" && err) return err;
  const message = (err as { message?: unknown } | undefined)?.message;
  return typeof message === "string" && message ? message : fallback;
}
