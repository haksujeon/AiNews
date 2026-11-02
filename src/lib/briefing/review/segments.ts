/**
 * 판 본문 → 문장 단위(Segment, S01..) 와 문장 단위 수정 적용 (순수 함수, DB 없음).
 *
 * 검토 모델은 S id 로 주장·수정을 가리킨다 → 원문 문장을 코드가 정확히 안다 (모델이 원문을 옮겨 적다 틀릴 일이 없다).
 * 수정은 "그 문장을 바꾸거나 지우기" 만 한다. 필드가 비면 그 항목을 통째로 빼고,
 * 뺄 수 없는 필드(headline·lede·dek)는 결정적 대체(1위 기사 제목·지표 문장)를 쓰거나 고칠 수 없음으로 돌려준다.
 */
import { splitSentences } from "../rules";
import type { EditionType } from "../repository";
import type { Segment } from "./types";

type Json = Record<string, unknown>;
type Ptr = (string | number)[];

const arr = (v: unknown): Json[] => (Array.isArray(v) ? (v as Json[]) : []);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

export const isPeriodic = (t: EditionType) => t === "weekly" || t === "monthly";

/** 키 숫자 표시 문자열 "값 — 설명" (고칠 때 같은 모양으로 다시 나눈다) */
export const KEY_NUMBER_SEP = " — ";

interface Field {
  path: string;
  ptr: Ptr;
  itemPtr: Ptr | null;
  text: string;
  refs: string[];
  metrics?: string[];
  whole: boolean;
  context?: string;
}

function dailyFields(c: Json): Field[] {
  const out: Field[] = [];
  const top = arr(c.top_stories);
  const headRefs = [...new Set([...strs(c.lede_refs), ...strs(top[0]?.refs)])];
  out.push({ path: "headline", ptr: ["headline"], itemPtr: null, text: str(c.headline), refs: headRefs, whole: true });
  out.push({ path: "lede", ptr: ["lede"], itemPtr: null, text: str(c.lede), refs: strs(c.lede_refs), whole: false });
  top.forEach((s, i) => {
    const refs = strs(s.refs);
    const ctx = `주요 기사 ${i + 1}위 · 주체 ${str(s.subject)}`;
    out.push({ path: `top_stories[${i}].title`, ptr: ["top_stories", i, "title"], itemPtr: ["top_stories", i], text: str(s.title), refs, whole: true, context: ctx });
    out.push({ path: `top_stories[${i}].what`, ptr: ["top_stories", i, "what"], itemPtr: ["top_stories", i], text: str(s.what), refs, whole: false, context: ctx });
    out.push({ path: `top_stories[${i}].why`, ptr: ["top_stories", i, "why"], itemPtr: ["top_stories", i], text: str(s.why), refs, whole: false, context: ctx });
  });
  arr(c.sections).forEach((sec, j) =>
    arr(sec.items).forEach((it, k) =>
      out.push({
        path: `sections[${j}].items[${k}]`, ptr: ["sections", j, "items", k, "text"], itemPtr: ["sections", j, "items", k],
        text: str(it.text), refs: strs(it.refs), whole: false, context: `분야 ${str(sec.section)}`,
      })
    )
  );
  arr(c.key_numbers).forEach((k, i) =>
    out.push({
      path: `key_numbers[${i}]`, ptr: ["key_numbers", i], itemPtr: ["key_numbers", i],
      text: `${str(k.value)}${KEY_NUMBER_SEP}${str(k.label)}`, refs: str(k.ref) ? [str(k.ref)] : [], whole: true, context: "숫자로 보는 오늘",
    })
  );
  arr(c.companies_to_watch).forEach((co, i) =>
    out.push({
      path: `companies_to_watch[${i}].why`, ptr: ["companies_to_watch", i, "why"], itemPtr: ["companies_to_watch", i],
      text: str(co.why), refs: strs(co.refs), whole: false, context: `주목 기업 ${str(co.name)}`,
    })
  );
  if (str(c.editor_note)) out.push({ path: "editor_note", ptr: ["editor_note"], itemPtr: ["editor_note"], text: str(c.editor_note), refs: [], whole: false });
  return out;
}

