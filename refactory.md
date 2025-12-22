# 리팩토링 분석 보고서

## 1. 소스 파일 구조 및 라인 수

### 주요 소스 파일

| 파일 | 라인 수 | 상태 | 설명 |
|------|---------|------|------|
| `public/renderer.js` | **5,967** | ⚠️ 위험 | UI 로직 전체, 리팩토링 필요 |
| `public/index.html` | 1,521 | 주의 | HTML + 인라인 CSS (1,224줄) |
| `public/codicon.css` | 698 | 정상 | VSCode 아이콘 스타일 |
| `src/main.ts` | 506 | 정상 | Electron 메인 프로세스 |
| `src/preload.ts` | 156 | 정상 | IPC 브릿지 |

### 외부 라이브러리 (참고)

| 파일 | 라인 수 | 설명 |
|------|---------|------|
| `public/vs/loader.js` | 1,368 | Monaco Editor 로더 |
| `public/vs/editor.api-*.js` | 903 | Monaco Editor API |

---

## 2. renderer.js 상세 분석

### 2.1 코드 섹션별 라인 분포 (추정)

| 섹션 | 시작 라인 | 종료 라인 | 라인 수 | 비율 |
|------|----------|----------|---------|------|
| 초기화 & 파일 감시 | 1 | ~210 | ~210 | 3.5% |
| Monaco Editor 설정 | ~213 | ~270 | ~57 | 1.0% |
| 파일 탐색기 (Explorer) | ~270 | ~1600 | ~1,330 | 22.3% |
| 탭 관리 | ~1600 | ~2100 | ~500 | 8.4% |
| 메뉴 & 다이얼로그 | ~2100 | ~2550 | ~450 | 7.5% |
| Testcase Sync | ~2550 | ~2750 | ~200 | 3.4% |
| Configuration | ~2750 | ~3080 | ~330 | 5.5% |
| Activity Bar & Sidebar | ~3080 | ~3210 | ~130 | 2.2% |
| **캔버스 에디터** | 3209 | ~4588 | **~1,379** | **23.1%** |
| 모달 & 토스트 | ~4588 | ~4720 | ~132 | 2.2% |
| OUTPUT 패널 | ~4720 | ~4857 | ~137 | 2.3% |
| 터미널 | ~4857 | ~5277 | ~420 | 7.0% |
| **Chat 패널** | 5277 | ~5967 | **~690** | **11.6%** |

### 2.2 함수 개수

- **총 함수 수**: 178개
- **전역 변수**: 30개 이상

### 2.3 주요 기능별 함수 분류

```
📁 파일 탐색기 (Explorer)
├── loadProjectFiles()
├── createFolderElement()
├── createFileElement()
├── loadFolderContents()
├── refreshExplorer()
├── showContextMenu()
├── renameItem()
├── deleteItem()
└── ... (약 25개 함수)

📑 탭 관리 (Tab Manager)
├── openFileInEditor()
├── renderTabs()
├── switchToTab()
├── closeTab()
├── performCloseTab()
├── hasUnsavedChanges()
└── ... (약 10개 함수)

🎨 캔버스 에디터 (Canvas Editor)
├── openCanvasEditorForTab()
├── renderCanvas()
├── drawShape()
├── handleCanvasMouseDown/Move/Up()
├── resizeShape()
├── deleteSelectedShape()
└── ... (약 40개 함수)

💬 Chat 패널
├── initChat()
├── toggleChatPanel()
├── sendChatMessage()
├── streamOllamaResponse()
├── addChatMessage()
├── renderMarkdown()
├── saveChatHistoryFiles()
└── ... (약 20개 함수)

🖥️ 터미널 & OUTPUT
├── createNewTerminal()
├── appendOutput()
├── clearOutput()
└── ... (약 15개 함수)
```

---

## 3. 문제점 분석

### 3.1 🔴 심각한 문제

#### (1) 단일 파일에 모든 로직 집중
- `renderer.js` 하나에 5,967줄의 코드
- 178개의 함수가 하나의 파일에 존재
- 코드 탐색 및 유지보수 어려움

#### (2) 전역 변수 남용
```javascript
// 현재 상태: 30개 이상의 전역 변수
let openTabs = [];
let activeTabIndex = -1;
let monacoEditor = null;
let canvasData = { shapes: [] };
let selectedShape = null;
let chatMessages = [];
// ... 등등
```

#### (3) 관심사 분리 없음
- UI 로직, 비즈니스 로직, 상태 관리가 혼재
- 캔버스 에디터, Chat, 파일 탐색기가 같은 파일에 존재

### 3.2 🟡 주의 필요

#### (1) index.html의 인라인 CSS
- 1,224줄의 CSS가 `<style>` 태그 내에 존재
- 별도의 CSS 파일로 분리 권장

#### (2) 하드코딩된 값들
```javascript
const newWidth = Math.min(Math.max(startWidth + diff, 280), 1600);
// 매직 넘버가 코드 곳곳에 존재
```

