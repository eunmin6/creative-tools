# Creative Tools

VSCode 스타일의 데스크톱 애플리케이션으로, 파일 탐색기, 코드 에디터, 비주얼 캔버스 에디터, AI 채팅을 제공합니다.

## 기능

### 1. 파일 탐색기 (Explorer)
- VSCode 스타일의 UI
- 실시간 파일 시스템 탐색
- 멀티 탭 지원 (여러 파일 동시 열기)
- 파일 변경 감지 (외부에서 파일 수정 시 자동 리로드)
- 파일/폴더 생성, 이름 변경, 삭제

### 2. 코드 에디터 (Monaco Editor)
- VSCode와 동일한 Monaco Editor 사용
- 구문 강조 (JavaScript, TypeScript, Python, JSON, Markdown 등)
- 자동 완성
- 다크 테마

### 3. 캔버스 에디터 (.canvas 파일)
- **파워포인트 스타일 도형 그리기**: 드래그 앤 드롭으로 도형 생성
- **도형 타입**: 사각형, 원형, 화살표, 텍스트
- **도형 조작**:
  - 드래그로 이동
  - 8개 핸들로 크기 조절 (모서리 4개 + 상하좌우 4개)
  - Delete 키로 삭제
  - 멀티 선택 (Ctrl+클릭, Shift+클릭)
- **격자 배경**: 정렬을 돕는 그리드 패턴

### 4. AI Chat 패널
- **Ollama LLM 연동**: 로컬 LLM과 대화
- **파일 첨부**: 열린 탭의 파일을 체크하여 LLM에 전달
- **대화 히스토리**: 최대 30개 이전 질문 저장
- **마크다운 렌더링**: 코드 블록, 테이블, 헤더 등 지원
- **Up/Down 키**: 이전 질문 탐색

### 5. 기타 기능
- **커스텀 타이틀바**: Windows 기본 타이틀바 제거, 다크 테마
- **OUTPUT 패널**: 로그 및 출력 표시
- **터미널**: 내장 터미널 지원

## 기술 스택

- **Electron**: 크로스 플랫폼 데스크톱 앱 프레임워크
- **TypeScript**: 타입 안정성을 갖춘 JavaScript
- **Node.js**: 백엔드 런타임
- **Monaco Editor**: VSCode 코드 에디터
- **Chokidar**: 파일 시스템 감시

## 설치 방법

### 1. 사전 요구사항

