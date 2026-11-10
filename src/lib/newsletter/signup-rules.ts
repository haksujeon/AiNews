/**
 * 구독 신청서 검사 규칙 (순수, DB·node 모듈 없음). 서버(signup.ts → /api/newsletter/subscribe)와
 * 신청 화면(subscribe-form.tsx)이 이 함수 하나를 쓴다 (Gate 2, QA C-14: 화면 검사가 없어 빈 칸도 서버로 갔다).
 */
export const SIGNUP_LANGS = ["ko", "zh", "en"] as const;
export type SignupLang = (typeof SIGNUP_LANGS)[number];

export interface SignupInput {
  organization: string;
  name: string;
  jobTitle: string | null;
  email: string;
  language: SignupLang;
  source: string | null;
}

export type SignupFieldError = "organization" | "name" | "jobTitle" | "email" | "language" | "consent" | "age";

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, max) : "");

/** 신청서 검사 (순수). 틀린 칸 목록을 돌려준다 */
export function parseSignup(body: Record<string, unknown>): { ok: true; input: SignupInput } | { ok: false; fields: SignupFieldError[] } {
  const fields: SignupFieldError[] = [];
  const organization = clean(body.organization, 100);
  const name = clean(body.name, 60);
  const jobTitle = clean(body.jobTitle, 60) || null;
  const email = clean(body.email, 254).toLowerCase();
  const language = (SIGNUP_LANGS as readonly string[]).includes(String(body.language)) ? (body.language as SignupLang) : null;
  const source = clean(body.source, 40).replace(/[^a-z0-9-_]/gi, "") || null;
  if (!organization) fields.push("organization");
  if (!name) fields.push("name");
  if (!EMAIL_RE.test(email)) fields.push("email");
  if (!language) fields.push("language");
  if (body.consent !== true) fields.push("consent");
  if (body.age14 !== true) fields.push("age");
  if (fields.length) return { ok: false, fields };
  return { ok: true, input: { organization, name, jobTitle, email, language: language!, source } };
}

