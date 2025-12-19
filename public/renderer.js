// 탭 관리를 위한 전역 변수
let openTabs = []; // { filePath, fileName, type, content, originalContent }
let activeTabIndex = -1;

// Explorer 설정
let hideSystemFolders = false; // true면 node_modules, dist, .git, .claude 숨김
const SYSTEM_FOLDERS = ['node_modules', 'dist', '.git', '.claude'];

// Monaco Editor 인스턴스
let monacoEditor = null;
let monacoReady = false;

// DOM 로드 완료 시 초기화
window.addEventListener('DOMContentLoaded', () => {
  initializeApp();
});

function initializeApp() {
  // 초기에는 폴더를 로드하지 않음 - Open Folder로만 폴더 로드
  setupTreeInteraction();
  setupActivityBar();
  setupSidebarResizer();
  setupGlobalKeyboardEvents();
  initMonaco();
}

// Monaco Editor 초기화
function initMonaco() {
  require(['vs/editor/editor.main'], function() {
    monacoReady = true;
    // hello


    // Monaco 테마 설정 (VSCode Dark 스타일)
    monaco.editor.defineTheme('custom-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': '#1e1e1e',
        'editor.lineHighlightBackground': '#2a2a2a',
      }
    });
    monaco.editor.setTheme('custom-dark');
  });
}

// 전역 키보드 이벤트 설정
function setupGlobalKeyboardEvents() {
  document.addEventListener('keydown', handleCanvasKeyDown);
}

// 현재 프로젝트 경로
let currentProjectPath = null;

// 프로젝트 파일 로드
async function loadProjectFiles(customPath = null) {
  if (!window.electronAPI || !window.electronAPI.fs) {
    console.error('File system API not available');
    return;
  }

  const projectRoot = customPath || await window.electronAPI.getProjectRoot();
  currentProjectPath = projectRoot;

  // 폴더 이름 추출
  const folderName = window.electronAPI.fs.path.basename(projectRoot).toUpperCase();

  const explorerContent = document.getElementById('explorer');

  // Explorer 내용을 실제 파일 구조로 대체
  explorerContent.innerHTML = '';

  // 프로젝트 루트 폴더 생성 (폴더 이름 사용)
  const rootFolder = createFolderElement(folderName, projectRoot, true);
  explorerContent.appendChild(rootFolder);

  // 하위 항목 컨테이너 (폴더 이름 기반 ID)
  const rootChildren = document.createElement('div');
  rootChildren.className = 'tree-item-children expanded';
  rootChildren.id = `${folderName.replace(/\s+/g, '-').toLowerCase()}-children`;

  // 프로젝트 디렉토리 읽기
  const items = await window.electronAPI.fs.readdir(projectRoot);

  // 시스템 폴더 필터링 (hideSystemFolders가 true일 때만)
  const filteredItems = hideSystemFolders
    ? items.filter(item => !SYSTEM_FOLDERS.includes(item.name))
    : items;

  // 디렉토리 먼저, 파일 나중에 정렬
  filteredItems.sort((a, b) => {
    if (a.isDirectory && !b.isDirectory) return -1;
    if (!a.isDirectory && b.isDirectory) return 1;
    return a.name.localeCompare(b.name);
  });

  for (const item of filteredItems) {
    if (item.isDirectory) {
      const folder = createFolderElement(item.name, item.path, false, 1);
      rootChildren.appendChild(folder);

      // 하위 폴더 내용 로드
      const subChildren = await loadFolderContents(item.path, item.name, 2);
      rootChildren.appendChild(subChildren);
    } else {
      const file = createFileElement(item.name, item.path, 1);
      rootChildren.appendChild(file);
    }
  }

  explorerContent.appendChild(rootChildren);
}

// 폴더 요소 생성
function createFolderElement(name, fullPath, isRoot = false, depth = 0) {
  const folder = document.createElement('div');
  folder.className = isRoot ? 'tree-item folder root' : 'tree-item folder';
  folder.dataset.type = 'folder';
  folder.dataset.name = name.replace(/\s+/g, '-').toLowerCase();
  folder.dataset.path = fullPath;

  // depth에 따른 들여쓰기
  folder.style.paddingLeft = `${8 + (depth * 16)}px`;

  // 모든 폴더에 chevron 추가 (루트 포함)
  const chevron = document.createElement('span');
  chevron.className = isRoot ? 'chevron expanded' : 'chevron';
  chevron.textContent = '❯';
  folder.appendChild(chevron);

  const label = document.createElement('span');
  label.className = 'tree-item-label';
  label.textContent = name;
  folder.appendChild(label);

  return folder;
}

// 파일 요소 생성
function createFileElement(name, fullPath, depth = 0) {
  const file = document.createElement('div');
  file.className = 'tree-item file';
  file.dataset.type = 'file';
  file.dataset.file = fullPath;

  // depth에 따른 들여쓰기 (파일은 폴더보다 조금 더 들여쓰기)
  file.style.paddingLeft = `${8 + (depth * 16)}px`;
  file.style.display = 'flex';
  file.style.alignItems = 'center';

  const icon = document.createElement('img');
  icon.className = 'tree-item-icon';
  icon.src = getFileIcon(name);
  icon.style.width = '20px';
  icon.style.height = '20px';
  icon.style.marginRight = '6px';
  icon.style.verticalAlign = 'middle';
  file.appendChild(icon);

  const label = document.createElement('span');
  label.className = 'tree-item-label';
  label.textContent = name;
  file.appendChild(label);

  return file;
}

// 파일 아이콘 가져오기
function getFileIcon(filename) {
  // 특수 탭 아이콘
  if (filename === 'Testcase Sync' || filename === 'Welcome') {
    return 'vvu-icon2.png';
  }

  const ext = filename.split('.').pop().toLowerCase();
  const iconMap = {
    'js': 'javascript',
    'mjs': 'javascript',
    'ts': 'typescript',
    'tsx': 'react',
    'jsx': 'react',
    'json': 'json',
    'html': 'html',
    'htm': 'html',
    'css': 'css',
    'scss': 'sass',
    'sass': 'sass',
    'less': 'less',
    'md': 'markdown',
    'markdown': 'markdown',
    'py': 'python',
    'java': 'java',
    'c': 'c',
    'cpp': 'cpp',
    'h': 'c',
    'hpp': 'cpp',
    'cs': 'c-sharp',
    'go': 'go',
    'rb': 'ruby',
    'php': 'php',
    'sql': 'db',
    'xml': 'xml',
    'yaml': 'yml',
    'yml': 'yml',
    'sh': 'shell',
    'bash': 'shell',
    'ps1': 'powershell',
    'vue': 'vue',
    'jade': 'jade',
    'pug': 'pug',
    'svg': 'svg',
    'png': 'image',
    'jpg': 'image',
    'jpeg': 'image',
    'gif': 'image',
    'ico': 'image',
    'pdf': 'pdf',
    'zip': 'zip',
    'rar': 'zip',
    '7z': 'zip',
    'mp3': 'audio',
    'wav': 'audio',
    'mp4': 'video',
    'avi': 'video',
    'rs': 'rust',
    'dart': 'dart',
    'swift': 'swift',
    'kt': 'kotlin',
    'scala': 'scala',
    'lua': 'lua',
    'r': 'R',
    'ex': 'elixir',
    'exs': 'elixir_script',
    'erl': 'erlang',
    'clj': 'clojure',
    'coffee': 'coffee',
    'elm': 'elm',
    'fs': 'f-sharp',
    'hs': 'haskell',
    'nim': 'nim',
    'pl': 'perl',
    'dockerfile': 'docker',
    'gitignore': 'git_ignore',
    'env': 'config',
    'lock': 'lock',
    'gradle': 'gradle',
    'svelte': 'svelte',
  };
  const iconName = iconMap[ext] || 'default';
  return `icons/${iconName}.svg`;
}

// 폴더 내용 로드
async function loadFolderContents(folderPath, folderName, depth = 1) {
  const container = document.createElement('div');
  container.className = 'tree-item-children';
  container.id = `${folderName.replace(/\s+/g, '-').toLowerCase()}-children`;

  if (!window.electronAPI || !window.electronAPI.fs) {
    return container;
  }

  const items = await window.electronAPI.fs.readdir(folderPath);

  // 정렬
  items.sort((a, b) => {
    if (a.isDirectory && !b.isDirectory) return -1;
    if (!a.isDirectory && b.isDirectory) return 1;
    return a.name.localeCompare(b.name);
  });

  for (const item of items) {
    if (item.isDirectory) {
      const folder = createFolderElement(item.name, item.path, false, depth);
      container.appendChild(folder);

      const subChildren = await loadFolderContents(item.path, item.name, depth + 1);
      container.appendChild(subChildren);
    } else {
      const file = createFileElement(item.name, item.path, depth);
      container.appendChild(file);
    }
  }

  return container;
}

// 트리 상호작용 설정
function setupTreeInteraction() {
  const explorer = document.getElementById('explorer');

  explorer.addEventListener('click', (event) => {
    const treeItem = event.target.closest('.tree-item');
    if (!treeItem) return;

    const isFolder = treeItem.dataset.type === 'folder';

    if (isFolder) {
      toggleFolder(treeItem);
    } else {
      selectFile(treeItem);
    }
  });
}

// 폴더 토글 (확장/축소)
function toggleFolder(folderElement) {
  const folderName = folderElement.dataset.name;
  const childrenContainer = document.getElementById(`${folderName}-children`);
  const chevron = folderElement.querySelector('.chevron');

  if (!childrenContainer) return;

  const isExpanded = childrenContainer.classList.contains('expanded');

  if (isExpanded) {
    childrenContainer.classList.remove('expanded');
    if (chevron) {
      chevron.classList.remove('expanded');
    }
  } else {
    childrenContainer.classList.add('expanded');
    if (chevron) {
      chevron.classList.add('expanded');
    }
  }
}

// 파일 선택
function selectFile(fileElement) {
  // 모든 파일 선택 해제
  document.querySelectorAll('.tree-item.file').forEach(item => {
    item.classList.remove('selected');
  });

  // 현재 파일 선택
  fileElement.classList.add('selected');

  const fileName = fileElement.dataset.file;
  openFileInEditor(fileName);
}

// 에디터에 파일 열기
async function openFileInEditor(filePath) {
  const fileName = window.electronAPI.fs.path.basename(filePath);

  // 실제 파일 읽기
  if (!window.electronAPI || !window.electronAPI.fs) {
    const editorArea = document.querySelector('.editor-area');
    editorArea.innerHTML = '<div style="padding: 20px; color: #f48771;">파일 시스템 API를 사용할 수 없습니다.</div>';
    return;
  }

  // 이미 열린 탭인지 확인
  const existingTabIndex = openTabs.findIndex(tab => tab.filePath === filePath);
  if (existingTabIndex !== -1) {
    // 이미 열려있으면 해당 탭 활성화
    switchToTab(existingTabIndex);
    return;
  }

  // 파일 내용 읽기
  const fileContent = await window.electronAPI.fs.readFile(filePath);

  // .canvas 파일인지 확인
  const isCanvas = fileName.endsWith('.canvas');

  // 새 탭 추가
  openTabs.push({
    filePath,
    fileName,
    type: isCanvas ? 'canvas' : 'text',
    content: fileContent,
    originalContent: fileContent
  });

  activeTabIndex = openTabs.length - 1;

  // UI 업데이트
  renderTabs();
  renderActiveTabContent();
}

