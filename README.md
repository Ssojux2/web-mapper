# Web Mapper

브라우저에서 영상을 실물에 프로젝션 맵핑하는 프로그램입니다. MadMapper의 비디오 맵핑 기능 중 핵심만 먼저 구현했습니다.

## 실행

```bash
npm install
npm run dev
```

Chrome 또는 Edge에서 http://localhost:5173 을 엽니다(맥·윈도우 모두 됩니다).

## 사용 순서

1. **Media** 탭에서 영상이나 이미지를 추가합니다. 파일을 패널에 끌어다 놓아도 됩니다.
2. **Surfaces** 탭에서 `+ Quad`로 서피스를 만들고, 미디어를 Output 뷰의 서피스 위에 끌어다 놓습니다.
3. **Output** 탭에서 해상도를 프로젝터에 맞추고, `화면 목록`으로 프로젝터를 고른 뒤 `출력 창 열기`를 누릅니다.
4. 출력 창을 클릭하면 전체화면이 됩니다(F 키로 전환).
5. Output 뷰에서 코너 핸들을 실물 모서리에 맞춥니다. Input 뷰에서는 영상의 어느 부분을 쓸지 고릅니다.

작업 내용은 자동 저장됩니다. `저장`은 `.mapper.json` 파일로 내보냅니다.

## 단축키

| 키 | 동작 |
| --- | --- |
| 화살표 / Shift+화살표 | 선택한 코너(없으면 서피스 전체)를 1px / 10px 이동 |
| Tab / Shift+Tab | 코너와 서피스 순환 |
| Esc | 코너 선택 해제, 한 번 더 누르면 서피스 선택 해제 |
| Q | Quad 추가 |
| Cmd/Ctrl+D | 복제 |
| Delete | 삭제 |
| Cmd/Ctrl+[ / ] | 레이어 뒤로 / 앞으로 |
| Space | 재생/일시정지 |
| T | 테스트 패턴 |
| Cmd/Ctrl+Z, Shift+Cmd/Ctrl+Z | 실행 취소, 다시 실행 |
| Cmd/Ctrl+S, Shift+Cmd/Ctrl+S, Cmd/Ctrl+O | 저장, 다른 이름으로 저장, 열기 |
| Cmd/Ctrl+휠, 휠, Alt+드래그 | 확대, 이동, 이동 |
| Cmd/Ctrl+0 | 뷰를 화면에 맞추기 |

## 브라우저 지원

- **Chrome·Edge**: 모든 기능. 출력 창이 고른 화면에 자동으로 열리고, 미디어 파일은 다시 열 때 권한만 허용하면 재연결됩니다.
- **Safari·Firefox**: 맵핑과 출력은 됩니다. 출력 창은 직접 프로젝터 화면으로 옮겨야 합니다. 미디어는 브라우저 저장소에 복사본으로 보관합니다.
- 오디오는 아직 지원하지 않습니다(모든 영상이 음소거 재생).

## 구조

- `src/core`: 프로젝트 모델, 호모그래피 계산, 실행 취소 상태, 창 간 메시지
- `src/render`: WebGL2 렌더러(원근 보정 셰이더, 테스트 패턴, 영상 텍스처)
- `src/media`: 미디어 요소, 파일 선택, IndexedDB 보관
- `src/project`: JSON 저장·열기, 자동 저장
- `src/editor`: 편집기 UI(React)
- `src/output`: 출력 창, 화면 배치, 재생 동기화

```bash
npm test        # 단위 테스트
npm run lint
npm run build
```
