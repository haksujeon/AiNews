/**
 * 메타 설명·RSS 설명·JSON-LD headline·공유 카드 제목이 함께 쓰는 글자 수 자르기 (Gate 2).
 * 공백을 한 칸으로 접고, 넘치면 max 글자 안에서 "…" 로 끝낸다. 코드 포인트 단위라 한자·이모지가 반쪽으로 잘리지 않는다.
 */
export function clipText(text: string | null | undefined, max: number): string {
  const flat = (text ?? "").replace(/\s+/g, " ").trim();
  const chars = [...flat];
  if (chars.length <= max) return flat;
  return `${chars.slice(0, Math.max(1, max - 1)).join("").trimEnd()}…`;
}