// 탭 렌더링
function renderTabs() {
  const editorTabs = document.getElementById('editorTabs');
  editorTabs.innerHTML = '';

  // 열린 탭이 없으면 Welcome 탭 표시
  if (openTabs.length === 0) {
    const welcomeTab = document.createElement('div');
    welcomeTab.className = 'editor-tab active';

    const tabIcon = document.createElement('img');
    tabIcon.src = 'vvu-icon2.png';
    tabIcon.style.width = '16px';
    tabIcon.style.height = '16px';
    tabIcon.style.marginRight = '6px';
    tabIcon.style.verticalAlign = 'middle';

    const tabLabel = document.createElement('span');
    tabLabel.textContent = 'Welcome';
    tabLabel.style.verticalAlign = 'middle';

    welcomeTab.appendChild(tabIcon);
    welcomeTab.appendChild(tabLabel);
    editorTabs.appendChild(welcomeTab);
    return;
  }

  openTabs.forEach((tab, index) => {
    const tabEl = document.createElement('div');
    tabEl.className = 'editor-tab' + (index === activeTabIndex ? ' active' : '');

    // 파일 아이콘 추가
    const tabIcon = document.createElement('img');
    tabIcon.src = getFileIcon(tab.fileName);
    tabIcon.style.width = '16px';
    tabIcon.style.height = '16px';
    tabIcon.style.marginRight = '6px';
    tabIcon.style.verticalAlign = 'middle';
    tabIcon.style.flexShrink = '0';

    // 파일 이름 (긴 파일명은 앞에 ... 추가)
    const tabLabel = document.createElement('span');
    const isModified = hasUnsavedChanges(index);
    const maxLength = 20;
    let displayName = tab.fileName;
    if (displayName.length > maxLength) {
      displayName = '...' + displayName.slice(-(maxLength - 3));
    }
    tabLabel.textContent = displayName + (isModified ? ' *' : '');
    tabLabel.style.cursor = 'pointer';
    tabLabel.style.verticalAlign = 'middle';
    tabLabel.title = tab.fileName; // 전체 파일명 툴팁
    tabLabel.addEventListener('click', () => switchToTab(index));

    const closeBtn = document.createElement('span');
    closeBtn.textContent = '×';
    closeBtn.style.marginLeft = '8px';
    closeBtn.style.cursor = 'pointer';
    closeBtn.style.fontSize = '18px';
    closeBtn.style.color = '#858585';
    closeBtn.style.transition = 'color 0.2s';
    closeBtn.style.verticalAlign = 'middle';
    closeBtn.addEventListener('mouseenter', () => {
      closeBtn.style.color = '#ffffff';
    });
    closeBtn.addEventListener('mouseleave', () => {
      closeBtn.style.color = '#858585';
    });
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeTab(index);
    });

    tabEl.appendChild(tabIcon);
    tabEl.appendChild(tabLabel);
    tabEl.appendChild(closeBtn);
    editorTabs.appendChild(tabEl);

    // 활성 탭이면 보이도록 스크롤
    if (index === activeTabIndex) {
      setTimeout(() => {
        tabEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
      }, 0);
    }
  });
}

// 탭 전환
function switchToTab(index) {
  if (index < 0 || index >= openTabs.length) return;

  // 이미 활성화된 탭이면 아무것도 하지 않음
  if (activeTabIndex === index) return;

  activeTabIndex = index;
  renderTabs();
  renderActiveTabContent();
}

// 탭 닫기
function closeTab(index) {
  if (index < 0 || index >= openTabs.length) return;

  // 변경사항이 있는지 확인
  if (hasUnsavedChanges(index)) {
    const tab = openTabs[index];
    showModal(
      'Unsaved Changes',
      `Do you want to save the changes you made to ${tab.fileName}?`,
      async () => {
        // Save 버튼 클릭
        await saveCurrentFile();
        performCloseTab(index);
      },
      () => {
        // Don't Save 버튼 클릭
        performCloseTab(index);
      },
      () => {
        // Cancel 버튼 클릭 - 아무것도 하지 않음
      }
    );
  } else {
    performCloseTab(index);
  }
}

// 실제로 탭을 닫는 함수
function performCloseTab(index) {
  if (index < 0 || index >= openTabs.length) return;

  openTabs.splice(index, 1);

  // 활성 탭 조정
  if (openTabs.length === 0) {
    activeTabIndex = -1;
    showWelcomeScreen();
  } else if (activeTabIndex >= openTabs.length) {
    activeTabIndex = openTabs.length - 1;
  } else if (activeTabIndex > index) {
    activeTabIndex--;
  }

  renderTabs();
  if (activeTabIndex >= 0) {
    renderActiveTabContent();
  }
}

// 활성 탭의 컨텐츠 렌더링
function renderActiveTabContent() {
  if (activeTabIndex < 0 || activeTabIndex >= openTabs.length) {
    showWelcomeScreen();
    return;
  }

  const tab = openTabs[activeTabIndex];
  const editorArea = document.querySelector('.editor-area');

  // 기존 Monaco 에디터 정리
  if (monacoEditor) {
    monacoEditor.dispose();
    monacoEditor = null;
  }

  if (tab.type === 'canvas') {
    openCanvasEditorForTab(tab);
  } else if (tab.type === 'testcase-sync') {
    renderTestcaseSync();
  } else {
    // Monaco 에디터로 텍스트 파일 편집
    editorArea.innerHTML = '<div id="monaco-container" style="width: 100%; height: 100%;"></div>';

    if (!monacoReady) {
      // Monaco가 아직 로드되지 않았으면 잠시 후 다시 시도
      setTimeout(() => renderActiveTabContent(), 100);
      return;
    }

    // 파일 확장자에 따른 언어 설정
    const language = getLanguageFromFileName(tab.fileName);

    // Monaco 에디터 생성
    monacoEditor = monaco.editor.create(document.getElementById('monaco-container'), {
      value: tab.content,
      language: language,
      theme: 'custom-dark',
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: 14,
      lineNumbers: 'on',
      scrollBeyondLastLine: false,
      wordWrap: 'on',
      tabSize: 2,
      renderWhitespace: 'selection',
      cursorBlinking: 'smooth',
      smoothScrolling: true,
    });

    // 내용 변경 이벤트
    monacoEditor.onDidChangeModelContent(() => {
      tab.content = monacoEditor.getValue();
      renderTabs(); // 탭 업데이트 (* 표시)
    });

    // Ctrl+S 키 바인딩 추가
    monacoEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      saveCurrentFile();
    });
  }
}

// 파일명에서 언어 타입 추출
function getLanguageFromFileName(fileName) {
  const ext = fileName.split('.').pop().toLowerCase();
  const languageMap = {
    'js': 'javascript',
    'ts': 'typescript',
    'json': 'json',
    'html': 'html',
    'htm': 'html',
    'css': 'css',
    'scss': 'scss',
    'less': 'less',
    'md': 'markdown',
    'py': 'python',
    'java': 'java',
    'c': 'c',
    'cpp': 'cpp',
    'h': 'c',
    'hpp': 'cpp',
    'cs': 'csharp',
    'go': 'go',
    'rs': 'rust',
    'rb': 'ruby',
    'php': 'php',
    'sql': 'sql',
    'xml': 'xml',
    'yaml': 'yaml',
    'yml': 'yaml',
    'sh': 'shell',
    'bash': 'shell',
    'txt': 'plaintext',
  };
  return languageMap[ext] || 'plaintext';
}

// 환영 화면 표시
function showWelcomeScreen() {
  const editorArea = document.querySelector('.editor-area');
  editorArea.innerHTML = `
    <div class="welcome-screen" style="align-items: flex-start; justify-content: flex-start; padding: 40px 60px; font-family: 'Segoe UI', sans-serif;">
      <h1 style="font-size: 36px; font-weight: 600; margin-bottom: 40px;">Virtual Validation Tools</h1>
      <div style="text-align: left;">
        <h2 style="font-size: 16px; font-weight: 600; color: #858585; text-transform: uppercase; margin-bottom: 12px;">Start</h2>
        <div class="welcome-link" onclick="openFolder()" style="display: flex; align-items: center; gap: 8px; cursor: pointer; padding: 4px 0; color: #3794ff; transition: color 0.2s; font-size: 14px;">
          <i class="codicon codicon-folder-opened" style="font-size: 16px;"></i>
          <span>Open Folder...</span>
        </div>
      </div>
    </div>
  `;

  // 호버 효과 추가
  const welcomeLink = editorArea.querySelector('.welcome-link');
  if (welcomeLink) {
    welcomeLink.addEventListener('mouseenter', () => {
      welcomeLink.style.color = '#4da6ff';
    });
    welcomeLink.addEventListener('mouseleave', () => {
      welcomeLink.style.color = '#3794ff';
    });
  }
}

// 폴더 열기
async function openFolder() {
  if (!window.electronAPI || !window.electronAPI.dialog) {
    console.error('Dialog API not available');
    return;
  }

  const folderPath = await window.electronAPI.dialog.openFolder();
  if (folderPath) {
    await loadProjectFiles(folderPath);

    // 폴더 열림 상태로 설정
    folderOpened = true;

    // 사이드바 표시
    const sidebar = document.querySelector('.sidebar');
    const resizer = document.querySelector('.sidebar-resizer');
    sidebar.style.display = 'flex';
    resizer.style.display = 'block';
    sidebarVisible = true;

    // Explorer 아이콘 활성화
    const explorerItem = document.querySelector('.activity-bar-item[data-view="explorer"]');
    if (explorerItem) {
      document.querySelectorAll('.activity-bar-item').forEach(i => i.classList.remove('active'));
      explorerItem.classList.add('active');
      currentActiveView = 'explorer';
    }
  }
}

// Project 메뉴 토글
function toggleProjectMenu(event) {
  event.stopPropagation();
  const dropdown = document.getElementById('projectDropdown');
  dropdown.classList.toggle('show');

  // 다른 곳 클릭하면 닫기
  const closeDropdown = (e) => {
    if (!e.target.closest('#projectMenu')) {
      dropdown.classList.remove('show');
      document.removeEventListener('click', closeDropdown);
    }
  };

  if (dropdown.classList.contains('show')) {
    setTimeout(() => document.addEventListener('click', closeDropdown), 0);
  }
}

// Testcase Sync 열기
function openTestcaseSync(event) {
  if (event) event.stopPropagation();

  // 드롭다운 닫기
  const dropdown = document.getElementById('projectDropdown');
  if (dropdown) dropdown.classList.remove('show');

  // 이미 열려있는지 확인
  const existingTabIndex = openTabs.findIndex(tab => tab.filePath === '__testcase_sync__');
  if (existingTabIndex !== -1) {
    switchToTab(existingTabIndex);
    return;
  }

  // 새 탭 추가
  openTabs.push({
    filePath: '__testcase_sync__',
    fileName: 'Testcase Sync',
    type: 'testcase-sync',
    content: null,
    originalContent: null
  });

  activeTabIndex = openTabs.length - 1;
  renderTabs();
  renderTestcaseSync();
}

// Testcase Sync 화면 렌더링
function renderTestcaseSync() {
  const editorArea = document.querySelector('.editor-area');
  editorArea.innerHTML = `
    <div class="testcase-sync" style="padding: 40px 60px; font-family: 'Segoe UI', sans-serif;">
      <h1 style="font-size: 28px; font-weight: 600; margin-bottom: 16px; color: #cccccc;">Testcase Sync</h1>
      <p style="font-size: 14px; color: #858585; margin-bottom: 40px;">Load your testcases to get started.</p>

      <div style="display: flex; flex-direction: column; gap: 16px; max-width: 400px;">
        <div class="wizard-option" onclick="loadFromCodebeamer()" style="display: flex; align-items: center; gap: 16px; padding: 16px 20px; background: #2d2d2d; border: 1px solid #454545; border-radius: 4px; cursor: pointer; transition: all 0.2s;">
          <div style="width: 40px; height: 40px; background: #0e639c; border-radius: 4px; display: flex; align-items: center; justify-content: center;">
            <i class="codicon codicon-cloud-download" style="font-size: 20px; color: white;"></i>
          </div>
          <div>
            <div style="font-size: 14px; font-weight: 500; color: #cccccc; margin-bottom: 4px;">Load from Codebeamer</div>
            <div style="font-size: 12px; color: #858585;">Connect to Codebeamer and import testcases</div>
          </div>
        </div>

        <div class="wizard-option" onclick="importFromExcel()" style="display: flex; align-items: center; gap: 16px; padding: 16px 20px; background: #2d2d2d; border: 1px solid #454545; border-radius: 4px; cursor: pointer; transition: all 0.2s;">
          <div style="width: 40px; height: 40px; background: #217346; border-radius: 4px; display: flex; align-items: center; justify-content: center;">
            <i class="codicon codicon-file" style="font-size: 20px; color: white;"></i>
          </div>
          <div>
            <div style="font-size: 14px; font-weight: 500; color: #cccccc; margin-bottom: 4px;">Import from Excel</div>
            <div style="font-size: 12px; color: #858585;">Import testcases from an Excel file (.xlsx)</div>
          </div>
        </div>
      </div>
    </div>
  `;

  // 호버 효과 추가
  const wizardOptions = editorArea.querySelectorAll('.wizard-option');
  wizardOptions.forEach(option => {
    option.addEventListener('mouseenter', () => {
      option.style.borderColor = '#007acc';
      option.style.background = '#37373d';
    });
    option.addEventListener('mouseleave', () => {
      option.style.borderColor = '#454545';
      option.style.background = '#2d2d2d';
    });
  });
}

