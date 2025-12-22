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
  setupPythonStreamListeners();
  setupFileWatchListeners();
  initChat();
}

// 파일 감시 이벤트 리스너 설정
function setupFileWatchListeners() {
  // 파일 변경 이벤트
  window.electronAPI.fileWatch.onChanged((filePath) => {
    console.log('File changed:', filePath);
    handleFileChanged(filePath);
  });

  // 파일 삭제 이벤트
  window.electronAPI.fileWatch.onDeleted((filePath) => {
    console.log('File deleted:', filePath);
    handleFileDeleted(filePath);
  });
}

// 파일 변경 처리
async function handleFileChanged(filePath) {
  // 해당 파일이 열린 탭인지 확인
  const tabIndex = openTabs.findIndex(tab => tab.filePath === filePath);
  if (tabIndex === -1) return;

  const tab = openTabs[tabIndex];

  // 변경사항이 없는 경우 자동으로 리로드
  if (tab.content === tab.originalContent) {
    // 파일 다시 읽기
    const newContent = await window.electronAPI.fs.readFile(filePath);
    tab.content = newContent;
    tab.originalContent = newContent;

    // 현재 활성 탭이면 에디터 내용 업데이트
    if (tabIndex === activeTabIndex) {
      if (monacoEditor && tab.type === 'text') {
        const currentPosition = monacoEditor.getPosition();
        monacoEditor.setValue(newContent);
        if (currentPosition) {
          monacoEditor.setPosition(currentPosition);
        }
      } else if (tab.type === 'canvas') {
        renderActiveTabContent();
      }
    }

    console.log('File auto-reloaded:', filePath);
  } else {
    // 변경사항이 있는 경우 사용자에게 알림
    showFileChangedNotification(tabIndex, filePath);
  }
}

// 파일 변경 알림 표시
function showFileChangedNotification(tabIndex, filePath) {
  const tab = openTabs[tabIndex];
  const fileName = tab.fileName;

  showModal(
    'File Changed',
    `The file "${fileName}" has been changed externally. Do you want to reload it? Your unsaved changes will be lost.`,
    async () => {
      // Reload 버튼 클릭
      const newContent = await window.electronAPI.fs.readFile(filePath);
      tab.content = newContent;
      tab.originalContent = newContent;

      if (tabIndex === activeTabIndex) {
        if (monacoEditor && tab.type === 'text') {
          monacoEditor.setValue(newContent);
        } else {
          renderActiveTabContent();
        }
      }
      renderTabs(); // 변경 표시(*) 업데이트
    },
    () => {
      // Keep My Changes 버튼 클릭 - 현재 내용 유지
      // originalContent를 현재 외부 내용으로 업데이트하여 다음 변경 감지 가능
    },
    null,
    'Reload',
    'Keep My Changes'
  );
}

// 파일 삭제 처리
function handleFileDeleted(filePath) {
  // 해당 파일이 열린 탭인지 확인
  const tabIndex = openTabs.findIndex(tab => tab.filePath === filePath);
  if (tabIndex === -1) return;

  const tab = openTabs[tabIndex];
  const fileName = tab.fileName;

  showModal(
    'File Deleted',
    `The file "${fileName}" has been deleted externally.`,
    () => {
      // Close Tab 버튼 클릭
      performCloseTab(tabIndex);
    },
    () => {
      // Keep Open 버튼 클릭 - 탭 유지 (저장 시 새로 생성됨)
    },
    null,
    'Close Tab',
    'Keep Open'
  );
}

// Python 스트리밍 이벤트 리스너 설정
function setupPythonStreamListeners() {
  // Python 출력 이벤트
  window.electronAPI.python.onOutput((data) => {
    if (data.processId === currentPythonProcessId) {
      handlePythonOutput(data.data, data.isError);
    }
  });

  // Python 종료 이벤트
  window.electronAPI.python.onExit((data) => {
    if (data.processId === currentPythonProcessId) {
      handlePythonExit(data.code, data.error);
    }
  });
}

// Python 출력 처리
function handlePythonOutput(output, isError) {
  const lines = output.split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;

    // PROGRESS:current/total 형식 파싱
    if (line.startsWith('PROGRESS:')) {
      const match = line.match(/PROGRESS:(\d+)\/(\d+)/);
      if (match) {
        const current = parseInt(match[1]);
        const total = parseInt(match[2]);
        const percent = Math.round((current / total) * 100);
        updateTcProgress(percent, `Processing ${current} of ${total}...`);
      }
    }
    // CREATED:filename 형식 파싱
    else if (line.startsWith('CREATED:')) {
      const fileName = line.replace('CREATED:', '').trim();
      updateTcCurrentFile(fileName);
      appendOutput(`Created: ${fileName}`, 'success');

      // Explorer 새로고침 및 파일 하이라이트
      refreshExplorer().then(() => {
        highlightFileInExplorer(currentProjectPath + '\\testcase\\' + fileName);
      });
    }
    // 일반 출력
    else {
      appendOutput(line, isError ? 'error' : 'info');
    }
  }
}

// Python 종료 처리
function handlePythonExit(code, error) {
  if (code === 0) {
    updateTcProgress(100, 'Completed!');
    appendOutput('TC Sync completed successfully!', 'success');
  } else if (error) {
    appendOutput(`Error: ${error}`, 'error');
    updateTcProgress(0, 'Error');
  } else {
    appendOutput(`Process exited with code ${code}`, 'warning');
    updateTcProgress(0, 'Stopped');
  }

  tcSyncRunning = false;
  currentPythonProcessId = null;

  // UI 상태 복원
  const startBtn = document.getElementById('tcStartBtn');
  const stopBtn = document.getElementById('tcStopBtn');
  if (startBtn) startBtn.style.display = 'flex';
  if (stopBtn) stopBtn.style.display = 'none';
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
  document.addEventListener('keydown', handleExplorerKeyDown);
}

// Explorer 키보드 이벤트 처리
function handleExplorerKeyDown(e) {
  // Monaco Editor나 터미널에 포커스가 있으면 무시
  const activeElement = document.activeElement;
  if (activeElement && (
    activeElement.closest('#monaco-container') ||
    activeElement.closest('#terminalContent') ||
    activeElement.tagName === 'INPUT' ||
    activeElement.tagName === 'TEXTAREA'
  )) {
    return;
  }

  // Delete 키로 선택된 파일/폴더 삭제 (다중 선택 지원)
  if (e.key === 'Delete') {
    const itemsToDelete = getSelectedItems();
    if (itemsToDelete.length > 0) {
      e.preventDefault();
      deleteSelectedItems(itemsToDelete);
    }
  }

  // F2 키로 선택된 파일/폴더 이름 변경
  if (e.key === 'F2' && selectedItemPath) {
    e.preventDefault();
    startInlineRename(selectedItemPath, selectedItemName, selectedItemIsFolder);
  }
}

// 현재 프로젝트 경로
let currentProjectPath = null;

// TC ID로 testcase 파일 열기
async function openTestcaseFile(tcId) {
  if (!currentProjectPath || !tcId) return;

  // testcase 폴더에서 TC ID.md 파일 찾기
  const testcasePath = `${currentProjectPath}/testcase/${tcId}.md`;

  try {
    // 파일 존재 확인 및 열기
    const content = await window.electronAPI.fs.readFile(testcasePath);
    if (content !== null) {
      // 파일 열기
      openFileInEditor(testcasePath);
    } else {
      showToast('error', `Testcase file not found: ${tcId}.md`);
    }
  } catch (error) {
    console.error('Error opening testcase file:', error);
    showToast('error', `Failed to open testcase: ${tcId}`);
  }
}

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

  // 루트 폴더에 Refresh 버튼 추가
  if (isRoot) {
    const refreshBtn = document.createElement('span');
    refreshBtn.className = 'explorer-refresh-btn';
    refreshBtn.innerHTML = '<i class="codicon codicon-refresh"></i>';
    refreshBtn.title = 'Refresh Explorer';
    refreshBtn.style.cssText = 'margin-left: auto; padding: 2px 6px; cursor: pointer; opacity: 0.6; display: flex; align-items: center;';
    refreshBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      refreshExplorer();
      showToast('info', 'Explorer refreshed');
    });
    refreshBtn.addEventListener('mouseenter', () => {
      refreshBtn.style.opacity = '1';
    });
    refreshBtn.addEventListener('mouseleave', () => {
      refreshBtn.style.opacity = '0.6';
    });
    folder.appendChild(refreshBtn);
    folder.style.display = 'flex';
    folder.style.alignItems = 'center';
  }

  // 우클릭 컨텍스트 메뉴 (루트 폴더 제외)
  if (!isRoot) {
    folder.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      // testcase로 시작하는 폴더는 전용 메뉴 표시
      if (name.toLowerCase().startsWith('testcase')) {
        showTestcaseFolderContextMenu(e, fullPath, name);
      } else {
        showContextMenu(e, fullPath, name, true);
      }
    });
  }

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

  // 우클릭 컨텍스트 메뉴
  file.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    // 엑셀 파일인 경우 전용 메뉴 표시
    if (isExcelFile(fullPath)) {
      showExcelContextMenu(e, fullPath, name);
    } else {
      showContextMenu(e, fullPath, name, false);
    }
  });

  return file;
}

// 현재 선택된 파일/폴더 정보
let contextMenuTargetPath = null;
let contextMenuTargetName = null;
let contextMenuTargetIsFolder = false;

// Explorer에서 선택된 파일/폴더
let selectedItemPath = null;
let selectedItemName = null;
let selectedItemIsFolder = false;

// 다중 선택 지원
let multiSelectedItems = new Set(); // { path, name, isFolder } 객체들의 Set
let lastClickedItemPath = null; // Shift 선택용

// 컨텍스트 메뉴 표시 (파일/폴더 공용)
function showContextMenu(e, itemPath, itemName, isFolder = false) {
  contextMenuTargetPath = itemPath;
  contextMenuTargetName = itemName;
  contextMenuTargetIsFolder = isFolder;

  const menu = document.getElementById('fileContextMenu');
  menu.style.display = 'block';
  menu.style.left = e.clientX + 'px';
  menu.style.top = e.clientY + 'px';

  // 화면 밖으로 나가지 않도록 조정
  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) {
    menu.style.left = (window.innerWidth - rect.width - 5) + 'px';
  }
  if (rect.bottom > window.innerHeight) {
    menu.style.top = (window.innerHeight - rect.height - 5) + 'px';
  }

  // 다른 곳 클릭하면 메뉴 닫기
  setTimeout(() => {
    document.addEventListener('click', hideContextMenu);
    document.addEventListener('contextmenu', hideContextMenu);
  }, 0);
}

// 컨텍스트 메뉴 숨기기
function hideContextMenu() {
  const menu = document.getElementById('fileContextMenu');
  const testcaseMenu = document.getElementById('testcaseFolderContextMenu');
  const excelMenu = document.getElementById('excelContextMenu');
  menu.style.display = 'none';
  testcaseMenu.style.display = 'none';
  excelMenu.style.display = 'none';
  document.removeEventListener('click', hideContextMenu);
  document.removeEventListener('contextmenu', hideContextMenu);
}

// Excel 파일 컨텍스트 메뉴 표시
function showExcelContextMenu(e, filePath, fileName) {
  contextMenuTargetPath = filePath;
  contextMenuTargetName = fileName;
  contextMenuTargetIsFolder = false;

  const menu = document.getElementById('excelContextMenu');
  menu.style.display = 'block';
  menu.style.left = e.clientX + 'px';
  menu.style.top = e.clientY + 'px';

  // 화면 밖으로 나가지 않도록 조정
  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) {
    menu.style.left = (window.innerWidth - rect.width - 5) + 'px';
  }
  if (rect.bottom > window.innerHeight) {
    menu.style.top = (window.innerHeight - rect.height - 5) + 'px';
  }

  // 다른 곳 클릭하면 메뉴 닫기
  setTimeout(() => {
    document.addEventListener('click', hideContextMenu);
    document.addEventListener('contextmenu', hideContextMenu);
  }, 0);
}

// Excel 프로그램으로 열기
function openExcelWithProgram() {
  const filePath = contextMenuTargetPath;
  hideContextMenu();
  if (filePath) {
    openWithDefaultProgram(filePath);
  }
}

// testcase 폴더 전용 컨텍스트 메뉴 표시
function showTestcaseFolderContextMenu(e, folderPath, folderName) {
  contextMenuTargetPath = folderPath;
  contextMenuTargetName = folderName;
  contextMenuTargetIsFolder = true;

  const menu = document.getElementById('testcaseFolderContextMenu');
  menu.style.display = 'block';
  menu.style.left = e.clientX + 'px';
  menu.style.top = e.clientY + 'px';

  // 화면 밖으로 나가지 않도록 조정
  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) {
    menu.style.left = (window.innerWidth - rect.width - 5) + 'px';
  }
  if (rect.bottom > window.innerHeight) {
    menu.style.top = (window.innerHeight - rect.height - 5) + 'px';
  }

  // 다른 곳 클릭하면 메뉴 닫기
  setTimeout(() => {
    document.addEventListener('click', hideContextMenu);
    document.addEventListener('contextmenu', hideContextMenu);
  }, 0);
}

// Categorize 탭 열기
function openCategorize() {
  const folderPath = contextMenuTargetPath;
  const folderName = contextMenuTargetName;

  hideContextMenu();

  if (!folderPath) return;

  // 이미 열려있는지 확인
  const existingTabIndex = openTabs.findIndex(tab =>
    tab.type === 'categorize' && tab.folderPath === folderPath
  );

  if (existingTabIndex !== -1) {
    activeTabIndex = existingTabIndex;
    renderTabs();
    renderCategorize(folderPath, folderName);
    return;
  }

  // 새 탭 추가
  openTabs.push({
    type: 'categorize',
    fileName: `Categorize: ${folderName}`,
    folderPath: folderPath,
    folderName: folderName
  });

  activeTabIndex = openTabs.length - 1;
  renderTabs();
  renderCategorize(folderPath, folderName);
}

// Category Viewer 열기 (Excel 파일용)
async function openCategoryViewer() {
  const filePath = contextMenuTargetPath;
  const fileName = contextMenuTargetName;

  hideContextMenu();

  if (!filePath) return;

  // 이미 열려있는지 확인
  const existingTabIndex = openTabs.findIndex(tab =>
    tab.type === 'categoryViewer' && tab.filePath === filePath
  );

  if (existingTabIndex !== -1) {
    activeTabIndex = existingTabIndex;
    renderTabs();
    renderCategoryViewer(openTabs[existingTabIndex]);
    return;
  }

  // Excel 데이터 읽기
  appendOutput('info', `Reading Excel file: ${fileName}`);

  try {
    const projectRoot = await window.electronAPI.getProjectRoot();
    const scriptPath = `${projectRoot}/scripts/excel_reader.py`;
    const result = await window.electronAPI.python.run(scriptPath, [filePath]);

    if (result.error) {
      appendOutput('error', `Failed to read Excel: ${result.error}`);
      if (result.stderr) {
        appendOutput('error', result.stderr);
      }
      showToast('error', 'Failed to read Excel file');
      return;
    }

    const data = JSON.parse(result.stdout);
    if (!data.success) {
      appendOutput('error', `Excel read error: ${data.error}`);
      showToast('error', data.error);
      return;
    }

    // 새 탭 추가
    openTabs.push({
      type: 'categoryViewer',
      fileName: 'View Category',
      filePath: filePath,
      excelData: data,
      activeSubTab: 'overview'
    });

    activeTabIndex = openTabs.length - 1;
    renderTabs();
    renderCategoryViewer(openTabs[activeTabIndex]);

    appendOutput('success', `Loaded ${data.rows.length} rows from Excel`);
  } catch (error) {
    console.error('Error opening category viewer:', error);
    appendOutput('error', `Error: ${error.message}`);
    showToast('error', 'Failed to open category viewer');
  }
}

