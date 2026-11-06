/**
 * 표기 사전 후보 보고서 (2026-11-06) — 사전(src/lib/text/ko-glossary.ts)에 없는 중국 회사·용어를 찾아 사람이 고르게 한다.
 * 고르는 것은 사람(사용자 결정: 한국 언론 표기 우선 → 없으면 영문). 이 스크립트는 사전을 바꾸지 않는다.
 *
 *   npx tsx scripts/ko-names-candidates.ts [--days 7] [--out ~/ainews-reports/ko-names-candidates]
 *
 * 찾는 것
 *  (A) 중국어 제목의 회사 이름 꼴(○○科技·○○智能·○○机器人·○○动力·○○半导体 …) 중 사전에 없는 것 — 건수·한국어 제목 예시
 *  (B) 한국어 글의 한자음 읽기 꼴(○○과기·○○커지·○○즈넝·○○지능 …) 중 사전의 정한 표기가 아닌 것 — 건수·중국어 제목 예시
 * 결과: 표로 출력 + --out 폴더에 날짜.md
 */
import { loadEnvConfig } from "@next/env";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const arg = (k: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};

/** 회사 이름 꼴 (중국어). 앞 2~4자 + 흔한 회사 꼬리 */
const ZH_COMPANY = /([一-鿿]{2,4})(科技|智能|机器人|动力|半导体|芯片|微电子|智造|智驾|汽车|集团)/g;
/** 흔한 낱말이라 회사 이름이 아닌 앞부분 */
const ZH_STOP = new Set(["人工", "具身", "人形", "工业", "服务", "国产", "中国", "全球", "通用", "智能", "自动", "新能源", "家用", "医疗", "数字", "前沿", "未来", "传统", "物理", "消费", "四足", "协作", "特种", "教育", "陪伴", "清洁", "多家", "头部", "国内", "海外", "相关", "我国", "本土", "多款", "首款", "多个", "这家", "一家", "该", "其"]);
/** 한자음 읽기 꼴 (한국어) */
const KO_SINO = /(?<![가-힣])([가-힣]{2,4})(과기|커지|즈넝|지능|동력|과학기술)(?![가-힣])/g;
const KO_STOP = new Set(["인공", "구현", "체화", "범용", "초", "인간", "인공 ", "생성형", "일반", "기계", "집단", "군집", "감정", "공간", "물리", "신체", "초인", "의료", "산업", "교육", "금융", "자율", "협업", "에이전트", "슈퍼"]);

async function main() {
  loadEnvConfig(process.cwd());
  const days = Number(arg("days") ?? 7);
  const outDir = (arg("out") ?? join(homedir(), "ainews-reports", "ko-names-candidates")).replace(/^~/, homedir());
  const { default: pool } = await import("../src/lib/db");
  const { KO_GLOSSARY } = await import("../src/lib/text/ko-glossary");
  const known = new Set(KO_GLOSSARY.flatMap((e) => e.zh));
  const knownKo = new Set(KO_GLOSSARY.map((e) => e.ko));
  try {
    const { rows } = await pool.query(
      `SELECT id::text, title_cn, title_kr, coalesce(summary_kr,'') || ' ' || coalesce(content_kr,'') AS body_kr
         FROM ai_news_ex WHERE created_at > now() - ($1 || ' days')::interval AND title_cn IS NOT NULL`,
      [String(days)]
    );
    const A = new Map<string, { n: number; ex: string[] }>();
    const Bm = new Map<string, { n: number; ex: string[] }>();
    for (const r of rows as { id: string; title_cn: string; title_kr: string | null; body_kr: string }[]) {
      const seenA = new Set<string>();
      for (const m of r.title_cn.matchAll(ZH_COMPANY)) {
        const name = m[1] + m[2];
        if (ZH_STOP.has(m[1]) || known.has(m[1]) || known.has(name) || [...known].some((k) => name.includes(k))) continue;
        if (seenA.has(name)) continue;
        seenA.add(name);
        const a = A.get(name) ?? { n: 0, ex: [] };
        a.n++;
        if (a.ex.length < 2 && r.title_kr) a.ex.push(r.title_kr.slice(0, 60));
        A.set(name, a);
      }
      const seenB = new Set<string>();
      for (const m of `${r.title_kr ?? ""} ${r.body_kr}`.matchAll(KO_SINO)) {
        const w = m[1] + m[2];
        if (KO_STOP.has(m[1]) || knownKo.has(w) || seenB.has(w)) continue;
        seenB.add(w);
        const b = Bm.get(w) ?? { n: 0, ex: [] };
        b.n++;
        if (b.ex.length < 2) b.ex.push(r.title_cn.slice(0, 50));
        Bm.set(w, b);
      }
    }
    const top = (m: Map<string, { n: number; ex: string[] }>) => [...m.entries()].filter(([, v]) => v.n >= 2).sort((a, b) => b[1].n - a[1].n).slice(0, 40);
    const ta = top(A);
    const tb = top(Bm);
    const date = new Date().toISOString().slice(0, 10);
    const md = [
      `# 표기 사전 후보 (${date}, 최근 ${days}일 기사 ${rows.length}건)`,
      "",
      "정한 원칙: 한국 언론 표기 우선 → 없으면 영문 공식 이름. 사전에 넣을 것만 골라 알려 주세요 (src/lib/text/ko-glossary.ts).",
      "",
      `## (A) 중국어 제목의 회사 이름 — 사전에 없음 (2건 이상, ${ta.length}개)`,
      "",
      "| 중국어 | 건수 | 한국어 제목 예 |",
      "|---|---|---|",
      ...ta.map(([k, v]) => `| ${k} | ${v.n} | ${v.ex.join(" / ")} |`),
      "",
      `## (B) 한국어 글의 한자음 읽기로 보이는 표기 (2건 이상, ${tb.length}개)`,
      "",
      "| 한국어 표기 | 건수 | 중국어 제목 예 |",
      "|---|---|---|",
      ...tb.map(([k, v]) => `| ${k} | ${v.n} | ${v.ex.join(" / ")} |`),
      "",
    ].join("\n");
    mkdirSync(outDir, { recursive: true });
    const file = join(outDir, `${date}.md`);
    writeFileSync(file, md);
    console.log(`${new Date().toISOString()} 후보 A ${ta.length} · B ${tb.length} (기사 ${rows.length}건) → ${file}`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
