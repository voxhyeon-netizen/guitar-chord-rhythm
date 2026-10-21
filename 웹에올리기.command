#!/bin/bash
# 기타 코드 리듬 — 웹에 올려서 아이패드 어디서나 쓰기
cd "$(dirname "$0")" || exit 1
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
REPO="guitar-chord-rhythm"
GH_VER="2.63.2"

pause() { echo ""; read -r -p "Enter 키를 누르면 창을 닫습니다…" _; }
die()   { echo ""; echo "❌ $1"; pause; exit 1; }

echo "=== 기타 코드 리듬 — 웹에 올리기 ==="
echo ""
echo "곡(songs 폴더)도 함께 올라갑니다."
PIN=$(sed -n "s/.*pin: *'\([^']*\)'.*/\1/p" js/access-config.js | head -1)
echo "접속 코드: ${PIN}"
echo "(바꾸려면 js/access-config.js 의 pin 을 수정한 뒤 다시 실행하세요)"
echo ""
read -r -p "계속할까요? (y/n) " YN
[ "$YN" = "y" ] || [ "$YN" = "Y" ] || { echo "취소했습니다."; pause; exit 0; }

# ---- GitHub 도구(gh) 준비 : 이 맥에 맞는 버전으로 ----
if command -v gh >/dev/null 2>&1 && gh --version >/dev/null 2>&1; then
  GH="$(command -v gh)"
else
  case "$(uname -m)" in
    arm64) GH_ARCH="arm64" ;;          # 애플 실리콘
    *)     GH_ARCH="amd64" ;;          # 인텔
  esac
  GH_DIR="/tmp/gh_${GH_VER}_macOS_${GH_ARCH}"
  GH="${GH_DIR}/bin/gh"

  if ! "$GH" --version >/dev/null 2>&1; then
    echo ""
    echo "GitHub 도구를 내려받는 중… (${GH_ARCH}, 처음 한 번만)"
    rm -rf "$GH_DIR" "/tmp/gh_${GH_ARCH}.zip"
    curl -fL --progress-bar \
      "https://github.com/cli/cli/releases/download/v${GH_VER}/gh_${GH_VER}_macOS_${GH_ARCH}.zip" \
      -o "/tmp/gh_${GH_ARCH}.zip" || die "내려받지 못했습니다. 인터넷 연결을 확인해 주세요."
    unzip -qo "/tmp/gh_${GH_ARCH}.zip" -d /tmp || die "압축을 풀지 못했습니다."
    xattr -dr com.apple.quarantine "$GH_DIR" 2>/dev/null
  fi
  "$GH" --version >/dev/null 2>&1 || die "GitHub 도구를 실행할 수 없습니다. (uname: $(uname -m))"
fi

# ---- 로그인 ----
if ! "$GH" auth status >/dev/null 2>&1; then
  echo ""
  echo "GitHub 로그인 창이 열립니다. 브라우저에서 승인해 주세요."
  echo "(계정이 없으면 먼저 github.com 에서 가입해 주세요)"
  "$GH" auth login --hostname github.com --git-protocol https --web || die "로그인하지 못했습니다."
fi

LOGIN=$("$GH" api user -q .login) || die "GitHub 계정을 확인하지 못했습니다."
echo ""
echo "계정: ${LOGIN}"

# ---- 업로드 ----
if [ ! -d .git ]; then
  git init -q || die "git 을 사용할 수 없습니다. (Xcode 명령어 도구가 필요할 수 있어요)"
  git branch -M main
fi
git add -A
if ! git commit -q -m "기타 코드 리듬 업데이트" 2>/dev/null; then
  if git diff --cached --quiet; then
    echo "(바뀐 내용 없음)"
  else
    # 커밋할 내용은 있는데 실패 = git 이름/메일이 설정되지 않은 경우
    git config user.name "${LOGIN}"
    git config user.email "${LOGIN}@users.noreply.github.com"
    git commit -q -m "기타 코드 리듬 업데이트" || die "저장하지 못했습니다."
  fi
fi

if "$GH" repo view "${LOGIN}/${REPO}" >/dev/null 2>&1; then
  echo "업로드 중…"
  git remote get-url origin >/dev/null 2>&1 || \
    git remote add origin "https://github.com/${LOGIN}/${REPO}.git"
  "$GH" auth setup-git >/dev/null 2>&1
  git push -u origin main || die "업로드하지 못했습니다."
else
  echo "저장소 만드는 중…"
  "$GH" repo create "$REPO" --public --source=. --remote=origin --push || die "저장소를 만들지 못했습니다."
fi

echo "웹 페이지 켜는 중…"
"$GH" api -X POST "repos/${LOGIN}/${REPO}/pages" -f build_type=workflow >/dev/null 2>&1

URL="https://${LOGIN}.github.io/${REPO}/"
echo ""
echo "============================================"
echo "  올렸습니다!"
echo "  주소:      ${URL}"
echo "  접속 코드: ${PIN}"
echo "============================================"
echo ""
echo "1~2분 뒤에 열립니다. 아이패드 Edge에서 위 주소를 열고"
echo "홈 화면에 추가 → 수업 전에 '⬇ 오프라인 저장'을 한 번 눌러두세요."
open "$URL" 2>/dev/null
pause
