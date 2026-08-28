import { NextRequest } from "next/server";

/**
 * 인메모리 고정 윈도 rate limiter.
 *
 * 관리자 로그인은 단일 공유 비밀번호 하나로 보호되므로, 시도 횟수 제한이 없으면
 * 무차별 대입에 그대로 노출된다. (2026-08-27 조사 P0-4)
 *
 * 한계: 프로세스 메모리에만 존재한다. 현재 PM2 fork 모드 단일 인스턴스라 충분하지만,
 * 클러스터 모드로 늘리거나 인스턴스를 추가하면 Redis 등 공유 저장소로 옮겨야 한다.
 * 재시작하면 카운터가 초기화되는 점도 동일한 이유로 감수한다.
 */
type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

// 메모리 누수 방지: 접근 시마다 만료된 항목을 걷어낸다.
function sweep(now: number): void {
  if (buckets.size < 1000) return;
  for (const [key, b] of buckets) {
    if (b.resetAt <= now) buckets.delete(key);
  }
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number
): RateLimitResult {
  const now = Date.now();
  sweep(now);

  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
  }

  existing.count += 1;
  const retryAfterSeconds = Math.ceil((existing.resetAt - now) / 1000);
  if (existing.count > limit) {
    return { allowed: false, remaining: 0, retryAfterSeconds };
  }
  return { allowed: true, remaining: limit - existing.count, retryAfterSeconds };
}

/** 성공한 로그인 후 해당 키의 실패 카운터를 비운다. */
export function resetRateLimit(key: string): void {
  buckets.delete(key);
}

/**
 * nginx가 X-Forwarded-For 를 세팅한다. 프록시 뒤에 있으므로 첫 번째 값이 원 클라이언트.
 * 헤더가 없으면 단일 키로 묶여 전역 제한처럼 동작한다(fail-safe).
 */
export function clientIp(request: NextRequest): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}
