/**
 * 구독자 아침 메일 보내기 (2026-11-04) — 매일 07:00 KST(재시도 09:10), 전날 판 한 판을 구독자 언어판으로.
 *
 * 어떤 판을 보내나: sla.ts currentEdition(now) — 정기 생성(00:10 KST)이 가리킨 가장 최근 판 (Gate 2, 홈·SLA 와 같은 규칙).
 *   화~금 아침 = 전날 판, 토 아침 = 금요일 판, 일 아침 = 금요일 판(이미 보냄 → 보낼 것 없음), 월 아침 = 토·일 합본.
 *   판이 아직 발행되지 않았으면 보내지 않고, 다음 예약 실행이 다시 본다. 다음 판으로 넘어가면 옛 판은 늦게 보내지 않는다.
 * 언어: 구독자 language(ko·en·zh)의 발행본만. 그 언어판이 없으면 다른 언어로 대신 보내지 않는다(기록만).
 * 중복 방지: newsletter_sends (구독자, 판) 한 행을 보내기 전에 잡는다. failed 만 다시 시도한다.
 */
import pool from "@/lib/db";
import { BASE_PATH } from "@/lib/api-path";
import { getPublishedBriefing, type PublicBriefing } from "@/lib/briefing/public";
import { currentEdition } from "@/lib/briefing/sla";
import { BRIEFING_LOCALES, type BriefingLocale } from "@/lib/briefing/types";
import { renderDailyEmail } from "./daily-email";
import { unsubscribeApiUrl, unsubscribePageUrl } from "./token";
import { getTransport, type MailTransport } from "./transport";

export interface SendOptions {
  now?: Date;
  /** 판 날짜를 직접 (없으면 currentEdition) */
  date?: string;
  /** 렌더만, 보내지도 기록하지도 않는다 */
  dry?: boolean;
  /** 이 주소의 구독자에게만 */
  only?: string;
  transport?: MailTransport;
}

export type SendOutcome = "sent" | "failed" | "already" | "no-edition" | "dry";

export interface SendReport {
  edition: string;
  results: { email: string; locale: BriefingLocale; outcome: SendOutcome; subject?: string; error?: string }[];
}

interface SubscriberRow {
  id: string;
  name: string | null;
  email: string;
  language: string | null;
}

const asLocale = (l: string | null): BriefingLocale => (BRIEFING_LOCALES as string[]).includes(l ?? "") ? (l as BriefingLocale) : "ko";

/** 메일 한 통 (렌더 + 수신 거부 헤더). 실제 발송·테스트 발송이 같은 함수 */
export function buildMail(b: PublicBriefing, s: SubscriberRow) {
  // 사이트는 /ainews 아래에 있다. 앱 밖(cron 스크립트)에서는 NEXT_PUBLIC_BASE_PATH 가 빌드에 들어가지 않으므로
  // 스크립트가 직접 넣어야 한다 (scripts/newsletter-send.ts). 빠지면 메일의 모든 링크가 404 라서 보내지 않는다.
  if (!BASE_PATH) throw new Error("NEXT_PUBLIC_BASE_PATH 가 비어 있어 메일 링크를 만들 수 없습니다");
  const m = renderDailyEmail(b, { name: s.name, email: s.email, unsubscribeUrl: unsubscribePageUrl(b.locale, s.id) });
  return {
    ...m,
    headers: { "List-Unsubscribe": `<${unsubscribeApiUrl(s.id)}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
  };
}

export async function sendDailyNewsletter(opts: SendOptions = {}): Promise<SendReport> {
  const edition = opts.date ?? currentEdition(opts.now ?? new Date());
  const { rows: subs } = await pool.query<SubscriberRow>(
    `SELECT id::text, name, email, language FROM newsletter_subscribers
      WHERE is_active AND ($1::text IS NULL OR lower(email) = lower($1)) ORDER BY created_at`,
    [opts.only ?? null]
  );
  const briefings = new Map<BriefingLocale, PublicBriefing | null>();
  const report: SendReport = { edition, results: [] };
  let transport = opts.transport;

  for (const s of subs) {
    const locale = asLocale(s.language);
    if (!briefings.has(locale)) briefings.set(locale, await getPublishedBriefing(locale, edition));
    const b = briefings.get(locale);
    if (!b) {
      report.results.push({ email: s.email, locale, outcome: "no-edition" });
      continue;
    }
    const mail = buildMail(b, s);
    if (opts.dry) {
      report.results.push({ email: s.email, locale, outcome: "dry", subject: mail.subject });
      continue;
    }
    // 잡기: 새 행이거나 지난번 실패한 행만
    const claim = await pool.query(
      `INSERT INTO newsletter_sends (subscriber_id, edition_date, locale, briefing_id, email, subject, status)
       VALUES ($1::uuid, $2::date, $3, $4::uuid, $5, $6, 'sending')
       ON CONFLICT (subscriber_id, edition_date) DO UPDATE
         SET status = 'sending', error = NULL, locale = EXCLUDED.locale, briefing_id = EXCLUDED.briefing_id,
             email = EXCLUDED.email, subject = EXCLUDED.subject, created_at = now()
       WHERE newsletter_sends.status = 'failed'
       RETURNING id`,
      [s.id, edition, locale, b.id, s.email, mail.subject]
    );
    if (!claim.rowCount) {
      report.results.push({ email: s.email, locale, outcome: "already" });
      continue;
    }
    const rowId = claim.rows[0].id;
    try {
      transport ??= getTransport();
      const r = await transport.send({ to: s.email, subject: mail.subject, html: mail.html, text: mail.text, headers: mail.headers });
      await pool.query(`UPDATE newsletter_sends SET status = 'sent', sent_at = now(), transport = $2, message_id = $3 WHERE id = $1`, [
        rowId,
        transport.name,
        r.messageId,
      ]);
      report.results.push({ email: s.email, locale, outcome: "sent", subject: mail.subject });
    } catch (e) {
      const error = (e as Error).message.slice(0, 500);
      await pool.query(`UPDATE newsletter_sends SET status = 'failed', error = $2, transport = $3 WHERE id = $1`, [rowId, error, transport?.name ?? null]);
      report.results.push({ email: s.email, locale, outcome: "failed", error });
    }
  }
  return report;
}

/** 수신 거부 (토큰 확인은 부르는 쪽). 이미 끊긴 구독자도 성공으로 본다 */
export async function unsubscribe(subscriberId: string): Promise<boolean> {
  const r = await pool.query(
    `UPDATE newsletter_subscribers SET is_active = false, unsubscribed_at = COALESCE(unsubscribed_at, now()) WHERE id = $1::uuid`,
    [subscriberId]
  );
  return (r.rowCount ?? 0) > 0;
}
