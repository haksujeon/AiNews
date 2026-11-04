/**
 * n8n 수집 워크플로 「AI Agent - Insights」 노드의 jsonBody 를 src/lib/insights.ts(INSIGHT_SYSTEM)에서 만든다.
 * 프롬프트 원본은 저장소에 두고 n8n 에는 이 출력만 넣는다 (n8n export 는 토큰이 있어 공개 저장소에 못 넣는다).
 *
 *   npx tsx scripts/n8n-insight-prompt.ts > /tmp/.../jsonBody.txt
 *
 * user 메시지는 insightUserMessage() 와 같은 모양이어야 한다(밤 보정과 같은 입력).
 */
import { INSIGHT_SYSTEM } from "../src/lib/insights";

if (INSIGHT_SYSTEM.includes("}}")) throw new Error("n8n 식 안에서 }} 는 쓸 수 없다");
const user = `'다음 뉴스를 분석하세요:\\n\\n제목: ' + $json.title_cn + '\\n요약: ' + ($json.summary_cn || $json.summary_kr || '') + '\\n본문: ' + ($json.content_cn ? $json.content_cn.substring(0, 3000) : '')`;
process.stdout.write(
  `={{ JSON.stringify({ model: 'anthropic-api-haiku-5-5', messages: [{ role: 'system', content: ${JSON.stringify(INSIGHT_SYSTEM)} }, { role: 'user', content: ${user} }], max_tokens: 3072, thinking: { type: 'disabled' }, num_retries: 2 }) }}`
);