// Codebeamer에서 불러오기 (UI만)
function loadFromCodebeamer() {
  showToast('info', 'Codebeamer connection feature coming soon.');
}

// Excel에서 가져오기
async function importFromExcel() {
  try {
    const filePath = await window.electronAPI.dialog.openFile({
      filters: [
        { name: 'Excel Files', extensions: ['xlsx', 'xls'] }
      ]
    });

    if (filePath) {
      const fileName = filePath.split(/[\\/]/).pop();
      showToast('info', `Processing: ${fileName}`);

      // Output 패널이 닫혀있으면 열기
      if (!outputPanelVisible) {
        toggleOutputPanel();
      }

      // Python 스크립트 실행
      appendOutput(`Selected Excel file: ${filePath}`, 'info');
      await runPythonScript('scripts/excel_handler.py', [filePath]);
    }
  } catch (error) {
    showToast('error', 'Failed to open file dialog.');
    console.error('Error opening file dialog:', error);
  }
}

// HTML 이스케이프
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 사이드바 표시 상태
let sidebarVisible = false;
let currentActiveView = null;
let folderOpened = false; // 폴더가 열렸는지 여부

// Activity Bar 상호작용 설정
function setupActivityBar() {
  const activityBarItems = document.querySelectorAll('.activity-bar-item');
  const sidebar = document.querySelector('.sidebar');
  const resizer = document.querySelector('.sidebar-resizer');

  activityBarItems.forEach(item => {
    item.addEventListener('click', () => {
      const view = item.dataset.view;

      // 폴더가 열리지 않은 상태에서는 사이드바를 열지 않음
      if (!folderOpened) {
        return;
      }

      // 같은 아이콘을 다시 클릭하면 사이드바 토글
      if (view === currentActiveView && item.classList.contains('active')) {
        sidebarVisible = !sidebarVisible;

        if (sidebarVisible) {
          sidebar.style.display = 'flex';
          resizer.style.display = 'block';
        } else {
          sidebar.style.display = 'none';
          resizer.style.display = 'none';
        }
        return;
      }

      // 다른 아이콘 클릭 시 사이드바 표시
      if (!sidebarVisible) {
        sidebarVisible = true;
        sidebar.style.display = 'flex';
        resizer.style.display = 'block';
      }

      // 모든 항목에서 active 클래스 제거
      activityBarItems.forEach(i => i.classList.remove('active'));

      // 클릭한 항목에 active 클래스 추가
      item.classList.add('active');
      currentActiveView = view;

      // 사이드바 헤더 텍스트 업데이트
      const sidebarHeader = document.querySelector('.sidebar-header');
      const viewNames = {
        'explorer': 'Explorer',
        'search': 'Search',
        'git': 'Source Control',
        'extensions': 'Extensions'
      };

      if (sidebarHeader && viewNames[view]) {
        sidebarHeader.textContent = viewNames[view];
      }
    });
  });
}

// 사이드바 리사이저 설정
function setupSidebarResizer() {
  const resizer = document.querySelector('.sidebar-resizer');
  const sidebar = document.querySelector('.sidebar');

  if (!resizer || !sidebar) return;

  let isResizing = false;
  let startX = 0;
  let startWidth = 0;

  const MIN_WIDTH = 200;
  const MAX_WIDTH = 600;

  resizer.addEventListener('mousedown', (e) => {
    isResizing = true;
    startX = e.clientX;
    startWidth = sidebar.offsetWidth;

    resizer.classList.add('resizing');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });

  document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;

    const delta = e.clientX - startX;
    let newWidth = startWidth + delta;

    // 최소/최대 너비 제약
    newWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, newWidth));

    sidebar.style.width = `${newWidth}px`;
  });

  document.addEventListener('mouseup', () => {
    if (isResizing) {
      isResizing = false;
      resizer.classList.remove('resizing');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
  });
}

// 윈도우 제어 함수
function minimizeWindow() {
  if (window.electronAPI && window.electronAPI.window) {
    window.electronAPI.window.minimize();
  }
}

function maximizeWindow() {
  if (window.electronAPI && window.electronAPI.window) {
    window.electronAPI.window.maximize();
  }
}

function closeWindow() {
  if (window.electronAPI && window.electronAPI.window) {
    window.electronAPI.window.close();
  }
}

// 개발자 도구 토글
function toggleDevTools() {
  if (window.electronAPI && window.electronAPI.devtools) {
    window.electronAPI.devtools.toggle();
  }
}

// ===== 캔버스 에디터 =====
let canvasData = {
  shapes: []
};
let selectedShape = null;
let selectedShapes = []; // 다중 선택된 도형들의 인덱스 배열
let isDragging = false;
let isResizing = false;
let resizeHandle = null;
let dragStartX = 0;
let dragStartY = 0;
let originalShapeData = null;
let originalShapesData = []; // 다중 선택 시 원본 데이터 배열
let currentFilePath = null;
let drawingMode = null; // 'rectangle' or 'circle' or null
let isDrawing = false;
let drawStartX = 0;
let drawStartY = 0;
let isSelectionBoxDragging = false; // 선택 박스 드래그 중
let selectionBoxStart = { x: 0, y: 0 }; // 선택 박스 시작 지점

// 무한 캔버스를 위한 뷰포트 오프셋
let viewportOffsetX = 0;
let viewportOffsetY = 0;
let isPanning = false; // 캔버스 패닝 중
let panStartX = 0;
let panStartY = 0;

// 색상 팔레트
const pasteColors = ['#616161', '#FFB3BA', '#BAFFC9', '#BAE1FF', '#FFFFBA', '#E0BBE4', '#FFC9BA', '#D4A5A5', '#9EC1CF'];
let colorPaletteVisible = false;

// 캔버스 에디터 열기 (탭용)
function openCanvasEditorForTab(tab) {
  currentFilePath = tab.filePath;
  const editorArea = document.querySelector('.editor-area');

  // JSON 파싱 (빈 파일이면 기본값)
  try {
    canvasData = tab.content.trim() ? JSON.parse(tab.content) : { shapes: [] };
  } catch (e) {
    canvasData = { shapes: [] };
  }

  // 캔버스 에디터 UI 생성
  editorArea.innerHTML = `
    <div id="canvas-editor" style="width: 100%; height: 100%; display: flex; flex-direction: row; background: #252526; position: relative;">
      <!-- 캔버스 영역 (전체 배경) -->
      <div id="canvas-container" style="flex: 1; position: relative; overflow: hidden; background-color: #252526; background-image: linear-gradient(rgba(255, 255, 255, 0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255, 255, 255, 0.05) 1px, transparent 1px); background-size: 20px 20px;">
      </div>

      <!-- 오른쪽 툴바 -->
      <div id="canvas-toolbar" style="width: 48px; background: #2d2d2d; display: flex; flex-direction: column; align-items: center; padding: 10px 0; gap: 4px; border-left: 1px solid #1e1e1e;">
        <button onclick="addRectangle()" title="Add Rectangle" style="width: 36px; height: 36px; background: transparent; color: #cccccc; border: none; cursor: pointer; font-size: 18px; display: flex; align-items: center; justify-content: center; transition: background 0.2s; border-radius: 4px;">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="14" height="14" rx="1"/>
          </svg>
        </button>
        <button onclick="addCircle()" title="Add Circle" style="width: 36px; height: 36px; background: transparent; color: #cccccc; border: none; cursor: pointer; font-size: 18px; display: flex; align-items: center; justify-content: center; transition: background 0.2s; border-radius: 4px;">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="10" cy="10" r="7"/>
          </svg>
        </button>
        <button onclick="addLine()" title="Add Line" style="width: 36px; height: 36px; background: transparent; color: #cccccc; border: none; cursor: pointer; font-size: 18px; display: flex; align-items: center; justify-content: center; transition: background 0.2s; border-radius: 4px;">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="3" y1="17" x2="17" y2="3"/>
          </svg>
        </button>
      </div>
    </div>
  `;

  // 도형 렌더링
  renderShapes();

  // 캔버스 이벤트 리스너
  setupCanvasEvents();

  // 툴바 버튼 호버 효과 추가
  const toolbarButtons = document.querySelectorAll('#canvas-toolbar button');
  toolbarButtons.forEach(btn => {
    btn.addEventListener('mouseenter', () => {
      btn.style.background = '#3e3e42';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.background = 'transparent';
    });
  });

  // 색상 팔레트 초기화
  initColorPalette();
}

// 월드 좌표를 화면 좌표로 변환 (뷰포트 offset 적용)
function worldToScreen(x, y) {
  return {
    x: x + viewportOffsetX,
    y: y + viewportOffsetY
  };
}

// 화면 좌표를 월드 좌표로 변환 (뷰포트 offset 제거)
function screenToWorld(x, y) {
  return {
    x: x - viewportOffsetX,
    y: y - viewportOffsetY
  };
}

// 색상 팔레트 초기화
function initColorPalette() {
  const palette = document.getElementById('colorPalette');
  if (!palette) return;

  // 이미 초기화된 경우 중복 방지
  if (palette.dataset.initialized === 'true') return;
  palette.dataset.initialized = 'true';

  palette.innerHTML = '';
  pasteColors.forEach(color => {
    const colorOption = document.createElement('div');
    colorOption.className = 'color-option';
    colorOption.style.backgroundColor = color;
    colorOption.dataset.color = color;

    colorOption.addEventListener('click', (e) => {
      e.stopPropagation();
      console.log('Color clicked:', color);
      changeShapeColor(color);
    });

    palette.appendChild(colorOption);
  });

  // 팔레트 외부 클릭 시 숨기기
  document.addEventListener('click', (e) => {
    if (!palette.contains(e.target) && !e.target.closest('.canvas-shape')) {
      hideColorPalette();
    }
  });
}

// 색상 팔레트 표시
function showColorPalette() {
  const palette = document.getElementById('colorPalette');
  if (!palette) return;

  // 고정된 색상 배열 사용
  // 팔레트 다시 렌더링
  palette.innerHTML = '';
  pasteColors.forEach(color => {
    const colorOption = document.createElement('div');
    colorOption.className = 'color-option';
    colorOption.style.backgroundColor = color;
    colorOption.dataset.color = color;

    colorOption.addEventListener('click', (e) => {
      e.stopPropagation();
      console.log('Color clicked:', color);
      changeShapeColor(color);
    });

    palette.appendChild(colorOption);
  });

  palette.classList.add('show');
  colorPaletteVisible = true;

  // 현재 선택된 도형의 색상 표시
  if (selectedShape !== null) {
    const currentColor = canvasData.shapes[selectedShape].color;
    palette.querySelectorAll('.color-option').forEach(option => {
      if (option.dataset.color === currentColor) {
        option.classList.add('selected');
      } else {
        option.classList.remove('selected');
      }
    });
  }
}

// 색상 팔레트 숨기기
function hideColorPalette() {
  const palette = document.getElementById('colorPalette');
  if (!palette) return;

  palette.classList.remove('show');
  colorPaletteVisible = false;
}

