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
// === 모달 관련 함수 ===

// 탭의 변경사항 확인
function hasUnsavedChanges(tabIndex) {
  if (tabIndex < 0 || tabIndex >= openTabs.length) return false;

  const tab = openTabs[tabIndex];

  // 캔버스 파일의 경우
  if (tab.type === 'canvas') {
    // 모듈에서 canvasData 가져오기
    const canvasData = typeof window.getCanvasData === 'function' ? window.getCanvasData() : { shapes: [] };
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
