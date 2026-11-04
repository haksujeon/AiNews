/**
 * 수신 거부 링크 토큰 — 구독자 id 에 HMAC 서명. 만료 없음(옛 메일의 링크도 계속 동작해야 한다).
 * 키: NEWSLETTER_SECRET, 없으면 ADMIN_SECRET 에 용도 접두어를 붙여 쓴다(관리자 토큰과 섞이지 않게).
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { absoluteUrl, rootUrl } from "@/lib/site";

function key(): string {
  const k = process.env.NEWSLETTER_SECRET || (process.env.ADMIN_SECRET ? `newsletter-unsubscribe:${process.env.ADMIN_SECRET}` : "");
  if (k.length < 32) throw new Error("NEWSLETTER_SECRET (또는 ADMIN_SECRET) 이 32자 이상이어야 합니다");
  return k;
}

const sig = (id: string) => createHmac("sha256", key()).update(`unsub:${id}`).digest("base64url").slice(0, 32);

export function unsubscribeToken(subscriberId: string): string {
  return `${Buffer.from(subscriberId).toString("base64url")}.${sig(subscriberId)}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 맞으면 구독자 id, 아니면 null */
export function verifyUnsubscribeToken(token: string | null | undefined): string | null {
  if (!token || token.length > 200) return null;
  const [a, s] = token.split(".");
  if (!a || !s) return null;
  const id = Buffer.from(a, "base64url").toString();
  if (!UUID.test(id)) return null;
  const want = Buffer.from(sig(id));
  const got = Buffer.from(s);
  return want.length === got.length && timingSafeEqual(want, got) ? id : null;
}

/** 메일 본문 링크: 확인 화면(GET 은 아무것도 바꾸지 않는다 — 메일 보안 검사기가 링크를 미리 열어 본다) */
export function unsubscribePageUrl(locale: string, subscriberId: string): string {
  return `${absoluteUrl(locale, "/unsubscribe")}?t=${unsubscribeToken(subscriberId)}`;
}

/** List-Unsubscribe 헤더(RFC 8058 한 번 누르기): 메일 프로그램이 이 주소로 POST 한다 */
export function unsubscribeApiUrl(subscriberId: string): string {
  return `${rootUrl("/api/newsletter/unsubscribe")}?t=${unsubscribeToken(subscriberId)}`;
}