// 도형 색상 변경
function changeShapeColor(color) {
  console.log('changeShapeColor called:', color, 'selectedShape:', selectedShape, 'selectedShapes:', selectedShapes);

  if (selectedShape !== null) {
    console.log('Changing single shape color');
    canvasData.shapes[selectedShape].color = color;
    renderShapes();

    // 탭을 수정됨으로 표시
    if (activeTabIndex >= 0 && openTabs[activeTabIndex]) {
      openTabs[activeTabIndex].content = JSON.stringify(canvasData, null, 2);
    }
  } else if (selectedShapes.length > 0) {
    console.log('Changing multiple shapes color');
    // 다중 선택된 도형들의 색상 변경
    selectedShapes.forEach(index => {
      canvasData.shapes[index].color = color;
    });
    renderShapes();

    // 탭을 수정됨으로 표시
    if (activeTabIndex >= 0 && openTabs[activeTabIndex]) {
      openTabs[activeTabIndex].content = JSON.stringify(canvasData, null, 2);
    }
  } else {
    console.log('No shape selected!');
  }
}

// 도형 렌더링
function renderShapes() {
  const container = document.getElementById('canvas-container');
  if (!container) return;

  container.innerHTML = '';

  canvasData.shapes.forEach((shape, index) => {
    if (shape.type === 'line') {
      // 직선은 SVG로 렌더링
      const shapeEl = document.createElement('div');
      shapeEl.className = 'canvas-shape';
      shapeEl.dataset.index = index;
      shapeEl.style.position = 'absolute';

      // 바운딩 박스 계산
      const minX = Math.min(shape.x, shape.x + shape.width);
      const minY = Math.min(shape.y, shape.y + shape.height);
      const maxX = Math.max(shape.x, shape.x + shape.width);
      const maxY = Math.max(shape.y, shape.y + shape.height);

      // 뷰포트 오프셋 적용
      const screenPos = worldToScreen(minX, minY);
      shapeEl.style.left = screenPos.x + 'px';
      shapeEl.style.top = screenPos.y + 'px';
      shapeEl.style.width = (maxX - minX) + 'px';
      shapeEl.style.height = (maxY - minY) + 'px';
      shapeEl.style.cursor = 'move';
      shapeEl.style.pointerEvents = 'all';

      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.style.width = '100%';
      svg.style.height = '100%';
      svg.style.overflow = 'visible';

      // 양 끝이 모두 연결되어 있으면 꺾은 직선(orthogonal)으로 렌더링
      if (shape.startConnection && shape.endConnection) {
        // 중간점이 없으면 자동으로 계산
        if (!shape.middlePoint) {
          shape.middlePoint = 0.5; // 기본값: 중간
        }
        if (!shape.middlePoint2) {
          shape.middlePoint2 = 0.5; // 5개 선분용 두 번째 중간점
        }

        const x1 = shape.x - minX;
        const y1 = shape.y - minY;
        const x2 = (shape.x + shape.width) - minX;
        const y2 = (shape.y + shape.height) - minY;

        const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');

        // 연결점의 위치(top/bottom/left/right) 확인
        const startPos = shape.startConnection.position;
        const endPos = shape.endConnection.position;

        // 같은 방향 연결 확인 (top-top, bottom-bottom, left-left, right-right)
        const isSameDirection =
          (startPos === 'top' && endPos === 'top') ||
          (startPos === 'bottom' && endPos === 'bottom') ||
          (startPos === 'left' && endPos === 'left') ||
          (startPos === 'right' && endPos === 'right');

        // 수직-수평 교차 연결 확인 (top/bottom과 left/right 조합)
        const isPerpendicularConnection =
          ((startPos === 'top' || startPos === 'bottom') && (endPos === 'left' || endPos === 'right')) ||
          ((startPos === 'left' || startPos === 'right') && (endPos === 'top' || endPos === 'bottom'));

        let points;

        if (isSameDirection) {
          // 5개 선분 (4번 꺾임): 평행한 면끼리 연결
          // offsetDistance가 없으면 초기값 설정
          if (shape.offsetDistance === undefined) {
            shape.offsetDistance = 30; // 기본값: 30px
          }

          if (startPos === 'top' || startPos === 'bottom') {
            // 위/아래 연결: 위/아래로 나갔다가 옆으로 가고 다시 돌아옴
            const yOffset = startPos === 'top' ? -shape.offsetDistance : shape.offsetDistance;
            const midY = Math.min(y1, y2) + yOffset;
            const midX1 = x1 + (x2 - x1) * shape.middlePoint;
            points = `${x1},${y1} ${x1},${midY} ${midX1},${midY} ${x2},${midY} ${x2},${y2}`;
          } else {
            // 좌/우 연결: 좌/우로 나갔다가 위/아래로 가고 다시 안으로
            const xOffset = startPos === 'left' ? -shape.offsetDistance : shape.offsetDistance;
            const midX = Math.min(x1, x2) + xOffset;
            const midY1 = y1 + (y2 - y1) * shape.middlePoint;
            points = `${x1},${y1} ${midX},${y1} ${midX},${midY1} ${midX},${y2} ${x2},${y2}`;
          }
        } else if (isPerpendicularConnection) {
          // 5개 선분 (4번 꺾임): 수직-수평 교차 연결
          if (shape.offsetDistance === undefined) {
            shape.offsetDistance = 30;
          }

          // 시작점과 끝점의 방향에 따라 경로 결정
          if (startPos === 'top' || startPos === 'bottom') {
            // 시작: 위/아래, 끝: 좌/우
            const yOffset = startPos === 'top' ? -shape.offsetDistance : shape.offsetDistance;
            const yExit = y1 + yOffset; // 시작점에서 위/아래로 나간 지점

            const xOffset = endPos === 'left' ? -shape.offsetDistance : shape.offsetDistance;
            const xExit = x2 + xOffset; // 끝점에서 좌/우로 나온 지점

            // 5개 선분: (x1,y1) → (x1,yExit) → (xExit,yExit) → (xExit,y2) → (x2,y2)
            points = `${x1},${y1} ${x1},${yExit} ${xExit},${yExit} ${xExit},${y2} ${x2},${y2}`;
          } else {
            // 시작: 좌/우, 끝: 위/아래
            const xOffset = startPos === 'left' ? -shape.offsetDistance : shape.offsetDistance;
            const xExit = x1 + xOffset; // 시작점에서 좌/우로 나간 지점

            const yOffset = endPos === 'top' ? -shape.offsetDistance : shape.offsetDistance;
            const yExit = y2 + yOffset; // 끝점에서 위/아래로 나온 지점

            // 5개 선분: (x1,y1) → (xExit,y1) → (xExit,yExit) → (x2,yExit) → (x2,y2)
            points = `${x1},${y1} ${xExit},${y1} ${xExit},${yExit} ${x2},${yExit} ${x2},${y2}`;
          }
        } else {
          // 3개 선분 (2번 꺾임): 인접한 면끼리 연결 (left-right 또는 top-bottom)
          // 방향이 저장되지 않았으면 연결점 방향을 보고 결정
          if (shape.isHorizontalFirst === undefined) {
            // 시작점이 left/right이면 수평 먼저, top/bottom이면 수직 먼저
            if (startPos === 'left' || startPos === 'right') {
              shape.isHorizontalFirst = true;
            } else if (startPos === 'top' || startPos === 'bottom') {
              shape.isHorizontalFirst = false;
            } else {
              // 방향 정보가 없으면 기존 방식 사용
              shape.isHorizontalFirst = Math.abs(shape.width) > Math.abs(shape.height);
            }
          }

          const isHorizontalFirst = shape.isHorizontalFirst;

          if (isHorizontalFirst) {
            // 수평 -> 수직 -> 수평
            const midX = x1 + (x2 - x1) * shape.middlePoint;
            points = `${x1},${y1} ${midX},${y1} ${midX},${y2} ${x2},${y2}`;
          } else {
            // 수직 -> 수평 -> 수직
            const midY = y1 + (y2 - y1) * shape.middlePoint;
            points = `${x1},${y1} ${x1},${midY} ${x2},${midY} ${x2},${y2}`;
          }
        }

        polyline.setAttribute('points', points);
        polyline.setAttribute('fill', 'none');
        polyline.setAttribute('stroke', (selectedShape === index || selectedShapes.includes(index)) ? '#007acc' : '#616161');
        polyline.setAttribute('stroke-width', '3');
        polyline.setAttribute('stroke-linecap', 'round');
        polyline.setAttribute('stroke-linejoin', 'round');

        svg.appendChild(polyline);
      } else {
        // 일반 직선
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');

        // SVG 내 좌표 계산 (바운딩 박스 내 상대 좌표)
        const x1 = shape.x - minX;
        const y1 = shape.y - minY;
        const x2 = (shape.x + shape.width) - minX;
        const y2 = (shape.y + shape.height) - minY;

        line.setAttribute('x1', x1);
        line.setAttribute('y1', y1);
        line.setAttribute('x2', x2);
        line.setAttribute('y2', y2);
        line.setAttribute('stroke', (selectedShape === index || selectedShapes.includes(index)) ? '#007acc' : '#616161');
        line.setAttribute('stroke-width', '3');
        line.setAttribute('stroke-linecap', 'round');

        svg.appendChild(line);
      }

      shapeEl.appendChild(svg);

      // 선택된 도형 표시 (단일 선택 또는 다중 선택)
      if (selectedShape === index || selectedShapes.includes(index)) {
        shapeEl.style.filter = 'drop-shadow(0 0 4px rgba(0, 122, 204, 0.6))';
        // 직선의 양 끝점에만 핸들 추가 (단일 선택일 때만)
        if (selectedShape === index) {
          addLineHandles(shapeEl, shape, minX, minY);
        }
      }

      container.appendChild(shapeEl);
    } else {
      // 사각형과 원은 기존 방식으로 렌더링
      const shapeEl = document.createElement('div');
      shapeEl.className = 'canvas-shape';
      shapeEl.dataset.index = index;
      shapeEl.style.position = 'absolute';

      // 뷰포트 오프셋 적용
      const screenPos = worldToScreen(shape.x, shape.y);
      shapeEl.style.left = screenPos.x + 'px';
      shapeEl.style.top = screenPos.y + 'px';
      shapeEl.style.width = shape.width + 'px';
      shapeEl.style.height = shape.height + 'px';
      shapeEl.style.cursor = 'move';
      shapeEl.style.border = '2px solid #3e3e42';
      shapeEl.style.background = shape.color || '#616161';

      if (shape.type === 'circle') {
        shapeEl.style.borderRadius = '50%';
      }

      // 선택된 도형 표시 (단일 선택 또는 다중 선택)
      if (selectedShape === index || selectedShapes.includes(index)) {
        shapeEl.style.border = '2px solid #007acc';
        shapeEl.style.boxShadow = '0 0 8px rgba(0, 122, 204, 0.6)';

        // 리사이즈 핸들 추가 (단일 선택일 때만)
        if (selectedShape === index) {
          addResizeHandles(shapeEl);
        }
      }

      // 사각형에는 연결점 추가 (직선 그리기 모드이거나 직선을 그리는 중일 때)
      if (shape.type === 'rectangle' && drawingMode === 'line') {
        addConnectionPoints(shapeEl, index);
      }

      container.appendChild(shapeEl);
    }
  });
}

// 리사이즈 핸들 추가
function addResizeHandles(shapeEl) {
  const handleSize = '8px';
  const handleColor = '#ffffff';

  const handles = [
    // 모서리 4개
    { position: 'top-left', top: '-5px', left: '-5px', cursor: 'nwse-resize' },
    { position: 'top-right', top: '-5px', right: '-5px', cursor: 'nesw-resize' },
    { position: 'bottom-left', bottom: '-5px', left: '-5px', cursor: 'nesw-resize' },
    { position: 'bottom-right', bottom: '-5px', right: '-5px', cursor: 'nwse-resize' },
    // 상하좌우 4개
    { position: 'top', top: '-5px', left: '50%', transform: 'translateX(-50%)', cursor: 'ns-resize' },
    { position: 'bottom', bottom: '-5px', left: '50%', transform: 'translateX(-50%)', cursor: 'ns-resize' },
    { position: 'left', left: '-5px', top: '50%', transform: 'translateY(-50%)', cursor: 'ew-resize' },
    { position: 'right', right: '-5px', top: '50%', transform: 'translateY(-50%)', cursor: 'ew-resize' }
  ];

  handles.forEach(h => {
    const handle = document.createElement('div');
    handle.className = 'resize-handle';
    handle.dataset.position = h.position;
    handle.style.position = 'absolute';
    handle.style.width = handleSize;
    handle.style.height = handleSize;
    handle.style.background = handleColor;
    handle.style.cursor = h.cursor;
    handle.style.borderRadius = '2px';
    handle.style.border = '1px solid #007acc';
    handle.style.boxShadow = '0 0 2px rgba(0, 0, 0, 0.5)';

    if (h.top) handle.style.top = h.top;
    if (h.bottom) handle.style.bottom = h.bottom;
    if (h.left) handle.style.left = h.left;
    if (h.right) handle.style.right = h.right;
    if (h.transform) handle.style.transform = h.transform;

    shapeEl.appendChild(handle);
  });
}

