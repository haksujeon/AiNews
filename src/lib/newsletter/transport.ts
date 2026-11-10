/**
 * 메일 보내기 한 곳 — 지금은 Gmail SMTP(앱 비밀번호), 실제 서비스 때 Resend 로 바꿀 자리 (2026-11-04 사용자 결정).
 * 바꿀 때는 이 파일에 transport 하나를 더하고 NEWSLETTER_TRANSPORT 로 고른다. 부르는 쪽(send.ts)은 그대로.
 *
 * 환경 변수 (.env.local, 저장소에 넣지 않는다):
 *   NEWSLETTER_SMTP_USER  Gmail 주소 (보내는 주소 = 이 주소. Gmail 은 다른 From 을 허용하지 않는다)
 *   NEWSLETTER_SMTP_PASS  Google 계정 > 보안 > 앱 비밀번호 (16자)
 *   NEWSLETTER_FROM_NAME  보내는 이름 (기본 "SDSC AI 뉴스")
 */
import nodemailer, { type Transporter } from "nodemailer";

export interface OutgoingMail {
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
}

export interface MailTransport {
  name: string;
  send(mail: OutgoingMail): Promise<{ messageId: string | null }>;
}

let smtp: Transporter | null = null;

function gmailTransport(): MailTransport {
  const user = process.env.NEWSLETTER_SMTP_USER;
  const pass = process.env.NEWSLETTER_SMTP_PASS;
  if (!user || !pass) throw new Error("NEWSLETTER_SMTP_USER / NEWSLETTER_SMTP_PASS 가 없습니다 (.env.local)");
  // 이 서버는 465 가 막혀 있다(2026-11-04 확인) → 587 STARTTLS. requireTLS 로 평문 전송은 거부. 연결이 막히면 오래 걸지 않고 실패로 기록
  smtp ??= nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    requireTLS: true,
    auth: { user, pass },
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
    socketTimeout: 60_000,
  });
  const from = { name: process.env.NEWSLETTER_FROM_NAME || "SDSC AI 뉴스", address: user };
  return {
    name: "gmail-smtp",
    async send(m) {
      const r = await smtp!.sendMail({ from, to: m.to, subject: m.subject, html: m.html, text: m.text, headers: m.headers });
      return { messageId: r.messageId ?? null };
    },
  };
}

export function getTransport(): MailTransport {
  const kind = process.env.NEWSLETTER_TRANSPORT || "gmail";
  if (kind === "gmail") return gmailTransport();
  throw new Error(`알 수 없는 NEWSLETTER_TRANSPORT: ${kind}`);
}
