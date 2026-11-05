-- 구독 신청(QR) 기능 (2026-11-05 사용자 결정: 회사·이름 필수, 직책 선택, 누구나, 이메일 확인 후 구독, 발송은 Gmail 유지).
-- 검토: ~/ainews-reports/subscribe-2026-11-05/PROPOSAL.md
-- 상태: 확인 대기 = is_active=false AND confirmed_at IS NULL AND unsubscribed_at IS NULL
--       구독 중   = is_active=true (발송 대상, send.ts 그대로)
--       해지      = is_active=false AND unsubscribed_at IS NOT NULL
-- 동의 기록(처리방침 3조): consent_at · consent_version · consent_ip — 3년 보관.
-- 적용: docker exec -i aiwork-postgres psql -U postgres -d ainews < scripts/2026-11-05-newsletter-signup.sql
-- 되돌리기: ALTER TABLE newsletter_subscribers DROP COLUMN job_title, DROP COLUMN source, DROP COLUMN confirmed_at,
--           DROP COLUMN confirm_sent_at, DROP COLUMN consent_at, DROP COLUMN consent_version, DROP COLUMN consent_ip;

ALTER TABLE newsletter_subscribers
  ADD COLUMN IF NOT EXISTS job_title       text,
  ADD COLUMN IF NOT EXISTS source          text,
  ADD COLUMN IF NOT EXISTS confirmed_at    timestamptz,
  ADD COLUMN IF NOT EXISTS confirm_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS consent_at      timestamptz,
  ADD COLUMN IF NOT EXISTS consent_version text,
  ADD COLUMN IF NOT EXISTS consent_ip      text;

-- 이미 구독 중인 사람(관리자가 넣은 구독자)은 확인된 것으로 본다
UPDATE newsletter_subscribers SET confirmed_at = COALESCE(confirmed_at, created_at) WHERE is_active AND confirmed_at IS NULL;

CREATE INDEX IF NOT EXISTS newsletter_subscribers_source_idx ON newsletter_subscribers (source);