// 직선용 핸들 추가
function addLineHandles(shapeEl, shape, minX, minY) {
  const handleSize = '10px';
  const handleColor = '#ffffff';

  // 시작점과 끝점의 상대 좌표 계산
  const startX = shape.x - minX;
  const startY = shape.y - minY;
  const endX = (shape.x + shape.width) - minX;
  const endY = (shape.y + shape.height) - minY;

  // 꺾은 직선일 경우 중간 핸들도 추가
  if (shape.startConnection && shape.endConnection) {
    // 연결점의 위치 확인
    const startPos = shape.startConnection.position;
    const endPos = shape.endConnection.position;

    // 같은 방향 연결 확인
    const isSameDirection =
      (startPos === 'top' && endPos === 'top') ||
      (startPos === 'bottom' && endPos === 'bottom') ||
      (startPos === 'left' && endPos === 'left') ||
      (startPos === 'right' && endPos === 'right');

    // 수직-수평 교차 연결 확인
    const isPerpendicularConnection =
      ((startPos === 'top' || startPos === 'bottom') && (endPos === 'left' || endPos === 'right')) ||
      ((startPos === 'left' || startPos === 'right') && (endPos === 'top' || endPos === 'bottom'));

    if (isSameDirection) {
      // 5개 선분: 중간 수평/수직 선분 위에 핸들 하나만 추가
      const offsetDist = shape.offsetDistance || 30;
      let midHandleX, midHandleY;

      if (startPos === 'top' || startPos === 'bottom') {
        const yOffset = startPos === 'top' ? -offsetDist : offsetDist;
        const midY = Math.min(startY, endY) + yOffset;
        midHandleX = startX + (endX - startX) * shape.middlePoint;
        midHandleY = midY;
      } else {
        const xOffset = startPos === 'left' ? -offsetDist : offsetDist;
        const midX = Math.min(startX, endX) + xOffset;
        midHandleX = midX;
        midHandleY = startY + (endY - startY) * shape.middlePoint;
      }

      const midHandle = document.createElement('div');
      midHandle.className = 'resize-handle';
      midHandle.dataset.position = 'middle';
      midHandle.style.position = 'absolute';
      midHandle.style.width = handleSize;
      midHandle.style.height = handleSize;
      midHandle.style.background = '#ffd700';
      // top/bottom 연결은 위아래로, left/right 연결은 좌우로
      midHandle.style.cursor = (startPos === 'top' || startPos === 'bottom') ? 'ns-resize' : 'ew-resize';
      midHandle.style.borderRadius = '50%';
      midHandle.style.border = '2px solid #007acc';
      midHandle.style.boxShadow = '0 0 3px rgba(0, 0, 0, 0.5)';
      midHandle.style.left = (midHandleX - 5) + 'px';
      midHandle.style.top = (midHandleY - 5) + 'px';

      shapeEl.appendChild(midHandle);
    } else if (isPerpendicularConnection) {
      // 5개 선분: 수직-수평 교차 연결 - 중간 지점에 핸들 추가
      const offsetDist = shape.offsetDistance || 30;
      let midHandleX, midHandleY;

      if (startPos === 'top' || startPos === 'bottom') {
        // 시작: 위/아래, 끝: 좌/우
        const yOffset = startPos === 'top' ? -offsetDist : offsetDist;
        const yExit = startY + yOffset;
        const xOffset = endPos === 'left' ? -offsetDist : offsetDist;
        const xExit = endX + xOffset;
        // 중간 수평 선분의 중앙에 핸들 배치
        midHandleX = (startX + xExit) / 2;
        midHandleY = yExit;
      } else {
        // 시작: 좌/우, 끝: 위/아래
        const xOffset = startPos === 'left' ? -offsetDist : offsetDist;
        const xExit = startX + xOffset;
        const yOffset = endPos === 'top' ? -offsetDist : offsetDist;
        const yExit = endY + yOffset;
        // 중간 수평 선분의 중앙에 핸들 배치
        midHandleX = xExit;
        midHandleY = (startY + yExit) / 2;
      }

      const midHandle = document.createElement('div');
      midHandle.className = 'resize-handle';
      midHandle.dataset.position = 'middle';
      midHandle.style.position = 'absolute';
      midHandle.style.width = handleSize;
      midHandle.style.height = handleSize;
      midHandle.style.background = '#ffd700';
      // 시작점의 방향에 따라 커서 결정
      midHandle.style.cursor = (startPos === 'top' || startPos === 'bottom') ? 'ns-resize' : 'ew-resize';
      midHandle.style.borderRadius = '50%';
      midHandle.style.border = '2px solid #007acc';
      midHandle.style.boxShadow = '0 0 3px rgba(0, 0, 0, 0.5)';
      midHandle.style.left = (midHandleX - 5) + 'px';
      midHandle.style.top = (midHandleY - 5) + 'px';

      shapeEl.appendChild(midHandle);
    } else {
      // 3개 선분: 기존 방식
      const isHorizontalFirst = shape.isHorizontalFirst;
      let midHandleX, midHandleY;

      if (isHorizontalFirst) {
        midHandleX = startX + (endX - startX) * shape.middlePoint;
        midHandleY = (startY + endY) / 2;
      } else {
        midHandleX = (startX + endX) / 2;
        midHandleY = startY + (endY - startY) * shape.middlePoint;
      }

      const midHandle = document.createElement('div');
      midHandle.className = 'resize-handle';
      midHandle.dataset.position = 'middle';
      midHandle.style.position = 'absolute';
      midHandle.style.width = handleSize;
      midHandle.style.height = handleSize;
      midHandle.style.background = '#ffd700';
      midHandle.style.cursor = isHorizontalFirst ? 'ew-resize' : 'ns-resize';
      midHandle.style.borderRadius = '50%';
      midHandle.style.border = '2px solid #007acc';
      midHandle.style.boxShadow = '0 0 3px rgba(0, 0, 0, 0.5)';
      midHandle.style.left = (midHandleX - 5) + 'px';
      midHandle.style.top = (midHandleY - 5) + 'px';

      shapeEl.appendChild(midHandle);
    }
  } else {
    // 일반 직선: 시작점과 끝점 핸들만
    const startHandle = document.createElement('div');
    startHandle.className = 'resize-handle';
    startHandle.dataset.position = 'start';
    startHandle.style.position = 'absolute';
    startHandle.style.width = handleSize;
    startHandle.style.height = handleSize;
    startHandle.style.background = handleColor;
    startHandle.style.cursor = 'move';
    startHandle.style.borderRadius = '50%';
    startHandle.style.border = '2px solid #007acc';
    startHandle.style.boxShadow = '0 0 3px rgba(0, 0, 0, 0.5)';
    startHandle.style.left = (startX - 5) + 'px';
    startHandle.style.top = (startY - 5) + 'px';

    const endHandle = document.createElement('div');
    endHandle.className = 'resize-handle';
    endHandle.dataset.position = 'end';
    endHandle.style.position = 'absolute';
    endHandle.style.width = handleSize;
    endHandle.style.height = handleSize;
    endHandle.style.background = handleColor;
    endHandle.style.cursor = 'move';
    endHandle.style.borderRadius = '50%';
    endHandle.style.border = '2px solid #007acc';
    endHandle.style.boxShadow = '0 0 3px rgba(0, 0, 0, 0.5)';
    endHandle.style.left = (endX - 5) + 'px';
    endHandle.style.top = (endY - 5) + 'px';

    shapeEl.appendChild(startHandle);
    shapeEl.appendChild(endHandle);
  }
}

// 사각형에 연결점 추가
function addConnectionPoints(shapeEl, shapeIndex) {
  const pointSize = '8px';
  const pointColor = '#89d185';

  const points = [
    { position: 'top', top: '-4px', left: '50%', transform: 'translateX(-50%)' },
    { position: 'bottom', bottom: '-4px', left: '50%', transform: 'translateX(-50%)' },
    { position: 'left', left: '-4px', top: '50%', transform: 'translateY(-50%)' },
    { position: 'right', right: '-4px', top: '50%', transform: 'translateY(-50%)' }
  ];

  points.forEach(p => {
    const point = document.createElement('div');
    point.className = 'connection-point';
    point.dataset.shapeIndex = shapeIndex;
    point.dataset.position = p.position;
    point.style.position = 'absolute';
    point.style.width = pointSize;
    point.style.height = pointSize;
    point.style.background = pointColor;
    point.style.border = '1px solid #ffffff';
    point.style.borderRadius = '50%';
    point.style.cursor = 'crosshair';
    point.style.zIndex = '10';
    point.style.pointerEvents = 'none'; // 클릭 이벤트는 무시

    if (p.top) point.style.top = p.top;
    if (p.bottom) point.style.bottom = p.bottom;
    if (p.left) point.style.left = p.left;
    if (p.right) point.style.right = p.right;
    if (p.transform) point.style.transform = p.transform;

    shapeEl.appendChild(point);
  });
}

// 캔버스 이벤트 설정
function setupCanvasEvents() {
  const container = document.getElementById('canvas-container');

  container.addEventListener('mousedown', handleCanvasMouseDown);
  document.addEventListener('mousemove', handleCanvasMouseMove);
  document.addEventListener('mouseup', handleCanvasMouseUp);
  // 키보드 이벤트는 initializeApp()에서 전역으로 등록됨
}

// 연결점 좌표 계산
function getConnectionPointPosition(shapeIndex, position) {
  const shape = canvasData.shapes[shapeIndex];
  if (!shape || shape.type !== 'rectangle') return null;

  const centerX = shape.x + shape.width / 2;
  const centerY = shape.y + shape.height / 2;

  switch(position) {
    case 'top':
      return { x: centerX, y: shape.y };
    case 'bottom':
      return { x: centerX, y: shape.y + shape.height };
    case 'left':
      return { x: shape.x, y: centerY };
    case 'right':
      return { x: shape.x + shape.width, y: centerY };
    default:
      return null;
  }
}

// 가장 가까운 연결점 찾기
function findNearestConnectionPoint(x, y, snapDistance = 15) {
  let nearestPoint = null;
  let minDistance = snapDistance;

  canvasData.shapes.forEach((shape, index) => {
    if (shape.type !== 'rectangle') return;

    ['top', 'bottom', 'left', 'right'].forEach(position => {
      const point = getConnectionPointPosition(index, position);
      if (!point) return;

      const distance = Math.sqrt(Math.pow(point.x - x, 2) + Math.pow(point.y - y, 2));
      if (distance < minDistance) {
        minDistance = distance;
        nearestPoint = {
          shapeIndex: index,
          position: position,
          x: point.x,
          y: point.y
        };
      }
    });
  });

  return nearestPoint;
}

// 사각형에 연결된 모든 선을 업데이트
function updateConnectedLines(rectangleIndex) {
  canvasData.shapes.forEach((shape, index) => {
    if (shape.type !== 'line') return;

    // 시작점이 이 사각형에 연결되어 있는지 확인
    if (shape.startConnection && shape.startConnection.shapeIndex === rectangleIndex) {
      const connectionPoint = getConnectionPointPosition(rectangleIndex, shape.startConnection.position);
      if (connectionPoint) {
        // 끝점을 유지하면서 시작점만 업데이트
        const endX = shape.x + shape.width;
        const endY = shape.y + shape.height;
        shape.x = connectionPoint.x;
        shape.y = connectionPoint.y;
        shape.width = endX - connectionPoint.x;
        shape.height = endY - connectionPoint.y;
      }
    }

    // 끝점이 이 사각형에 연결되어 있는지 확인
    if (shape.endConnection && shape.endConnection.shapeIndex === rectangleIndex) {
      const connectionPoint = getConnectionPointPosition(rectangleIndex, shape.endConnection.position);
      if (connectionPoint) {
        // 시작점을 유지하면서 끝점만 업데이트
        shape.width = connectionPoint.x - shape.x;
        shape.height = connectionPoint.y - shape.y;
      }
    }
  });
}