// Category Viewer 렌더링
function renderCategoryViewer(tab) {
  const editorArea = document.querySelector('.editor-area');
  const data = tab.excelData;
  const rows = data.rows;
  const activeSubTab = tab.activeSubTab || 'overview';

  // 통계 계산
  const stats = calculateCategoryStats(rows);

  editorArea.innerHTML = `
    <div class="category-viewer" style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; height: 100%; display: flex; flex-direction: column; overflow: hidden;">
      <!-- 서브 탭 헤더 -->
      <div class="subtab-header" style="display: flex; background: #2d2d2d; border-bottom: 1px solid #3c3c3c; flex-shrink: 0;">
        <div class="subtab ${activeSubTab === 'overview' ? 'active' : ''}" data-subtab="overview" onclick="switchCategorySubTab('overview')" style="padding: 10px 20px; cursor: pointer; color: ${activeSubTab === 'overview' ? '#ffffff' : '#858585'}; border-bottom: 2px solid ${activeSubTab === 'overview' ? '#007acc' : 'transparent'}; transition: all 0.2s;">Overview</div>
        <div class="subtab ${activeSubTab === 'modules' ? 'active' : ''}" data-subtab="modules" onclick="switchCategorySubTab('modules')" style="padding: 10px 20px; cursor: pointer; color: ${activeSubTab === 'modules' ? '#ffffff' : '#858585'}; border-bottom: 2px solid ${activeSubTab === 'modules' ? '#007acc' : 'transparent'}; transition: all 0.2s;">Modules</div>
        <div class="subtab ${activeSubTab === 'implGroups' ? 'active' : ''}" data-subtab="implGroups" onclick="switchCategorySubTab('implGroups')" style="padding: 10px 20px; cursor: pointer; color: ${activeSubTab === 'implGroups' ? '#ffffff' : '#858585'}; border-bottom: 2px solid ${activeSubTab === 'implGroups' ? '#007acc' : 'transparent'}; transition: all 0.2s;">Impl Groups</div>
        <div class="subtab ${activeSubTab === 'testMethods' ? 'active' : ''}" data-subtab="testMethods" onclick="switchCategorySubTab('testMethods')" style="padding: 10px 20px; cursor: pointer; color: ${activeSubTab === 'testMethods' ? '#ffffff' : '#858585'}; border-bottom: 2px solid ${activeSubTab === 'testMethods' ? '#007acc' : 'transparent'}; transition: all 0.2s;">Test Methods</div>
      </div>

      <!-- 서브 탭 컨텐츠 -->
      <div class="subtab-content" style="flex: 1; overflow: hidden; display: flex; flex-direction: column;">
        ${renderCategorySubTabContent(activeSubTab, rows, stats)}
      </div>
    </div>
  `;

  // 필터 이벤트 설정 (Overview 탭일 때만)
  if (activeSubTab === 'overview') {
    setupFilterEvents(rows);
  }
}

// 서브 탭 전환
function switchCategorySubTab(subTabName) {
  const tab = openTabs[activeTabIndex];
  if (!tab || tab.type !== 'categoryViewer') return;

  tab.activeSubTab = subTabName;
  renderCategoryViewer(tab);
}

// 서브 탭 컨텐츠 렌더링
function renderCategorySubTabContent(subTab, rows, stats) {
  switch (subTab) {
    case 'overview':
      return renderOverviewTab(rows, stats);
    case 'modules':
      return renderGroupedTab(rows, 'Module_Group', 'Modules', '#ffb74d', stats.modules);
    case 'implGroups':
      return renderGroupedTab(rows, 'Impl_Group', 'Impl Groups', '#ba68c8', stats.implGroups);
    case 'testMethods':
      return renderTestMethodsTab(rows, stats.testMethods);
    default:
      return renderOverviewTab(rows, stats);
  }
}

