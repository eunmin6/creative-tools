# Creative Tools

VSCode 스타일의 데스크톱 애플리케이션으로, 파일 탐색기와 비주얼 캔버스 에디터를 제공합니다.

## 기능

### 1. 파일 탐색기
- VSCode 스타일의 UI
- 실시간 파일 시스템 탐색
- 멀티 탭 지원 (여러 파일 동시 열기)
- 탭 닫기 기능

### 2. 캔버스 에디터 (.canvas 파일)
- **파워포인트 스타일 도형 그리기**: 드래그 앤 드롭으로 도형 생성
- **도형 타입**: 사각형, 원형
- **도형 조작**:
  - 드래그로 이동
  - 8개 핸들로 크기 조절 (모서리 4개 + 상하좌우 4개)
  - Delete 키로 삭제
- **격자 배경**: 정렬을 돕는 그리드 패턴
- **키보드 단축키**:
  - `Ctrl+S`: 저장
  - `Delete`: 선택된 도형 삭제
  - `ESC`: 그리기 모드 종료

### 3. 커스텀 타이틀바
- Windows 기본 타이틀바 제거
- VSCode 스타일 다크 테마
- 창 조절 버튼 (최소화, 최대화, 닫기)

## 기술 스택

- **Electron**: 크로스 플랫폼 데스크톱 앱 프레임워크
- **TypeScript**: 타입 안정성을 갖춘 JavaScript
- **Node.js**: 백엔드 런타임

## 설치 방법

### 1. 사전 요구사항

Node.js 설치가 필요합니다. 다음 명령어로 확인:

```bash
node --version
npm --version
```

Node.js가 없다면 [nodejs.org](https://nodejs.org/)에서 다운로드하세요.

### 2. 프로젝트 클론

```bash
git clone https://github.com/eunmin6/creative-tools.git
cd creative-tools
```

### 3. 의존성 설치

```bash
npm install
```

필요한 패키지:
- `electron`: ^28.0.0
- `typescript`: ^5.3.3
- `@types/node`: ^20.10.6

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
│   ├── index.html       # UI 템플릿
│   └── renderer.js      # 렌더러 프로세스 (UI 로직, 캔버스 에디터)
├── dist/                # 컴파일된 TypeScript 파일
├── test.canvas          # 샘플 캔버스 파일
├── package.json         # 프로젝트 설정 및 의존성
├── tsconfig.json        # TypeScript 설정
└── README.md
```

## 사용 방법

### 캔버스 에디터 사용하기

1. 앱 실행 후 왼쪽 Explorer에서 `.canvas` 파일을 엽니다
2. 오른쪽 툴바에서 도형 아이콘을 클릭합니다 (사각형 □ 또는 원 ○)
3. 마우스 커서가 십자(+)로 변경됩니다
4. 캔버스에서 드래그하여 도형을 그립니다
5. 도형을 클릭하여 선택하고 드래그로 이동하거나, 핸들로 크기를 조절합니다
6. `Ctrl+S`로 저장합니다

### 파일 탐색기

- 왼쪽 Explorer에서 파일을 클릭하여 엽니다
- 여러 파일을 열면 상단에 탭이 생성됩니다
- 탭의 ✕ 버튼으로 닫을 수 있습니다

## 주요 기능 세부사항

### 보안 설정
- `contextIsolation: true`: 렌더러와 preload 스크립트 격리
- `nodeIntegration: false`: 렌더러에서 Node.js API 직접 접근 차단
- Context Bridge API를 통한 안전한 IPC 통신

### IPC 통신
메인 프로세스와 렌더러 프로세스 간 안전한 통신:
- 파일 시스템 작업 (읽기, 쓰기)
- 창 제어 (최소화, 최대화, 닫기)
- 개발자 도구 토글

## 개발

### 새 기능 추가

1. **메인 프로세스** (`src/main.ts`): IPC 핸들러 추가
2. **Preload** (`src/preload.ts`): API를 `electronAPI`에 노출
3. **렌더러** (`public/renderer.js`): UI 로직 구현

### 캔버스 파일 형식

`.canvas` 파일은 JSON 형식으로 저장됩니다:

```json
{
  "shapes": [
    {
      "type": "rectangle",
      "x": 100,
      "y": 100,
      "width": 200,
      "height": 150,
      "color": "#616161"
    }
  ]
}
```

## 문제 해결

### 앱이 실행되지 않을 때
1. `node_modules`와 `dist` 폴더 삭제 후 재설치:
   ```bash
   rm -rf node_modules dist
   npm install
   npm start
   ```

### TypeScript 컴파일 오류
- `tsconfig.json` 설정 확인
- `@types/node` 패키지 설치 확인

## 배포

### Windows 실행 파일 빌드

```bash
npm install --save-dev electron-builder
```

`package.json`에 빌드 설정 추가:

```json
"scripts": {
  "dist": "npm run build && electron-builder"
},
"build": {
  "appId": "com.creative-tools.app",
  "productName": "Creative Tools",
  "win": {
    "target": "nsis",
    "icon": "build/icon.ico"
  }
}
```

빌드 실행:

```bash
npm run dist
```

## 라이선스

ISC

## 기여

이슈와 풀 리퀘스트를 환영합니다!

## 참고 자료

- [Electron 공식 문서](https://www.electronjs.org/docs/latest/)
- [TypeScript 공식 문서](https://www.typescriptlang.org/docs/)
- [Electron Security Best Practices](https://www.electronjs.org/docs/latest/tutorial/security)