// 키보드 이벤트 핸들러
function handleCanvasKeyDown(e) {
  // Ctrl+S: 저장 (모든 파일 타입에서 동작)
  if (e.ctrlKey && e.key === 's') {
    e.preventDefault();
    saveCurrentFile();
    return;
  }

  // 캔버스 에디터가 열려있지 않으면 나머지 키 무시
  if (!document.getElementById('canvas-editor')) return;

  // Escape 키: 그리기 모드 해제
  if (e.key === 'Escape') {
    e.preventDefault();
    exitDrawingMode();
  }

  // Delete 키: 선택된 도형 삭제
  if (e.key === 'Delete' && selectedShape !== null) {
    e.preventDefault();
    deleteSelectedShape();
  }
}

function handleCanvasMouseDown(e) {
  const container = document.getElementById('canvas-container');
  const rect = container.getBoundingClientRect();

  // 그리기 모드인 경우
  if (drawingMode) {
    isDrawing = true;
    // 화면 좌표를 월드 좌표로 변환
    const worldPos = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
    drawStartX = worldPos.x;
    drawStartY = worldPos.y;

    // 새 도형 추가 (시작점에서 크기 0으로)
    canvasData.shapes.push({
      type: drawingMode,
      x: drawStartX,
      y: drawStartY,
      width: 0,
      height: 0,
      color: '#616161'
    });
    selectedShape = canvasData.shapes.length - 1;
    return;
  }

  // 일반 선택 모드
  const shapeEl = e.target.closest('.canvas-shape');

  if (!shapeEl) {
    // 빈 공간 클릭: 캔버스 패닝 시작 (Ctrl 키 없이)
    if (!e.ctrlKey) {
      isPanning = true;
      panStartX = e.clientX;
      panStartY = e.clientY;
      selectedShape = null;
      selectedShapes = [];
      container.style.cursor = 'grabbing';
      hideColorPalette();
    }
    renderShapes();
    return;
  }

  const index = parseInt(shapeEl.dataset.index);

  // Ctrl+클릭: 다중 선택
  if (e.ctrlKey) {
    // 단일 선택 모드였다면 그 도형을 다중 선택에 추가
    if (selectedShape !== null && selectedShapes.length === 0) {
      selectedShapes.push(selectedShape);
      selectedShape = null;
    }

    const shapeIndex = selectedShapes.indexOf(index);
    if (shapeIndex > -1) {
      // 이미 선택된 경우 제거
      selectedShapes.splice(shapeIndex, 1);
      renderShapes();
      return;
    } else {
      // 선택 추가
      selectedShapes.push(index);
      renderShapes();
      return;
    }
  }

  // 다중 선택된 도형 중 하나를 클릭한 경우, 다중 선택 유지하고 드래그 준비
  if (selectedShapes.length > 0 && selectedShapes.includes(index)) {
    // 드래그 준비 계속 진행 (아래 코드 실행)
  } else {
    // 일반 클릭: 단일 선택
    selectedShape = index;
    selectedShapes = []; // 다중 선택 해제
  }

  // 사각형이 선택되면 색상 팔레트 표시
  const shape = canvasData.shapes[index];
  if (shape.type === 'rectangle' || shape.type === 'circle') {
    showColorPalette();
  } else {
    hideColorPalette();
  }

  // 리사이즈 핸들 클릭 확인
  if (e.target.classList.contains('resize-handle')) {
    isResizing = true;
    resizeHandle = e.target.dataset.position;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    // 원본 도형 데이터 저장
    originalShapeData = { ...canvasData.shapes[index] };
  } else {
    // 연결된 직선인지 확인
    const shape = canvasData.shapes[index];
    const isConnectedLine = shape.type === 'line' && shape.startConnection && shape.endConnection;

    // 연결된 직선이면 드래그 비활성화
    if (!isConnectedLine) {
      isDragging = true;
      resizeHandle = null;
      const worldPos = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);

      // 다중 선택된 도형 중 하나를 클릭한 경우
      if (selectedShapes.length > 0 && selectedShapes.includes(index)) {
        // 드래그 시작 위치 저장 (마우스의 월드 좌표)
        dragStartX = worldPos.x;
        dragStartY = worldPos.y;

        // 모든 선택된 도형의 원본 데이터 저장
        originalShapesData = selectedShapes.map(i => ({
          index: i,
          data: { ...canvasData.shapes[i] }
        }));
      } else {
        // 단일 선택: 마우스 클릭 위치와 도형 위치의 오프셋 계산
        dragStartX = worldPos.x - canvasData.shapes[index].x;
        dragStartY = worldPos.y - canvasData.shapes[index].y;
      }
    }
  }

  renderShapes();
}

function handleCanvasMouseMove(e) {
  const container = document.getElementById('canvas-container');
  if (!container) return;
  const rect = container.getBoundingClientRect();

  // 캔버스 패닝 처리
  if (isPanning) {
    const deltaX = e.clientX - panStartX;
    const deltaY = e.clientY - panStartY;

    viewportOffsetX += deltaX;
    viewportOffsetY += deltaY;

    panStartX = e.clientX;
    panStartY = e.clientY;

    renderShapes();
    return;
  }

  // 그리기 모드인 경우
  if (isDrawing && selectedShape !== null) {
    // 화면 좌표를 월드 좌표로 변환
    const worldPos = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
    const currentX = worldPos.x;
    const currentY = worldPos.y;

    const shape = canvasData.shapes[selectedShape];
    const width = currentX - drawStartX;
    const height = currentY - drawStartY;

    if (shape.type === 'line') {
      // 직선은 시작점을 고정하고 width/height를 변경 (음수 가능)
      shape.x = drawStartX;
      shape.y = drawStartY;

      // 끝점에서 가까운 연결점 찾기
      const endX = drawStartX + width;
      const endY = drawStartY + height;
      const nearestPoint = findNearestConnectionPoint(endX, endY);

      if (nearestPoint) {
        // 연결점에 스냅
        shape.width = nearestPoint.x - drawStartX;
        shape.height = nearestPoint.y - drawStartY;
      } else {
        shape.width = width;
        shape.height = height;
      }
    } else {
      // 사각형과 원은 기존 방식 (음수 불가, 위치 조정)
      shape.x = width >= 0 ? drawStartX : currentX;
      shape.y = height >= 0 ? drawStartY : currentY;
      shape.width = Math.abs(width);
      shape.height = Math.abs(height);
    }

    renderShapes();
    return;
  }

  if (!isDragging && !isResizing) return;
  // 다중 선택 모드가 아닌 경우에만 selectedShape null 체크
  if (selectedShape === null && selectedShapes.length === 0) return;

  if (isDragging) {
    // 드래그 이동 (월드 좌표계)
    const worldPos = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);

    // 다중 선택된 도형들을 함께 이동
    if (originalShapesData.length > 0) {
      // 마우스 이동량 계산 (드래그 시작 지점으로부터의 변화량)
      const deltaX = worldPos.x - dragStartX;
      const deltaY = worldPos.y - dragStartY;

      // 모든 선택된 도형 이동
      originalShapesData.forEach(item => {
        const shape = canvasData.shapes[item.index];
        shape.x = item.data.x + deltaX;
        shape.y = item.data.y + deltaY;

        // 사각형이 이동할 때 연결된 선들도 업데이트
        if (shape.type === 'rectangle') {
          updateConnectedLines(item.index);
        }
      });
    } else {
      // 단일 도형 이동
      const shape = canvasData.shapes[selectedShape];
      shape.x = worldPos.x - dragStartX;
      shape.y = worldPos.y - dragStartY;

      // 사각형이 이동할 때 연결된 선들도 업데이트
      if (shape.type === 'rectangle') {
        updateConnectedLines(selectedShape);
      }
    }
  } else if (isResizing && originalShapeData) {
    // 리사이즈
    const shape = canvasData.shapes[selectedShape];
    const deltaX = e.clientX - dragStartX;
    const deltaY = e.clientY - dragStartY;

    const minSize = 20;

    switch (resizeHandle) {
      case 'bottom-right':
        shape.width = Math.max(minSize, originalShapeData.width + deltaX);
        shape.height = Math.max(minSize, originalShapeData.height + deltaY);
        break;
      case 'bottom-left':
        const newWidthBL = originalShapeData.width - deltaX;
        if (newWidthBL >= minSize) {
          shape.x = originalShapeData.x + deltaX;
          shape.width = newWidthBL;
        }
        shape.height = Math.max(minSize, originalShapeData.height + deltaY);
        break;
      case 'top-right':
        shape.width = Math.max(minSize, originalShapeData.width + deltaX);
        const newHeightTR = originalShapeData.height - deltaY;
        if (newHeightTR >= minSize) {
          shape.y = originalShapeData.y + deltaY;
          shape.height = newHeightTR;
        }
        break;
      case 'top-left':
        const newWidthTL = originalShapeData.width - deltaX;
        const newHeightTL = originalShapeData.height - deltaY;
        if (newWidthTL >= minSize) {
          shape.x = originalShapeData.x + deltaX;
          shape.width = newWidthTL;
        }
        if (newHeightTL >= minSize) {
          shape.y = originalShapeData.y + deltaY;
          shape.height = newHeightTL;
        }
        break;
      case 'top':
        const newHeightT = originalShapeData.height - deltaY;
        if (newHeightT >= minSize) {
          shape.y = originalShapeData.y + deltaY;
          shape.height = newHeightT;
        }
        break;
      case 'bottom':
        shape.height = Math.max(minSize, originalShapeData.height + deltaY);
        break;
      case 'left':
        const newWidthL = originalShapeData.width - deltaX;
        if (newWidthL >= minSize) {
          shape.x = originalShapeData.x + deltaX;
          shape.width = newWidthL;
        }
        break;
      case 'right':
        shape.width = Math.max(minSize, originalShapeData.width + deltaX);
        break;
      // 직선용 핸들
      case 'start':
        // 시작점 이동
        const newStartX = originalShapeData.x + deltaX;
        const newStartY = originalShapeData.y + deltaY;
        const nearestStartPoint = findNearestConnectionPoint(newStartX, newStartY);

        if (nearestStartPoint) {
          // 연결점에 스냅
          shape.x = nearestStartPoint.x;
          shape.y = nearestStartPoint.y;
          shape.width = originalShapeData.width + (originalShapeData.x - nearestStartPoint.x);
          shape.height = originalShapeData.height + (originalShapeData.y - nearestStartPoint.y);
        } else {
          shape.x = newStartX;
          shape.y = newStartY;
          shape.width = originalShapeData.width - deltaX;
          shape.height = originalShapeData.height - deltaY;
        }
        break;
      case 'end':
        // 끝점 이동
        const newEndX = originalShapeData.x + originalShapeData.width + deltaX;
        const newEndY = originalShapeData.y + originalShapeData.height + deltaY;
        const nearestEndPoint = findNearestConnectionPoint(newEndX, newEndY);

        if (nearestEndPoint) {
          // 연결점에 스냅
          shape.width = nearestEndPoint.x - originalShapeData.x;
          shape.height = nearestEndPoint.y - originalShapeData.y;
        } else {
          shape.width = originalShapeData.width + deltaX;
          shape.height = originalShapeData.height + deltaY;
        }
        break;
      case 'middle':
        // 꺾은 직선의 중간점 이동
        // 연결점 위치 확인
        const startPos = originalShapeData.startConnection.position;
        const endPos = originalShapeData.endConnection.position;
        const isSameDirection =
          (startPos === 'top' && endPos === 'top') ||
          (startPos === 'bottom' && endPos === 'bottom') ||
          (startPos === 'left' && endPos === 'left') ||
          (startPos === 'right' && endPos === 'right');

        const isPerpendicularConnection =
          ((startPos === 'top' || startPos === 'bottom') && (endPos === 'left' || endPos === 'right')) ||
          ((startPos === 'left' || startPos === 'right') && (endPos === 'top' || endPos === 'bottom'));

        if (isSameDirection) {
          // 5개 선분 (같은 방향): top/bottom이면 위아래로 offsetDistance 조정, left/right이면 좌우로 조정
          if (startPos === 'top' || startPos === 'bottom') {
            // 위아래 연결: Y축으로 offsetDistance 조정
            const originalOffset = originalShapeData.offsetDistance || 30;
            const multiplier = startPos === 'top' ? -1 : 1;
            shape.offsetDistance = Math.max(10, originalOffset + deltaY * multiplier);
          } else {
            // 좌우 연결: X축으로 offsetDistance 조정
            const originalOffset = originalShapeData.offsetDistance || 30;
            const multiplier = startPos === 'left' ? -1 : 1;
            shape.offsetDistance = Math.max(10, originalOffset + deltaX * multiplier);
          }
        } else if (isPerpendicularConnection) {
          // 5개 선분 (수직-수평 교차): 시작점 방향에 따라 offsetDistance 조정
          if (startPos === 'top' || startPos === 'bottom') {
            // 시작점이 위/아래: Y축으로 offsetDistance 조정
            const originalOffset = originalShapeData.offsetDistance || 30;
            const multiplier = startPos === 'top' ? -1 : 1;
            shape.offsetDistance = Math.max(10, originalOffset + deltaY * multiplier);
          } else {
            // 시작점이 좌/우: X축으로 offsetDistance 조정
            const originalOffset = originalShapeData.offsetDistance || 30;
            const multiplier = startPos === 'left' ? -1 : 1;
            shape.offsetDistance = Math.max(10, originalOffset + deltaX * multiplier);
          }
        } else {
          // 3개 선분: 기존 방식 (middlePoint 조정)
          const isHorizontalFirst = originalShapeData.isHorizontalFirst;

          if (isHorizontalFirst) {
            const totalWidth = originalShapeData.width;
            const newMiddlePoint = (originalShapeData.middlePoint * totalWidth + deltaX) / totalWidth;
            shape.middlePoint = Math.max(0, Math.min(1, newMiddlePoint));
          } else {
            const totalHeight = originalShapeData.height;
            const newMiddlePoint = (originalShapeData.middlePoint * totalHeight + deltaY) / totalHeight;
            shape.middlePoint = Math.max(0, Math.min(1, newMiddlePoint));
          }
        }
        break;
    }

    // 사각형 리사이즈 시 연결된 선들도 업데이트
    if (shape.type === 'rectangle') {
      updateConnectedLines(selectedShape);
    }
  }

  renderShapes();
}

