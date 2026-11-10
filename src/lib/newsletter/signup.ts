/**
 * 구독 신청 (2026-11-05 사용자 결정): 회사·이름·이메일·언어 필수, 직책 선택, 누구나, 이메일 확인 뒤 구독.
 * 흐름: 신청(확인 대기 저장 + 확인 메일) → 확인 메일의 버튼 → 확인 화면에서 한 번 더 누름(POST) → 구독 중 + 환영 메일.
 * 확인 화면은 GET 으로 아무것도 바꾸지 않는다 — 회사 메일 보안 검사기가 링크를 미리 열어 보기 때문(수신 거부와 같은 규칙).
 * 상태 규칙은 scripts/2026-11-05-newsletter-signup.sql 머리말.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import pool from "@/lib/db";
import { CONSENT_VERSION } from "@/lib/trust/config";

export * from "./signup-rules";
import { SIGNUP_LANGS, type SignupInput, type SignupLang } from "./signup-rules";

/** 확인 메일 링크 유효 시간 — 지나면 확인 대기 정보도 지운다 */
export const CONFIRM_TTL_HOURS = 48;

/** 봇 걸러내기 (순수): 사람 눈에 안 보이는 칸이 채워졌거나, 화면을 연 지 3초 안에 제출하면 봇으로 본다 */
export function looksLikeBot(body: Record<string, unknown>, now = Date.now()): boolean {
  if (typeof body.website === "string" && body.website.trim() !== "") return true;
  const t0 = Number(body.t0);
  return !Number.isFinite(t0) || now - t0 < 3000 || now - t0 > 24 * 3600 * 1000;
}

// ───────────────────────── 접속 주소별 제한 (한 프로세스 안 — pm2 한 개라 충분)

const hits = new Map<string, number[]>();
export const RATE_LIMIT = { max: 5, windowMs: 3600 * 1000 };

export function rateLimited(ip: string, now = Date.now()): boolean {
  const list = (hits.get(ip) ?? []).filter((t) => now - t < RATE_LIMIT.windowMs);
  if (list.length >= RATE_LIMIT.max) {
    hits.set(ip, list);
    return true;
  }
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < RATE_LIMIT.windowMs)) hits.delete(k);
  return false;
}

// ───────────────────────── 확인 토큰 (구독자 id + 만료 시각에 HMAC)

function key(): string {
  const k = process.env.NEWSLETTER_SECRET || (process.env.ADMIN_SECRET ? `newsletter-confirm:${process.env.ADMIN_SECRET}` : "");
  if (k.length < 32) throw new Error("NEWSLETTER_SECRET (또는 ADMIN_SECRET) 이 32자 이상이어야 합니다");
  return k;
}
const sig = (payload: string) => createHmac("sha256", key()).update(`confirm:${payload}`).digest("base64url").slice(0, 32);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function confirmToken(subscriberId: string, now = Date.now()): string {
  const payload = `${subscriberId}.${Math.floor(now / 1000) + CONFIRM_TTL_HOURS * 3600}`;
  return `${Buffer.from(payload).toString("base64url")}.${sig(payload)}`;
}

/** 맞고 만료 전이면 구독자 id */
export function verifyConfirmToken(token: string | null | undefined, now = Date.now()): string | null {
  if (!token || token.length > 300) return null;
  const [a, s] = token.split(".");
  if (!a || !s) return null;
  const payload = Buffer.from(a, "base64url").toString();
  const [id, exp] = payload.split(".");
  if (!UUID.test(id ?? "") || !/^\d+$/.test(exp ?? "")) return null;
  const want = Buffer.from(sig(payload));
  const got = Buffer.from(s);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  return Number(exp) * 1000 > now ? id : null;
}

// ───────────────────────── DB

/** 만료된 확인 대기 정보 지우기 (신청이 올 때마다 함께) */
export async function purgeExpiredPending(): Promise<number> {
  const { rowCount } = await pool.query(
    `DELETE FROM newsletter_subscribers
      WHERE NOT is_active AND confirmed_at IS NULL AND unsubscribed_at IS NULL
        AND confirm_sent_at < now() - make_interval(hours => $1)`,
    [CONFIRM_TTL_HOURS]
  );
  return rowCount ?? 0;
}

export type SignupResult =
  | { kind: "pending"; id: string; name: string; language: SignupLang } // 확인 메일을 보낼 대상
  | { kind: "active" } // 이미 구독 중 — 화면에는 같은 답(가입 여부를 드러내지 않음), 메일은 보내지 않음
  | { kind: "throttled" }; // 같은 주소로 확인 메일을 10분 안에 또 보내지 않음

/**
 * 신청 저장. 새 주소·확인 대기·해지했던 주소는 확인 대기로(정보 갱신), 구독 중이면 그대로 둔다.
 * 동의 기록은 신청 때마다 새로 쓴다(처리방침 판이 바뀌었을 수 있다).
 */
export async function upsertPending(input: SignupInput, ip: string | null): Promise<SignupResult> {
  const { rows } = await pool.query(
    `SELECT id::text, is_active, confirm_sent_at FROM newsletter_subscribers WHERE lower(email) = $1 LIMIT 1`,
    [input.email]
  );
  const cur = rows[0] as { id: string; is_active: boolean; confirm_sent_at: Date | null } | undefined;
  if (cur?.is_active) return { kind: "active" };
  if (cur?.confirm_sent_at && Date.now() - new Date(cur.confirm_sent_at).getTime() < 10 * 60 * 1000) return { kind: "throttled" };
  const vals = [input.organization, input.name, input.jobTitle, input.email, input.language, input.source, CONSENT_VERSION, ip];
  if (cur) {
    await pool.query(
      `UPDATE newsletter_subscribers SET organization = $1, name = $2, job_title = $3, email = $4, language = $5, source = COALESCE($6, source),
              consent_at = now(), consent_version = $7, consent_ip = $8, confirmed_at = NULL, unsubscribed_at = NULL, confirm_sent_at = now()
        WHERE id = $9::uuid`,
      [...vals, cur.id]
    );
    return { kind: "pending", id: cur.id, name: input.name, language: input.language };
  }
  const ins = await pool.query(
    `INSERT INTO newsletter_subscribers (organization, name, job_title, email, language, source, consent_version, consent_ip, consent_at, confirm_sent_at, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), now(), false) RETURNING id::text`,
    vals
  );
  return { kind: "pending", id: ins.rows[0].id, name: input.name, language: input.language };
}

/** 확인 버튼: 확인 대기 → 구독 중. 이미 구독 중이면 그대로 성공(already). 지워졌으면(만료) null */
export async function confirmSubscriber(id: string): Promise<{ id: string; name: string; email: string; language: SignupLang; already: boolean } | null> {
  const { rows: before } = await pool.query(`SELECT is_active FROM newsletter_subscribers WHERE id = $1::uuid`, [id]);
  if (!before[0]) return null;
  const already = before[0].is_active === true;
  const { rows } = await pool.query(
    `UPDATE newsletter_subscribers SET is_active = true, confirmed_at = COALESCE(confirmed_at, now()), unsubscribed_at = NULL
      WHERE id = $1::uuid RETURNING id::text, name, email, language`,
    [id]
  );
  const r = rows[0];
  if (!r) return null;
  const language = (SIGNUP_LANGS as readonly string[]).includes(r.language) ? (r.language as SignupLang) : "ko";
  return { id: r.id, name: r.name ?? "", email: r.email, language, already };
}
