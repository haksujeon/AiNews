#!/bin/bash
# 매일 브리핑 카드·음성 — ko·zh·en (사용자 결정 2026-11-05: 음성 = NotebookLM, 인포그래픽 = 자체 카드, 검사 통과 시 자동 공개).
# crontab(UTC) 10 18 / 0 20 (= 03:10 · 05:00 KST, 발행 01시대 이후·07:00 메일 전). 이미 승인된 것은 건너뛰므로 두 번째는 재시도용.
# 끄기: .env.local 에 BRIEFING_MEDIA=off. 로그 ~/logs/ainews-media.log
set -u
cd "$(dirname "$0")/.." || exit 1
export PATH=/home/swingken/.nvm/versions/node/v20.20.1/bin:$PATH
if grep -qE '^BRIEFING_MEDIA=off' .env.local 2>/dev/null; then echo "$(date -u +%FT%TZ) 꺼짐(BRIEFING_MEDIA=off)"; exit 0; fi
# 세 언어 모두 (2026-11-05 사용자 결정: 중국어·영어도). 한국어가 먼저 — 07:00 메일 구독자 대부분이 한국어
for L in ko zh en; do
  echo "===== $(date -u +%FT%TZ) 카드 $L"
  npx tsx scripts/briefing-card.ts --locale "$L" --approve || echo "카드 실패 $L (exit $?)"
done
for L in ko zh en; do
  echo "===== $(date -u +%FT%TZ) 음성 $L"
  npx tsx scripts/briefing-audio.ts --locale "$L" --attempts 3 --approve-on-pass || echo "음성 실패 $L (exit $?)"
done
echo "===== $(date -u +%FT%TZ) 끝"