function handleCanvasMouseUp() {
  const container = document.getElementById('canvas-container');

  // 패닝 완료
  if (isPanning) {
    isPanning = false;
    if (container) {
      container.style.cursor = '';
    }
    return;
  }

  // 그리기 완료
  if (isDrawing) {
    isDrawing = false;

    // 너무 작은 도형은 제거
    if (selectedShape !== null) {
      const shape = canvasData.shapes[selectedShape];
      // 직선은 절대값으로 체크, 사각형/원은 그대로 체크
      const minSize = 5;
      if (shape.type === 'line') {
        // 직선: width와 height의 절대값으로 체크
        if (Math.abs(shape.width) < minSize && Math.abs(shape.height) < minSize) {
          canvasData.shapes.splice(selectedShape, 1);
          selectedShape = null;
        } else {
          // 직선의 시작점과 끝점의 연결 확인
          const startPoint = findNearestConnectionPoint(shape.x, shape.y);
          const endPoint = findNearestConnectionPoint(shape.x + shape.width, shape.y + shape.height);

          if (startPoint) {
            shape.startConnection = { shapeIndex: startPoint.shapeIndex, position: startPoint.position };
          }
          if (endPoint) {
            shape.endConnection = { shapeIndex: endPoint.shapeIndex, position: endPoint.position };
          }
        }
      } else {
        // 사각형/원: 기존 방식
        if (shape.width < minSize || shape.height < minSize) {
          canvasData.shapes.splice(selectedShape, 1);
          selectedShape = null;
        }
      }
    }

    // 그리기 모드 종료
    exitDrawingMode();
    renderShapes();
    return;
  }

  // 리사이징 완료 시에도 직선의 연결 확인
  if (isResizing && selectedShape !== null && resizeHandle) {
    const shape = canvasData.shapes[selectedShape];
    if (shape && shape.type === 'line') {
      if (resizeHandle === 'start') {
        const startPoint = findNearestConnectionPoint(shape.x, shape.y);
        if (startPoint) {
          shape.startConnection = { shapeIndex: startPoint.shapeIndex, position: startPoint.position };
        } else {
          shape.startConnection = null;
        }
      } else if (resizeHandle === 'end') {
        const endPoint = findNearestConnectionPoint(shape.x + shape.width, shape.y + shape.height);
        if (endPoint) {
          shape.endConnection = { shapeIndex: endPoint.shapeIndex, position: endPoint.position };
        } else {
          shape.endConnection = null;
        }
      }
    }
  }

  isDragging = false;
  isResizing = false;
  resizeHandle = null;
  originalShapeData = null;
}

// 사각형 추가
function addRectangle() {
  drawingMode = 'rectangle';
  updateCanvasCursor();
}

// 동그라미 추가
function addCircle() {
  drawingMode = 'circle';
  updateCanvasCursor();
}

// 직선 추가
function addLine() {
  drawingMode = 'line';
  updateCanvasCursor();
  renderShapes(); // 연결점을 즉시 표시하기 위해 re-render
}

// 그리기 모드 해제
function exitDrawingMode() {
  drawingMode = null;
  isDrawing = false;
  updateCanvasCursor();
}

// 캔버스 커서 업데이트
function updateCanvasCursor() {
  const container = document.getElementById('canvas-container');
  if (!container) return;

  if (drawingMode) {
    container.style.cursor = 'crosshair';
  } else {
    container.style.cursor = 'default';
  }
}

// 선택된 도형 삭제
function deleteSelectedShape() {
  if (selectedShape !== null) {
    canvasData.shapes.splice(selectedShape, 1);
    selectedShape = null;
    renderShapes();
  }
}

// 캔버스 저장
async function saveCanvas() {
  if (!currentFilePath) return;

  const jsonContent = JSON.stringify(canvasData, null, 2);

  try {
    const result = await window.electronAPI.fs.writeFile(currentFilePath, jsonContent);
    if (result.success) {
      // 저장 성공 시 탭의 originalContent 업데이트
      if (activeTabIndex >= 0 && openTabs[activeTabIndex]) {
        openTabs[activeTabIndex].content = jsonContent;
        openTabs[activeTabIndex].originalContent = jsonContent;
        renderTabs(); // * 표시 제거
      }
    } else {
      showToast('Failed to save file: ' + result.error, 'error');
    }
  } catch (error) {
    showToast('Error saving file: ' + error, 'error');
  }
}

// 현재 파일 저장 (타입에 따라 분기)
async function saveCurrentFile() {
  if (activeTabIndex < 0 || activeTabIndex >= openTabs.length) return;

  const tab = openTabs[activeTabIndex];

  if (tab.type === 'canvas') {
    await saveCanvas();
  } else {
    await saveTextFile();
  }
}

// 텍스트 파일 저장
async function saveTextFile() {
  if (activeTabIndex < 0 || activeTabIndex >= openTabs.length) return;

  const tab = openTabs[activeTabIndex];

  try {
    const result = await window.electronAPI.fs.writeFile(tab.filePath, tab.content);
    if (result.success) {
      // 저장 성공 시 originalContent 업데이트
      tab.originalContent = tab.content;
      renderTabs(); // * 표시 제거
    } else {
      showToast('Failed to save file: ' + result.error, 'error');
    }
  } catch (error) {
    showToast('Error saving file: ' + error, 'error');
  }
}

// === 모달 관련 함수 ===

// 탭의 변경사항 확인
function hasUnsavedChanges(tabIndex) {
  if (tabIndex < 0 || tabIndex >= openTabs.length) return false;

  const tab = openTabs[tabIndex];

  // 캔버스 파일의 경우
  if (tab.type === 'canvas') {
    const currentContent = JSON.stringify(canvasData, null, 2);
    return currentContent !== tab.originalContent;
  }

  // 텍스트 파일의 경우
  return tab.content !== tab.originalContent;
}

// 모달 표시
function showModal(title, message, onSave, onDontSave, onCancel) {
  const overlay = document.getElementById('modalOverlay');
  const headerEl = document.getElementById('modalHeader');
  const bodyEl = document.getElementById('modalBody');

  headerEl.textContent = title;
  bodyEl.textContent = message;

  overlay.classList.add('show');

  // 버튼 이벤트 리스너 제거 (이전 리스너 정리)
  const saveBtn = document.getElementById('modalSaveBtn');
  const dontSaveBtn = document.getElementById('modalDontSaveBtn');
  const cancelBtn = document.getElementById('modalCancelBtn');

  const newSaveBtn = saveBtn.cloneNode(true);
  const newDontSaveBtn = dontSaveBtn.cloneNode(true);
  const newCancelBtn = cancelBtn.cloneNode(true);

  saveBtn.parentNode.replaceChild(newSaveBtn, saveBtn);
  dontSaveBtn.parentNode.replaceChild(newDontSaveBtn, dontSaveBtn);
  cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);

  // 새 이벤트 리스너 추가
  newSaveBtn.addEventListener('click', () => {
    hideModal();
    onSave();
  });

  newDontSaveBtn.addEventListener('click', () => {
    hideModal();
    onDontSave();
  });

  newCancelBtn.addEventListener('click', () => {
    hideModal();
    if (onCancel) onCancel();
  });

  // Escape 키로 모달 닫기
  const escHandler = (e) => {
    if (e.key === 'Escape') {
      hideModal();
      if (onCancel) onCancel();
      document.removeEventListener('keydown', escHandler);
    }
  };
  document.addEventListener('keydown', escHandler);
}

// 모달 숨기기
function hideModal() {
  const overlay = document.getElementById('modalOverlay');
  overlay.classList.remove('show');
}

// === 토스트 알림 함수 ===

// 토스트 표시
function showToast(message, type = 'info', duration = 3000) {
  const container = document.getElementById('toastContainer');

  // 아이콘 선택
  let icon = '';
  switch(type) {
    case 'success':
      icon = '✓';
      break;
    case 'error':
      icon = '✕';
      break;
    case 'info':
      icon = 'ℹ';
      break;
    default:
      icon = 'ℹ';
  }

  // 토스트 엘리먼트 생성
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  toast.innerHTML = `
    <div class="toast-icon">${icon}</div>
    <div class="toast-message">${message}</div>
    <div class="toast-close">✕</div>
  `;

  // 닫기 버튼 이벤트
  const closeBtn = toast.querySelector('.toast-close');
  closeBtn.addEventListener('click', () => {
    removeToast(toast);
  });

  // 컨테이너에 추가
  container.appendChild(toast);

  // 자동 제거
  setTimeout(() => {
    removeToast(toast);
  }, duration);
}

// 토스트 제거
function removeToast(toast) {
  toast.classList.add('removing');
  setTimeout(() => {
    if (toast.parentNode) {
      toast.parentNode.removeChild(toast);
    }
  }, 300); // 애니메이션 시간과 맞춤
}

// ===== OUTPUT 패널 관련 함수 =====

let outputPanelVisible = true;

// View 메뉴 토글
function toggleViewMenu(event) {
  event.stopPropagation();
  const dropdown = document.getElementById('viewDropdown');
  dropdown.classList.toggle('show');

  // 다른 곳 클릭하면 닫기
  const closeDropdown = (e) => {
    if (!e.target.closest('#viewMenu')) {
      dropdown.classList.remove('show');
      document.removeEventListener('click', closeDropdown);
    }
  };

  if (dropdown.classList.contains('show')) {
    setTimeout(() => document.addEventListener('click', closeDropdown), 0);
  }
}

