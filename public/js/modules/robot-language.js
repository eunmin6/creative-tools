/**
 * Robot Framework Language Support for Monaco Editor
 *
 * Monaco Editor에서 Robot Framework 구문 강조를 제공합니다.
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
          [/\s{2,}#.*$/, 'comment'],

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

    // 4. Robot Framework 전용 테마 규칙 추가
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

    // 커스텀 테마 정의
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
