#!/usr/bin/env node
/**
 * AI News 수집 파이프라인 점검 스크립트
 *
 * 2026-08-27 조치(n8n 모델명 aliyun-tp-deepseek-v4-pro → apiyi-deepseek-v4-flash) 이후
 * 실제로 신규 뉴스가 저장되는지, 그리고 "번역이 되었는지"까지 확인한다.
 *
 * 번역 확인이 중요한 이유:
 *   AI Agent - Translation / Insights 노드는 onError=continueRegularOutput 이라
 *   LLM 호출이 실패해도 워크플로가 '성공'으로 표시되며 중국어 원문을 그대로 통과시킨다.
 *   따라서 "건수가 늘었다"만으로는 정상 판정을 할 수 없고, title_kr != title_cn 을 봐야 한다.
 *
 * 사용: node scripts/check-ingest.mjs
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const WORKFLOW_ID = "xOkFhLu8pRaN8LRl";
const PG_CONTAINER = "aiwork-postgres";
const SITE = "https://news.aibaseclub.com/ainews/ko";

const psql = (sql) =>
  execFileSync("docker", ["exec", PG_CONTAINER, "psql", "-U", "ainews", "-d", "ainews", "-tAF|", "-c", sql], {
    encoding: "utf8",
  }).trim();

function n8nCreds() {
  const cfg = JSON.parse(readFileSync(`${process.env.HOME}/.claude.json`, "utf8"));
  let key = null;
  let url = "http://127.0.0.1:5678";
  JSON.stringify(cfg, (k, v) => {
    if (k === "N8N_API_KEY" && typeof v === "string") key = v;
    if (k === "N8N_API_URL" && typeof v === "string") url = v;
    return v;
  });
  return { key, url };
}

const lines = [];
const log = (s) => { lines.push(s); console.log(s); };

log(`# AI News 파이프라인 점검  (${new Date().toISOString()})`);

// 1) DB 현황
const [total, newest] = psql("select count(*), max(news_date)::date from ai_news_ex").split("|");
log(`\n## DB`);
log(`- 총 건수: ${total}`);
log(`- 최신 news_date: ${newest}`);

const today = new Date().toISOString().slice(0, 10);
const fresh = psql(
  `select count(*) from ai_news_ex where news_date::date >= current_date - interval '1 day'`
);
log(`- 최근 2일(${today} 기준) 건수: ${fresh}`);

// 2) 번역 품질 — 한국어 제목이 중국어 원문 그대로인지
if (Number(fresh) > 0) {
  const [n, untranslated] = psql(
    `select count(*), count(*) filter (where title_kr = title_cn or title_kr ~ '[\\u4e00-\\u9fff]{4,}')
     from ai_news_ex where news_date::date >= current_date - interval '1 day'`
  ).split("|");
  const ok = Number(untranslated) === 0;
  log(`- 번역 상태: ${n}건 중 미번역(중국어 잔존) ${untranslated}건 ${ok ? "✅" : "❌ onError 무음 실패 의심"}`);
  log(`\n### 최근 저장분 샘플`);
  log(psql(`select left(title_kr,60), source_name, news_date::date
            from ai_news_ex where news_date::date >= current_date - interval '1 day'
            order by created_at desc limit 5`) || "  (없음)");
} else {
  log(`- ❌ 신규 저장 없음 — 파이프라인이 여전히 막혀 있음`);
}

// 3) n8n 최근 실행
const { key, url } = n8nCreds();
log(`\n## n8n 최근 실행`);
try {
  const r = await fetch(`${url}/api/v1/executions?workflowId=${WORKFLOW_ID}&limit=5`, {
    headers: { "X-N8N-API-KEY": key },
  });
  const j = await r.json();
  for (const e of j.data ?? []) {
    log(`- ${e.startedAt} ${e.status === "success" ? "✅" : "❌"} ${e.status} (id ${e.id})`);
  }
  const latest = j.data?.[0];
  if (latest && latest.status !== "success") {
    const d = await (await fetch(`${url}/api/v1/executions/${latest.id}?includeData=true`, {
      headers: { "X-N8N-API-KEY": key },
    })).json();
    const err = JSON.stringify(d).match(/"message":"([^"]{10,200})"/);
    log(`  실패 원인 추정: ${err ? err[1] : "확인 필요 (n8n UI)"}`);
  }
} catch (e) {
  log(`- n8n API 조회 실패: ${e.message}`);
}

// 4) 사이트 헬스체크
log(`\n## 사이트`);
try {
  const r = await fetch(SITE);
  log(`- ${SITE} → ${r.status} ${r.status === 200 ? "✅" : "❌"}`);
} catch (e) {
  log(`- ${SITE} → ❌ ${e.message}`);
}
try {
  const pm2 = execFileSync("pm2", ["jlist"], { encoding: "utf8" });
  const app = JSON.parse(pm2).find((a) => a.name === "ainews");
  log(`- pm2 ainews: ${app ? `${app.pm2_env.status} (restarts ${app.pm2_env.restart_time})` : "❌ 등록 없음"}`);
} catch {
  log(`- pm2 조회 실패`);
}
