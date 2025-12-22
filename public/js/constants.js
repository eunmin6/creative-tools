/**
 * 상수 및 설정 정의
 */

const Constants = {
  // 시스템 폴더 (숨김 처리용)
  SYSTEM_FOLDERS: ['node_modules', 'dist', '.git', '.claude'],

  // 파일 아이콘 매핑
  FILE_ICONS: {
    // 프로그래밍 언어
    js: 'icons/javascript.svg',
    ts: 'icons/typescript.svg',
    py: 'icons/python.svg',
    java: 'icons/java.svg',
    cpp: 'icons/cpp.svg',
    c: 'icons/c.svg',
    cs: 'icons/csharp.svg',
    go: 'icons/go.svg',
    rs: 'icons/rust.svg',
    rb: 'icons/ruby.svg',
    php: 'icons/php.svg',
    swift: 'icons/swift.svg',
    kt: 'icons/kotlin.svg',

    // 웹
    html: 'icons/html.svg',
    css: 'icons/css.svg',
    scss: 'icons/sass.svg',
    less: 'icons/less.svg',
    vue: 'icons/vue.svg',
    jsx: 'icons/react.svg',
    tsx: 'icons/react_ts.svg',

    // 데이터/설정
    json: 'icons/json.svg',
    xml: 'icons/xml.svg',
    yaml: 'icons/yaml.svg',
    yml: 'icons/yaml.svg',
    toml: 'icons/toml.svg',
    ini: 'icons/settings.svg',
    env: 'icons/tune.svg',

    // 문서
    md: 'icons/markdown.svg',
    txt: 'icons/document.svg',
    pdf: 'icons/pdf.svg',
    doc: 'icons/word.svg',
    docx: 'icons/word.svg',

    // 이미지
    png: 'icons/image.svg',
    jpg: 'icons/image.svg',
    jpeg: 'icons/image.svg',
    gif: 'icons/image.svg',
    svg: 'icons/svg.svg',
    ico: 'icons/image.svg',

    // 기타
    canvas: 'icons/canvas.svg',
    sh: 'icons/console.svg',
    bat: 'icons/console.svg',
    ps1: 'icons/powershell.svg',
    sql: 'icons/database.svg',
    graphql: 'icons/graphql.svg',

    // 엑셀
    xlsx: 'icons/table.svg',
    xls: 'icons/table.svg',
    csv: 'icons/table.svg'
  },

  // Monaco Editor 언어 매핑
  LANGUAGE_MAP: {
    js: 'javascript',
    mjs: 'javascript',
    jsx: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    py: 'python',
    java: 'java',
    cpp: 'cpp',
    c: 'c',
    cs: 'csharp',
    go: 'go',
    rs: 'rust',
    rb: 'ruby',
    php: 'php',
    swift: 'swift',
    kt: 'kotlin',
    html: 'html',
    htm: 'html',
    css: 'css',
    scss: 'scss',
    less: 'less',
    json: 'json',
    xml: 'xml',
    yaml: 'yaml',
    yml: 'yaml',
    md: 'markdown',
    sql: 'sql',
    sh: 'shell',
    bat: 'bat',
    ps1: 'powershell',
    dockerfile: 'dockerfile',
    graphql: 'graphql'
  },

  // UI 설정
  UI: {
    SIDEBAR_MIN_WIDTH: 150,
    SIDEBAR_MAX_WIDTH: 600,
    CHAT_PANEL_MIN_WIDTH: 280,
    CHAT_PANEL_MAX_WIDTH: 1600,
    CHAT_PANEL_DEFAULT_WIDTH: 350,
    BOTTOM_PANEL_MIN_HEIGHT: 100,
    BOTTOM_PANEL_MAX_HEIGHT: 500
  },

  // Chat 설정
  CHAT: {
    MAX_HISTORY: 30,
    OLLAMA_URL: 'http://localhost:11434/api/generate'
  },

  // 캔버스 설정
  CANVAS: {
    GRID_SIZE: 20,
    MIN_SHAPE_SIZE: 10,
    HANDLE_SIZE: 8,
    DEFAULT_COLORS: {
      rectangle: '#616161',
      ellipse: '#1976d2',
      arrow: '#333333',
      text: '#333333'
    }
  }
};

// 전역 상태 관리
const AppState = {
  // 탭 관리
  tabs: {
    list: [],        // { filePath, fileName, type, content, originalContent, chatAttached }
    activeIndex: -1
  },

  // Monaco Editor
  editor: {
    instance: null,
    ready: false
  },

  // 파일 탐색기
  explorer: {
    currentPath: null,
    selectedItem: null,
    selectedName: null,
    isFolder: false,
    multiSelected: new Set(),
    lastClickedPath: null,
    hideSystemFolders: false,
    folderOpened: false
  },

  // 사이드바
  sidebar: {
    visible: false,
    activeView: null,
    width: 250
  },

  // 캔버스 에디터
  canvas: {
    data: { shapes: [] },
    selectedShape: null,
    selectedShapes: [],
    mode: 'select',        // 'select', 'rectangle', 'ellipse', 'arrow', 'text'
    isDrawing: false,
    isDragging: false,
    isResizing: false,
    isPanning: false,
    panOffset: { x: 0, y: 0 },
    zoom: 1
  },

  // Chat
  chat: {
    messages: [],
    userHistory: [],
    historyIndex: -1,
    tempInput: '',
    systemPrompt: '',
    promptHistory: '',
    promptLast: '',
    isLoading: false,
    isResizing: false
  },

  // 터미널
  terminal: {
    id: null,
    ready: false
  },

  // Python 프로세스
  python: {
    processId: null,
    running: false
  },

  // 컨텍스트 메뉴
  contextMenu: {
    targetPath: null,
    targetName: null,
    isFolder: false
  },

  // 모달
  modal: {
    pendingDeleteItems: null,
    pendingDeleteCallback: null
  },

  // 메뉴
  menu: {
    open: false,
    activeId: null
  }
};

// 전역으로 노출
window.Constants = Constants;
window.AppState = AppState;