// Overview 탭 렌더링
function renderOverviewTab(rows, stats) {
  return `
    <div style="padding: 20px; height: 100%; display: flex; flex-direction: column; overflow: hidden;">
      <!-- 상단 통계 요약 -->
      <div class="stats-summary" style="display: flex; gap: 20px; flex-wrap: wrap; margin-bottom: 20px; flex-shrink: 0;">
        <div class="stat-card" style="background: #2d2d30; padding: 15px 20px; border-radius: 6px; min-width: 150px;">
          <div style="font-size: 24px; font-weight: 600; color: #4fc3f7;">${rows.length}</div>
          <div style="font-size: 13px; color: #858585; margin-top: 4px;">Total TCs</div>
        </div>
        <div class="stat-card" style="background: #2d2d30; padding: 15px 20px; border-radius: 6px; min-width: 150px;">
          <div style="font-size: 24px; font-weight: 600; color: #81c784;">${stats.automation.yes} / ${rows.length}</div>
          <div style="font-size: 13px; color: #858585; margin-top: 4px;">Automation (Y)</div>
        </div>
        <div class="stat-card" style="background: #2d2d30; padding: 15px 20px; border-radius: 6px; min-width: 150px;">
          <div style="font-size: 24px; font-weight: 600; color: #ffb74d;">${stats.modules.size}</div>
          <div style="font-size: 13px; color: #858585; margin-top: 4px;">Modules</div>
        </div>
        <div class="stat-card" style="background: #2d2d30; padding: 15px 20px; border-radius: 6px; min-width: 150px;">
          <div style="font-size: 24px; font-weight: 600; color: #ba68c8;">${stats.implGroups.size}</div>
          <div style="font-size: 13px; color: #858585; margin-top: 4px;">Impl Groups</div>
        </div>
        <div class="stat-card" style="background: #2d2d30; padding: 15px 20px; border-radius: 6px; min-width: 150px;">
          <div style="font-size: 24px; font-weight: 600; color: #4db6ac;">${stats.testMethods.size}</div>
          <div style="font-size: 13px; color: #858585; margin-top: 4px;">Test Methods</div>
        </div>
      </div>

      <!-- 필터 섹션 -->
      <div class="filter-section" style="display: flex; gap: 15px; flex-wrap: wrap; margin-bottom: 15px; flex-shrink: 0;">
        ${createFilterDropdown('automation', 'Automation', stats.automation.values)}
        ${createFilterDropdown('module', 'Module', [...stats.modules])}
        ${createFilterDropdown('implGroup', 'Impl Group', [...stats.implGroups])}
        ${createFilterDropdown('testMethod', 'Test Method', [...stats.testMethods])}
      </div>

      <!-- 선택된 필터 표시 -->
      <div id="activeFilters" style="display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 15px; min-height: 28px; flex-shrink: 0;"></div>

      <!-- 결과 카운트 -->
      <div style="font-size: 13px; color: #858585; margin-bottom: 10px; flex-shrink: 0;">
        Showing <span id="filteredCount">${rows.length}</span> of ${rows.length} TCs
      </div>

      <!-- 리스트 뷰 -->
      <div class="list-view-container" style="flex: 1; overflow: auto; background: #1e1e1e; border: 1px solid #3c3c3c; border-radius: 4px;">
        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
          <thead style="position: sticky; top: 0; background: #2d2d30; z-index: 1;">
            <tr>
              <th style="padding: 10px 12px; text-align: left; border-bottom: 1px solid #3c3c3c; color: #cccccc;">TC ID</th>
              <th style="padding: 10px 12px; text-align: left; border-bottom: 1px solid #3c3c3c; color: #cccccc;">Module</th>
              <th style="padding: 10px 12px; text-align: left; border-bottom: 1px solid #3c3c3c; color: #cccccc;">Impl Group</th>
              <th style="padding: 10px 12px; text-align: left; border-bottom: 1px solid #3c3c3c; color: #cccccc;">Automation</th>
              <th style="padding: 10px 12px; text-align: left; border-bottom: 1px solid #3c3c3c; color: #cccccc;">Test Methods</th>
            </tr>
          </thead>
          <tbody id="tcListBody">
            ${renderTCRows(rows)}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// 그룹별 탭 렌더링 (Modules, Impl Groups)
function renderGroupedTab(rows, groupKey, title, color, groupSet) {
  // 그룹별 카운트 계산
  const groupCounts = {};
  rows.forEach(row => {
    const group = row[groupKey] || row['Module'] || 'Unknown';
    if (!groupCounts[group]) {
      groupCounts[group] = [];
    }
    groupCounts[group].push(row);
  });

  const sortedGroups = Object.entries(groupCounts).sort((a, b) => b[1].length - a[1].length);

  return `
    <div style="padding: 20px; height: 100%; overflow: auto;">
      <div style="font-size: 16px; font-weight: 600; color: #cccccc; margin-bottom: 20px;">
        ${title} <span style="color: ${color}; margin-left: 8px;">(${sortedGroups.length})</span>
      </div>
      <div class="grouped-list">
        ${sortedGroups.map(([groupName, groupRows], idx) => `
          <div class="group-item" style="margin-bottom: 2px;">
            <div class="group-header" onclick="toggleGroupExpand(${idx})" style="display: flex; align-items: center; padding: 12px 16px; background: #2d2d30; cursor: pointer; border-radius: 4px; transition: background 0.2s;">
              <span class="group-chevron" id="chevron-${idx}" style="margin-right: 10px; color: #858585; transition: transform 0.2s;">▶</span>
              <span style="flex: 1; font-size: 14px; color: #cccccc;">${groupName}</span>
              <span style="background: ${color}; color: #1e1e1e; padding: 2px 10px; border-radius: 10px; font-size: 12px; font-weight: 600;">${groupRows.length}</span>
            </div>
            <div class="group-content" id="group-content-${idx}" style="display: none; margin-left: 26px; border-left: 2px solid #3c3c3c; margin-top: 2px;">
              <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                <thead style="background: #252526;">
                  <tr>
                    <th style="padding: 8px 12px; text-align: left; color: #858585; font-weight: normal;">TC ID</th>
                    <th style="padding: 8px 12px; text-align: left; color: #858585; font-weight: normal;">Automation</th>
                    <th style="padding: 8px 12px; text-align: left; color: #858585; font-weight: normal;">Impl Group</th>
                  </tr>
                </thead>
                <tbody>
                  ${groupRows.map(row => {
                    const rowTcId = row['TC_ID'] || row['ID'] || '';
                    return `
                    <tr style="border-bottom: 1px solid #2d2d2d;">
                      <td style="padding: 8px 12px;"><span onclick="openTestcaseFile('${rowTcId}')" style="color: #4fc3f7; cursor: pointer; text-decoration: underline;">${rowTcId}</span></td>
                      <td style="padding: 8px 12px;"><span style="background: ${(row['Automation'] || '').toUpperCase().includes('Y') ? '#2e7d32' : '#616161'}; padding: 2px 8px; border-radius: 3px; font-size: 12px;">${row['Automation'] || ''}</span></td>
                      <td style="padding: 8px 12px; color: #cccccc;">${row['Impl_Group'] || ''}</td>
                    </tr>
                  `}).join('')}
                </tbody>
              </table>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

// Test Methods 탭 렌더링
function renderTestMethodsTab(rows, testMethodSet) {
  // 테스트 메소드별 카운트 계산
  const methodCounts = {};
  [...testMethodSet].forEach(method => {
    methodCounts[method] = rows.filter(row => {
      const key = `TM_${method}`;
      return row[key] === 'Y' || row[key] === 'True' || row[key] === 'TRUE' || row[key] === '1';
    });
  });

  const sortedMethods = Object.entries(methodCounts).sort((a, b) => b[1].length - a[1].length);

  return `
    <div style="padding: 20px; height: 100%; overflow: auto;">
      <div style="font-size: 16px; font-weight: 600; color: #cccccc; margin-bottom: 20px;">
        Test Methods <span style="color: #4db6ac; margin-left: 8px;">(${sortedMethods.length})</span>
      </div>
      <div class="grouped-list">
        ${sortedMethods.map(([methodName, methodRows], idx) => `
          <div class="group-item" style="margin-bottom: 2px;">
            <div class="group-header" onclick="toggleGroupExpand(${idx + 1000})" style="display: flex; align-items: center; padding: 12px 16px; background: #2d2d30; cursor: pointer; border-radius: 4px; transition: background 0.2s;">
              <span class="group-chevron" id="chevron-${idx + 1000}" style="margin-right: 10px; color: #858585; transition: transform 0.2s;">▶</span>
              <span style="flex: 1; font-size: 14px; color: #cccccc;">${methodName}</span>
              <span style="background: #4db6ac; color: #1e1e1e; padding: 2px 10px; border-radius: 10px; font-size: 12px; font-weight: 600;">${methodRows.length}</span>
            </div>
            <div class="group-content" id="group-content-${idx + 1000}" style="display: none; margin-left: 26px; border-left: 2px solid #3c3c3c; margin-top: 2px;">
              <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                <thead style="background: #252526;">
                  <tr>
                    <th style="padding: 8px 12px; text-align: left; color: #858585; font-weight: normal;">TC ID</th>
                    <th style="padding: 8px 12px; text-align: left; color: #858585; font-weight: normal;">Module</th>
                    <th style="padding: 8px 12px; text-align: left; color: #858585; font-weight: normal;">Automation</th>
                  </tr>
                </thead>
                <tbody>
                  ${methodRows.map(row => {
                    const rowTcId = row['TC_ID'] || row['ID'] || '';
                    return `
                    <tr style="border-bottom: 1px solid #2d2d2d;">
                      <td style="padding: 8px 12px;"><span onclick="openTestcaseFile('${rowTcId}')" style="color: #4fc3f7; cursor: pointer; text-decoration: underline;">${rowTcId}</span></td>
                      <td style="padding: 8px 12px; color: #cccccc;">${row['Module_Group'] || row['Module'] || ''}</td>
                      <td style="padding: 8px 12px;"><span style="background: ${(row['Automation'] || '').toUpperCase().includes('Y') ? '#2e7d32' : '#616161'}; padding: 2px 8px; border-radius: 3px; font-size: 12px;">${row['Automation'] || ''}</span></td>
                    </tr>
                  `}).join('')}
                </tbody>
              </table>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

// 그룹 확장/축소 토글
function toggleGroupExpand(idx) {
  const content = document.getElementById(`group-content-${idx}`);
  const chevron = document.getElementById(`chevron-${idx}`);

  if (content.style.display === 'none') {
    content.style.display = 'block';
    chevron.style.transform = 'rotate(90deg)';
  } else {
    content.style.display = 'none';
    chevron.style.transform = 'rotate(0deg)';
  }
}

// 통계 계산
function calculateCategoryStats(rows) {
  const stats = {
    automation: { yes: 0, no: 0, values: ['Y', 'N'] },
    modules: new Set(),
    implGroups: new Set(),
    testMethods: new Set()
  };

  rows.forEach(row => {
    // Automation
    const automation = row['Automation'] || '';
    if (automation.toUpperCase() === 'Y' || automation.includes('Y')) {
      stats.automation.yes++;
    } else {
      stats.automation.no++;
    }

    // Module
    const module = row['Module_Group'] || row['Module'] || '';
    if (module) stats.modules.add(module);

    // Impl Group
    const implGroup = row['Impl_Group'] || '';
    if (implGroup) stats.implGroups.add(implGroup);

    // Test Methods (TM_* columns)
    Object.keys(row).forEach(key => {
      if (key.startsWith('TM_') && (row[key] === 'Y' || row[key] === 'True' || row[key] === 'TRUE' || row[key] === '1')) {
        stats.testMethods.add(key.replace('TM_', ''));
      }
    });
  });

  return stats;
}

// 필터 드롭다운 생성
function createFilterDropdown(id, label, values) {
  const options = values.map(v => `<label style="display: flex; align-items: center; gap: 8px; padding: 6px 10px; cursor: pointer; transition: background 0.1s;">
    <input type="checkbox" value="${v}" style="cursor: pointer;">
    <span>${v}</span>
  </label>`).join('');

  return `
    <div class="filter-dropdown" style="position: relative;">
      <button id="filter-btn-${id}" onclick="toggleFilterDropdown('${id}')"
        style="background: #3c3c3c; border: 1px solid #555; color: #cccccc; padding: 8px 12px; border-radius: 4px; cursor: pointer; display: flex; align-items: center; gap: 8px; font-size: 13px;">
        <span>${label}</span>
        <span style="font-size: 10px;">▼</span>
      </button>
      <div id="filter-menu-${id}" class="filter-menu" style="display: none; position: absolute; top: 100%; left: 0; background: #252526; border: 1px solid #454545; border-radius: 4px; min-width: 180px; max-height: 250px; overflow-y: auto; z-index: 100; margin-top: 4px; box-shadow: 0 4px 12px rgba(0,0,0,0.4);">
        <div style="padding: 8px 10px; border-bottom: 1px solid #3c3c3c; display: flex; gap: 8px;">
          <button onclick="selectAllFilter('${id}')" style="background: #0e639c; border: none; color: white; padding: 4px 8px; border-radius: 3px; cursor: pointer; font-size: 11px;">All</button>
          <button onclick="clearFilter('${id}')" style="background: #3c3c3c; border: none; color: #cccccc; padding: 4px 8px; border-radius: 3px; cursor: pointer; font-size: 11px;">Clear</button>
        </div>
        <div class="filter-options" data-filter="${id}">
          ${options}
        </div>
      </div>
    </div>
  `;
}

// 필터 드롭다운 토글
function toggleFilterDropdown(id) {
  const menu = document.getElementById(`filter-menu-${id}`);
  const isVisible = menu.style.display === 'block';

  // 모든 메뉴 닫기
  document.querySelectorAll('.filter-menu').forEach(m => m.style.display = 'none');

  if (!isVisible) {
    menu.style.display = 'block';
  }
}

// 전체 선택
function selectAllFilter(id) {
  const options = document.querySelector(`.filter-options[data-filter="${id}"]`);
  options.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = true);
  applyFilters();
}

// 필터 해제
function clearFilter(id) {
  const options = document.querySelector(`.filter-options[data-filter="${id}"]`);
  options.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
  applyFilters();
}

// TC 행 렌더링
function renderTCRows(rows) {
  return rows.map(row => {
    const tcId = row['TC_ID'] || row['ID'] || Object.values(row)[0] || '';
    const module = row['Module_Group'] || row['Module'] || '';
    const implGroup = row['Impl_Group'] || '';
    const automation = row['Automation'] || '';

    // Test Methods 수집
    const testMethods = Object.keys(row)
      .filter(key => key.startsWith('TM_') && (row[key] === 'Y' || row[key] === 'True' || row[key] === 'TRUE' || row[key] === '1'))
      .map(key => key.replace('TM_', ''))
      .join(', ');

    return `
      <tr class="tc-row" data-tcid="${tcId}" data-module="${module}" data-impl="${implGroup}" data-automation="${automation}" data-methods="${testMethods}" style="border-bottom: 1px solid #2d2d2d;">
        <td style="padding: 10px 12px;"><span onclick="openTestcaseFile('${tcId}')" style="color: #4fc3f7; cursor: pointer; text-decoration: underline;">${tcId}</span></td>
        <td style="padding: 10px 12px; color: #cccccc;">${module}</td>
        <td style="padding: 10px 12px; color: #cccccc;">${implGroup}</td>
        <td style="padding: 10px 12px;"><span style="background: ${automation.toUpperCase().includes('Y') ? '#2e7d32' : '#616161'}; padding: 2px 8px; border-radius: 3px; font-size: 11px;">${automation}</span></td>
        <td style="padding: 10px 12px; color: #858585; font-size: 12px;">${testMethods}</td>
      </tr>
    `;
  }).join('');
}

// 필터 이벤트 설정
let currentFilteredRows = [];
function setupFilterEvents(originalRows) {
  currentFilteredRows = originalRows;

  // 체크박스 변경 이벤트
  document.querySelectorAll('.filter-options input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => applyFilters());
  });

  // 외부 클릭 시 드롭다운 닫기
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.filter-dropdown')) {
      document.querySelectorAll('.filter-menu').forEach(m => m.style.display = 'none');
    }
  });
}

// 필터 적용
function applyFilters() {
  const tab = openTabs[activeTabIndex];
  if (!tab || tab.type !== 'categoryViewer') return;

  const rows = tab.excelData.rows;

  // 선택된 필터 수집
  const filters = {
    automation: [...document.querySelectorAll('.filter-options[data-filter="automation"] input:checked')].map(cb => cb.value),
    module: [...document.querySelectorAll('.filter-options[data-filter="module"] input:checked')].map(cb => cb.value),
    implGroup: [...document.querySelectorAll('.filter-options[data-filter="implGroup"] input:checked')].map(cb => cb.value),
    testMethod: [...document.querySelectorAll('.filter-options[data-filter="testMethod"] input:checked')].map(cb => cb.value)
  };

  // 필터링
  const filteredRows = rows.filter(row => {
    // Automation 필터
    if (filters.automation.length > 0) {
      const automation = (row['Automation'] || '').toUpperCase();
      const matches = filters.automation.some(f => {
        if (f === 'Y') return automation.includes('Y');
        if (f === 'N') return !automation.includes('Y');
        return true;
      });
      if (!matches) return false;
    }

    // Module 필터
    if (filters.module.length > 0) {
      const module = row['Module_Group'] || row['Module'] || '';
      if (!filters.module.includes(module)) return false;
    }

    // Impl Group 필터
    if (filters.implGroup.length > 0) {
      const implGroup = row['Impl_Group'] || '';
      if (!filters.implGroup.includes(implGroup)) return false;
    }

    // Test Method 필터
    if (filters.testMethod.length > 0) {
      const hasMethod = filters.testMethod.some(method => {
        const key = `TM_${method}`;
        return row[key] === 'Y' || row[key] === 'True' || row[key] === 'TRUE' || row[key] === '1';
      });
      if (!hasMethod) return false;
    }

    return true;
  });

  // 결과 업데이트
  document.getElementById('filteredCount').textContent = filteredRows.length;
  document.getElementById('tcListBody').innerHTML = renderTCRows(filteredRows);

  // 활성 필터 표시
  updateActiveFilters(filters);
}

// 활성 필터 표시
function updateActiveFilters(filters) {
  const container = document.getElementById('activeFilters');
  if (!container) return;

  const tags = [];

  Object.entries(filters).forEach(([key, values]) => {
    values.forEach(value => {
      tags.push(`
        <span style="background: #0e639c; color: white; padding: 4px 10px; border-radius: 12px; font-size: 11px; display: flex; align-items: center; gap: 6px;">
          ${key}: ${value}
          <span onclick="removeFilter('${key}', '${value}')" style="cursor: pointer; opacity: 0.7;">×</span>
        </span>
      `);
    });
  });

  container.innerHTML = tags.join('');
}

// 필터 제거
function removeFilter(filterType, value) {
  const selector = `.filter-options[data-filter="${filterType}"] input[value="${value}"]`;
  const checkbox = document.querySelector(selector);
  if (checkbox) {
    checkbox.checked = false;
    applyFilters();
  }
}

// 이름 변경 (컨텍스트 메뉴에서 호출)
function renameItem() {
  // 값을 먼저 저장
  const targetPath = contextMenuTargetPath;
  const targetName = contextMenuTargetName;
  const isFolder = contextMenuTargetIsFolder;

  hideContextMenu();

  if (!targetPath || !targetName) return;

  startInlineRename(targetPath, targetName, isFolder);
}

// 인라인 이름 변경 시작 (파일/폴더 공용)
function startInlineRename(itemPath, itemName, isFolder = false) {
  // 해당 요소 찾기
  let element;
  if (isFolder) {
    element = document.querySelector(`.tree-item.folder[data-path="${CSS.escape(itemPath)}"]`);
  } else {
    element = document.querySelector(`.tree-item.file[data-file="${CSS.escape(itemPath)}"]`);
  }
  if (!element) return;

  const labelElement = element.querySelector('.tree-item-label');
  if (!labelElement) return;

  // 기존 라벨을 입력 필드로 교체
  const originalText = labelElement.textContent;
  const input = document.createElement('input');
  input.type = 'text';
  input.value = originalText;
  input.className = 'inline-rename-input';
  input.style.cssText = `
    background: #3c3c3c;
    border: 1px solid #007acc;
    color: #cccccc;
    font-size: 13px;
    padding: 1px 4px;
    outline: none;
    width: 100%;
    min-width: 50px;
  `;

  labelElement.style.display = 'none';
  element.appendChild(input);
  input.focus();

  // 파일이면 확장자 앞까지 선택, 폴더는 전체 선택
  if (!isFolder) {
    const dotIndex = originalText.lastIndexOf('.');
    if (dotIndex > 0) {
      input.setSelectionRange(0, dotIndex);
    } else {
      input.select();
    }
  } else {
    input.select();
  }

  // 이름 변경 완료 처리
  const finishRename = async () => {
    const newName = input.value.trim();
    input.remove();
    labelElement.style.display = '';

    if (!newName || newName === originalText) return;

    try {
      const dirPath = itemPath.substring(0, itemPath.lastIndexOf('\\'));
      const newPath = dirPath + '\\' + newName;

      const result = await window.electronAPI.fs.rename(itemPath, newPath);

      if (result.success) {
        // 선택된 항목 정보 업데이트
        if (selectedItemPath === itemPath) {
          selectedItemPath = newPath;
          selectedItemName = newName;
        }

        // 파일인 경우 열려있는 탭 업데이트
        if (!isFolder) {
          const tabIndex = openTabs.findIndex(tab => tab.filePath === itemPath);
          if (tabIndex !== -1) {
            openTabs[tabIndex].filePath = newPath;
            openTabs[tabIndex].fileName = newName;
            renderTabs();
          }
        }

        // Explorer 새로고침
        await refreshExplorer();
      } else {
        showToast('error', 'Failed to rename: ' + (result.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('Error renaming:', error);
      showToast('error', 'Failed to rename');
    }
  };

  // Enter로 완료
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      finishRename();
    }
    // ESC로 취소
    if (e.key === 'Escape') {
      e.preventDefault();
      input.remove();
      labelElement.style.display = '';
    }
  });

  // 포커스 잃으면 완료
  input.addEventListener('blur', () => {
    // 약간의 딜레이 후 처리 (다른 이벤트와 충돌 방지)
    setTimeout(() => {
      if (input.parentNode) {
        finishRename();
      }
    }, 100);
  });
}

// 삭제 확인 다이얼로그 표시
let pendingDeleteItems = null;
let pendingDeleteCallback = null;

function showDeleteConfirmation(items, onConfirm) {
  const overlay = document.getElementById('deleteConfirmOverlay');
  const header = document.getElementById('deleteConfirmHeader');
  const body = document.getElementById('deleteConfirmBody');
  const confirmBtn = document.getElementById('deleteConfirmBtn');
  const cancelBtn = document.getElementById('deleteCancelBtn');

  // 메시지 구성
  const hasFolders = items.some(item => item.isFolder);
  const itemCount = items.length;

  if (itemCount === 1) {
    const item = items[0];
    if (item.isFolder) {
      header.textContent = 'Delete Folder';
      body.innerHTML = `Are you sure you want to delete the folder <strong>"${item.name}"</strong> and all its contents?<br><br>This action cannot be undone.`;
    } else {
      header.textContent = 'Delete File';
      body.innerHTML = `Are you sure you want to delete <strong>"${item.name}"</strong>?`;
    }
  } else {
    header.textContent = 'Delete Multiple Items';
    if (hasFolders) {
      body.innerHTML = `Are you sure you want to delete <strong>${itemCount} items</strong> (including folders and their contents)?<br><br>This action cannot be undone.`;
    } else {
      body.innerHTML = `Are you sure you want to delete <strong>${itemCount} files</strong>?`;
    }
  }

  pendingDeleteItems = items;
  pendingDeleteCallback = onConfirm;

  // 이벤트 리스너 (기존 것 제거 후 추가)
  const newConfirmBtn = confirmBtn.cloneNode(true);
  const newCancelBtn = cancelBtn.cloneNode(true);
  confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
  cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);

  newConfirmBtn.addEventListener('click', () => {
    const callback = pendingDeleteCallback;
    hideDeleteConfirmation();
    if (callback) {
      callback();
    }
  });

  newCancelBtn.addEventListener('click', hideDeleteConfirmation);

  overlay.classList.add('show');
}

function hideDeleteConfirmation() {
  const overlay = document.getElementById('deleteConfirmOverlay');
  overlay.classList.remove('show');
  pendingDeleteItems = null;
  pendingDeleteCallback = null;
}

// 선택된 아이템들 삭제 (다중 선택 지원)
async function deleteSelectedItems(items) {
  if (!items || items.length === 0) return;

  const hasFolders = items.some(item => item.isFolder);

  // 폴더가 포함된 경우 확인 다이얼로그 표시
  if (hasFolders) {
    showDeleteConfirmation(items, async () => {
      await performDelete(items);
    });
  } else {
    // 파일만 있는 경우 바로 삭제
    await performDelete(items);
  }
}

// 실제 삭제 수행
async function performDelete(items) {
  for (const item of items) {
    await deleteItemByPath(item.path, item.isFolder);
  }
  // 다중 선택 초기화
  clearMultiSelection();
}

// 삭제 (컨텍스트 메뉴에서 호출)
async function deleteItem() {
  // 값을 먼저 저장
  const targetPath = contextMenuTargetPath;
  const isFolder = contextMenuTargetIsFolder;
  const targetName = contextMenuTargetName;

  hideContextMenu();

  if (!targetPath) return;

  // 다중 선택된 아이템이 있으면 다중 삭제
  const multiItems = getSelectedItems();
  if (multiItems.length > 1) {
    await deleteSelectedItems(multiItems);
  } else {
    // 단일 아이템 삭제
    const item = { path: targetPath, name: targetName, isFolder };
    if (isFolder) {
      // 폴더는 확인 다이얼로그 표시
      showDeleteConfirmation([item], async () => {
        await deleteItemByPath(targetPath, isFolder);
      });
    } else {
      await deleteItemByPath(targetPath, isFolder);
    }
  }
}

// 경로로 파일/폴더 삭제
async function deleteItemByPath(itemPath, isFolder = false) {
  try {
    let result;
    if (isFolder) {
      result = await window.electronAPI.fs.deleteFolder(itemPath);
    } else {
      result = await window.electronAPI.fs.delete(itemPath);
    }

    if (result.success) {
      // 선택 정보 초기화
      if (selectedItemPath === itemPath) {
        selectedItemPath = null;
        selectedItemName = null;
        selectedItemIsFolder = false;
      }

      // 파일인 경우 열려있는 탭 닫기
      if (!isFolder) {
        const tabIndex = openTabs.findIndex(tab => tab.filePath === itemPath);
        if (tabIndex !== -1) {
          openTabs.splice(tabIndex, 1);
          if (activeTabIndex >= openTabs.length) {
            activeTabIndex = openTabs.length - 1;
          }
          renderTabs();
          if (activeTabIndex >= 0) {
            renderActiveTabContent();
          } else {
            showWelcomeScreen();
          }
        }
      } else {
        // 폴더 삭제 시 해당 폴더 내 파일들의 탭도 닫기
        const tabsToClose = openTabs.filter(tab => tab.filePath && tab.filePath.startsWith(itemPath + '\\'));
        for (const tab of tabsToClose) {
          const tabIndex = openTabs.indexOf(tab);
          if (tabIndex !== -1) {
            openTabs.splice(tabIndex, 1);
          }
        }
        if (activeTabIndex >= openTabs.length) {
          activeTabIndex = openTabs.length - 1;
        }
        renderTabs();
        if (activeTabIndex >= 0) {
          renderActiveTabContent();
        } else {
          showWelcomeScreen();
        }
      }

      // Explorer 새로고침
      await refreshExplorer();
    } else {
      const itemType = isFolder ? 'folder' : 'file';
      showToast('error', `Failed to delete ${itemType}: ` + (result.error || 'Unknown error'));
    }
  } catch (error) {
    console.error('Error deleting:', error);
    showToast('error', 'Failed to delete');
  }
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

    // Refresh 버튼 클릭은 무시
    if (event.target.closest('.explorer-refresh-btn')) return;

    const isFolder = treeItem.dataset.type === 'folder';

    if (isFolder) {
      toggleFolder(treeItem, event);
    } else {
      selectFile(treeItem, event);
    }
  });

  // 더블클릭 이벤트 (엑셀 파일용)
  explorer.addEventListener('dblclick', (event) => {
    const treeItem = event.target.closest('.tree-item');
    if (!treeItem) return;

    const isFolder = treeItem.dataset.type === 'folder';
    if (isFolder) return;

    const filePath = treeItem.dataset.file;
    if (filePath && isExcelFile(filePath)) {
      openWithDefaultProgram(filePath);
    }
  });
}

// 엑셀 파일인지 확인
function isExcelFile(filePath) {
  const ext = filePath.toLowerCase();
  return ext.endsWith('.xlsx') || ext.endsWith('.xls') || ext.endsWith('.xlsm');
}

// 기본 프로그램으로 파일 열기
async function openWithDefaultProgram(filePath) {
  try {
    await window.electronAPI.shell.openPath(filePath);
  } catch (error) {
    console.error('Failed to open file:', error);
    showToast('error', 'Failed to open file with default program');
  }
}

// 다중 선택 초기화
function clearMultiSelection() {
  multiSelectedItems.clear();
  document.querySelectorAll('.tree-item.multi-selected').forEach(item => {
    item.classList.remove('multi-selected');
  });
}

// 다중 선택에 아이템 추가/제거
function toggleMultiSelectItem(element, path, name, isFolder) {
  const itemKey = path;
  const existingItem = [...multiSelectedItems].find(item => item.path === path);

  if (existingItem) {
    multiSelectedItems.delete(existingItem);
    element.classList.remove('multi-selected');
  } else {
    multiSelectedItems.add({ path, name, isFolder, element });
    element.classList.add('multi-selected');
  }
}

// 범위 선택 (Shift)
function rangeSelectItems(fromPath, toPath) {
  const allItems = document.querySelectorAll('.tree-item.file, .tree-item.folder:not(.root)');
  let inRange = false;
  let foundStart = false;
  let foundEnd = false;

  allItems.forEach(item => {
    const itemPath = item.dataset.file || item.dataset.path;
    if (!itemPath) return;

    if (itemPath === fromPath || itemPath === toPath) {
      if (!foundStart) {
        foundStart = true;
        inRange = true;
      } else {
        foundEnd = true;
      }
    }

    if (inRange) {
      const name = item.querySelector('.tree-item-label')?.textContent || '';
      const isFolder = item.dataset.type === 'folder';
      const existingItem = [...multiSelectedItems].find(i => i.path === itemPath);
      if (!existingItem) {
        multiSelectedItems.add({ path: itemPath, name, isFolder, element: item });
        item.classList.add('multi-selected');
      }
    }

    if (foundEnd) {
      inRange = false;
    }
  });
}

// 현재 선택된 아이템들 가져오기 (단일 선택 포함)
function getSelectedItems() {
  if (multiSelectedItems.size > 0) {
    return [...multiSelectedItems];
  } else if (selectedItemPath) {
    return [{ path: selectedItemPath, name: selectedItemName, isFolder: selectedItemIsFolder }];
  }
  return [];
}

// 폴더 토글 (확장/축소)
function toggleFolder(folderElement, event = null) {
  const folderName = folderElement.dataset.name;
  const folderPath = folderElement.dataset.path;
  const childrenContainer = document.getElementById(`${folderName}-children`);
  const chevron = folderElement.querySelector('.chevron');
  const itemName = folderElement.querySelector('.tree-item-label')?.textContent || folderName;

  // 폴더 선택 상태 저장 (Delete/F2 키용) - 루트 폴더 제외
  if (folderPath && !folderElement.classList.contains('root')) {
    const ctrlKey = event?.ctrlKey || event?.metaKey;
    const shiftKey = event?.shiftKey;

    if (ctrlKey) {
      // Ctrl+클릭: 다중 선택 토글
      toggleMultiSelectItem(folderElement, folderPath, itemName, true);
    } else if (shiftKey && lastClickedItemPath) {
      // Shift+클릭: 범위 선택
      rangeSelectItems(lastClickedItemPath, folderPath);
    } else {
      // 일반 클릭: 단일 선택
      clearMultiSelection();
      document.querySelectorAll('.tree-item.file').forEach(item => {
        item.classList.remove('selected');
      });
      document.querySelectorAll('.tree-item.folder').forEach(item => {
        item.classList.remove('selected');
      });
      folderElement.classList.add('selected');
      selectedItemPath = folderPath;
      selectedItemName = itemName;
      selectedItemIsFolder = true;
    }

    lastClickedItemPath = folderPath;
  }

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
function selectFile(fileElement, event = null) {
  const filePath = fileElement.dataset.file;
  const fileName = window.electronAPI.fs.path.basename(filePath);
  const ctrlKey = event?.ctrlKey || event?.metaKey;
  const shiftKey = event?.shiftKey;

  if (ctrlKey) {
    // Ctrl+클릭: 다중 선택 토글
    toggleMultiSelectItem(fileElement, filePath, fileName, false);
  } else if (shiftKey && lastClickedItemPath) {
    // Shift+클릭: 범위 선택
    rangeSelectItems(lastClickedItemPath, filePath);
  } else {
    // 일반 클릭: 단일 선택
    clearMultiSelection();
    document.querySelectorAll('.tree-item.file').forEach(item => {
      item.classList.remove('selected');
    });
    document.querySelectorAll('.tree-item.folder').forEach(item => {
      item.classList.remove('selected');
    });

    fileElement.classList.add('selected');
    selectedItemPath = filePath;
    selectedItemName = fileName;
    selectedItemIsFolder = false;

    // 파일 열기 (Ctrl/Shift 없이 클릭할 때만, 엑셀 파일 제외)
    if (!isExcelFile(filePath)) {
      openFileInEditor(filePath);
    }
  }

  lastClickedItemPath = filePath;
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

  // 파일 감시 시작
  window.electronAPI.fileWatch.start(filePath).then(result => {
    if (result.success) {
      console.log('Started watching file:', filePath);
    }
  });

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

  // Chat 첨부 파일 목록 업데이트
  updateChatAttachments();
}

// Chat 첨부 파일 목록 업데이트 (열린 탭 파일들)
function updateChatAttachments() {
  const container = document.getElementById('chatAttachments');
  if (!container) return;

  // 실제 파일만 필터링 (testcase-sync, configuration 등 제외)
  const fileTabs = openTabs.filter(tab =>
    tab.filePath && !tab.filePath.startsWith('__') && tab.type !== 'categorize' && tab.type !== 'categoryViewer'
  );

  if (fileTabs.length === 0) {
    container.innerHTML = '<span style="color: #6e6e6e; font-size: 11px;">No files open</span>';
    return;
  }

  container.innerHTML = fileTabs.map((tab, idx) => {
    const originalIndex = openTabs.indexOf(tab);
    const isChecked = tab.chatAttached ? 'checked' : '';
    const checkedClass = tab.chatAttached ? 'checked' : '';
    return `
      <label class="chat-attachment-item ${checkedClass}" data-tab-index="${originalIndex}">
        <input type="checkbox" ${isChecked} onchange="toggleChatAttachment(${originalIndex}, this)">
        <i class="codicon codicon-file file-icon"></i>
        <span>${tab.fileName}</span>
      </label>
    `;
  }).join('');
}

// 첨부 파일 토글
function toggleChatAttachment(tabIndex, checkbox) {
  if (tabIndex >= 0 && tabIndex < openTabs.length) {
    openTabs[tabIndex].chatAttached = checkbox.checked;
    // 스타일 업데이트
    const label = checkbox.closest('.chat-attachment-item');
    if (label) {
      label.classList.toggle('checked', checkbox.checked);
    }
  }
}

// 첨부된 파일 내용 가져오기
function getAttachedFilesContent() {
  const attachedFiles = openTabs.filter(tab => tab.chatAttached && tab.content);
  if (attachedFiles.length === 0) return '';

  let content = '[Attached Files]\n';
  attachedFiles.forEach(tab => {
    content += `\n--- ${tab.fileName} ---\n`;
    content += tab.content;
    content += `\n--- End of ${tab.fileName} ---\n`;
  });
  return content + '\n';
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

  // 파일 감시 중지 (실제 파일인 경우에만)
  const tab = openTabs[index];
  if (tab.filePath && !tab.filePath.startsWith('__')) {
    window.electronAPI.fileWatch.stop(tab.filePath).then(result => {
      if (result.success) {
        console.log('Stopped watching file:', tab.filePath);
      }
    });
  }

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
  } else if (tab.type === 'configuration') {
    renderConfiguration();
  } else if (tab.type === 'categorize') {
    renderCategorize(tab.folderPath, tab.folderName);
  } else if (tab.type === 'categoryViewer') {
    renderCategoryViewer(tab);
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
      mouseWheelZoom: true,  // Ctrl+휠로 글자 크기 조정
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

    // 기존 Chat 히스토리 파일들 삭제 (잔재 정리)
    try {
      await window.electronAPI.fs.delete(folderPath + '/.vvu.prompt.history.md');
      console.log('Deleted old .vvu.prompt.history.md');
    } catch (error) { /* 파일이 없으면 무시 */ }
    try {
      await window.electronAPI.fs.delete(folderPath + '/.vvu.prompt.last.md');
      console.log('Deleted old .vvu.prompt.last.md');
    } catch (error) { /* 파일이 없으면 무시 */ }

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

    // Configuration 메뉴 활성화
    enableConfigurationMenu();
  }
}

// Configuration 메뉴 활성화
function enableConfigurationMenu() {
  const configMenuItem = document.getElementById('configMenuItem');
  if (configMenuItem) {
    configMenuItem.style.color = '#cccccc';
    configMenuItem.style.pointerEvents = 'auto';
  }
}

// Configuration 메뉴 비활성화
function disableConfigurationMenu() {
  const configMenuItem = document.getElementById('configMenuItem');
  if (configMenuItem) {
    configMenuItem.style.color = '#6e6e6e';
    configMenuItem.style.pointerEvents = 'none';
  }
}

// 메뉴에서 폴더 열기
function openFolderFromMenu(event) {
  if (event) event.stopPropagation();
  closeAllMenus();
  openFolder();
}

// 메뉴 상태 관리
let menuOpen = false;
let activeMenuId = null;

// 모든 드롭다운 메뉴 닫기
function closeAllMenus() {
  document.querySelectorAll('.dropdown-menu').forEach(menu => {
    menu.classList.remove('show');
  });
  menuOpen = false;
  activeMenuId = null;
}

// 특정 메뉴 열기
function openMenu(menuId) {
  closeAllMenus();
  const dropdown = document.getElementById(menuId + 'Dropdown');
  if (dropdown) {
    dropdown.classList.add('show');
    menuOpen = true;
    activeMenuId = menuId;
  }
}

// 메뉴 토글 (클릭)
function toggleMenu(menuId, event) {
  event.stopPropagation();

  if (activeMenuId === menuId && menuOpen) {
    closeAllMenus();
  } else {
    openMenu(menuId);

    // 다른 곳 클릭하면 닫기
    const closeOnClick = (e) => {
      if (!e.target.closest('.menu-with-dropdown')) {
        closeAllMenus();
        document.removeEventListener('click', closeOnClick);
      }
    };
    setTimeout(() => document.addEventListener('click', closeOnClick), 0);
  }
}

// 메뉴 호버 (마우스 이동)
function hoverMenu(menuId, event) {
  // 다른 메뉴가 열려있을 때만 호버로 전환
  if (menuOpen && activeMenuId !== menuId) {
    openMenu(menuId);
  }
}

// Testcase Sync 열기
function openTestcaseSync(event) {
  if (event) event.stopPropagation();

  // 드롭다운 닫기
  closeAllMenus();

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

// Categorize 진행 상태
let categorizeRunning = false;
let categorizeFolderPath = null;
let categorizeProcessId = null;

// Categorize 화면 렌더링
function renderCategorize(folderPath, folderName) {
  const editorArea = document.querySelector('.editor-area');
  categorizeFolderPath = folderPath;

  editorArea.innerHTML = `
    <div class="categorize-view" style="padding: 40px 60px; font-family: 'Segoe UI', sans-serif; max-width: 600px;">
      <h1 style="font-size: 28px; font-weight: 600; margin-bottom: 8px; color: #cccccc;">Categorize</h1>
      <p style="font-size: 14px; color: #858585; margin-bottom: 32px;">Categorize testcases in <strong style="color: #cccccc;">${escapeHtml(folderName)}</strong></p>

      <!-- 옵션 선택 -->
      <div class="categorize-section" style="margin-bottom: 32px;">
        <h2 style="font-size: 14px; font-weight: 600; color: #cccccc; margin-bottom: 16px; text-transform: uppercase; letter-spacing: 0.5px;">
          <i class="codicon codicon-settings" style="margin-right: 8px; color: #007acc;"></i>
          Options
        </h2>
        <div style="background: #2d2d2d; border-radius: 4px; padding: 16px; border: 1px solid #454545;">
          <label class="categorize-option" style="display: flex; align-items: center; padding: 10px 0; cursor: pointer; border-bottom: 1px solid #3c3c3c;">
            <input type="checkbox" id="catOptAutomation" style="width: 18px; height: 18px; margin-right: 12px; accent-color: #007acc;">
            <div>
              <div style="font-size: 14px; color: #cccccc;">Automation Status</div>
              <div style="font-size: 12px; color: #858585; margin-top: 2px;">Categorize by automation status (Automated, Manual, Not Automatable)</div>
            </div>
          </label>
          <label class="categorize-option" style="display: flex; align-items: center; padding: 10px 0; cursor: pointer; border-bottom: 1px solid #3c3c3c;">
            <input type="checkbox" id="catOptModule" style="width: 18px; height: 18px; margin-right: 12px; accent-color: #007acc;">
            <div>
              <div style="font-size: 14px; color: #cccccc;">Module Classification</div>
              <div style="font-size: 12px; color: #858585; margin-top: 2px;">Categorize by module or component</div>
            </div>
          </label>
          <label class="categorize-option" style="display: flex; align-items: center; padding: 10px 0; cursor: pointer; border-bottom: 1px solid #3c3c3c;">
            <input type="checkbox" id="catOptTestMethod" style="width: 18px; height: 18px; margin-right: 12px; accent-color: #007acc;">
            <div>
              <div style="font-size: 14px; color: #cccccc;">Test Method</div>
              <div style="font-size: 12px; color: #858585; margin-top: 2px;">Categorize by test method (Unit, Integration, System, etc.)</div>
            </div>
          </label>
          <label class="categorize-option" style="display: flex; align-items: center; padding: 10px 0; cursor: pointer;">
            <input type="checkbox" id="catOptImplType" style="width: 18px; height: 18px; margin-right: 12px; accent-color: #007acc;">
            <div>
              <div style="font-size: 14px; color: #cccccc;">Implementation Type</div>
              <div style="font-size: 12px; color: #858585; margin-top: 2px;">Categorize by implementation type (Positive, Negative, Boundary, etc.)</div>
            </div>
          </label>
        </div>
      </div>

      <!-- 진행 상태 -->
      <div class="categorize-section" style="margin-bottom: 32px;">
        <h2 style="font-size: 14px; font-weight: 600; color: #cccccc; margin-bottom: 16px; text-transform: uppercase; letter-spacing: 0.5px;">
          <i class="codicon codicon-sync" style="margin-right: 8px; color: #007acc;"></i>
          Progress
        </h2>
        <div style="background: #2d2d2d; border-radius: 4px; padding: 16px; border: 1px solid #454545;">
          <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
            <span id="catProgressText" style="font-size: 13px; color: #cccccc;">Ready to start</span>
            <span id="catProgressPercent" style="font-size: 13px; color: #858585;">0%</span>
          </div>
          <div style="background: #1e1e1e; border-radius: 4px; height: 8px; overflow: hidden;">
            <div id="catProgressBar" style="background: #007acc; height: 100%; width: 0%; transition: width 0.3s ease;"></div>
          </div>
          <div id="catCurrentFile" style="margin-top: 12px; font-size: 12px; color: #858585; min-height: 18px;"></div>
        </div>
      </div>

      <!-- 시작 버튼 -->
      <div style="display: flex; gap: 12px;">
        <button id="catStartBtn" onclick="startCategorize()" style="padding: 12px 32px; background: #0e639c; border: none; border-radius: 4px; color: white; cursor: pointer; font-size: 14px; font-weight: 500; display: flex; align-items: center; gap: 8px;">
          <i class="codicon codicon-play"></i>
          Start
        </button>
        <button id="catStopBtn" onclick="stopCategorize()" style="padding: 12px 24px; background: #5a5a5a; border: none; border-radius: 4px; color: white; cursor: pointer; font-size: 14px; display: none; align-items: center; gap: 8px;">
          <i class="codicon codicon-debug-stop"></i>
          Stop
        </button>
      </div>
    </div>
  `;
}

// Categorize 진행률 업데이트
function updateCategorizeProgress(percent, text) {
  const progressBar = document.getElementById('catProgressBar');
  const progressText = document.getElementById('catProgressText');
  const progressPercent = document.getElementById('catProgressPercent');

  if (progressBar) progressBar.style.width = percent + '%';
  if (progressText) progressText.textContent = text;
  if (progressPercent) progressPercent.textContent = percent + '%';
}

// Categorize 시작
async function startCategorize() {
  const options = {
    automation: document.getElementById('catOptAutomation')?.checked,
    module: document.getElementById('catOptModule')?.checked,
    testMethod: document.getElementById('catOptTestMethod')?.checked,
    implType: document.getElementById('catOptImplType')?.checked
  };

  if (!options.automation && !options.module && !options.testMethod && !options.implType) {
    showToast('warning', 'Please select at least one option.');
    return;
  }

  if (!categorizeFolderPath) {
    showToast('error', 'No folder selected for categorization.');
    return;
  }

  categorizeRunning = true;

  const startBtn = document.getElementById('catStartBtn');
  const stopBtn = document.getElementById('catStopBtn');
  const currentFileEl = document.getElementById('catCurrentFile');
  if (startBtn) startBtn.style.display = 'none';
  if (stopBtn) stopBtn.style.display = 'flex';

  updateCategorizeProgress(0, 'Starting...');
  appendOutput('=== Categorizer Started ===', 'info');
  appendOutput(`Target folder: ${categorizeFolderPath}`, 'info');

  try {
    // Python 스크립트 경로
    const projectRoot = await window.electronAPI.getProjectRoot();
    const scriptPath = projectRoot + '/scripts/categorizer.py';
    const optionsJson = JSON.stringify(options);

    appendOutput(`Options: ${optionsJson}`, 'info');

    // Python 스크립트 실행 (스트리밍 모드)
    const result = await window.electronAPI.python.runStreaming(scriptPath, [categorizeFolderPath, optionsJson]);
    categorizeProcessId = result.processId;

    // 출력 핸들러 설정
    window.electronAPI.python.onOutput((data) => {
      if (data.processId !== categorizeProcessId) return;

      const lines = data.data.split('\n');
      for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine) continue;

        // OUTPUT에 로그 출력
        if (data.isError) {
          appendOutput(trimmedLine, 'error');
        } else if (trimmedLine.startsWith('PROGRESS:')) {
          const progress = trimmedLine.substring(9);
          const [current, total] = progress.split('/').map(Number);
          const percent = Math.round((current / total) * 100);
          updateCategorizeProgress(percent, `Processing ${current}/${total}`);
          if (currentFileEl) currentFileEl.textContent = `Analyzing testcase ${current} of ${total}...`;
        } else if (trimmedLine.startsWith('COMPLETE:')) {
          const outputPath = trimmedLine.substring(9);
          updateCategorizeProgress(100, 'Completed!');
          if (currentFileEl) currentFileEl.textContent = `Output: ${outputPath}`;
          appendOutput(`Excel file created: ${outputPath}`, 'success');
          showToast('success', 'Categorization completed! Excel file created.');
          // Explorer 새로고침
          refreshExplorer();
        } else if (trimmedLine.startsWith('Found ')) {
          if (currentFileEl) currentFileEl.textContent = trimmedLine;
          appendOutput(trimmedLine, 'info');
        } else {
          // 기타 출력
          appendOutput(trimmedLine, 'info');
        }
      }
    });

    // 종료 핸들러
    window.electronAPI.python.onExit((data) => {
      if (data.processId !== categorizeProcessId) return;

      categorizeRunning = false;
      categorizeProcessId = null;

      if (startBtn) startBtn.style.display = 'flex';
      if (stopBtn) stopBtn.style.display = 'none';

      if (data.code !== 0 && data.error) {
        showToast('error', 'Categorization failed: ' + data.error);
        updateCategorizeProgress(0, 'Failed');
        appendOutput(`Categorization failed: ${data.error}`, 'error');
      } else if (data.code === 0) {
        appendOutput('=== Categorizer Finished ===', 'success');
      }
    });

  } catch (error) {
    console.error('Error starting categorizer:', error);
    showToast('error', 'Failed to start categorization: ' + error.message);
    appendOutput(`Error: ${error.message}`, 'error');
    categorizeRunning = false;
    if (startBtn) startBtn.style.display = 'flex';
    if (stopBtn) stopBtn.style.display = 'none';
  }
}

// Categorize 중지
async function stopCategorize() {
  if (categorizeProcessId) {
    await window.electronAPI.python.kill(categorizeProcessId);
    categorizeProcessId = null;
  }

  categorizeRunning = false;
  updateCategorizeProgress(0, 'Stopped');

  const startBtn = document.getElementById('catStartBtn');
  const stopBtn = document.getElementById('catStopBtn');
  const currentFileEl = document.getElementById('catCurrentFile');
  if (startBtn) startBtn.style.display = 'flex';
  if (stopBtn) stopBtn.style.display = 'none';
  if (currentFileEl) currentFileEl.textContent = '';
}

// Testcase Sync 진행 상태
let tcSyncRunning = false;
let currentPythonProcessId = null;

// Testcase Sync 화면 렌더링
async function renderTestcaseSync() {
  const editorArea = document.querySelector('.editor-area');

  // 설정에서 Excel 경로 불러오기
  const config = await loadConfiguration();
  const excelPath = config.excel?.syncPath || '';

  editorArea.innerHTML = `
    <div class="testcase-sync" style="padding: 40px 60px; font-family: 'Segoe UI', sans-serif; max-width: 600px;">
      <h1 style="font-size: 28px; font-weight: 600; margin-bottom: 8px; color: #cccccc;">Testcase Sync</h1>
      <p style="font-size: 14px; color: #858585; margin-bottom: 32px;">Import testcases from Excel and generate TC files.</p>

      <!-- Excel 파일 선택 -->
      <div class="tc-section" style="margin-bottom: 32px;">
        <h2 style="font-size: 14px; font-weight: 600; color: #cccccc; margin-bottom: 16px; text-transform: uppercase; letter-spacing: 0.5px;">
          <i class="codicon codicon-file" style="margin-right: 8px; color: #217346;"></i>
          Excel Source
        </h2>
        <div style="display: flex; gap: 8px; align-items: center;">
          <input type="text" id="tcExcelPath" value="${escapeHtml(excelPath)}" readonly
                 placeholder="Select an Excel file..."
                 style="flex: 1; padding: 10px 14px; background: #3c3c3c; border: 1px solid #5a5a5a; border-radius: 4px; color: #cccccc; font-size: 13px; outline: none;">
          <button onclick="selectTcExcelFile()" style="padding: 10px 20px; background: #0e639c; border: none; border-radius: 4px; color: white; cursor: pointer; font-size: 13px; white-space: nowrap;">
            <i class="codicon codicon-folder-opened" style="margin-right: 6px;"></i>Browse
          </button>
        </div>
      </div>

      <!-- 진행 상태 -->
      <div class="tc-section" style="margin-bottom: 32px;">
        <h2 style="font-size: 14px; font-weight: 600; color: #cccccc; margin-bottom: 16px; text-transform: uppercase; letter-spacing: 0.5px;">
          <i class="codicon codicon-sync" style="margin-right: 8px; color: #007acc;"></i>
          Progress
        </h2>
        <div style="background: #2d2d2d; border-radius: 4px; padding: 16px; border: 1px solid #454545;">
          <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
            <span id="tcProgressText" style="font-size: 13px; color: #cccccc;">Ready to start</span>
            <span id="tcProgressPercent" style="font-size: 13px; color: #858585;">0%</span>
          </div>
          <div style="background: #1e1e1e; border-radius: 4px; height: 8px; overflow: hidden;">
            <div id="tcProgressBar" style="background: #007acc; height: 100%; width: 0%; transition: width 0.3s ease;"></div>
          </div>
          <div id="tcCurrentFile" style="margin-top: 12px; font-size: 12px; color: #858585; min-height: 18px;"></div>
        </div>
      </div>

      <!-- 시작 버튼 -->
      <div style="display: flex; gap: 12px;">
        <button id="tcStartBtn" onclick="startTcSync()" style="padding: 12px 32px; background: #217346; border: none; border-radius: 4px; color: white; cursor: pointer; font-size: 14px; font-weight: 500; display: flex; align-items: center; gap: 8px;">
          <i class="codicon codicon-play"></i>
          Start Sync
        </button>
        <button id="tcStopBtn" onclick="stopTcSync()" style="padding: 12px 24px; background: #5a5a5a; border: none; border-radius: 4px; color: white; cursor: pointer; font-size: 14px; display: none; align-items: center; gap: 8px;">
          <i class="codicon codicon-debug-stop"></i>
          Stop
        </button>
      </div>
    </div>
  `;

  // 입력 필드 포커스 스타일
  const input = document.getElementById('tcExcelPath');
  if (input) {
    input.addEventListener('focus', () => input.style.borderColor = '#007acc');
    input.addEventListener('blur', () => input.style.borderColor = '#5a5a5a');
  }
}

// TC Sync용 Excel 파일 선택
async function selectTcExcelFile() {
  try {
    const filePath = await window.electronAPI.dialog.openFile({
      filters: [{ name: 'Excel Files', extensions: ['xlsx', 'xls'] }]
    });

    if (filePath) {
      // UI 업데이트
      const inputEl = document.getElementById('tcExcelPath');
      if (inputEl) {
        inputEl.value = filePath;
      }

      // 설정에 저장
      await saveTcExcelPath(filePath);
    }
  } catch (error) {
    console.error('Error selecting Excel file:', error);
  }
}

// TC Excel 경로를 설정에 저장
async function saveTcExcelPath(filePath) {
  if (!currentProjectPath) return;

  try {
    const config = await loadConfiguration();
    if (!config.excel) config.excel = {};
    config.excel.syncPath = filePath;

    const configPath = currentProjectPath + '\\.vvu.config';
    await window.electronAPI.fs.writeFile(configPath, JSON.stringify(config, null, 2));
  } catch (error) {
    console.error('Error saving TC Excel path:', error);
  }
}

// TC Sync 시작 (스트리밍 모드)
async function startTcSync() {
  const excelPath = document.getElementById('tcExcelPath')?.value;

  if (!excelPath) {
    showToast('error', 'Please select an Excel file first.');
    return;
  }

  if (!currentProjectPath) {
    showToast('error', 'Please open a folder first.');
    return;
  }

  tcSyncRunning = true;

  // UI 상태 변경
  const startBtn = document.getElementById('tcStartBtn');
  const stopBtn = document.getElementById('tcStopBtn');
  if (startBtn) startBtn.style.display = 'none';
  if (stopBtn) stopBtn.style.display = 'flex';

  updateTcProgress(0, 'Starting...');

  // Output 패널 열기
  if (!outputPanelVisible) {
    const panel = document.getElementById('bottomPanel');
    const checkmark = document.getElementById('outputCheckmark');
    panel.classList.add('show');
    if (checkmark) checkmark.textContent = '✓';
    outputPanelVisible = true;
  }
  switchBottomTab('output');

  // Python 스크립트 실행 (스트리밍 모드)
  appendOutput('Starting TC Sync...', 'info');
  appendOutput(`Excel: ${excelPath}`, 'info');
  appendOutput(`Output: ${currentProjectPath}\\testcase`, 'info');

  try {
    // 스트리밍 모드로 Python 실행
    const result = await window.electronAPI.python.runStreaming('scripts/tc_generator.py', [excelPath, currentProjectPath]);
    currentPythonProcessId = result.processId;
    // 이후 처리는 이벤트 리스너에서 수행 (handlePythonOutput, handlePythonExit)
  } catch (error) {
    console.error('TC Sync error:', error);
    appendOutput(`Error: ${error.message}`, 'error');
    updateTcProgress(0, 'Error');

    tcSyncRunning = false;
    currentPythonProcessId = null;

    // UI 상태 복원
    if (startBtn) startBtn.style.display = 'flex';
    if (stopBtn) stopBtn.style.display = 'none';
  }
}

// TC Sync 중지
async function stopTcSync() {
  if (currentPythonProcessId) {
    await window.electronAPI.python.kill(currentPythonProcessId);
    appendOutput('TC Sync stopped by user.', 'warning');
  }

  tcSyncRunning = false;
  currentPythonProcessId = null;
  updateTcProgress(0, 'Stopped');

  const startBtn = document.getElementById('tcStartBtn');
  const stopBtn = document.getElementById('tcStopBtn');
  if (startBtn) startBtn.style.display = 'flex';
  if (stopBtn) stopBtn.style.display = 'none';
}

// TC 진행률 업데이트
function updateTcProgress(percent, text) {
  const progressBar = document.getElementById('tcProgressBar');
  const progressText = document.getElementById('tcProgressText');
  const progressPercent = document.getElementById('tcProgressPercent');

  if (progressBar) progressBar.style.width = percent + '%';
  if (progressText) progressText.textContent = text;
  if (progressPercent) progressPercent.textContent = percent + '%';
}

// TC 현재 파일 표시
function updateTcCurrentFile(fileName) {
  const el = document.getElementById('tcCurrentFile');
  if (el) el.textContent = `Creating: ${fileName}`;
}

// Explorer에서 파일 하이라이트
async function highlightFileInExplorer(filePath) {
  // testcase 폴더 확장
  const testcaseFolder = document.querySelector('.tree-item.folder[data-name="testcase"]');
  if (testcaseFolder) {
    const childrenContainer = document.getElementById('testcase-children');
    if (childrenContainer && !childrenContainer.classList.contains('expanded')) {
      childrenContainer.classList.add('expanded');
      const chevron = testcaseFolder.querySelector('.chevron');
      if (chevron) chevron.classList.add('expanded');
    }
  }

  // 파일 선택
  const fileElement = document.querySelector(`.tree-item.file[data-file="${CSS.escape(filePath)}"]`);
  if (fileElement) {
    // 기존 선택 해제
    document.querySelectorAll('.tree-item.file').forEach(item => {
      item.classList.remove('selected');
    });

    // 새 파일 선택
    fileElement.classList.add('selected');
    selectedItemPath = filePath;
    selectedItemName = window.electronAPI.fs.path.basename(filePath);
    selectedItemIsFolder = false;

    // 스크롤하여 보이게
    fileElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

// Configuration 열기
function openConfiguration(event) {
  if (event) event.stopPropagation();

  // 드롭다운 닫기
  closeAllMenus();

  // 폴더가 열려있지 않으면 리턴
  if (!folderOpened || !currentProjectPath) {
    return;
  }

  // 이미 열려있는지 확인
  const existingTabIndex = openTabs.findIndex(tab => tab.filePath === '__configuration__');
  if (existingTabIndex !== -1) {
    switchToTab(existingTabIndex);
    return;
  }

  // 새 탭 추가
  openTabs.push({
    filePath: '__configuration__',
    fileName: 'Configuration',
    type: 'configuration',
    content: null,
    originalContent: null
  });

  activeTabIndex = openTabs.length - 1;
  renderTabs();
  renderConfiguration();
}

// Configuration 화면 렌더링
async function renderConfiguration() {
  const editorArea = document.querySelector('.editor-area');

  // 기존 설정 불러오기
  const config = await loadConfiguration();

  editorArea.innerHTML = `
    <div class="configuration-screen" style="padding: 40px 60px; font-family: 'Segoe UI', sans-serif; max-width: 600px;">
      <h1 style="font-size: 28px; font-weight: 600; margin-bottom: 8px; color: #cccccc;">Configuration</h1>
      <p style="font-size: 14px; color: #858585; margin-bottom: 32px;">Project settings for Virtual Validation Tools</p>

      <div style="display: flex; flex-direction: column; gap: 24px;">
        <!-- Codebeamer Settings -->
        <div class="config-section">
          <h2 style="font-size: 14px; font-weight: 600; color: #cccccc; margin-bottom: 16px; text-transform: uppercase; letter-spacing: 0.5px;">Codebeamer Settings</h2>

          <div class="config-field" style="margin-bottom: 16px;">
            <label style="display: block; font-size: 13px; color: #cccccc; margin-bottom: 6px;">Server URL</label>
            <input type="text" id="configCbUrl" value="${escapeHtml(config.codebeamer?.url || '')}"
                   placeholder="https://codebeamer.example.com"
                   style="width: 100%; padding: 8px 12px; background: #3c3c3c; border: 1px solid #5a5a5a; border-radius: 4px; color: #cccccc; font-size: 13px; outline: none;">
          </div>

          <div class="config-field" style="margin-bottom: 16px;">
            <label style="display: block; font-size: 13px; color: #cccccc; margin-bottom: 6px;">Username</label>
            <input type="text" id="configCbUsername" value="${escapeHtml(config.codebeamer?.username || '')}"
                   placeholder="your.username"
                   style="width: 100%; padding: 8px 12px; background: #3c3c3c; border: 1px solid #5a5a5a; border-radius: 4px; color: #cccccc; font-size: 13px; outline: none;">
          </div>

          <div class="config-field" style="margin-bottom: 16px;">
            <label style="display: block; font-size: 13px; color: #cccccc; margin-bottom: 6px;">Project ID</label>
            <input type="text" id="configCbProjectId" value="${escapeHtml(config.codebeamer?.projectId || '')}"
                   placeholder="12345"
                   style="width: 100%; padding: 8px 12px; background: #3c3c3c; border: 1px solid #5a5a5a; border-radius: 4px; color: #cccccc; font-size: 13px; outline: none;">
          </div>

          <div class="config-field" style="margin-bottom: 16px;">
            <label style="display: block; font-size: 13px; color: #cccccc; margin-bottom: 6px;">Tracker ID</label>
            <input type="text" id="configCbTrackerId" value="${escapeHtml(config.codebeamer?.trackerId || '')}"
                   placeholder="67890"
                   style="width: 100%; padding: 8px 12px; background: #3c3c3c; border: 1px solid #5a5a5a; border-radius: 4px; color: #cccccc; font-size: 13px; outline: none;">
          </div>
        </div>

        <!-- Excel Settings -->
        <div class="config-section">
          <h2 style="font-size: 14px; font-weight: 600; color: #cccccc; margin-bottom: 16px; text-transform: uppercase; letter-spacing: 0.5px;">Excel Settings</h2>

          <div class="config-field" style="margin-bottom: 16px;">
            <label style="display: block; font-size: 13px; color: #cccccc; margin-bottom: 6px;">Default Excel File Path</label>
            <div style="display: flex; gap: 8px;">
              <input type="text" id="configExcelPath" value="${escapeHtml(config.excel?.defaultPath || '')}"
                     placeholder="C:\\path\\to\\testcases.xlsx"
                     style="flex: 1; padding: 8px 12px; background: #3c3c3c; border: 1px solid #5a5a5a; border-radius: 4px; color: #cccccc; font-size: 13px; outline: none;">
              <button onclick="browseExcelFile()" style="padding: 8px 16px; background: #0e639c; border: none; border-radius: 4px; color: white; cursor: pointer; font-size: 13px;">Browse...</button>
            </div>
          </div>
        </div>

        <!-- User Settings -->
        <div class="config-section">
          <h2 style="font-size: 14px; font-weight: 600; color: #cccccc; margin-bottom: 16px; text-transform: uppercase; letter-spacing: 0.5px;">User Settings</h2>

          <div class="config-field" style="margin-bottom: 16px;">
            <label style="display: block; font-size: 13px; color: #cccccc; margin-bottom: 6px;">Account Name</label>
            <input type="text" id="configAccountName" value="${escapeHtml(config.user?.accountName || '')}"
                   placeholder="John Doe"
                   style="width: 100%; padding: 8px 12px; background: #3c3c3c; border: 1px solid #5a5a5a; border-radius: 4px; color: #cccccc; font-size: 13px; outline: none;">
          </div>

          <div class="config-field" style="margin-bottom: 16px;">
            <label style="display: block; font-size: 13px; color: #cccccc; margin-bottom: 6px;">Email</label>
            <input type="text" id="configEmail" value="${escapeHtml(config.user?.email || '')}"
                   placeholder="john.doe@example.com"
                   style="width: 100%; padding: 8px 12px; background: #3c3c3c; border: 1px solid #5a5a5a; border-radius: 4px; color: #cccccc; font-size: 13px; outline: none;">
          </div>
        </div>

        <!-- Save Button -->
        <div style="margin-top: 16px;">
          <button onclick="saveConfiguration()" style="padding: 10px 24px; background: #0e639c; border: none; border-radius: 4px; color: white; cursor: pointer; font-size: 14px; font-weight: 500;">
            Save Configuration
          </button>
          <span id="configSaveStatus" style="margin-left: 16px; font-size: 13px; color: #858585;"></span>
        </div>
      </div>
    </div>
  `;

  // 입력 필드 포커스 스타일 추가
  const inputs = editorArea.querySelectorAll('input');
  inputs.forEach(input => {
    input.addEventListener('focus', () => {
      input.style.borderColor = '#007acc';
    });
    input.addEventListener('blur', () => {
      input.style.borderColor = '#5a5a5a';
    });
  });
}

// 설정 불러오기
async function loadConfiguration() {
  if (!currentProjectPath) return {};

  try {
    const configPath = currentProjectPath + '\\.vvu.config';
    const content = await window.electronAPI.fs.readFile(configPath);
    return JSON.parse(content);
  } catch (error) {
    // 파일이 없거나 파싱 오류시 빈 객체 반환
    return {};
  }
}

// 설정 저장
async function saveConfiguration() {
  if (!currentProjectPath) return;

  const config = {
    codebeamer: {
      url: document.getElementById('configCbUrl')?.value || '',
      username: document.getElementById('configCbUsername')?.value || '',
      projectId: document.getElementById('configCbProjectId')?.value || '',
      trackerId: document.getElementById('configCbTrackerId')?.value || ''
    },
    excel: {
      defaultPath: document.getElementById('configExcelPath')?.value || ''
    },
    user: {
      accountName: document.getElementById('configAccountName')?.value || '',
      email: document.getElementById('configEmail')?.value || ''
    }
  };

  try {
    const configPath = currentProjectPath + '\\.vvu.config';
    const result = await window.electronAPI.fs.writeFile(configPath, JSON.stringify(config, null, 2));

    const statusEl = document.getElementById('configSaveStatus');
    if (result.success) {
      statusEl.textContent = 'Configuration saved successfully!';
      statusEl.style.color = '#4ec9b0';

      // Explorer 새로고침
      await refreshExplorer();
    } else {
      statusEl.textContent = 'Failed to save configuration.';
      statusEl.style.color = '#f14c4c';
    }

    // 3초 후 메시지 숨기기
    setTimeout(() => {
      statusEl.textContent = '';
    }, 3000);
  } catch (error) {
    console.error('Error saving configuration:', error);
  }
}

// Explorer 새로고침
async function refreshExplorer() {
  if (currentProjectPath) {
    // 현재 확장된 폴더 상태 저장
    const expandedFolders = new Set();
    document.querySelectorAll('.tree-item-children.expanded').forEach(el => {
      expandedFolders.add(el.id);
    });

    await loadProjectFiles(currentProjectPath);

    // 확장된 폴더 상태 복원
    expandedFolders.forEach(folderId => {
      const children = document.getElementById(folderId);
      if (children) {
        children.classList.add('expanded');
        // 해당 폴더의 chevron도 업데이트
        const folder = children.previousElementSibling;
        if (folder && folder.classList.contains('folder')) {
          const chevron = folder.querySelector('.chevron');
          if (chevron) chevron.classList.add('expanded');
        }
      }
    });
  }
}

// Excel 파일 찾아보기
async function browseExcelFile() {
  try {
    const filePath = await window.electronAPI.dialog.openFile({
      filters: [{ name: 'Excel Files', extensions: ['xlsx', 'xls'] }]
    });

    if (filePath) {
      const inputEl = document.getElementById('configExcelPath');
      if (inputEl) {
        inputEl.value = filePath;
      }
    }
  } catch (error) {
    console.error('Error browsing file:', error);
  }
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
      // Output 패널이 닫혀있으면 열기
      if (!outputPanelVisible) {
        const panel = document.getElementById('bottomPanel');
        const checkmark = document.getElementById('outputCheckmark');
        panel.classList.add('show');
        if (checkmark) checkmark.textContent = '✓';
        outputPanelVisible = true;
      }

      // OUTPUT 탭으로 전환
      switchBottomTab('output');

      // Python 스크립트 실행
      appendOutput(`Selected Excel file: ${filePath}`, 'info');
      await runPythonScript('scripts/excel_handler.py', [filePath]);
    }
  } catch (error) {
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

// Output 패널 토글
function toggleOutputPanel(event) {
  if (event) event.stopPropagation();

  // 드롭다운 닫기
  closeAllMenus();

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
  closeAllMenus();

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
      // 터미널에 포커스
      setTimeout(() => {
        focusTerminal();
      }, 100);
    }
  }
}

// 터미널 기본 경로 결정
async function getTerminalDefaultPath() {
  // 1. Open Folder로 열린 경로가 있으면 사용
  if (currentProjectPath) {
    return currentProjectPath;
  }

  // 2. D:\ 드라이브 확인
  try {
    const dItems = await window.electronAPI.fs.readdir('D:\\');
    if (dItems && dItems.length >= 0) {
      return 'D:\\';
    }
  } catch (e) {
    // D:\ 접근 불가
  }

  // 3. C:\ 사용
  return 'C:\\';
}

// 새 터미널 생성
async function createNewTerminal() {
  try {
    const defaultPath = await getTerminalDefaultPath();
    const result = await window.electronAPI.terminal.create(defaultPath);
    const terminalNum = terminals.length + 1;

    const terminal = {
      id: result.terminalId,
      name: `cmd ${terminalNum}`,
      cwd: result.cwd,
      output: [],
      currentInput: '',  // 현재 입력 중인 문자열
      tabIndex: 0,       // Tab 자동완성 인덱스
      tabMatches: []     // Tab 자동완성 매칭 목록
    };

    terminals.push(terminal);
    activeTerminalId = terminal.id;

    renderTerminalList();
    renderTerminalContent();

    // 터미널에 포커스
    setTimeout(() => {
      focusTerminal();
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
    focusTerminal();
  }, 50);
}

// 터미널 내용 렌더링
function renderTerminalContent() {
  const contentEl = document.getElementById('terminalContent');

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
  html += `<div class="terminal-output-line"><span style="color:#6a9955">&gt;&nbsp;</span>${escapeHtml(terminal.currentInput)}<span class="terminal-cursor"></span></div>`;

  contentEl.innerHTML = html;

  // 스크롤을 맨 아래로
  contentEl.scrollTop = contentEl.scrollHeight;
}

// 터미널 포커스
function focusTerminal() {
  const contentEl = document.getElementById('terminalContent');
  if (contentEl) {
    contentEl.focus();
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
  terminal.output.push({ text: `> ${command}`, type: '' });
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

  // 터미널 키보드 이벤트 (terminalContent에 직접 바인딩)
  const contentEl = document.getElementById('terminalContent');
  if (contentEl) {
    contentEl.addEventListener('keydown', handleTerminalKeyDown);
  }
}

// 터미널 키보드 이벤트 처리
function handleTerminalKeyDown(e) {
  const terminal = terminals.find(t => t.id === activeTerminalId);
  if (!terminal) return;

  // Tab: 자동완성
  if (e.key === 'Tab') {
    e.preventDefault();
    handleTabCompletion(terminal);
    return;
  }

  // Enter: 명령어 실행
  if (e.key === 'Enter') {
    e.preventDefault();
    const command = terminal.currentInput;
    terminal.currentInput = '';
    terminal.tabMatches = [];
    terminal.tabIndex = 0;
    handleTerminalInput(command);
    return;
  }

  // Backspace: 글자 삭제
  if (e.key === 'Backspace') {
    e.preventDefault();
    if (terminal.currentInput.length > 0) {
      terminal.currentInput = terminal.currentInput.slice(0, -1);
      terminal.tabMatches = [];
      terminal.tabIndex = 0;
      renderTerminalContent();
    }
    return;
  }

  // Escape: 입력 취소
  if (e.key === 'Escape') {
    e.preventDefault();
    terminal.currentInput = '';
    terminal.tabMatches = [];
    terminal.tabIndex = 0;
    renderTerminalContent();
    return;
  }

  // Ctrl+C: 입력 취소 및 새 줄
  if (e.ctrlKey && e.key === 'c') {
    e.preventDefault();
    terminal.output.push({ text: `> ${terminal.currentInput}^C`, type: '' });
    terminal.currentInput = '';
    terminal.tabMatches = [];
    terminal.tabIndex = 0;
    renderTerminalContent();
    return;
  }

  // 일반 문자 입력 (printable characters)
  if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
    e.preventDefault();
    terminal.currentInput += e.key;
    terminal.tabMatches = [];
    terminal.tabIndex = 0;
    renderTerminalContent();
  }
}

// Tab 자동완성 처리
async function handleTabCompletion(terminal) {
  // 현재 입력에서 마지막 토큰 추출
  const input = terminal.currentInput;
  const tokens = input.split(/\s+/);
  const lastToken = tokens[tokens.length - 1] || '';

  // 검색 경로 결정
  let searchDir = terminal.cwd;
  let prefix = lastToken;

  // 경로 구분자가 있으면 경로와 prefix 분리
  const lastSlash = Math.max(lastToken.lastIndexOf('/'), lastToken.lastIndexOf('\\'));
  if (lastSlash >= 0) {
    const pathPart = lastToken.substring(0, lastSlash + 1);
    prefix = lastToken.substring(lastSlash + 1);

    // 절대 경로인지 상대 경로인지 확인
    if (/^[A-Za-z]:/.test(pathPart)) {
      searchDir = pathPart;
    } else {
      searchDir = terminal.cwd + '\\' + pathPart;
    }
  }

  // 이미 매칭된 목록이 있으면 다음 항목으로 순환
  if (terminal.tabMatches.length > 0) {
    terminal.tabIndex = (terminal.tabIndex + 1) % terminal.tabMatches.length;
    applyTabCompletion(terminal, tokens, lastSlash, prefix);
    return;
  }

  // 디렉토리 목록 가져오기
  try {
    const items = await window.electronAPI.fs.readdir(searchDir);
    const matches = items
      .filter(item => item.name.toLowerCase().startsWith(prefix.toLowerCase()))
      .map(item => ({
        name: item.name,
        isDirectory: item.isDirectory
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    if (matches.length > 0) {
      terminal.tabMatches = matches;
      terminal.tabIndex = 0;
      applyTabCompletion(terminal, tokens, lastSlash, prefix);
    }
  } catch (error) {
    // 디렉토리 접근 실패시 무시
  }
}

// Tab 자동완성 적용
function applyTabCompletion(terminal, tokens, lastSlash, prefix) {
  const match = terminal.tabMatches[terminal.tabIndex];
  const completedName = match.isDirectory ? match.name + '\\' : match.name;

  // 마지막 토큰 교체
  if (lastSlash >= 0) {
    const pathPart = tokens[tokens.length - 1].substring(0, lastSlash + 1);
    tokens[tokens.length - 1] = pathPart + completedName;
  } else {
    tokens[tokens.length - 1] = completedName;
  }

  terminal.currentInput = tokens.join(' ');
  renderTerminalContent();
}

// =============================================
// Chat Panel (Copilot 스타일)
// =============================================

let chatMessages = [];
let isChatLoading = false;
let isChatResizing = false;
let chatSystemPrompt = '';
let chatPromptHistory = '';  // .vvu.prompt.history.md 내용
let chatPromptLast = '';     // .vvu.prompt.last.md 내용
let chatUserHistory = [];    // 사용자 질문 히스토리 (Up/Down 키용)
let chatHistoryIndex = -1;   // 현재 히스토리 인덱스
let chatTempInput = '';      // Up 키 누르기 전 임시 저장

// Chat 초기화
async function initChat() {
  // Ollama 모델 목록 로드
  await loadOllamaModels();
  // Chat 패널 리사이저 설정
  setupChatPanelResizer();
  // 시스템 프롬프트 로드
  await loadChatSystemPrompt();
  // 히스토리 파일 로드
  await loadChatHistoryFiles();
}

// 시스템 프롬프트 파일 로드
async function loadChatSystemPrompt() {
  // 프로젝트가 열려있지 않으면 기본 프롬프트 없이 진행
  if (!currentProjectPath) {
    chatSystemPrompt = '';
    console.log('No project opened, chat system prompt not loaded');
    return;
  }

  try {
    const promptPath = currentProjectPath + '/.vvu.prompt.base.md';

    // 파일이 없으면 기본 파일 생성
    const content = await window.electronAPI.fs.readFile(promptPath);
    if (content && !content.startsWith('Error reading file')) {
      chatSystemPrompt = content;
      console.log('Chat system prompt loaded from:', promptPath);
    } else {
      // 기본 프롬프트 생성
      const defaultPrompt = `# VVU Chat System Instructions

아래 지시사항을 숙지하고 사용자의 질문에 답변하세요.

## 질문 유형 분류 및 답변 가이드라인

먼저 사용자의 질문 유형을 파악하고, 답변 첫 줄에 질문 유형을 명시합니다.

### 1. 지식 관련 질문 (Knowledge Questions)
지식, 개념, 정의에 대한 질문인 경우:

**답변 형식:**
1. 첫 줄: "**지식 관련 질문입니다.**"
2. **정의**: 핵심 개념을 간결하게 정의
3. **설명**: 관련 내용을 이해하기 쉽게 설명
4. **대표적인 사례**: 3개의 구체적인 예시 제공

**주의:** 마크다운 표는 사용하지 않고, 핵심 내용을 이해하기 쉽게 풀어서 설명합니다.

### 2. 코드 관련 질문 (Code Questions)
코드 작성, 버그 수정, 리팩토링 등의 질문인 경우:

**답변 형식:**
1. 첫 줄: "**코드 관련 질문입니다.**"
2. 문제 분석
3. 해결 방안 제시
4. 코드 예시 제공

### 3. 일반 질문 (General Questions)
위 유형에 해당하지 않는 일반적인 질문:

**답변 형식:**
1. 첫 줄: "**일반 질문입니다.**"
2. 질문 의도 파악
3. 명확하고 간결한 답변 제공

---

**공통 주의사항:**
- 응답은 항상 한국어로 작성합니다 (코드 제외)
- 불필요한 서론 없이 바로 본론으로 들어갑니다
- 마크다운 형식을 활용하여 가독성을 높입니다
- 마크다운 표는 사용하지 않습니다
`;
      await window.electronAPI.fs.writeFile(promptPath, defaultPrompt);
      chatSystemPrompt = defaultPrompt;
      console.log('Chat system prompt created at:', promptPath);
      // Explorer 새로고침하여 새 파일 표시
      refreshExplorer();
    }
  } catch (error) {
    console.error('Error loading chat system prompt:', error);
  }
}

// 히스토리 파일 로드
async function loadChatHistoryFiles() {
  if (!currentProjectPath) return;

  try {
    // .vvu.prompt.history.md 로드
    const historyPath = currentProjectPath + '/.vvu.prompt.history.md';
    const historyContent = await window.electronAPI.fs.readFile(historyPath);
    if (historyContent && !historyContent.startsWith('Error reading file')) {
      chatPromptHistory = historyContent;
      // 히스토리에서 사용자 질문 추출하여 chatUserHistory에 저장
      const questions = historyContent.split('\n')
        .filter(line => line.startsWith('- '))
        .map(line => line.substring(2).trim());
      chatUserHistory = questions;
    } else {
      chatPromptHistory = '';
      chatUserHistory = [];
    }

    // .vvu.prompt.last.md 로드
    const lastPath = currentProjectPath + '/.vvu.prompt.last.md';
    const lastContent = await window.electronAPI.fs.readFile(lastPath);
    if (lastContent && !lastContent.startsWith('Error reading file')) {
      chatPromptLast = lastContent;
    } else {
      chatPromptLast = '';
    }

    console.log('Chat history files loaded, questions:', chatUserHistory.length);
  } catch (error) {
    console.error('Error loading chat history files:', error);
  }
}

// 히스토리 파일 저장 (메시지 전송 후 호출)
async function saveChatHistoryFiles(userQuestion, aiResponse) {
  if (!currentProjectPath) return;

  try {
    // 1. 기존 last의 질문을 history로 이동 (AI 답변 제외)
    if (chatPromptLast) {
      const lastLines = chatPromptLast.split('\n');
      const questionLine = lastLines.find(line => line.startsWith('**Q:**'));
      if (questionLine) {
        const prevQuestion = questionLine.replace('**Q:** ', '').trim();
        // 이미 history에 없으면 추가
        if (!chatUserHistory.includes(prevQuestion)) {
          chatUserHistory.push(prevQuestion);
        }
      }
    }

    // 2. 현재 질문을 userHistory에 추가 (Up/Down 키용)
    if (!chatUserHistory.includes(userQuestion)) {
      chatUserHistory.push(userQuestion);
    }

    // 3. 30개 제한 (오래된 것 삭제)
    while (chatUserHistory.length > 30) {
      chatUserHistory.shift();
    }

    // 4. .vvu.prompt.history.md 저장 (마지막 질문 제외한 이전 질문들만)
    const historyQuestions = chatUserHistory.slice(0, -1);  // 마지막 제외
    if (historyQuestions.length > 0) {
      const historyContent = `# Chat History (Previous Questions)\n\n${historyQuestions.map(q => '- ' + q).join('\n')}\n`;
      const historyPath = currentProjectPath + '/.vvu.prompt.history.md';
      await window.electronAPI.fs.writeFile(historyPath, historyContent);
      chatPromptHistory = historyContent;
    }

    // 5. .vvu.prompt.last.md 저장 (마지막 Q&A)
    const lastContent = `# Last Conversation\n\n**Q:** ${userQuestion}\n\n**A:** ${aiResponse}\n`;
    const lastPath = currentProjectPath + '/.vvu.prompt.last.md';
    await window.electronAPI.fs.writeFile(lastPath, lastContent);
    chatPromptLast = lastContent;

    // 히스토리 인덱스 리셋
    chatHistoryIndex = -1;
    chatTempInput = '';

    console.log('Chat history files saved, total questions:', chatUserHistory.length);
  } catch (error) {
    console.error('Error saving chat history files:', error);
  }
}

// Chat 패널 리사이저 설정
function setupChatPanelResizer() {
  const resizer = document.getElementById('chatPanelResizer');
  const chatPanel = document.getElementById('chatPanel');

  if (!resizer || !chatPanel) return;

  let startX, startWidth;

  resizer.addEventListener('mousedown', (e) => {
    e.preventDefault();
    isChatResizing = true;
    startX = e.clientX;
    startWidth = chatPanel.offsetWidth;
    resizer.classList.add('resizing');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });

  document.addEventListener('mousemove', (e) => {
    if (!isChatResizing) return;

    // 왼쪽으로 드래그하면 너비 증가, 오른쪽으로 드래그하면 너비 감소
    const diff = startX - e.clientX;
    const newWidth = Math.min(Math.max(startWidth + diff, 280), 1600);
    chatPanel.style.width = newWidth + 'px';
  });

  document.addEventListener('mouseup', () => {
    if (isChatResizing) {
      isChatResizing = false;
      resizer.classList.remove('resizing');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
  });
}

// 코드 블록 ID 카운터
let codeBlockCounter = 0;

// 간단한 마크다운 렌더링
function renderMarkdown(text) {
  // 코드 블록 (```)
  text = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (match, lang, code) => {
    const escapedCode = escapeHtml(code.trim());
    return `<pre style="background: #1e1e1e; padding: 12px; border-radius: 6px; overflow-x: auto; margin: 8px 0;"><code style="font-family: 'Consolas', 'Monaco', monospace; font-size: 12px; color: #d4d4d4;">${escapedCode}</code></pre>`;
  });

  // 테이블 렌더링
  text = text.replace(/(\|.+\|[\r\n]+\|[-:\s|]+\|[\r\n]+(?:\|.+\|[\r\n]*)+)/g, (match) => {
    const lines = match.trim().split('\n').filter(line => line.trim());
    if (lines.length < 2) return match;

    // 헤더 행
    const headerCells = lines[0].split('|').filter(cell => cell.trim() !== '');
    // 구분선 (정렬 정보)
    const alignLine = lines[1].split('|').filter(cell => cell.trim() !== '');
    const alignments = alignLine.map(cell => {
      const trimmed = cell.trim();
      if (trimmed.startsWith(':') && trimmed.endsWith(':')) return 'center';
      if (trimmed.endsWith(':')) return 'right';
      return 'left';
    });

    // 데이터 행
    const dataRows = lines.slice(2);

    let tableHtml = '<table style="border-collapse: collapse; margin: 8px 0; width: 100%; font-size: 12px;">';

    // 헤더
    tableHtml += '<thead><tr>';
    headerCells.forEach((cell, i) => {
      const align = alignments[i] || 'left';
      tableHtml += `<th style="border: 1px solid #555; padding: 8px 12px; background: #2d2d2d; text-align: ${align}; color: #e0e0e0; font-weight: 600;">${cell.trim()}</th>`;
    });
    tableHtml += '</tr></thead>';

    // 바디
    tableHtml += '<tbody>';
    dataRows.forEach(row => {
      const cells = row.split('|').filter(cell => cell.trim() !== '');
      tableHtml += '<tr>';
      cells.forEach((cell, i) => {
        const align = alignments[i] || 'left';
        tableHtml += `<td style="border: 1px solid #454545; padding: 6px 12px; text-align: ${align}; color: #cccccc;">${cell.trim()}</td>`;
      });
      tableHtml += '</tr>';
    });
    tableHtml += '</tbody></table>';

    return tableHtml;
  });

  // 인라인 코드 (`)
  text = text.replace(/`([^`]+)`/g, '<code style="background: #3c3c3c; padding: 2px 6px; border-radius: 3px; font-family: \'Consolas\', monospace; font-size: 12px;">$1</code>');

  // 헤더
  text = text.replace(/^### (.+)$/gm, '<h3 style="font-size: 14px; font-weight: 600; margin: 12px 0 8px 0; color: #e0e0e0;">$1</h3>');
  text = text.replace(/^## (.+)$/gm, '<h2 style="font-size: 15px; font-weight: 600; margin: 14px 0 8px 0; color: #e0e0e0;">$1</h2>');
  text = text.replace(/^# (.+)$/gm, '<h1 style="font-size: 16px; font-weight: 600; margin: 16px 0 10px 0; color: #ffffff;">$1</h1>');

  // 볼드 (**text** 또는 __text__)
  text = text.replace(/\*\*(.+?)\*\*/g, '<strong style="color: #ffffff;">$1</strong>');
  text = text.replace(/__(.+?)__/g, '<strong style="color: #ffffff;">$1</strong>');

  // 이탤릭 (*text* 또는 _text_)
  text = text.replace(/\*([^\*]+)\*/g, '<em>$1</em>');
  text = text.replace(/_([^_]+)_/g, '<em>$1</em>');

  // 리스트 항목 (- 또는 *)
  text = text.replace(/^[\-\*] (.+)$/gm, '<li style="margin-left: 16px; margin-bottom: 4px;">$1</li>');

  // 숫자 리스트
  text = text.replace(/^\d+\. (.+)$/gm, '<li style="margin-left: 16px; margin-bottom: 4px;">$1</li>');

  // 줄바꿈
  text = text.replace(/\n/g, '<br>');

  return text;
}

// 코드 블록 복사 함수
function copyCodeBlock(codeId) {
  const codeElement = document.getElementById(codeId);
  if (codeElement) {
    const code = codeElement.textContent;
    navigator.clipboard.writeText(code).then(() => {
      showToast('success', 'Code copied to clipboard!');
    }).catch(err => {
      console.error('Failed to copy:', err);
      showToast('error', 'Failed to copy code');
    });
  }
}

// Ollama 모델 목록 로드
async function loadOllamaModels() {
  try {
    const response = await fetch('http://localhost:11434/api/tags');
    if (response.ok) {
      const data = await response.json();
      const select = document.getElementById('llmSelect');
      if (select && data.models && data.models.length > 0) {
        select.innerHTML = data.models.map(model =>
          `<option value="${model.name}" ${model.name === 'gpt-oss:20b' ? 'selected' : ''}>${model.name}</option>`
        ).join('');

        // gpt-oss:20b가 없으면 첫번째 모델 선택
        if (!data.models.find(m => m.name === 'gpt-oss:20b')) {
          select.value = data.models[0].name;
        }
      }
    }
  } catch (error) {
    console.log('Ollama not available:', error.message);
    // Ollama가 없으면 기본값 유지
  }
}

// Chat 패널 토글
async function toggleChatPanel(event) {
  if (event) {
    event.stopPropagation();
    closeAllMenus();
  }

  const chatPanel = document.getElementById('chatPanel');
  if (chatPanel.style.display === 'none') {
    chatPanel.style.display = 'flex';
    document.getElementById('chatInput').focus();

    // Open Chat 시 .vvu.prompt.history.md 삭제 (새 대화 세션 시작)
    if (currentProjectPath) {
      const historyPath = currentProjectPath + '/.vvu.prompt.history.md';
      try {
        await window.electronAPI.fs.delete(historyPath);
        console.log('Deleted chat history file on Open Chat');
      } catch (error) {
        // 파일이 없어도 무시
      }
    }

    // 패널 열 때마다 프롬프트 파일들 새로고침 (파일 수정 반영)
    await loadChatSystemPrompt();
    await loadChatHistoryFiles();

    // 첨부 파일 목록 업데이트
    updateChatAttachments();
  } else {
    chatPanel.style.display = 'none';
  }
}

// Chat 히스토리 초기화 (화면만)
function clearChatHistory() {
  chatMessages = [];
  const messagesContainer = document.getElementById('chatMessages');
  messagesContainer.innerHTML = `
    <div class="chat-welcome">
      <div style="font-size: 16px; font-weight: 600; margin-bottom: 8px;">Welcome to Chat</div>
      <div style="color: #858585;">Ask me anything about your project or code.</div>
    </div>
  `;
}

// Chat 전체 초기화 (대화창 + 입력 히스토리 + 파일)
async function resetChat() {
  // 대화 창 초기화
  chatMessages = [];
  const messagesContainer = document.getElementById('chatMessages');
  messagesContainer.innerHTML = `
    <div class="chat-welcome">
      <div style="font-size: 16px; font-weight: 600; margin-bottom: 8px;">Welcome to Chat</div>
      <div style="color: #858585;">Ask me anything about your project or code.</div>
    </div>
  `;

  // 입력 히스토리 초기화
  chatUserHistory = [];
  chatHistoryIndex = -1;
  chatTempInput = '';
  chatPromptHistory = '';
  chatPromptLast = '';

  // 입력창 초기화
  const input = document.getElementById('chatInput');
  if (input) {
    input.value = '';
    input.style.height = 'auto';
  }

  // 히스토리 파일들 삭제
  if (currentProjectPath) {
    try {
      await window.electronAPI.fs.delete(currentProjectPath + '/.vvu.prompt.history.md');
    } catch (error) { /* 무시 */ }
    try {
      await window.electronAPI.fs.delete(currentProjectPath + '/.vvu.prompt.last.md');
    } catch (error) { /* 무시 */ }
  }

  // 첨부 파일 체크 해제
  openTabs.forEach(tab => {
    tab.chatAttached = false;
  });
  updateChatAttachments();

  console.log('Chat fully reset');
}

// Enter 키 처리
function handleChatKeydown(event) {
  const textarea = event.target;

  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    sendChatMessage();
    return;
  }

  // Up 키: 이전 히스토리로 이동
  if (event.key === 'ArrowUp' && chatUserHistory.length > 0) {
    event.preventDefault();

    // 처음 Up 키를 누르면 현재 입력 저장
    if (chatHistoryIndex === -1) {
      chatTempInput = textarea.value;
      chatHistoryIndex = chatUserHistory.length - 1;
    } else if (chatHistoryIndex > 0) {
      chatHistoryIndex--;
    }

    textarea.value = chatUserHistory[chatHistoryIndex] || '';
    return;
  }

  // Down 키: 다음 히스토리로 이동
  if (event.key === 'ArrowDown' && chatHistoryIndex !== -1) {
    event.preventDefault();

    if (chatHistoryIndex < chatUserHistory.length - 1) {
      chatHistoryIndex++;
      textarea.value = chatUserHistory[chatHistoryIndex] || '';
    } else {
      // 마지막까지 가면 임시 저장된 입력으로 복원
      chatHistoryIndex = -1;
      textarea.value = chatTempInput;
    }
    return;
  }

  // 텍스트 영역 자동 높이 조절
  textarea.style.height = 'auto';
  textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
}

// 메시지 전송
async function sendChatMessage() {
  const input = document.getElementById('chatInput');
  const message = input.value.trim();

  if (!message || isChatLoading) return;

  // 사용자 메시지 추가
  addChatMessage('user', message);
  input.value = '';
  input.style.height = 'auto';

  // 로딩 표시
  isChatLoading = true;
  const loadingId = showChatLoading();

  try {
    // 메시지 전송 전 시스템 프롬프트 새로고침 (파일 수정 반영)
    await loadChatSystemPrompt();

    const model = document.getElementById('llmSelect').value;
    await streamOllamaResponse(message, model, loadingId);
  } catch (error) {
    console.error('Chat error:', error);
    removeChatLoading(loadingId);
    addChatMessage('assistant', 'Error: Failed to get response from LLM. Make sure Ollama is running.');
  } finally {
    isChatLoading = false;
  }
}

// Chat 메시지 추가
function addChatMessage(role, content) {
  chatMessages.push({ role, content });

  const messagesContainer = document.getElementById('chatMessages');

  // Welcome 메시지 제거
  const welcome = messagesContainer.querySelector('.chat-welcome');
  if (welcome) welcome.remove();

  const messageDiv = document.createElement('div');
  messageDiv.className = `chat-message ${role}`;

  // Assistant 메시지는 마크다운 렌더링 적용
  const renderedContent = role === 'assistant' ? renderMarkdown(content) : escapeHtml(content);

  messageDiv.innerHTML = `
    <div class="chat-message-role">${role === 'user' ? 'You' : 'Assistant'}</div>
    <div class="chat-message-content">${renderedContent}</div>
  `;

  messagesContainer.appendChild(messageDiv);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;

  return messageDiv;
}

// 로딩 표시
function showChatLoading() {
  const messagesContainer = document.getElementById('chatMessages');
  const loadingDiv = document.createElement('div');
  loadingDiv.className = 'chat-message assistant';
  loadingDiv.id = 'chat-loading-' + Date.now();
  loadingDiv.innerHTML = `
    <div class="chat-message-role">Assistant</div>
    <div class="chat-loading">
      <div class="chat-loading-dots">
        <span></span><span></span><span></span>
      </div>
      <span>Thinking...</span>
    </div>
  `;

  messagesContainer.appendChild(loadingDiv);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;

  return loadingDiv.id;
}

// 로딩 제거
function removeChatLoading(loadingId) {
  const loadingDiv = document.getElementById(loadingId);
  if (loadingDiv) loadingDiv.remove();
}

// Ollama 스트리밍 응답
async function streamOllamaResponse(prompt, model, loadingId) {
  const messagesContainer = document.getElementById('chatMessages');
  let messageDiv = null;
  let contentDiv = null;
  let fullResponse = '';
  let firstChunkReceived = false;
  const userQuestion = prompt;  // 원본 사용자 질문 저장

  try {
    // 전체 프롬프트 구성: 시스템 + 첨부파일 + 히스토리 + 마지막 대화 + 현재 질문
    let fullPrompt = '';

    if (chatSystemPrompt) {
      fullPrompt += `[System Instructions]\n${chatSystemPrompt}\n\n`;
    }

    // 첨부된 파일 내용 추가
    const attachedContent = getAttachedFilesContent();
    if (attachedContent) {
      fullPrompt += attachedContent;
    }

    if (chatPromptHistory) {
      fullPrompt += `[Previous Questions History]\n${chatPromptHistory}\n\n`;
    }

    if (chatPromptLast) {
      fullPrompt += `[Last Conversation]\n${chatPromptLast}\n\n`;
    }

    fullPrompt += `[Current Question]\n${prompt}`;

    const response = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model,
        prompt: fullPrompt,
        stream: true
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n').filter(line => line.trim());

      for (const line of lines) {
        try {
          const json = JSON.parse(line);
          if (json.response) {
            // 첫 번째 응답이 오면 로딩 제거하고 메시지 div 생성
            if (!firstChunkReceived) {
              firstChunkReceived = true;
              removeChatLoading(loadingId);

              messageDiv = document.createElement('div');
              messageDiv.className = 'chat-message assistant';
              messageDiv.innerHTML = `
                <div class="chat-message-role">Assistant</div>
                <div class="chat-message-content"></div>
              `;
              messagesContainer.appendChild(messageDiv);
              contentDiv = messageDiv.querySelector('.chat-message-content');
            }

            fullResponse += json.response;
            // 스트리밍 중에는 일반 텍스트로 표시
            contentDiv.textContent = fullResponse;
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
          }
        } catch (e) {
          // JSON 파싱 실패 무시
        }
      }
    }

    // 스트리밍 완료 후 마크다운 렌더링 적용
    if (contentDiv) {
      contentDiv.innerHTML = renderMarkdown(fullResponse);
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    // 최종 응답 저장
    chatMessages.push({ role: 'assistant', content: fullResponse });

    // 히스토리 파일 저장
    await saveChatHistoryFiles(userQuestion, fullResponse);

  } catch (error) {
    // 에러 발생 시 로딩 제거하고 에러 메시지 표시
    removeChatLoading(loadingId);

    messageDiv = document.createElement('div');
    messageDiv.className = 'chat-message assistant';
    messageDiv.innerHTML = `
      <div class="chat-message-role">Assistant</div>
      <div class="chat-message-content" style="color: #f48771;">Error: ${error.message}</div>
    `;
    messagesContainer.appendChild(messageDiv);
    throw error;
  }
}

// HTML 이스케이프
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
