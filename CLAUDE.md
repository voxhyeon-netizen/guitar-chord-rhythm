# 기타 코드 리듬 — 프로젝트 안내 (Claude 전용)

> 이 파일은 Claude가 이 폴더에서 작업을 시작할 때 자동으로 읽습니다.
> 사람이 읽는 설명서는 `README.md`, 진행 상황은 `작업노트.md` 입니다.

## 무엇을 만드는 중인가

초등 기타 수업용 리듬 게임. 노래에 맞춰 코드가 위에서 내려오고, **아이들이 실제 기타로 연주**하고
**선생님이 키 하나로 바로 판정**한다. 자동 채점(마이크 인식) 없음 — 판정은 사람이 한다.

- 판정 키: `X` 성공 · `Z` 살짝 · `C` 실패 · `Space` 일시정지
- 선생님은 교실 뒤에서 조작한다. **조작은 최소**로, 화면은 빔프로젝터에서 멀리서도 보이게.
- 사용자(선생님)는 개발자가 아니다. 터미널 명령 대신 `.command` 더블클릭으로 쓴다.

## 파일 지도

```
index.html          화면 4개(홈·채보 에디터·연주·결과) + 설정 오버레이. 모든 DOM이 여기 있다.
css/style.css       전체 스타일
js/access-config.js 웹에 올렸을 때 쓰는 접속 코드 설정
js/gate.js          접속 코드 잠금 (로컬·같은 와이파이는 묻지 않음)
js/chords.js        코드 모양 데이터 + 운지 다이어그램 SVG 생성
js/storage.js       곡 목록 읽기/쓰기(serve.py API), 설정은 localStorage
js/audio.js         재생 엔진. <audio> 요소 기반 + 효과음용 WAV 생성
js/editor.js        채보 에디터 (파형·비트 그리드·코드 배치)
js/play.js          연주 화면 (코드 낙하, 판정, 콤보)
js/main.js          화면 전환, 곡 목록, 설정, 오프라인 저장
serve.py            로컬 서버(포트 8799 고정) + 곡 저장 API
sw.js               오프라인 저장용 서비스 워커
songs/songs.json    곡 목록 + 채보   songs/*.mp3,m4a  음원
```

실행 스크립트(사용자가 더블클릭하는 것):

| 파일 | 하는 일 |
|---|---|
| `기타게임.command` | `serve.py` 실행 → 브라우저 열기 (수업용) |
| `웹에올리기.command` | commit + push → GitHub Pages 배포 |
| `최신곡받기.command` | `git pull --rebase` (다른 쪽에서 올린 곡 받기) |

## 작업 규칙

1. **빌드 과정이 없다.** 순수 HTML/CSS/JS. 번들러·npm 쓰지 말 것.
2. **파일을 고치면 `index.html`의 `?v=` 숫자를 모두 +1** 한다. 안 올리면 아이패드에 반영되지 않는다.
   (현재 `v=5` — 한 번에 전부 같은 숫자로 맞춘다.)
3. 곡은 `songs/` 안의 **실제 파일**이다. localStorage에 넣지 말 것 (폴더 복사로 곡이 따라가야 한다).
   localStorage에는 **설정값만** 둔다.
4. 아이패드(Edge)에서 돌아야 한다. 오디오는 **첫 터치에서 잠금 해제**가 필요하고, Web Audio로 노래를
   재생하면 무음이 되는 사례가 있었다 → 노래·효과음은 `<audio>`로, Web Audio는 파형/메트로놈 전용.
5. 한글 UI. 아이들·선생님이 읽는 문구는 쉬운 말로.
6. 작업을 끝내면 **`작업노트.md`를 갱신**한다 (아래 참고).

## 번갈아 작업하기 (중요)

이 폴더는 두 곳에서 작업한다 — **Claude 데스크탑 앱 대화**와 **Claude Code 세션**.
GitHub(`voxhyeon-netizen/guitar-chord-rhythm`, 브랜치 `main`)이 둘 사이의 기준이다.

- **작업 시작 전**: `git pull --rebase origin main` (또는 `최신곡받기.command`)으로 먼저 받는다.
- **작업 끝낸 뒤**: `작업노트.md`를 고치고 → commit → push (또는 `웹에올리기.command`).
- 커밋하지 않은 변경을 남겨둔 채 다른 쪽에서 작업하면 충돌한다. **끝낼 때 꼭 push**.
- 사용자가 "데스크탑에서 하던 것"을 물으면 `작업노트.md`와 `git log`를 먼저 본다.

### GitHub 계정이 두 개다 (주의)

| 프로젝트 | 저장소 주인 |
|---|---|
| 기타코드리듬 (이 폴더) | `voxhyeon-netizen` |
| 리듬RPG (`~/Desktop/리듬RPG`) | `Hyeon-seok-C` |

맥에는 한 번에 한 계정만 로그인된다. 지금은 `voxhyeon-netizen`.
리듬RPG 쪽에서 push가 403으로 막히면 계정이 달라서다 — `~/.config/gh/hosts.yml.backup-2026-10-21`을
`hosts.yml`로 되돌리면 `Hyeon-seok-C`로 돌아간다. 멋대로 바꾸지 말고 사용자에게 먼저 알린다.