#### (3) 중복 코드
- 비슷한 패턴의 이벤트 핸들러
- 유사한 UI 업데이트 로직

---

## 4. 리팩토링 제안

### 4.1 모듈 분리 (권장)

```
public/
├── js/
│   ├── app.js              # 메인 앱 초기화
│   ├── modules/
│   │   ├── file-explorer.js   # 파일 탐색기 (~1,300줄)
│   │   ├── tab-manager.js     # 탭 관리 (~500줄)
│   │   ├── canvas-editor.js   # 캔버스 에디터 (~1,400줄)
│   │   ├── chat-panel.js      # Chat 패널 (~700줄)
│   │   ├── terminal.js        # 터미널 (~420줄)
│   │   ├── output-panel.js    # OUTPUT 패널 (~140줄)
│   │   └── menu-dialog.js     # 메뉴 & 다이얼로그 (~450줄)
│   ├── utils/
│   │   ├── dom-utils.js       # DOM 헬퍼 함수
│   │   ├── file-utils.js      # 파일 관련 유틸리티
│   │   └── markdown.js        # 마크다운 렌더러
│   └── constants.js           # 상수 정의
├── css/
│   ├── main.css              # 메인 스타일
│   ├── explorer.css          # 파일 탐색기 스타일
│   ├── canvas.css            # 캔버스 에디터 스타일
│   ├── chat.css              # Chat 패널 스타일
│   └── components.css        # 공통 컴포넌트 스타일
└── index.html                # HTML만 (구조)
```

### 4.2 상태 관리 개선

```javascript
// 현재: 전역 변수 산재
let openTabs = [];
let activeTabIndex = -1;
let selectedShape = null;

// 제안: 상태 객체로 통합
const AppState = {
  tabs: {
    list: [],
    activeIndex: -1
  },
  canvas: {
    shapes: [],
    selectedShape: null,
    mode: 'select'
  },
  chat: {
    messages: [],
    history: [],
    isLoading: false
  },
  explorer: {
    currentPath: null,
    selectedItem: null
  }
};
```

### 4.3 이벤트 핸들러 통합

```javascript
// 현재: 개별 이벤트 핸들러
document.addEventListener('keydown', handleGlobalKeyDown);
canvas.addEventListener('mousedown', handleCanvasMouseDown);
// ...

// 제안: 이벤트 매니저
const EventManager = {
  init() {
    this.setupKeyboardEvents();
    this.setupMouseEvents();
    this.setupResizeEvents();
  },
  // ...
};
```

### 4.4 CSS 분리

```html
<!-- 현재: index.html 내 인라인 스타일 -->
<style>
  /* 1,224줄의 CSS */
</style>

<!-- 제안: 외부 CSS 파일 -->
<link rel="stylesheet" href="css/main.css">
<link rel="stylesheet" href="css/components.css">
```

---

## 5. 리팩토링 우선순위

| 순위 | 작업 | 영향도 | 난이도 | 예상 효과 |
|------|------|--------|--------|----------|
| 1 | 캔버스 에디터 분리 | 높음 | 중간 | ~1,400줄 분리 |
| 2 | Chat 패널 분리 | 높음 | 낮음 | ~700줄 분리 |
| 3 | 파일 탐색기 분리 | 높음 | 중간 | ~1,300줄 분리 |
| 4 | CSS 외부 파일로 분리 | 중간 | 낮음 | HTML 가독성 향상 |
| 5 | 상태 관리 객체화 | 높음 | 높음 | 코드 구조 개선 |
| 6 | 상수 분리 | 낮음 | 낮음 | 유지보수성 향상 |

---

## 6. 리팩토링 시 주의사항

### 6.1 ES 모듈 호환성
- Electron의 `nodeIntegration: false` 설정으로 인해 `import/export` 사용 시 주의 필요
- 대안: IIFE 패턴 또는 전역 객체 활용

### 6.2 기존 기능 보장
- 각 모듈 분리 후 통합 테스트 필수
- 전역 함수 호출 체인 확인 필요

### 6.3 점진적 리팩토링
- 한 번에 모든 것을 바꾸지 않고 단계별 진행
- 각 단계마다 테스트 및 커밋

---

## 7. 결론

### 현재 상태
- `renderer.js`가 5,967줄로 관리 한계 초과
- 모든 기능이 하나의 파일에 혼재
- 전역 변수 30개 이상으로 상태 추적 어려움

### 권장 조치
1. **즉시**: 캔버스 에디터와 Chat 패널을 별도 모듈로 분리 (약 2,100줄 감소)
2. **단기**: 파일 탐색기, 탭 관리자 분리 (약 1,800줄 추가 감소)
3. **중기**: CSS 외부 파일 분리, 상태 관리 개선

### 기대 효과
- `renderer.js`: 5,967줄 → 약 1,500줄 (75% 감소)
- 코드 탐색 및 유지보수성 대폭 향상
- 기능별 독립 개발 및 테스트 가능
