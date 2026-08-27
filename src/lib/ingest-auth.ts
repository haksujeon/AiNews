import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

/**
 * 수집 파이프라인(n8n) 전용 쓰기 API 보호.
 *
 * /api/news/upsert 는 id 를 받아 `ON CONFLICT (id) DO UPDATE` 를 수행하므로,
 * 무인증 상태에서는 제3자가 기존 기사의 제목·본문·원문링크를 덮어쓸 수 있다.
 * (2026-08-27 조사에서 외부 도달 가능 확인)
 *
 * n8n 측 호출 방법:
 *   Authorization: Bearer <INGEST_TOKEN>   (또는 X-Ingest-Token 헤더)
 *
 * 설계상 fail-closed: INGEST_TOKEN 이 없거나 32자 미만이면 503 으로 거부한다.
 * 환경변수 누락이 곧 "인증 없음"으로 퇴화하지 않게 하기 위함이다.
 */
const MIN_TOKEN_LENGTH = 32;

const sha256 = (value: string): Buffer =>
  createHash("sha256").update(value, "utf8").digest();

function unauthorized(): NextResponse {
  return NextResponse.json(
    { error: { message: "Unauthorized" } },
    { status: 401 }
  );
}

export function requireIngestToken(request: NextRequest): NextResponse | null {
  const expected = process.env.INGEST_TOKEN;

  if (!expected || expected.length < MIN_TOKEN_LENGTH) {
    console.error(
      "[ingest-auth] INGEST_TOKEN 미설정 또는 너무 짧음 — 쓰기 API를 거부합니다."
    );
    return NextResponse.json(
      { error: { message: "Ingest endpoint is not configured" } },
      { status: 503 }
    );
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const provided = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : (request.headers.get("x-ingest-token") ?? "").trim();

  if (!provided) return unauthorized();

  // 길이 노출을 피하려고 양쪽을 SHA-256으로 고정 길이화한 뒤 상수시간 비교한다.
  if (!timingSafeEqual(sha256(provided), sha256(expected))) return unauthorized();

  return null;
}
