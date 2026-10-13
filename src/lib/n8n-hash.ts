/**
 * n8n 워크플로(xOkFhLu8pRaN8LRl) "Merge and Filter" 노드의 content_hash 계산을 그대로 옮긴 것.
 *
 *   const hashInput = link + '_' + newsDate;   // newsDate = 베이징 기준 'YYYY-MM-DD'
 *   const content_hash = simpleHash(hashInput);
 *
 * n8n 은 news_date 를 'YYYY-MM-DD' 문자열로 보내고 DB(timezone=UTC)는 그날 00:00 UTC 로 저장하므로
 * DB 행에서 source_url + '_' + to_char(news_date AT TIME ZONE 'UTC','YYYY-MM-DD') 로 같은 해시를 재계산할 수 있다.
 *
 * 주의: 아래 함수는 n8n 코드와 비트 단위로 같아야 한다 (32비트 XOR 동작 포함). 수정 금지.
 */
export function n8nSimpleHash(str: string): string {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h) ^ str.charCodeAt(i);
  return (h >>> 0).toString(16).padStart(8, '0') + str.length.toString(16).padStart(8, '0');
}

export function n8nContentHash(sourceUrl: string, newsDateYmd: string): string {
  return n8nSimpleHash(sourceUrl + '_' + newsDateYmd);
}
