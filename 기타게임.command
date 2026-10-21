#!/bin/bash
# 기타 코드 리듬 — 더블클릭으로 실행
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

xattr -d com.apple.quarantine "$0" 2>/dev/null || true
xattr -d com.apple.quarantine "$DIR/serve.py" 2>/dev/null || true

if ! command -v python3 >/dev/null 2>&1; then
  echo "Python 3가 설치되어 있지 않습니다."
  read -r -p "Enter 키를 누르면 창을 닫습니다…" _
  exit 1
fi

echo "🎸 기타 코드 리듬 시작 중…"
echo "   (아이패드에서 쓰려면 아래 '아이패드에서' 주소를 Edge 주소창에 입력하세요)"
python3 "$DIR/serve.py" || {
  echo ""
  echo "실행에 실패했습니다. 터미널에서 직접 실행해 보세요:"
  echo "  cd \"$DIR\" && python3 serve.py"
  read -r -p "Enter 키를 누르면 창을 닫습니다…" _
}