#### Node.js (필수)
```bash
node --version   # v18.0.0 이상 권장
npm --version
```
Node.js가 없다면 [nodejs.org](https://nodejs.org/)에서 다운로드하세요.

#### Ollama (Chat 기능 사용 시)
AI Chat 기능을 사용하려면 Ollama를 설치해야 합니다:
1. [ollama.ai](https://ollama.ai/)에서 다운로드 및 설치
2. 모델 다운로드:
   ```bash
   ollama pull llama2       # 또는 원하는 모델
   ollama pull codellama    # 코드 관련 질문용
   ```
3. Ollama 서버 실행 (기본 포트: 11434)

### 2. 프로젝트 클론

```bash
git clone https://github.com/eunmin6/creative-tools.git
cd creative-tools
```

### 3. 의존성 설치

```bash
npm install
```

#### 주요 패키지
| 패키지 | 버전 | 설명 |
|--------|------|------|
| `electron` | ^28.0.0 | 데스크톱 앱 프레임워크 |
| `typescript` | ^5.3.0 | TypeScript 컴파일러 |
| `monaco-editor` | ^0.55.1 | VSCode 코드 에디터 |
| `chokidar` | ^3.6.0 | 파일 변경 감시 |
| `@vscode/codicons` | ^0.0.44 | VSCode 아이콘 |
| `@types/node` | ^20.10.0 | Node.js 타입 정의 |

## 실행 방법

### 개발 모드

```bash
npm start
```

이 명령어는 TypeScript를 컴파일하고 Electron 앱을 실행합니다.

### TypeScript 컴파일만

```bash
npm run build
```

### 감시 모드 (자동 재컴파일)

```bash
npm run watch
```

## 프로젝트 구조

```
creative-tools/
├── src/
│   ├── main.ts          # 메인 프로세스 (앱 진입점, IPC 핸들러)
│   └── preload.ts       # Preload 스크립트 (보안 API 브릿지)
├── public/
│   ├── index.html       # UI 템플릿 및 스타일
│   ├── renderer.js      # 렌더러 프로세스 (UI 로직)
│   └── codicon.css      # VSCode 아이콘 스타일
├── dist/                # 컴파일된 TypeScript 파일
├── node_modules/
│   └── monaco-editor/   # Monaco Editor 라이브러리
├── package.json         # 프로젝트 설정 및 의존성
├── tsconfig.json        # TypeScript 설정
└── README.md
```

## 사용 방법

### 캔버스 에디터 사용하기

1. 앱 실행 후 왼쪽 Explorer에서 `.canvas` 파일을 엽니다
2. 오른쪽 툴바에서 도형 아이콘을 클릭합니다
3. 캔버스에서 드래그하여 도형을 그립니다
4. 도형을 클릭하여 선택하고 조작합니다
5. `Ctrl+S`로 저장합니다

### AI Chat 사용하기

1. 상단 메뉴 `Project > Open Chat` 클릭
2. 파일을 첨부하려면 입력창 위의 파일 체크박스 선택
3. 질문 입력 후 Enter 또는 전송 버튼 클릭
4. Up/Down 키로 이전 질문 탐색 가능

### 키보드 단축키

| 단축키 | 기능 |
|--------|------|
| `Ctrl+S` | 저장 |
| `Delete` | 선택된 도형 삭제 |
| `ESC` | 그리기 모드 종료 |
| `Up/Down` | Chat 이전 질문 탐색 |
| `Enter` | Chat 메시지 전송 |
| `Shift+Enter` | Chat 줄바꿈 |

## 주요 기능 세부사항

### 파일 변경 감지
- Chokidar 라이브러리를 사용한 실시간 파일 감시
- 열린 탭의 파일이 외부에서 수정되면 자동 리로드
- 변경사항이 있는 파일은 확인 후 리로드

### AI Chat 프롬프트 구조
LLM에게 전달되는 프롬프트 순서:
1. `[System Instructions]` - `.vvu.prompt.base.md` 파일
2. `[Attached Files]` - 체크된 파일들의 내용
3. `[Previous Questions History]` - 이전 30개 질문
4. `[Last Conversation]` - 마지막 Q&A
5. `[Current Question]` - 현재 질문

### 보안 설정
- `contextIsolation: true`: 렌더러와 preload 스크립트 격리
- `nodeIntegration: false`: 렌더러에서 Node.js API 직접 접근 차단
- Context Bridge API를 통한 안전한 IPC 통신

## 문제 해결

### 앱이 실행되지 않을 때
```bash
rm -rf node_modules dist
npm install
npm start
```

### Chat 기능이 작동하지 않을 때
1. Ollama가 실행 중인지 확인: `curl http://localhost:11434/api/tags`
2. 모델이 설치되어 있는지 확인: `ollama list`

### TypeScript 컴파일 오류
- `tsconfig.json` 설정 확인
- `@types/node` 패키지 설치 확인

## 배포

### Windows 실행 파일 빌드

```bash
npm run dist:win
```

### Mac/Linux 빌드

```bash
npm run dist:mac    # macOS
npm run dist:linux  # Linux
```

빌드된 파일은 `release/` 폴더에 생성됩니다.

## 라이선스

ISC

## 기여

이슈와 풀 리퀘스트를 환영합니다!

## 참고 자료

- [Electron 공식 문서](https://www.electronjs.org/docs/latest/)
- [TypeScript 공식 문서](https://www.typescriptlang.org/docs/)
- [Monaco Editor](https://microsoft.github.io/monaco-editor/)
- [Ollama](https://ollama.ai/)
- [Chokidar](https://github.com/paulmillr/chokidar)
