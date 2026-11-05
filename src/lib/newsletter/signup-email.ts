/**
 * 구독 확인 메일 · 환영 메일 (구독 신청, signup.ts). 색·글꼴은 아침 메일(daily-email.ts)과 같다.
 * 확인 메일 버튼은 확인 화면(GET 은 아무것도 바꾸지 않음)으로 간다 — 그 화면에서 한 번 더 눌러야 구독된다.
 */
import { absoluteUrl } from "@/lib/site";
import { C, FONT, esc } from "./daily-email";
import { CONFIRM_TTL_HOURS, confirmToken, type SignupLang } from "./signup";
import { unsubscribeApiUrl, unsubscribePageUrl } from "./token";

const T = {
  ko: {
    brand: "AI 뉴스 · 중국 AI 데일리",
    confirmSubject: "[AI 뉴스] 구독 확인을 눌러 주세요",
    confirmTitle: "구독을 확인해 주세요",
    confirmBody: (name: string) => `${name}님, 중국 AI 데일리 구독 신청을 받았습니다. 아래 버튼을 누르면 다음 날 아침 7시부터 메일을 보내 드립니다.`,
    confirmBtn: "구독 확인",
    confirmIgnore: (h: number) => `직접 신청하지 않으셨다면 이 메일을 무시하세요. ${h}시간 안에 확인하지 않으면 신청 정보는 지워집니다.`,
    welcomeSubject: "[AI 뉴스] 구독을 시작합니다",
    welcomeTitle: "매일 아침 7시에 만나요",
    welcomeItems: ["전날 중국 AI 주요 5건과 한눈에 보기", "3분 듣기 (AI 음성)", "월요일은 토·일 합본"],
    welcomeBtn: "최신 브리핑 보기",
    unsub: "수신 거부",
    unsubNote: "모든 메일 하단 링크로 언제든 해지할 수 있습니다.",
  },
  zh: {
    brand: "AI NEWS · 中国AI每日简报",
    confirmSubject: "【AI NEWS】请确认订阅",
    confirmTitle: "请确认您的订阅",
    confirmBody: (name: string) => `${name}，我们已收到您的中国AI每日简报订阅申请。点击下方按钮后，将从次日早上7点（韩国时间）开始发送。`,
    confirmBtn: "确认订阅",
    confirmIgnore: (h: number) => `如果不是您本人申请，请忽略此邮件。${h}小时内未确认，申请信息将被删除。`,
    welcomeSubject: "【AI NEWS】订阅已开始",
    welcomeTitle: "每天早上7点见",
    welcomeItems: ["前一天中国AI要闻5条与一览", "3分钟收听（AI语音）", "周一为周末合刊"],
    welcomeBtn: "查看最新简报",
    unsub: "退订",
    unsubNote: "每封邮件底部的链接都可随时退订。",
  },
  en: {
    brand: "AI NEWS · China AI Daily",
    confirmSubject: "[AI NEWS] Please confirm your subscription",
    confirmTitle: "Confirm your subscription",
    confirmBody: (name: string) => `${name}, we received your request to subscribe to China AI Daily. Press the button below and we will send it from the next morning at 7:00 (KST).`,
    confirmBtn: "Confirm subscription",
    confirmIgnore: (h: number) => `If you did not sign up, ignore this email. Unconfirmed requests are deleted after ${h} hours.`,
    welcomeSubject: "[AI NEWS] Your subscription has started",
    welcomeTitle: "See you every morning at 7",
    welcomeItems: ["Yesterday's top 5 China AI stories at a glance", "3-minute AI audio", "Mondays cover the weekend"],
    welcomeBtn: "Read the latest briefing",
    unsub: "Unsubscribe",
    unsubNote: "Every email has a one-click unsubscribe link.",
  },
} satisfies Record<SignupLang, unknown>;

function shell(lang: SignupLang, inner: string, foot = ""): string {
  const t = T[lang];
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head>
<body style="margin:0;padding:0;background:${C.bg}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:${C.card};border-radius:12px">
<tr><td style="padding:28px 32px 0;font:700 12px/1.4 ${FONT};letter-spacing:.06em;color:${C.jade}">${esc(t.brand)}</td></tr>
${inner}
</table>
${foot}
</td></tr></table></body></html>`;
}

function button(href: string, label: string): string {
  return `<tr><td style="padding:22px 32px 6px"><a href="${esc(href)}" style="display:inline-block;background:${C.jade};color:#fff;text-decoration:none;font:700 15px/1 ${FONT};padding:15px 26px;border-radius:8px">${esc(label)}</a></td></tr>`;
}

export function confirmPageUrl(lang: SignupLang, subscriberId: string): string {
  return `${absoluteUrl(lang, "/subscribe/confirm")}?t=${confirmToken(subscriberId)}`;
}

/** 신청 직후 확인 메일 */
export function renderConfirmMail(lang: SignupLang, subscriberId: string, name: string) {
  const t = T[lang];
  const url = confirmPageUrl(lang, subscriberId);
  const html = shell(
    lang,
    `<tr><td style="padding:8px 32px 0;font:800 22px/1.35 ${FONT};color:${C.ink}">${esc(t.confirmTitle)}</td></tr>
<tr><td style="padding:12px 32px 0;font:15px/1.7 ${FONT};color:${C.sub}">${esc(t.confirmBody(name))}</td></tr>
${button(url, t.confirmBtn)}
<tr><td style="padding:14px 32px 28px;font:12.5px/1.6 ${FONT};color:${C.faint}">${esc(t.confirmIgnore(CONFIRM_TTL_HOURS))}</td></tr>`
  );
  const text = [t.confirmTitle, "", t.confirmBody(name), "", `${t.confirmBtn}: ${url}`, "", t.confirmIgnore(CONFIRM_TTL_HOURS)].join("\n");
  return { subject: t.confirmSubject, html, text };
}

/** 확인 직후 환영 메일 (수신 거부 링크·헤더 포함 — 아침 메일과 같은 규칙) */
export function renderWelcomeMail(lang: SignupLang, subscriberId: string) {
  const t = T[lang];
  const briefing = absoluteUrl(lang, "/briefing");
  const unsub = unsubscribePageUrl(lang, subscriberId);
  const html = shell(
    lang,
    `<tr><td style="padding:8px 32px 0;font:800 22px/1.35 ${FONT};color:${C.ink}">${esc(t.welcomeTitle)}</td></tr>
<tr><td style="padding:12px 32px 0;font:15px/1.8 ${FONT};color:${C.ink}">${t.welcomeItems.map((x) => `· ${esc(x)}`).join("<br>")}</td></tr>
${button(briefing, t.welcomeBtn)}
<tr><td style="padding:10px 32px 28px"></td></tr>`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px"><tr><td style="padding:16px 24px;font:12px/1.7 ${FONT};color:${C.faint}"><a href="${esc(unsub)}" style="color:${C.sub};font-weight:700">${esc(t.unsub)}</a> — ${esc(t.unsubNote)}</td></tr></table>`
  );
  const text = [t.welcomeTitle, "", ...t.welcomeItems.map((x) => `· ${x}`), "", `${t.welcomeBtn}: ${briefing}`, "", `${t.unsub}: ${unsub}`].join("\n");
  return {
    subject: t.welcomeSubject,
    html,
    text,
    headers: { "List-Unsubscribe": `<${unsubscribeApiUrl(subscriberId)}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
  };
}
