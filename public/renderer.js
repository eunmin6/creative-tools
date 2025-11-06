// 탭 관리를 위한 전역 변수
let openTabs = []; // { filePath, fileName, type, content }
let activeTabIndex = -1;

// DOM 로드 완료 시 초기화
window.addEventListener('DOMContentLoaded', () => {
  initializeApp();
});

function initializeApp() {
  loadProjectFiles();
  setupTreeInteraction();
  setupActivityBar();
}

// 프로젝트 파일 로드
async function loadProjectFiles() {
  if (!window.electronAPI || !window.electronAPI.fs) {
    console.error('File system API not available');
    return;
  }

  const projectRoot = await window.electronAPI.getProjectRoot();
  const explorerContent = document.getElementById('explorer');

  // Explorer 내용을 실제 파일 구조로 대체
  explorerContent.innerHTML = '';

  // 프로젝트 루트 폴더 생성
  const rootFolder = createFolderElement('PROJECT', projectRoot, true);
  explorerContent.appendChild(rootFolder);

  // 하위 항목 컨테이너
  const rootChildren = document.createElement('div');
  rootChildren.className = 'tree-item-children expanded';
  rootChildren.id = 'root-children';

  // 프로젝트 디렉토리 읽기
  const items = await window.electronAPI.fs.readdir(projectRoot);

  // node_modules와 dist 제외
  const filteredItems = items.filter(item =>
    item.name !== 'node_modules' &&
    item.name !== 'dist' &&
    item.name !== '.git' &&
    item.name !== '.claude'
  );

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
  folder.className = 'tree-item folder';
  folder.dataset.type = 'folder';
  folder.dataset.name = name.replace(/\s+/g, '-').toLowerCase();
  folder.dataset.path = fullPath;

  // depth에 따른 들여쓰기
  folder.style.paddingLeft = `${8 + (depth * 16)}px`;

  if (!isRoot) {
    const chevron = document.createElement('span');
    chevron.className = 'chevron';
    chevron.textContent = '▶';
    folder.appendChild(chevron);
  }

  const icon = document.createElement('span');
  icon.className = 'tree-item-icon';
  icon.textContent = '📁';
  folder.appendChild(icon);

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

  const icon = document.createElement('span');
  icon.className = 'tree-item-icon';
  icon.textContent = getFileIcon(name);
  file.appendChild(icon);

  const label = document.createElement('span');
  label.className = 'tree-item-label';
  label.textContent = name;
  file.appendChild(label);

  return file;
}

// 파일 아이콘 가져오기
function getFileIcon(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  const icons = {
    'js': '📜',
    'ts': '📘',
    'json': '📦',
    'html': '🌐',
    'css': '🎨',
    'md': '📝',
    'txt': '📄',
    'png': '🖼️',
    'jpg': '🖼️',
    'gif': '🖼️'
  };
  return icons[ext] || '📄';
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
    content: fileContent
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

  openTabs.forEach((tab, index) => {
    const tabEl = document.createElement('div');
    tabEl.className = 'editor-tab' + (index === activeTabIndex ? ' active' : '');

    const tabLabel = document.createElement('span');
    tabLabel.textContent = tab.fileName;
    tabLabel.style.cursor = 'pointer';
    tabLabel.addEventListener('click', () => switchToTab(index));

    const closeBtn = document.createElement('span');
    closeBtn.textContent = '×';
    closeBtn.style.marginLeft = '8px';
    closeBtn.style.cursor = 'pointer';
    closeBtn.style.fontSize = '18px';
    closeBtn.style.color = '#858585';
    closeBtn.style.transition = 'color 0.2s';
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

    tabEl.appendChild(tabLabel);
    tabEl.appendChild(closeBtn);
    editorTabs.appendChild(tabEl);
  });
}

// 탭 전환
function switchToTab(index) {
  if (index < 0 || index >= openTabs.length) return;

  activeTabIndex = index;
  renderTabs();
  renderActiveTabContent();
}

// 탭 닫기
function closeTab(index) {
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

  if (tab.type === 'canvas') {
    openCanvasEditorForTab(tab);
  } else {
    // 텍스트 파일 표시
    const escapedContent = escapeHtml(tab.content);
    editorArea.innerHTML = `
      <div style="padding: 20px;">
        <div style="color: #858585; margin-bottom: 20px; font-size: 12px;">
          ${tab.filePath}
        </div>
        <pre style="color: #d4d4d4; line-height: 1.6; white-space: pre-wrap; word-wrap: break-word;">${escapedContent}</pre>
      </div>
    `;
  }
}

// 환영 화면 표시
function showWelcomeScreen() {
  const editorArea = document.querySelector('.editor-area');
  editorArea.innerHTML = `
    <div class="welcome-screen">
      <h1>Code Editor</h1>
      <p>Electron + TypeScript 기반 에디터</p>
      <p>왼쪽 Explorer에서 파일을 선택하세요</p>
    </div>
  `;
}

