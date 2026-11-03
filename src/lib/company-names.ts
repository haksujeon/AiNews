/**
 * 기업 표시 이름 (기업·이슈 메뉴, 2026-11-03). 기업 범위 = 이름표 ENTITIES (briefing/entities.ts).
 * 기본은 언어별 첫 별칭(nameEntryOf), 첫 별칭이 사람·제품 이름이거나 비어 있으면 아래에서 덮는다.
 * ko 덮어쓰기는 주간·월간 리포트의 entityNameKo(meta·amd·intel·cn_gov)와 같은 값을 포함한다.
 */
import { ENTITIES, nameEntryOf, type Entity } from "./briefing/entities";

export type CompanyLocale = "ko" | "en" | "zh";

const OVERRIDE: Record<string, Partial<Record<CompanyLocale, string>>> = {
  cn_gov: { ko: "중국 정부·기관", en: "Chinese government & institutes", zh: "中国政府·机构" },
  meta: { ko: "메타", en: "Meta", zh: "Meta" },
  amd: { ko: "AMD", en: "AMD", zh: "AMD" },
  intel: { ko: "인텔", en: "Intel" },
  openai: { zh: "OpenAI" },
  anthropic: { zh: "Anthropic" },
  figure_ai: { zh: "Figure AI" },
  "1x": { zh: "1X" },
  fourier: { ko: "푸리에", en: "Fourier" },
  xpeng_iron: { ko: "샤오펑 IRON", en: "XPeng IRON", zh: "小鹏 IRON" },
  xunce: { en: "Xunce" },
  baai: { en: "BAAI" },
  tsmc: { ko: "TSMC" },
  alibaba: { zh: "阿里巴巴" },
  bytedance: { zh: "字节跳动" },
  deepseek: { zh: "DeepSeek" },
  minimax: { zh: "MiniMax" },
  smic: { zh: "中芯国际" },
  cxmt: { zh: "长鑫存储" },
  stepfun: { zh: "阶跃星辰" },
  infinigence: { zh: "无问芯穹" },
};

export function isCompanyKey(key: string): boolean {
  return ENTITIES.some((e) => e.key === key);
}

export function companyEntity(key: string): Entity | undefined {
  return ENTITIES.find((e) => e.key === key);
}

/** 화면에 보일 이름. 모르는 키는 키 그대로 */
export function companyName(key: string, locale: string): string {
  const loc: CompanyLocale = locale === "en" || locale === "zh" ? locale : "ko";
  const o = OVERRIDE[key]?.[loc];
  if (o) return o;
  const e = companyEntity(key);
  if (!e) return key;
  const n = nameEntryOf(e);
  // 언어별 첫 별칭 → 없으면 en → ko 순
  return n[loc][0] ?? n.en[0] ?? n.ko[0] ?? key;
}

/** 중국 기업 먼저, 그 안에서는 이름표 순서 (기업 찾기 칩) */
export function companyDirectory(): { key: string; chinese: boolean }[] {
  return ENTITIES.map((e) => ({ key: e.key, chinese: e.chinese }));
}