function periodicFields(c: Json): Field[] {
  const out: Field[] = [];
  out.push({ path: "headline", ptr: ["headline"], itemPtr: null, text: str(c.headline), refs: strs(c.dek_refs), metrics: strs(c.dek_metrics), whole: true });
  out.push({ path: "dek", ptr: ["dek"], itemPtr: null, text: str(c.dek), refs: strs(c.dek_refs), metrics: strs(c.dek_metrics), whole: false });
  arr(c.big_picture).forEach((b, i) => {
    const base = { refs: strs(b.refs), metrics: strs(b.metrics), itemPtr: ["big_picture", i] as Ptr, context: `큰 흐름 ${i + 1}` };
    out.push({ ...base, path: `big_picture[${i}].title`, ptr: ["big_picture", i, "title"], text: str(b.title), whole: true });
    out.push({ ...base, path: `big_picture[${i}].text`, ptr: ["big_picture", i, "text"], text: str(b.text), whole: false });
  });
  arr(c.movers).forEach((m, i) =>
    out.push({
      path: `movers[${i}].text`, ptr: ["movers", i, "text"], itemPtr: ["movers", i], text: str(m.text), refs: strs(m.refs),
      metrics: strs(m.metrics), whole: false, context: `움직인 실체 ${str(m.entity)}`,
    })
  );
  const money = c.money as Json | null | undefined;
  if (money && str(money.text))
    out.push({ path: "money.text", ptr: ["money", "text"], itemPtr: ["money"], text: str(money.text), refs: strs(money.refs), whole: false, context: "돈의 흐름" });
  const lens = c.china_lens as Json | null | undefined;
  if (lens && str(lens.text))
    out.push({
      path: "china_lens.text", ptr: ["china_lens", "text"], itemPtr: ["china_lens"], text: str(lens.text), refs: strs(lens.refs),
      metrics: strs(lens.metrics), whole: false, context: "중국 렌즈",
    });
  arr(c.watch_next).forEach((w, i) =>
    out.push({ path: `watch_next[${i}].text`, ptr: ["watch_next", i, "text"], itemPtr: ["watch_next", i], text: str(w.text), refs: strs(w.refs), whole: false, context: "다음 주 볼 것" })
  );
  const term = c.term as Json | null | undefined;
  if (term && str(term.why))
    out.push({
      path: "term.why", ptr: ["term", "why"], itemPtr: ["term"], text: str(term.why), refs: [], metrics: strs(term.metrics), whole: false,
      context: `이번 기간의 용어 ${str(term.term)}`,
    });
  arr(c.month_arc).forEach((a, i) =>
    out.push({
      path: `month_arc[${i}].text`, ptr: ["month_arc", i, "text"], itemPtr: ["month_arc", i], text: str(a.text), refs: strs(a.refs),
      metrics: strs(a.metrics), whole: false, context: `한 달의 흐름 ${str(a.week)}`,
    })
  );
  return out;
}

/** 판 본문 → 문장 목록 (S01..). 짧은 필드(제목·숫자)는 통째로 한 문장 */
export function segmentContent(content: unknown, editionType: EditionType): Segment[] {
  const c = (content ?? {}) as Json;
  const fields = isPeriodic(editionType) ? periodicFields(c) : dailyFields(c);
  const out: Segment[] = [];
  for (const f of fields) {
    if (!f.text.trim()) continue;
    const parts = f.whole ? [f.text.trim()] : splitSentences(f.text);
    parts.forEach((text, index) => {
      out.push({
        sid: `S${String(out.length + 1).padStart(2, "0")}`,
        path: f.path, index, text, refs: f.refs, metrics: f.metrics, whole: f.whole, context: f.context, ptr: f.ptr, itemPtr: f.itemPtr,
      });
    });
  }
  return out;
}

// ───────────────────────── 수정 적용

export interface SegmentEdit {
  sid: string;
  action: "replace" | "delete";
  /** replace 일 때 새 문장 */
  text?: string;
}

export interface EditFallbacks {
  /** 데일리 headline 이 지워지면 (기본: 1위 기사 제목) / 주간·월간은 지표 문장 */
  headline?: (content: Json) => string | null;
  /** 주간·월간 dek 가 지워지면 지표 문장 */
  dek?: (content: Json) => { text: string; metrics: string[] } | null;
}

export interface EditOutcome {
  content: Json;
  /** 통째로 뺀 항목 위치 */
  dropped: string[];
  /** 결정적 대체를 쓴 필드 */
  fallbacks: string[];
  /** 고칠 수 없음 (lede 가 비었다 등) — 있으면 이 판은 자동 발행하지 않는다 */
  unfixable: string[];
  /** 적용한 수정 (sid → 결과) */
  applied: { sid: string; path: string; action: "replace" | "delete"; before: string; after: string }[];
}

function getAt(obj: unknown, ptr: Ptr): unknown {
  let cur: unknown = obj;
  for (const k of ptr) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string | number, unknown>)[k];
  }
  return cur;
}

function setAt(obj: Json, ptr: Ptr, value: unknown) {
  const parent = getAt(obj, ptr.slice(0, -1)) as Record<string | number, unknown> | undefined;
  if (parent && typeof parent === "object") parent[ptr[ptr.length - 1]] = value;
}

const ptrKey = (p: Ptr) => JSON.stringify(p);

/**
 * 문장 단위 수정을 적용한다. 새 문장은 호출하는 쪽(fix.ts)이 근거 확인을 끝낸 것만 넘긴다.
 * 필드가 비면 항목을 빼고(뒤쪽 위치부터 빼서 앞 위치가 밀리지 않게), 뺄 수 없는 필드는 대체하거나 unfixable.
 */
