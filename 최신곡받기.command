#!/bin/bash
# 다른 맥에서 올린 곡을 이 맥으로 받아오기
cd "$(dirname "$0")" || exit 1
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
pause() { echo ""; read -r -p "Enter 키를 누르면 창을 닫습니다…" _; }

echo "=== 최신 곡 받아오기 ==="
echo ""

if [ ! -d .git ]; then
  echo "이 폴더는 아직 GitHub와 연결되어 있지 않습니다."
  echo "먼저 '웹에올리기.command' 를 한 번 실행해 주세요."
  pause; exit 1
fi

git stash -q 2>/dev/null && STASHED=1
if git pull --rebase origin main; then
  [ "$STASHED" = "1" ] && git stash pop -q 2>/dev/null
  echo ""
  echo "✅ 최신 곡을 받아왔습니다."
  echo "   곡 수: $(python3 -c "import json;print(len(json.load(open('songs/songs.json'))['songs']))" 2>/dev/null || echo '?')"
  echo "   이제 '기타게임.command' 로 열면 새 곡이 보입니다."
else
  git rebase --abort 2>/dev/null
  [ "$STASHED" = "1" ] && git stash pop -q 2>/dev/null
  echo ""
  echo "⚠️  받아오지 못했습니다. 같은 곡을 양쪽 맥에서 고쳤을 수 있어요."
  echo "   어느 쪽 내용을 남길지 알려주시면 도와드릴게요."
fi
pause