// Output 패널 토글
function toggleOutputPanel(event) {
  if (event) event.stopPropagation();

  // 드롭다운 닫기
  const dropdown = document.getElementById('viewDropdown');
  if (dropdown) dropdown.classList.remove('show');

  const panel = document.getElementById('bottomPanel');
  const checkmark = document.getElementById('outputCheckmark');

  outputPanelVisible = !outputPanelVisible;

  if (outputPanelVisible) {
    panel.classList.add('show');
    if (checkmark) checkmark.textContent = '✓';
  } else {
    panel.classList.remove('show');
    if (checkmark) checkmark.textContent = '';
  }
}

// Developer Tools 토글 (메뉴에서)
function toggleDevToolsFromMenu(event) {
  if (event) event.stopPropagation();

  // 드롭다운 닫기
  const dropdown = document.getElementById('viewDropdown');
  if (dropdown) dropdown.classList.remove('show');

  toggleDevTools();
}

// Output 내용 추가
function appendOutput(message, type = 'info') {
  const outputContent = document.getElementById('outputContent');
  if (!outputContent) return;

  const line = document.createElement('div');
  line.className = `output-line ${type}`;

  const timestamp = new Date().toLocaleTimeString();
  const prefix = type === 'error' ? '[ERROR]' :
                 type === 'success' ? '[SUCCESS]' :
                 type === 'warning' ? '[WARNING]' : '[INFO]';

  line.textContent = `${timestamp} ${prefix} ${message}`;
  outputContent.appendChild(line);

  // 스크롤을 맨 아래로
  outputContent.scrollTop = outputContent.scrollHeight;
}

// Output 클리어
function clearOutput() {
  const outputContent = document.getElementById('outputContent');
  if (outputContent) {
    outputContent.innerHTML = '<div class="output-line info">[INFO] Output cleared.</div>';
  }
}

// 하단 패널 리사이저 설정
function setupBottomPanelResizer() {
  const resizer = document.getElementById('bottomPanelResizer');
  const panel = document.getElementById('bottomPanel');
  if (!resizer || !panel) return;

  let isResizing = false;
  let startY = 0;
  let startHeight = 0;

  resizer.addEventListener('mousedown', (e) => {
    isResizing = true;
    startY = e.clientY;
    startHeight = panel.offsetHeight;
    resizer.classList.add('resizing');
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;

    const delta = startY - e.clientY;
    const newHeight = Math.max(100, Math.min(window.innerHeight * 0.7, startHeight + delta));
    panel.style.height = newHeight + 'px';
  });

  document.addEventListener('mouseup', () => {
    if (isResizing) {
      isResizing = false;
      resizer.classList.remove('resizing');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
  });
}

// Python 스크립트 실행
async function runPythonScript(scriptPath, args = []) {
  appendOutput(`Running Python script: ${scriptPath}`, 'info');

  try {
    const result = await window.electronAPI.python.run(scriptPath, args);

    if (result.stdout) {
      result.stdout.split('\n').forEach(line => {
        if (line.trim()) appendOutput(line, 'success');
      });
    }

    if (result.stderr) {
      result.stderr.split('\n').forEach(line => {
        if (line.trim()) appendOutput(line, 'error');
      });
    }

    if (result.error) {
      appendOutput(`Error: ${result.error}`, 'error');
    }

    return result;
  } catch (error) {
    appendOutput(`Failed to run script: ${error.message}`, 'error');
    return { error: error.message };
  }
}

// 초기화 시 리사이저 설정
document.addEventListener('DOMContentLoaded', () => {
  setupBottomPanelResizer();
  setupTerminalListeners();
});

// ===== 터미널 관련 함수 =====

let terminals = []; // { id, name, output: [] }
let activeTerminalId = null;
let currentBottomTab = 'output';

// 하단 탭 전환 (OUTPUT / TERMINAL)
function switchBottomTab(tabName) {
  currentBottomTab = tabName;

  // 탭 활성화 상태 업데이트
  document.querySelectorAll('.bottom-panel-tab').forEach(tab => {
    if (tab.dataset.panel === tabName) {
      tab.classList.add('active');
    } else {
      tab.classList.remove('active');
    }
  });

  // 콘텐츠 표시/숨김
  const outputContent = document.getElementById('outputContent');
  const terminalContainer = document.getElementById('terminalContainer');
  const actionsContainer = document.getElementById('bottomPanelActions');

  if (tabName === 'output') {
    outputContent.style.display = 'block';
    terminalContainer.style.display = 'none';
    actionsContainer.innerHTML = `
      <div class="bottom-panel-action" onclick="clearOutput()" title="Clear Output">
        <i class="codicon codicon-clear-all"></i>
      </div>
      <div class="bottom-panel-action" onclick="toggleOutputPanel()" title="Close Panel">
        <i class="codicon codicon-close"></i>
      </div>
    `;
  } else if (tabName === 'terminal') {
    outputContent.style.display = 'none';
    terminalContainer.style.display = 'flex';
    actionsContainer.innerHTML = `
      <div class="bottom-panel-action" onclick="createNewTerminal()" title="New Terminal">
        <i class="codicon codicon-plus"></i>
      </div>
      <div class="bottom-panel-action" onclick="killActiveTerminal()" title="Kill Terminal">
        <i class="codicon codicon-trash"></i>
      </div>
      <div class="bottom-panel-action" onclick="clearTerminal()" title="Clear Terminal">
        <i class="codicon codicon-clear-all"></i>
      </div>
      <div class="bottom-panel-action" onclick="toggleOutputPanel()" title="Close Panel">
        <i class="codicon codicon-close"></i>
      </div>
    `;

    // 터미널이 없으면 자동 생성
    if (terminals.length === 0) {
      createNewTerminal();
    } else {
      // 입력 필드에 포커스
      setTimeout(() => {
        document.getElementById('terminalInput')?.focus();
      }, 100);
    }
  }
}

// 새 터미널 생성
async function createNewTerminal() {
  try {
    const result = await window.electronAPI.terminal.create();
    const terminalNum = terminals.length + 1;

    const terminal = {
      id: result.terminalId,
      name: `cmd ${terminalNum}`,
      cwd: result.cwd,
      output: []
    };

    terminals.push(terminal);
    activeTerminalId = terminal.id;

    renderTerminalList();
    renderTerminalContent();

    // 입력 필드에 포커스
    setTimeout(() => {
      document.getElementById('terminalInput')?.focus();
    }, 100);

  } catch (error) {
    console.error('Failed to create terminal:', error);
    showToast('error', 'Failed to create terminal');
  }
}

// 터미널 목록 렌더링
function renderTerminalList() {
  const listEl = document.getElementById('terminalList');
  if (!listEl) return;

  listEl.innerHTML = terminals.map(term => `
    <div class="terminal-item ${term.id === activeTerminalId ? 'active' : ''}"
         onclick="switchTerminal('${term.id}')">
      <i class="codicon codicon-terminal terminal-item-icon"></i>
      <span class="terminal-item-name">${term.name}</span>
      <span class="terminal-item-close" onclick="event.stopPropagation(); closeTerminal('${term.id}')">×</span>
    </div>
  `).join('');
}

// 터미널 전환
function switchTerminal(terminalId) {
  activeTerminalId = terminalId;
  renderTerminalList();
  renderTerminalContent();

  setTimeout(() => {
    document.getElementById('terminalInput')?.focus();
  }, 50);
}

// 터미널 내용 렌더링
function renderTerminalContent() {
  const contentEl = document.getElementById('terminalContent');
  const inputEl = document.getElementById('terminalInput');

  if (!contentEl) return;

  const terminal = terminals.find(t => t.id === activeTerminalId);
  if (!terminal) {
    contentEl.innerHTML = '<div class="terminal-output-line">No terminal selected</div>';
    return;
  }

  // 출력 라인 렌더링
  let html = terminal.output.map(line =>
    `<div class="terminal-output-line ${line.type || ''}">${escapeHtml(line.text)}</div>`
  ).join('');

  // 현재 입력 라인 표시 (프롬프트 + 타이핑 중인 내용)
  const currentInput = inputEl ? inputEl.value : '';
  const shortCwd = terminal.cwd ? terminal.cwd.split(/[\\/]/).pop() : 'cmd';
  html += `<div class="terminal-output-line"><span style="color:#6a9955">${escapeHtml(shortCwd)}>&nbsp;</span>${escapeHtml(currentInput)}<span class="terminal-cursor"></span></div>`;

  contentEl.innerHTML = html;

  // 스크롤을 맨 아래로
  contentEl.scrollTop = contentEl.scrollHeight;
}

// 터미널 입력 포커스
function focusTerminalInput() {
  const inputEl = document.getElementById('terminalInput');
  if (inputEl) {
    inputEl.focus();
  }
}

// 터미널에 출력 추가
function appendTerminalOutput(terminalId, text, type = '') {
  const terminal = terminals.find(t => t.id === terminalId);
  if (!terminal) return;

  // 줄바꿈으로 분리
  const lines = text.split('\n');
  lines.forEach(line => {
    if (line.trim() || lines.length === 1) {
      terminal.output.push({ text: line, type });
    }
  });

  // 활성 터미널이면 화면 업데이트
  if (terminalId === activeTerminalId) {
    renderTerminalContent();
  }
}

// 터미널 닫기
async function closeTerminal(terminalId) {
  try {
    await window.electronAPI.terminal.kill(terminalId);
  } catch (e) {
    // 이미 종료된 경우 무시
  }

  terminals = terminals.filter(t => t.id !== terminalId);

  if (activeTerminalId === terminalId) {
    activeTerminalId = terminals.length > 0 ? terminals[terminals.length - 1].id : null;
  }

  renderTerminalList();
  renderTerminalContent();
}

// 활성 터미널 종료
function killActiveTerminal() {
  if (activeTerminalId) {
    closeTerminal(activeTerminalId);
  }
}

// 터미널 클리어
function clearTerminal() {
  const terminal = terminals.find(t => t.id === activeTerminalId);
  if (terminal) {
    terminal.output = [];
    renderTerminalContent();
  }
}

// 터미널 입력 처리
async function handleTerminalInput(command) {
  if (!activeTerminalId) return;

  const terminal = terminals.find(t => t.id === activeTerminalId);
  if (!terminal) return;

  // 입력한 명령어를 출력에 추가
  const shortCwd = terminal.cwd ? terminal.cwd.split(/[\\/]/).pop() : 'cmd';
  terminal.output.push({ text: `${shortCwd}> ${command}`, type: '' });
  renderTerminalContent();

  // 빈 명령어면 전송하지 않음
  if (!command.trim()) return;

  // 명령어 전송
  try {
    await window.electronAPI.terminal.write(activeTerminalId, command);
  } catch (error) {
    appendTerminalOutput(activeTerminalId, `Error: ${error.message}`, 'error');
  }
}

// 터미널 이벤트 리스너 설정
function setupTerminalListeners() {
  // 터미널 데이터 수신
  window.electronAPI.terminal.onData((data) => {
    appendTerminalOutput(data.terminalId, data.data, data.isError ? 'error' : '');

    // cd 명령 후 경로 업데이트 시도
    const terminal = terminals.find(t => t.id === data.terminalId);
    if (terminal && data.data.includes('>')) {
      // 프롬프트에서 경로 추출 시도
      const match = data.data.match(/([A-Za-z]:\\[^\r\n>]*)/);
      if (match) {
        terminal.cwd = match[1];
      }
    }
  });

  // 터미널 종료 수신
  window.electronAPI.terminal.onExit((data) => {
    appendTerminalOutput(data.terminalId, `\nProcess exited with code ${data.code}`, 'error');
  });

  // 터미널 입력 필드 이벤트
  const inputEl = document.getElementById('terminalInput');
  if (inputEl) {
    // 입력 중 실시간 업데이트
    inputEl.addEventListener('input', () => {
      renderTerminalContent();
    });

    // Enter 키 처리
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const command = inputEl.value;
        inputEl.value = '';
        handleTerminalInput(command);
      }
    });
  }
}