export function applySegmentEdits(
  content: unknown,
  editionType: EditionType,
  segments: Segment[],
  edits: SegmentEdit[],
  fallbacks: EditFallbacks = {}
): EditOutcome {
  const c = structuredClone((content ?? {}) as Json);
  const bySid = new Map(segments.map((s) => [s.sid, s]));
  const applied: EditOutcome["applied"] = [];
  const out: EditOutcome = { content: c, dropped: [], fallbacks: [], unfixable: [], applied };

  // 필드별로 문장 배열을 만든 뒤 바꾸거나(null = 삭제) 한다
  const fieldSentences = new Map<string, { seg: Segment; parts: (string | null)[] }>();
  for (const e of edits) {
    const seg = bySid.get(e.sid);
    if (!seg) continue;
    const key = ptrKey(seg.ptr);
    if (!fieldSentences.has(key)) {
      const all = segments.filter((s) => ptrKey(s.ptr) === key).sort((a, b) => a.index - b.index);
      fieldSentences.set(key, { seg, parts: all.map((s) => s.text) });
    }
    const f = fieldSentences.get(key)!;
    const before = f.parts[seg.index];
    if (before === undefined || before === null) continue;
    const after = e.action === "replace" ? (e.text ?? "").replace(/\s+/g, " ").trim() : "";
    f.parts[seg.index] = after ? after : null;
    applied.push({ sid: e.sid, path: seg.path, action: after ? "replace" : "delete", before, after });
  }

  const emptied: Segment[] = [];
  for (const { seg, parts } of fieldSentences.values()) {
    const kept = parts.filter((p): p is string => Boolean(p));
    if (!kept.length) {
      emptied.push(seg);
      continue;
    }
    if (seg.path.startsWith("key_numbers[")) {
      const [value, ...rest] = kept.join(" ").split(KEY_NUMBER_SEP);
      const label = rest.join(KEY_NUMBER_SEP).trim();
      if (!value.trim() || !label) {
        emptied.push(seg);
        continue;
      }
      const item = getAt(c, seg.ptr) as Json;
      item.value = value.trim();
      item.label = label;
      continue;
    }
    setAt(c, seg.ptr, kept.join(" "));
  }

  // 빈 필드 → 항목 삭제 또는 대체
  const drops: Ptr[] = [];
  for (const seg of emptied) {
    if (seg.itemPtr) {
      if (!drops.some((d) => ptrKey(d) === ptrKey(seg.itemPtr!))) drops.push(seg.itemPtr);
      continue;
    }
    if (seg.path === "headline") {
      setAt(c, ["headline"], "");
      continue; // 항목을 다 뺀 뒤 대체 (1위 기사가 바뀔 수 있다)
    }
    if (seg.path === "dek" && fallbacks.dek) {
      const fb = fallbacks.dek(c);
      if (fb) {
        c.dek = fb.text;
        c.dek_refs = [];
        c.dek_metrics = fb.metrics;
        out.fallbacks.push("dek");
        continue;
      }
    }
    out.unfixable.push(`${seg.path}: 문장을 모두 지우면 비는 필드`);
  }
  // 뒤쪽 위치부터 뺀다 (배열 위치가 밀리지 않게)
  drops.sort((a, b) => {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const x = a[i];
      const y = b[i];
      if (x === y) continue;
      if (typeof x === "number" && typeof y === "number") return y - x;
      return String(y).localeCompare(String(x));
    }
    return 0;
  });
  for (const d of drops) {
    const last = d[d.length - 1];
    const parent = getAt(c, d.slice(0, -1));
    if (Array.isArray(parent) && typeof last === "number") parent.splice(last, 1);
    else if (parent && typeof parent === "object") (parent as Json)[last as string] = null;
    out.dropped.push(d.map((k) => (typeof k === "number" ? `[${k}]` : k)).join(".").replace(/\.\[/g, "["));
  }
  // 빈 분야 정리·순위 다시 매기기 (데일리)
  if (!isPeriodic(editionType)) {
    c.sections = arr(c.sections).filter((s) => arr(s.items).length > 0);
    c.top_stories = arr(c.top_stories).map((s, i) => ({ ...s, rank: i + 1 }));
    if (!str(c.editor_note)) delete c.editor_note;
  }
  if (!str(c.headline)) {
    const fb = fallbacks.headline
      ? fallbacks.headline(c)
      : isPeriodic(editionType)
        ? null
        : str(arr(c.top_stories)[0]?.title) || null;
    if (fb) {
      c.headline = fb;
      out.fallbacks.push("headline");
    } else out.unfixable.push("headline: 대체할 문장이 없음");
  }
  if (!isPeriodic(editionType) && !arr(c.top_stories).length) out.unfixable.push("top_stories: 주요 기사가 모두 빠짐");
  return out;
}