// HTML 이스케이프
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Activity Bar 상호작용 설정
function setupActivityBar() {
  const activityBarItems = document.querySelectorAll('.activity-bar-item');

  activityBarItems.forEach(item => {
    item.addEventListener('click', () => {
      // 모든 항목에서 active 클래스 제거
      activityBarItems.forEach(i => i.classList.remove('active'));

      // 클릭한 항목에 active 클래스 추가
      item.classList.add('active');

      const view = item.dataset.view;

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
let isDragging = false;
let isResizing = false;
let resizeHandle = null;
let dragStartX = 0;
let dragStartY = 0;
let originalShapeData = null;
let currentFilePath = null;
let drawingMode = null; // 'rectangle' or 'circle' or null
let isDrawing = false;
let drawStartX = 0;
let drawStartY = 0;

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
}

// 도형 렌더링
function renderShapes() {
  const container = document.getElementById('canvas-container');
  if (!container) return;

  container.innerHTML = '';

  canvasData.shapes.forEach((shape, index) => {
    const shapeEl = document.createElement('div');
    shapeEl.className = 'canvas-shape';
    shapeEl.dataset.index = index;
    shapeEl.style.position = 'absolute';
    shapeEl.style.left = shape.x + 'px';
    shapeEl.style.top = shape.y + 'px';
    shapeEl.style.width = shape.width + 'px';
    shapeEl.style.height = shape.height + 'px';
    shapeEl.style.cursor = 'move';
    shapeEl.style.border = '2px solid #3e3e42';
    shapeEl.style.background = '#616161';

    if (shape.type === 'circle') {
      shapeEl.style.borderRadius = '50%';
    }

    // 선택된 도형 표시
    if (selectedShape === index) {
      shapeEl.style.border = '2px solid #007acc';
      shapeEl.style.boxShadow = '0 0 8px rgba(0, 122, 204, 0.6)';

      // 리사이즈 핸들 추가
      addResizeHandles(shapeEl);
    }

    container.appendChild(shapeEl);
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

// 캔버스 이벤트 설정
function setupCanvasEvents() {
  const container = document.getElementById('canvas-container');

  container.addEventListener('mousedown', handleCanvasMouseDown);
  document.addEventListener('mousemove', handleCanvasMouseMove);
  document.addEventListener('mouseup', handleCanvasMouseUp);

  // 키보드 이벤트 추가
  document.addEventListener('keydown', handleCanvasKeyDown);
}

// 키보드 이벤트 핸들러
function handleCanvasKeyDown(e) {
  // 캔버스 에디터가 열려있지 않으면 무시
  if (!document.getElementById('canvas-editor')) return;

  // Escape 키: 그리기 모드 해제
  if (e.key === 'Escape') {
    e.preventDefault();
    exitDrawingMode();
  }

  // Ctrl+S: 저장
  if (e.ctrlKey && e.key === 's') {
    e.preventDefault();
    saveCanvas();
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
    drawStartX = e.clientX - rect.left;
    drawStartY = e.clientY - rect.top;

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
    selectedShape = null;
    renderShapes();
    return;
  }

  const index = parseInt(shapeEl.dataset.index);
  selectedShape = index;

  // 리사이즈 핸들 클릭 확인
  if (e.target.classList.contains('resize-handle')) {
    isResizing = true;
    resizeHandle = e.target.dataset.position;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    // 원본 도형 데이터 저장
    originalShapeData = { ...canvasData.shapes[index] };
  } else {
    isDragging = true;
    resizeHandle = null;
    // 마우스 클릭 위치와 도형 위치의 오프셋 계산
    dragStartX = e.clientX - rect.left - canvasData.shapes[index].x;
    dragStartY = e.clientY - rect.top - canvasData.shapes[index].y;
  }

  renderShapes();
}

function handleCanvasMouseMove(e) {
  const container = document.getElementById('canvas-container');
  const rect = container.getBoundingClientRect();

  // 그리기 모드인 경우
  if (isDrawing && selectedShape !== null) {
    const currentX = e.clientX - rect.left;
    const currentY = e.clientY - rect.top;

    const shape = canvasData.shapes[selectedShape];
    const width = currentX - drawStartX;
    const height = currentY - drawStartY;

    // 드래그 방향에 따라 위치와 크기 조정
    shape.x = width >= 0 ? drawStartX : currentX;
    shape.y = height >= 0 ? drawStartY : currentY;
    shape.width = Math.abs(width);
    shape.height = Math.abs(height);

    renderShapes();
    return;
  }

  if (!isDragging && !isResizing) return;
  if (selectedShape === null) return;

  if (isDragging) {
    // 드래그 이동
    canvasData.shapes[selectedShape].x = e.clientX - rect.left - dragStartX;
    canvasData.shapes[selectedShape].y = e.clientY - rect.top - dragStartY;
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
    }
  }

  renderShapes();
}

function handleCanvasMouseUp() {
  // 그리기 완료
  if (isDrawing) {
    isDrawing = false;

    // 너무 작은 도형은 제거
    if (selectedShape !== null) {
      const shape = canvasData.shapes[selectedShape];
      if (shape.width < 5 || shape.height < 5) {
        canvasData.shapes.splice(selectedShape, 1);
        selectedShape = null;
      }
    }

    // 그리기 모드 종료
    exitDrawingMode();
    renderShapes();
    return;
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
      alert('✅ 저장되었습니다!');
    } else {
      alert('❌ 저장 실패: ' + result.error);
    }
  } catch (error) {
    alert('❌ 저장 중 오류 발생: ' + error);
  }
}
