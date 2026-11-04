-- 구독자 아침 메일 발송 기록 (2026-11-04, src/lib/newsletter/send.ts).
-- 구독자 × 판 한 행. 보내기 전에 'sending' 으로 먼저 잡고(ON CONFLICT DO NOTHING) 결과를 sent/failed 로 적는다 —
-- 예약 실행이 여러 번 돌아도(07:00·09:10, 개발·운영 서버 둘) 같은 판을 두 번 보내지 않는다.
-- 관리자 "발송 내역"(api/admin/send-history)도 이 표를 읽는다 (2~5월 옛 기록은 ai_news_ex.sent_at 그대로).
-- 적용: docker exec -i aiwork-postgres psql -U postgres -d ainews < scripts/2026-11-04-newsletter-sends.sql
-- 되돌리기: DROP TABLE newsletter_sends; ALTER TABLE newsletter_subscribers DROP COLUMN unsubscribed_at;

CREATE TABLE IF NOT EXISTS newsletter_sends (
  id             bigserial PRIMARY KEY,
  subscriber_id  uuid NOT NULL REFERENCES newsletter_subscribers(id) ON DELETE CASCADE,
  edition_date   date NOT NULL,
  locale         text NOT NULL CHECK (locale IN ('ko', 'en', 'zh')),
  briefing_id    uuid,
  email          text NOT NULL,
  subject        text,
  status         text NOT NULL CHECK (status IN ('sending', 'sent', 'failed')),
  transport      text,
  message_id     text,
  error          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  sent_at        timestamptz,
  UNIQUE (subscriber_id, edition_date)
);
CREATE INDEX IF NOT EXISTS newsletter_sends_sent_at_idx ON newsletter_sends (sent_at DESC);

-- 수신 거부한 때 (is_active=false 와 함께 적는다. 관리자가 끈 것과 구분)
ALTER TABLE newsletter_subscribers ADD COLUMN IF NOT EXISTS unsubscribed_at timestamptz;

GRANT SELECT, INSERT, UPDATE ON newsletter_sends TO ainews;
GRANT USAGE ON SEQUENCE newsletter_sends_id_seq TO ainews;
