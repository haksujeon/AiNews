/**
 * 검토 모델에게 주는 결정적 점검 힌트 (순수 함수). 오류 판정이 아니라 "이 문장은 꼭 확인하라" 는 표시다.
 * 보정 v5 에서 검토 모델이 계속 놓친 사람 감사 오류 유형을 기계적으로 짚는다:
 *  - 근거 목록 밖 기사에만 있는 숫자·로마자 이름·기업 (misattributed — lede 의 스탠퍼드 2.7%, 논문 1위 등)
 *  - 상대 시점 표현 ("지난 7월" 을 7-15 판에 — wrong)
 *  - 두 주체를 묶은 헤드라인 ("알리바바·DeepSeek 자금 행보" — wrong)
 *  - 지켜볼 일(watch_next)·예정 표현 (근거에 예정·일정이 있어야 — unsupported)
 */
import { ENTITIES, entityMentioned } from "../entities";
import type { Segment } from "./types";

export interface Hint {
  sid: string;
  kind: "refs_outside" | "relative_time" | "headline_pair" | "watch_next";
  detail: string;
}

const numTokens = (t: string) => [...(t ?? "").matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => m[0].replace(/,/g, "")).filter((n) => Number(n) > 12 || n.includes("."));
const latinTokens = (t: string) => [...(t ?? "").matchAll(/[A-Za-z][A-Za-z0-9.+-]{2,}/g)].map((m) => m[0].toLowerCase());
const has = (hay: string, needle: string) => hay.includes(needle);

const RELATIVE_TIME_RE = /지난\s?(\d{1,2}월|해|달|주|분기)|작년|지난해|올해\s?(초|상반기|하반기)?|이달\s?초|지난달|최근\s?\d+(일|주|개월)/;

export function buildHints(segments: Segment[], fullText: Map<string, string>, labelOf: Map<string, string>, editionDate: string): Hint[] {
  const out: Hint[] = [];
  const lower = new Map([...fullText].map(([id, t]) => [id, t.replace(/,/g, "").toLowerCase()]));
  for (const s of segments) {
    if (!s.refs.length) continue;
    const inRefs = s.refs.map((r) => lower.get(r) ?? "").join(" ");
    const others = [...lower].filter(([id]) => !s.refs.includes(id));
    const outside: string[] = [];
    const check = (token: string) => {
      if (has(inRefs, token)) return;
      const where = others.filter(([, t]) => has(t, token)).map(([id]) => labelOf.get(id)).filter(Boolean);
      if (where.length) outside.push(`'${token}'→${where.slice(0, 3).join(",")}`);
    };
    for (const n of numTokens(s.text)) check(n);
    for (const w of latinTokens(s.text)) check(w);
    for (const e of ENTITIES) {
      if (!entityMentioned(e, s.text)) continue;
      const inR = s.refs.some((r) => entityMentioned(e, fullText.get(r) ?? ""));
      if (inR) continue;
      const where = [...fullText].filter(([id, t]) => !s.refs.includes(id) && entityMentioned(e, t)).map(([id]) => labelOf.get(id)).filter(Boolean);
      if (where.length) outside.push(`${e.key}→${where.slice(0, 3).join(",")}`);
    }
    if (outside.length) out.push({ sid: s.sid, kind: "refs_outside", detail: `근거 목록에 없고 다른 인용 기사에만 있음: ${[...new Set(outside)].slice(0, 5).join(" ")}` });
    const rt = s.text.match(RELATIVE_TIME_RE);
    if (rt) out.push({ sid: s.sid, kind: "relative_time", detail: `상대 시점 '${rt[0]}' — 판 날짜 ${editionDate} 기준으로 맞는지` });
    if (s.path === "headline" && /[·,와과및]\s?\S+\s?(행보|경쟁|대결|격돌|동시|나란히|잇따라|속)/.test(s.text))
      out.push({ sid: s.sid, kind: "headline_pair", detail: "두 주체·사실을 묶은 헤드라인 — 각 부분과 둘의 관계(공통 행보·대립·인과)가 근거에 있는지" });
    if (s.path.startsWith("watch_next")) out.push({ sid: s.sid, kind: "watch_next", detail: "지켜볼 일 — 근거에 예정·계획·일정이 있는지" });
  }
  return out;
}
