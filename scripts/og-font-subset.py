#!/usr/bin/env python3
"""
공유 카드(OG 이미지)용 글꼴 일부 글자 묶음을 만든다 (P0-3). 결과는 assets/fonts/ 에 커밋한다 — 한 번만 돌리면 된다.

  pip install fonttools
  python3 scripts/og-font-subset.py <Pretendard-Bold.otf> <NotoSansSC-Bold.otf> [corpus.txt]

- Pretendard-Bold.subset.otf : KS X 1001 한글 2350자 + 라틴·문장부호 (+ corpus 의 한글)
- NotoSansSC-Bold.subset.otf : GB2312 1·2급 한자 6763자 + 중국어 문장부호·전각 (+ corpus 의 한자·가나)
  corpus.txt 는 공개 기사 제목·브리핑 헤드라인·messages 에서 뽑은 글자 모음(선택). 실제로 쓰인 2급 한자를 덧붙인다.
원본: Pretendard 1.3.9 (npm pretendard, dist/public/static/Pretendard-Bold.otf),
      Noto Sans CJK SC Bold (SubsetOTF, notofonts/noto-cjk). 둘 다 SIL OFL 1.1 — 라이선스 전문은 assets/fonts/*.txt.
"""
import sys
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont

OUT = Path(__file__).resolve().parent.parent / "assets" / "fonts"

LATIN = set(range(0x20, 0x7F)) | set(range(0xA0, 0x180))
PUNCT = set(range(0x2010, 0x2070)) | {0x20A9, 0x20AC, 0x2122, 0x2190, 0x2192, 0x2191, 0x2193, 0x2264, 0x2265, 0x00D7, 0x00B7}
CJK_PUNCT = set(range(0x3000, 0x3040)) | set(range(0xFF01, 0xFF5F)) | {0x30FB}


def ksx1001_hangul() -> set[int]:
    out = set()
    for cp in range(0xAC00, 0xD7A4):
        try:
            # euc-kr 코덱은 2350자 밖의 글자도 8바이트 조합열로 인코딩하므로 2바이트인 것만 센다
            if len(chr(cp).encode("euc-kr")) == 2:
                out.add(cp)
        except UnicodeEncodeError:
            pass
    return out  # 2350


def gb2312(last_row: int) -> set[int]:
    """GB2312 한자. last_row=0xD8 → 1급(16~55 구역) 3755자, 0xF8 → 1·2급 6763자"""
    out = set()
    for row in range(0xB0, last_row):
        for col in range(0xA1, 0xFF):
            try:
                ch = bytes([row, col]).decode("gb2312")
            except UnicodeDecodeError:
                continue
            out.add(ord(ch))
    return out


def make(src: str, dst: Path, codepoints: set[int]) -> None:
    font = TTFont(src)
    cmap = font.getBestCmap()
    keep = sorted(cp for cp in codepoints if cp in cmap)
    opts = subset.Options()
    opts.layout_features = ["kern", "liga", "locl", "palt", "vert"]
    opts.name_IDs = ["*"]  # 저작권·라이선스 이름표는 그대로
    opts.name_languages = ["*"]
    opts.notdef_outline = True
    opts.hinting = False
    opts.desubroutinize = False
    s = subset.Subsetter(opts)
    s.populate(unicodes=keep)
    s.subset(font)
    font.save(str(dst))
    print(f"{dst.name}: {len(keep)} glyph codepoints, {dst.stat().st_size / 1024:.0f} KiB")


def main() -> None:
    pretendard, noto = sys.argv[1], sys.argv[2]
    corpus = set(map(ord, Path(sys.argv[3]).read_text("utf-8"))) if len(sys.argv) > 3 else set()
    hangul = ksx1001_hangul() | {c for c in corpus if 0xAC00 <= c <= 0xD7A3 or 0x3130 <= c <= 0x318F}
    # 1급만으로는 새 기사 제목의 2급 한자(예: 36氪 의 氪)가 두부가 될 수 있어 2급까지 넣는다(1,509 KiB ≈ 1.47 MiB, 계획 상한 약 1.5MB)
    han = gb2312(0xF8) | {c for c in corpus if 0x3400 <= c <= 0x9FFF or 0x3040 <= c <= 0x30FF or 0xF900 <= c <= 0xFAFF}
    OUT.mkdir(parents=True, exist_ok=True)
    make(pretendard, OUT / "Pretendard-Bold.subset.otf", LATIN | PUNCT | hangul | {c for c in corpus if c < 0x2E80})
    make(noto, OUT / "NotoSansSC-Bold.subset.otf", LATIN | PUNCT | CJK_PUNCT | han)


if __name__ == "__main__":
    main()
