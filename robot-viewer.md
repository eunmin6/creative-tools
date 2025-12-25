# Robot Framework Syntax Highlighting in Monaco Editor

## 현재 상황

Monaco Editor는 Robot Framework를 기본 내장 언어로 지원하지 않습니다.
- [GitHub Issue #4541](https://github.com/microsoft/monaco-editor/issues/4541)에서 기능 요청이 있으나, 2024년 5월 이후 진행 없음
- 커뮤니티 기여나 공식 구현 계획 없음

## 가능한 구현 방안

### 방안 1: Monarch 토크나이저로 커스텀 언어 정의 (권장)

Monaco Editor의 [Monarch](https://microsoft.github.io/monaco-editor/monarch.html)는 선언적 방식으로 구문 강조를 정의할 수 있는 라이브러리입니다.

#### 장점
- 외부 의존성 없음
- 경량 (클라이언트 사이드에서 동작)
- 완전한 커스터마이징 가능

#### 단점
- 직접 구현 필요
- 복잡한 문법 처리에 한계

#### 구현 예시

```javascript
// Robot Framework 언어 등록
monaco.languages.register({ id: 'robotframework' });

// Monarch 토크나이저 정의
monaco.languages.setMonarchTokensProvider('robotframework', {
  defaultToken: '',
  ignoreCase: true,

  tokenizer: {
    root: [
      // 섹션 헤더 (*** Test Cases ***, *** Keywords *** 등)
      [/^\*{3}\s*(Settings|Variables|Test Cases|Tasks|Keywords|Comments)\s*\*{3}/, 'keyword.section'],

      // 주석
      [/#.*$/, 'comment'],

      // 변수들
      [/\$\{[^}]+\}/, 'variable.scalar'],      // ${variable}
      [/@\{[^}]+\}/, 'variable.list'],         // @{list}
      [/&\{[^}]+\}/, 'variable.dict'],         // &{dict}
      [/%\{[^}]+\}/, 'variable.env'],          // %{ENV_VAR}

      // 내장 키워드 (일부 예시)
      [/\b(Log|Should Be Equal|Should Contain|Wait Until|Run Keyword|Set Variable|Return From Keyword|RETURN)\b/, 'keyword.builtin'],

      // Settings 섹션 키워드
      [/\b(Library|Resource|Variables|Documentation|Metadata|Suite Setup|Suite Teardown|Test Setup|Test Teardown|Test Template|Test Timeout|Force Tags|Default Tags)\b/, 'keyword.setting'],

      // 제어 구조
      [/\b(IF|ELSE IF|ELSE|END|FOR|IN|IN RANGE|WHILE|TRY|EXCEPT|FINALLY|BREAK|CONTINUE)\b/, 'keyword.control'],

      // [Arguments], [Documentation], [Tags] 등
      [/\[(Arguments|Documentation|Tags|Setup|Teardown|Template|Timeout|Return)\]/, 'attribute'],

      // 숫자
      [/\b\d+(\.\d+)?\b/, 'number'],

      // 문자열 (큰따옴표, 작은따옴표)
      [/"[^"]*"/, 'string'],
      [/'[^']*'/, 'string'],

      // 테스트 케이스/키워드 이름 (줄 시작, 공백 없음)
      [/^[A-Za-z][A-Za-z0-9 _]*(?=\s{2,}|\s*$)/, 'entity.name.function'],
    ],
  },
});

// 언어 설정 (괄호 매칭, 주석 등)
monaco.languages.setLanguageConfiguration('robotframework', {
  comments: {
    lineComment: '#',
  },
  brackets: [
    ['{', '}'],
    ['[', ']'],
    ['(', ')'],
  ],
  autoClosingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '(', close: ')' },
    { open: '"', close: '"' },
    { open: "'", close: "'" },
  ],
});
```

#### 커스텀 테마 색상 정의

```javascript
monaco.editor.defineTheme('robotframework-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'keyword.section', foreground: 'C586C0', fontStyle: 'bold' },
    { token: 'keyword.builtin', foreground: 'DCDCAA' },
    { token: 'keyword.setting', foreground: '569CD6' },
    { token: 'keyword.control', foreground: 'C586C0' },
    { token: 'variable.scalar', foreground: '9CDCFE' },
    { token: 'variable.list', foreground: '4EC9B0' },
    { token: 'variable.dict', foreground: '4FC1FF' },
    { token: 'variable.env', foreground: 'CE9178' },
    { token: 'attribute', foreground: '9CDCFE' },
    { token: 'entity.name.function', foreground: 'DCDCAA' },
    { token: 'comment', foreground: '6A9955' },
    { token: 'string', foreground: 'CE9178' },
    { token: 'number', foreground: 'B5CEA8' },
  ],
  colors: {},
});
```

### 방안 2: Language Server Protocol (LSP) 연동

[RobotCode](https://github.com/robotcodedev/robotcode)는 Robot Framework를 위한 종합 툴킷으로, LSP를 지원합니다.

#### 장점
- 구문 강조뿐 아니라 자동완성, 정의로 이동, 호버 정보 등 풍부한 기능
- 정확한 문법 분석 (실제 파서 사용)

#### 단점
- 서버 프로세스 필요 (Python 환경)
- 복잡한 설정 필요
- Electron 앱에서 LSP 클라이언트 구현 필요

#### 참고
- [monaco-languageclient](https://github.com/TypeFox/monaco-languageclient) 라이브러리로 Monaco와 LSP 연동 가능

### 방안 3: TextMate Grammar 사용

VSCode의 Robot Framework 확장에서 사용하는 TextMate grammar를 가져와서 사용할 수 있습니다.

#### 참고 라이브러리
- [monaco-textmate](https://github.com/NeekSandhu/monaco-textmate)
- [vscode-oniguruma](https://github.com/ArcticLampyrid/vscode-oniguruma) (WASM)

#### 단점
- WASM 로딩 필요
- 설정이 복잡함

## 권장 구현 순서

1. **1단계 (즉시 적용 가능)**: Monarch 토크나이저로 기본 구문 강조 구현
   - 섹션 헤더, 변수, 키워드, 주석 등 주요 요소 강조
   - 약 100줄 내외 코드로 구현 가능

2. **2단계 (선택)**: 내장 키워드 목록 확장
   - BuiltIn, Collections, String 등 라이브러리 키워드 추가

3. **3단계 (고급)**: LSP 연동으로 자동완성, 정의로 이동 기능 추가

## 파일 연결 방법

`.robot` 파일을 Monaco에서 열 때 언어 설정:

```javascript
// 파일 확장자로 언어 감지
const model = monaco.editor.createModel(
  content,
  'robotframework',  // 등록한 언어 ID
  monaco.Uri.file(filePath)
);

// 또는 기존 모델의 언어 변경
monaco.editor.setModelLanguage(model, 'robotframework');
```

## 디버깅 팁

Monaco Editor에서 토큰 파싱 결과 확인:
1. 에디터에서 `Ctrl+Shift+P` (Command Palette)
2. "Developer: Inspect Tokens" 검색 및 실행
3. 커서 위치의 토큰 정보 확인

## 참고 자료

- [Monaco Editor Monarch Documentation](https://microsoft.github.io/monaco-editor/monarch.html)
- [Monaco Editor Custom Language Guide](https://www.checklyhq.com/blog/customizing-monaco/)
- [RobotCode - Robot Framework Toolkit](https://github.com/robotcodedev/robotcode)
- [Extend Monaco Language Configuration](https://dev.to/pranomvignesh/extend-language-configuration-in-monaco-editor-5fjo)

---

## 프로젝트 적용 가이드 (Monarch 토크나이저 방식)

### 현재 프로젝트 구조

```
public/
├── js/
│   └── modules/
│       ├── tab-manager.js      # Monaco Editor 초기화, 언어 설정
│       ├── theme-manager.js    # 테마 관리
│       ├── robot-generator.js  # Robot 스크립트 생성
│       └── ...
├── index.html                  # 메인 HTML, 스크립트 로드
└── vs/                         # Monaco Editor 라이브러리
```

### 관련 기존 코드

#### 1. `tab-manager.js` - 언어 매핑 (line 453-466)

```javascript
function getLanguageFromFileName(fileName) {
  const ext = fileName.split('.').pop().toLowerCase();
  const languageMap = {
    'js': 'javascript', 'ts': 'typescript', 'json': 'json',
    'html': 'html', 'htm': 'html', 'css': 'css',
    'scss': 'scss', 'less': 'less', 'md': 'markdown',
    'py': 'python', 'java': 'java', 'c': 'c', 'cpp': 'cpp',
    // ... 기타 언어
  };
  return languageMap[ext] || 'plaintext';
}
```

현재 `.robot` 확장자는 `plaintext`로 처리됨.

### 구현 방안: 별도 파일 분리

#### 새로 생성할 파일

**`public/js/modules/robot-language.js`** - Robot Framework 언어 정의 전담

```javascript
/**
 * Robot Framework Language Support for Monaco Editor
 *
 * 이 모듈은 Monaco Editor에서 Robot Framework 구문 강조를 제공합니다.
 */
(function() {
  'use strict';

  // Monaco가 로드될 때까지 대기 후 언어 등록
  function registerRobotFrameworkLanguage() {
    if (typeof monaco === 'undefined') {
      console.warn('Monaco not loaded yet, retrying...');
      setTimeout(registerRobotFrameworkLanguage, 100);
      return;
    }

    // 1. 언어 등록
    monaco.languages.register({
      id: 'robotframework',
      extensions: ['.robot', '.resource'],
      aliases: ['Robot Framework', 'robot', 'robotframework'],
    });

    // 2. Monarch 토크나이저 정의
    monaco.languages.setMonarchTokensProvider('robotframework', {
      defaultToken: '',
      ignoreCase: true,

      tokenizer: {
        root: [
          // 섹션 헤더
          [/^\*{3}\s*(Settings|Variables|Test Cases|Tasks|Keywords|Comments)\s*\*{3}.*$/, 'keyword.section'],

          // 주석
          [/^#.*$/, 'comment'],
          [/\s+#.*$/, 'comment'],

          // 변수들
          [/\$\{[^}]+\}/, 'variable'],
          [/@\{[^}]+\}/, 'variable.list'],
          [/&\{[^}]+\}/, 'variable.dict'],
          [/%\{[^}]+\}/, 'variable.env'],

          // Settings 섹션 키워드
          [/^(Library|Resource|Variables|Documentation|Metadata|Suite Setup|Suite Teardown|Test Setup|Test Teardown|Test Template|Test Timeout|Force Tags|Default Tags)\b/, 'keyword.setting'],

          // 제어 구조
          [/\b(IF|ELSE IF|ELSE|END|FOR|IN|IN RANGE|WHILE|TRY|EXCEPT|FINALLY|BREAK|CONTINUE|RETURN)\b/, 'keyword.control'],

          // [Arguments], [Documentation] 등
          [/\[(Arguments|Documentation|Tags|Setup|Teardown|Template|Timeout|Return)\]/, 'attribute'],

          // 문자열
          [/"[^"]*"/, 'string'],
          [/'[^']*'/, 'string'],

          // 숫자
          [/\b\d+(\.\d+)?\b/, 'number'],

          // 테스트 케이스/키워드 이름 (줄 시작)
          [/^[A-Za-z가-힣][A-Za-z0-9가-힣 _-]*(?=\s{2,}|$)/, 'entity.name.function'],
        ],
      },
    });

    // 3. 언어 설정
    monaco.languages.setLanguageConfiguration('robotframework', {
      comments: {
        lineComment: '#',
      },
      brackets: [
        ['{', '}'],
        ['[', ']'],
        ['(', ')'],
      ],
      autoClosingPairs: [
        { open: '{', close: '}' },
        { open: '[', close: ']' },
        { open: '(', close: ')' },
        { open: '"', close: '"' },
        { open: "'", close: "'" },
        { open: '${', close: '}' },
      ],
      surroundingPairs: [
        { open: '{', close: '}' },
        { open: '[', close: ']' },
        { open: '(', close: ')' },
        { open: '"', close: '"' },
        { open: "'", close: "'" },
      ],
    });

    // 4. Robot Framework 전용 테마 규칙 추가 (기존 테마 확장)
    defineRobotThemeRules();

    console.log('Robot Framework language registered for Monaco Editor');
  }

  // 테마에 Robot Framework 토큰 색상 추가
  function defineRobotThemeRules() {
    // Dark 테마용 규칙
    const darkRules = [
      { token: 'keyword.section', foreground: 'C586C0', fontStyle: 'bold' },
      { token: 'keyword.setting', foreground: '569CD6' },
      { token: 'keyword.control', foreground: 'C586C0' },
      { token: 'variable', foreground: '9CDCFE' },
      { token: 'variable.list', foreground: '4EC9B0' },
      { token: 'variable.dict', foreground: '4FC1FF' },
      { token: 'variable.env', foreground: 'CE9178' },
      { token: 'attribute', foreground: '9CDCFE' },
      { token: 'entity.name.function', foreground: 'DCDCAA' },
    ];

    // Light 테마용 규칙
    const lightRules = [
      { token: 'keyword.section', foreground: 'AF00DB', fontStyle: 'bold' },
      { token: 'keyword.setting', foreground: '0000FF' },
      { token: 'keyword.control', foreground: 'AF00DB' },
      { token: 'variable', foreground: '001080' },
      { token: 'variable.list', foreground: '267F99' },
      { token: 'variable.dict', foreground: '0070C1' },
      { token: 'variable.env', foreground: 'A31515' },
      { token: 'attribute', foreground: '001080' },
      { token: 'entity.name.function', foreground: '795E26' },
    ];

    // 커스텀 테마 정의 (선택적)
    try {
      monaco.editor.defineTheme('robot-dark', {
        base: 'vs-dark',
        inherit: true,
        rules: darkRules,
        colors: {},
      });

      monaco.editor.defineTheme('robot-light', {
        base: 'vs',
        inherit: true,
        rules: lightRules,
        colors: {},
      });
    } catch (e) {
      // 테마 정의 실패 시 무시 (기존 테마 사용)
    }
  }

  // 초기화
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', registerRobotFrameworkLanguage);
  } else {
    // Monaco 로드 후 실행되도록 약간 지연
    setTimeout(registerRobotFrameworkLanguage, 0);
  }

  // 전역 노출 (필요시 수동 호출용)
  window.registerRobotFrameworkLanguage = registerRobotFrameworkLanguage;

})();
```

### 기존 코드 수정 사항

#### 1. `index.html` - 스크립트 로드 추가 (1줄)

```html
<!-- 기존 모듈 로드 부분에 추가 -->
<script src="js/modules/robot-language.js"></script>
```

위치: 다른 모듈 스크립트들과 함께, Monaco Editor 로드(`vs/editor/editor.main.js`) 이후에 배치

#### 2. `tab-manager.js` - 언어 매핑 추가 (1줄)

```javascript
// getLanguageFromFileName 함수의 languageMap에 추가
const languageMap = {
  'js': 'javascript', 'ts': 'typescript', 'json': 'json',
  // ... 기존 매핑 ...
  'robot': 'robotframework',  // ← 이 한 줄만 추가
};
```

### 변경 요약

| 파일 | 변경 내용 | 변경량 |
|------|----------|--------|
| `public/js/modules/robot-language.js` | **새 파일 생성** | ~130줄 |
| `public/index.html` | 스크립트 로드 추가 | 1줄 |
| `public/js/modules/tab-manager.js` | languageMap에 robot 추가 | 1줄 |

### 파일 구조 (변경 후)

```
public/
├── js/
│   └── modules/
│       ├── tab-manager.js      # 'robot': 'robotframework' 추가
│       ├── robot-language.js   # ← 새 파일 (언어 정의)
│       └── ...
├── index.html                  # <script> 태그 추가
└── vs/
```

### 장점

1. **분리된 관심사**: Robot Framework 언어 정의가 별도 파일에 격리됨
2. **최소 침습**: 기존 코드에 2줄만 추가
3. **유지보수 용이**: 언어 정의 변경 시 `robot-language.js`만 수정
4. **확장 가능**: 나중에 자동완성, 호버 정보 등 기능 추가 가능
5. **제거 용이**: 필요 없으면 스크립트 로드와 매핑 1줄씩만 제거

### 테스트 방법

1. 앱 실행
2. `.robot` 파일 열기
3. 섹션 헤더, 변수, 키워드 등에 색상이 적용되는지 확인
4. (선택) `Ctrl+Shift+P` → "Inspect Tokens"로 토큰 파싱 확인
