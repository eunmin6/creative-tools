/**
 * File Explorer Module
 * 파일 탐색기 기능을 담당하는 모듈
 */

(function() {
  'use strict';

  // ===== 모듈 내부 상태 =====

  // Explorer 설정
  let hideSystemFolders = false;
  const SYSTEM_FOLDERS = ['node_modules', 'dist', '.git', '.claude'];

  // 현재 프로젝트 경로
  let currentProjectPath = null;

  // 현재 선택된 파일/폴더 정보
  let contextMenuTargetPath = null;
  let contextMenuTargetName = null;
  let contextMenuTargetIsFolder = false;

  // Explorer에서 선택된 파일/폴더
  let selectedItemPath = null;
  let selectedItemName = null;
  let selectedItemIsFolder = false;

  // 다중 선택 지원
  let multiSelectedItems = new Set();
  let lastClickedItemPath = null;

  // ===== 프로젝트 파일 로드 =====

  async function loadProjectFiles(customPath = null) {
    if (!window.electronAPI || !window.electronAPI.fs) {
      console.error('File system API not available');
      return;
    }

    const projectRoot = customPath || await window.electronAPI.getProjectRoot();
    currentProjectPath = projectRoot;
    window.currentProjectPath = projectRoot; // 전역 접근용

    const folderName = window.electronAPI.fs.path.basename(projectRoot).toUpperCase();
    const explorerContent = document.getElementById('explorer');

    explorerContent.innerHTML = '';

    const rootFolder = createFolderElement(folderName, projectRoot, true);
    explorerContent.appendChild(rootFolder);

    const rootChildren = document.createElement('div');
    rootChildren.className = 'tree-item-children expanded';
    rootChildren.id = `${folderName.replace(/\s+/g, '-').toLowerCase()}-children`;

    const items = await window.electronAPI.fs.readdir(projectRoot);

    const filteredItems = hideSystemFolders
      ? items.filter(item => !SYSTEM_FOLDERS.includes(item.name))
      : items;

    filteredItems.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });

    for (const item of filteredItems) {
      if (item.isDirectory) {
        const folder = createFolderElement(item.name, item.path, false, 1);
        rootChildren.appendChild(folder);
        const subChildren = await loadFolderContents(item.path, item.name, 2);
        rootChildren.appendChild(subChildren);
      } else {
        const file = createFileElement(item.name, item.path, 1);
        rootChildren.appendChild(file);
      }
    }

    explorerContent.appendChild(rootChildren);
  }

  // ===== 폴더 요소 생성 =====

  function createFolderElement(name, fullPath, isRoot = false, depth = 0) {
    const folder = document.createElement('div');
    folder.className = isRoot ? 'tree-item folder root' : 'tree-item folder';
    folder.dataset.type = 'folder';
    folder.dataset.name = name.replace(/\s+/g, '-').toLowerCase();
    folder.dataset.path = fullPath;

    folder.style.paddingLeft = `${8 + (depth * 16)}px`;

    const chevron = document.createElement('span');
    chevron.className = isRoot ? 'chevron expanded' : 'chevron';
    chevron.textContent = '❯';
    folder.appendChild(chevron);

    const label = document.createElement('span');
    label.className = 'tree-item-label';
    label.textContent = name;
    folder.appendChild(label);

    if (isRoot) {
      const refreshBtn = document.createElement('span');
      refreshBtn.className = 'explorer-refresh-btn';
      refreshBtn.innerHTML = '<i class="codicon codicon-refresh"></i>';
      refreshBtn.title = 'Refresh Explorer';
      refreshBtn.style.cssText = 'margin-left: auto; padding: 2px 6px; cursor: pointer; opacity: 0.6; display: flex; align-items: center;';
      refreshBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        refreshExplorer();
        if (typeof window.showToast === 'function') {
          window.showToast('info', 'Explorer refreshed');
        }
      });
      refreshBtn.addEventListener('mouseenter', () => refreshBtn.style.opacity = '1');
      refreshBtn.addEventListener('mouseleave', () => refreshBtn.style.opacity = '0.6');
      folder.appendChild(refreshBtn);
      folder.style.display = 'flex';
      folder.style.alignItems = 'center';
    }

    if (!isRoot) {
      folder.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (name.toLowerCase().startsWith('testcase')) {
          showTestcaseFolderContextMenu(e, fullPath, name);
        } else {
          showContextMenu(e, fullPath, name, true);
        }
      });
    }

    return folder;
  }

  // ===== 파일 요소 생성 =====

  function createFileElement(name, fullPath, depth = 0) {
    const file = document.createElement('div');
    file.className = 'tree-item file';
    file.dataset.type = 'file';
    file.dataset.file = fullPath;

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

    file.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (isExcelFile(fullPath)) {
        showExcelContextMenu(e, fullPath, name);
      } else if (isMdFile(fullPath)) {
        showMdFileContextMenu(e, fullPath, name);
      } else {
        showContextMenu(e, fullPath, name, false);
      }
    });

    return file;
  }

  // ===== 컨텍스트 메뉴 =====

  function showContextMenu(e, itemPath, itemName, isFolder = false) {
    contextMenuTargetPath = itemPath;
    contextMenuTargetName = itemName;
    contextMenuTargetIsFolder = isFolder;

    const menu = document.getElementById('fileContextMenu');
    menu.style.display = 'block';
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';

    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      menu.style.left = (window.innerWidth - rect.width - 5) + 'px';
    }
    if (rect.bottom > window.innerHeight) {
      menu.style.top = (window.innerHeight - rect.height - 5) + 'px';
    }

    setTimeout(() => {
      document.addEventListener('click', hideContextMenu);
      document.addEventListener('contextmenu', hideContextMenu);
    }, 0);
  }

  function hideContextMenu() {
    const menu = document.getElementById('fileContextMenu');
    const testcaseMenu = document.getElementById('testcaseFolderContextMenu');
    const excelMenu = document.getElementById('excelContextMenu');
    const mdMenu = document.getElementById('mdFileContextMenu');
    if (menu) menu.style.display = 'none';
    if (testcaseMenu) testcaseMenu.style.display = 'none';
    if (excelMenu) excelMenu.style.display = 'none';
    if (mdMenu) mdMenu.style.display = 'none';
    document.removeEventListener('click', hideContextMenu);
    document.removeEventListener('contextmenu', hideContextMenu);
  }

  function showExcelContextMenu(e, filePath, fileName) {
    contextMenuTargetPath = filePath;
    contextMenuTargetName = fileName;
    contextMenuTargetIsFolder = false;

    const menu = document.getElementById('excelContextMenu');
    menu.style.display = 'block';
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';

    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      menu.style.left = (window.innerWidth - rect.width - 5) + 'px';
    }
    if (rect.bottom > window.innerHeight) {
      menu.style.top = (window.innerHeight - rect.height - 5) + 'px';
    }

    setTimeout(() => {
      document.addEventListener('click', hideContextMenu);
      document.addEventListener('contextmenu', hideContextMenu);
    }, 0);
  }

  function openExcelWithProgram() {
    const filePath = contextMenuTargetPath;
    hideContextMenu();
    if (filePath) {
      openWithDefaultProgram(filePath);
    }
  }

  function showTestcaseFolderContextMenu(e, folderPath, folderName) {
    contextMenuTargetPath = folderPath;
    contextMenuTargetName = folderName;
    contextMenuTargetIsFolder = true;

    const menu = document.getElementById('testcaseFolderContextMenu');

    // Generate Script / Stop Generation 메뉴 동적 변경
    const generateMenuItem = menu.querySelector('#generateScriptMenuItem');
    if (generateMenuItem) {
      const isGenerating = typeof window.isGenerating === 'function' && window.isGenerating();
      const icon = generateMenuItem.querySelector('i');
      const label = generateMenuItem.querySelector('.context-menu-label');

      if (isGenerating) {
        if (icon) icon.className = 'codicon codicon-debug-stop';
        if (label) label.textContent = 'Stop Generation';
        generateMenuItem.onclick = () => window.stopGeneration();
      } else {
        if (icon) icon.className = 'codicon codicon-run-all';
        if (label) label.textContent = 'Generate Script';
        generateMenuItem.onclick = () => window.generateScriptsFromFolder();
      }
    }

    menu.style.display = 'block';
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';

    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      menu.style.left = (window.innerWidth - rect.width - 5) + 'px';
    }
    if (rect.bottom > window.innerHeight) {
      menu.style.top = (window.innerHeight - rect.height - 5) + 'px';
    }

    setTimeout(() => {
      document.addEventListener('click', hideContextMenu);
      document.addEventListener('contextmenu', hideContextMenu);
    }, 0);
  }

  function showMdFileContextMenu(e, filePath, fileName) {
    contextMenuTargetPath = filePath;
    contextMenuTargetName = fileName;
    contextMenuTargetIsFolder = false;

    const menu = document.getElementById('mdFileContextMenu');
    menu.style.display = 'block';
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';

    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      menu.style.left = (window.innerWidth - rect.width - 5) + 'px';
    }
    if (rect.bottom > window.innerHeight) {
      menu.style.top = (window.innerHeight - rect.height - 5) + 'px';
    }

    setTimeout(() => {
      document.addEventListener('click', hideContextMenu);
      document.addEventListener('contextmenu', hideContextMenu);
    }, 0);
  }

  function isMdFile(filePath) {
    const ext = filePath.toLowerCase();
    return ext.endsWith('.md');
  }

  // ===== 파일 아이콘 =====

  function getFileIcon(filename) {
    if (filename === 'Testcase Sync' || filename === 'Welcome') {
      return 'vvu-icon2.png';
    }

    const ext = filename.split('.').pop().toLowerCase();
    const iconMap = {
      'js': 'javascript', 'mjs': 'javascript', 'ts': 'typescript',
      'tsx': 'react', 'jsx': 'react', 'json': 'json',
      'html': 'html', 'htm': 'html', 'css': 'css',
      'scss': 'sass', 'sass': 'sass', 'less': 'less',
      'md': 'markdown', 'markdown': 'markdown', 'py': 'python',
      'java': 'java', 'c': 'c', 'cpp': 'cpp', 'h': 'c', 'hpp': 'cpp',
      'cs': 'c-sharp', 'go': 'go', 'rb': 'ruby', 'php': 'php',
      'sql': 'db', 'xml': 'xml', 'yaml': 'yml', 'yml': 'yml',
      'sh': 'shell', 'bash': 'shell', 'ps1': 'powershell',
      'vue': 'vue', 'jade': 'jade', 'pug': 'pug', 'svg': 'svg',
      'png': 'image', 'jpg': 'image', 'jpeg': 'image', 'gif': 'image', 'ico': 'image',
      'pdf': 'pdf', 'zip': 'zip', 'rar': 'zip', '7z': 'zip',
      'mp3': 'audio', 'wav': 'audio', 'mp4': 'video', 'avi': 'video',
      'rs': 'rust', 'dart': 'dart', 'swift': 'swift', 'kt': 'kotlin',
      'scala': 'scala', 'lua': 'lua', 'r': 'R', 'ex': 'elixir',
      'exs': 'elixir_script', 'erl': 'erlang', 'clj': 'clojure',
      'coffee': 'coffee', 'elm': 'elm', 'fs': 'f-sharp', 'hs': 'haskell',
      'nim': 'nim', 'pl': 'perl', 'dockerfile': 'docker',
      'gitignore': 'git_ignore', 'env': 'config', 'lock': 'lock',
      'gradle': 'gradle', 'svelte': 'svelte',
    };
    const iconName = iconMap[ext] || 'default';
    return `icons/${iconName}.svg`;
  }

  // ===== 폴더 내용 로드 =====

  async function loadFolderContents(folderPath, folderName, depth = 1) {
    const container = document.createElement('div');
    container.className = 'tree-item-children';
    container.id = `${folderName.replace(/\s+/g, '-').toLowerCase()}-children`;

    if (!window.electronAPI || !window.electronAPI.fs) {
      return container;
    }

    const items = await window.electronAPI.fs.readdir(folderPath);

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

  // ===== 트리 상호작용 =====

  function setupTreeInteraction() {
    const explorer = document.getElementById('explorer');

    explorer.addEventListener('click', (event) => {
      const treeItem = event.target.closest('.tree-item');
      if (!treeItem) return;
      if (event.target.closest('.explorer-refresh-btn')) return;

      const isFolder = treeItem.dataset.type === 'folder';

      if (isFolder) {
        toggleFolder(treeItem, event);
      } else {
        selectFile(treeItem, event);
      }
    });

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

  // ===== 유틸리티 함수 =====

  function isExcelFile(filePath) {
    const ext = filePath.toLowerCase();
    return ext.endsWith('.xlsx') || ext.endsWith('.xls') || ext.endsWith('.xlsm');
  }

  async function openWithDefaultProgram(filePath) {
    try {
      await window.electronAPI.shell.openPath(filePath);
    } catch (error) {
      console.error('Failed to open file:', error);
      if (typeof window.showToast === 'function') {
        window.showToast('error', 'Failed to open file with default program');
      }
    }
  }

  // ===== 다중 선택 =====

  function clearMultiSelection() {
    multiSelectedItems.clear();
    document.querySelectorAll('.tree-item.multi-selected').forEach(item => {
      item.classList.remove('multi-selected');
    });
  }

  function toggleMultiSelectItem(element, path, name, isFolder) {
    // 첫 번째 Ctrl+클릭 시, 기존에 선택된 항목도 다중 선택에 추가
    if (multiSelectedItems.size === 0 && selectedItemPath && selectedItemPath !== path) {
      const selectedElement = document.querySelector(
        `.tree-item.file[data-file="${CSS.escape(selectedItemPath)}"], .tree-item.folder[data-path="${CSS.escape(selectedItemPath)}"]`
      );
      if (selectedElement) {
        multiSelectedItems.add({
          path: selectedItemPath,
          name: selectedItemName,
          isFolder: selectedItemIsFolder,
          element: selectedElement
        });
        selectedElement.classList.add('multi-selected');
      }
    }

    const existingItem = [...multiSelectedItems].find(item => item.path === path);

    if (existingItem) {
      multiSelectedItems.delete(existingItem);
      element.classList.remove('multi-selected');
    } else {
      multiSelectedItems.add({ path, name, isFolder, element });
      element.classList.add('multi-selected');
    }
  }

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

  function getSelectedItems() {
    if (multiSelectedItems.size > 0) {
      return [...multiSelectedItems];
    } else if (selectedItemPath) {
      return [{ path: selectedItemPath, name: selectedItemName, isFolder: selectedItemIsFolder }];
    }
    return [];
  }

  // ===== 폴더 토글 =====

  function toggleFolder(folderElement, event = null) {
    const folderName = folderElement.dataset.name;
    const folderPath = folderElement.dataset.path;
    const childrenContainer = document.getElementById(`${folderName}-children`);
    const chevron = folderElement.querySelector('.chevron');
    const itemName = folderElement.querySelector('.tree-item-label')?.textContent || folderName;

    if (folderPath && !folderElement.classList.contains('root')) {
      const ctrlKey = event?.ctrlKey || event?.metaKey;
      const shiftKey = event?.shiftKey;

      if (ctrlKey) {
        toggleMultiSelectItem(folderElement, folderPath, itemName, true);
      } else if (shiftKey && lastClickedItemPath) {
        rangeSelectItems(lastClickedItemPath, folderPath);
      } else {
        clearMultiSelection();
        document.querySelectorAll('.tree-item.file').forEach(item => item.classList.remove('selected'));
        document.querySelectorAll('.tree-item.folder').forEach(item => item.classList.remove('selected'));
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
      if (chevron) chevron.classList.remove('expanded');
    } else {
      childrenContainer.classList.add('expanded');
      if (chevron) chevron.classList.add('expanded');
    }
  }

  // ===== 파일 선택 =====

  function selectFile(fileElement, event = null) {
    const filePath = fileElement.dataset.file;
    const fileName = window.electronAPI.fs.path.basename(filePath);
    const ctrlKey = event?.ctrlKey || event?.metaKey;
    const shiftKey = event?.shiftKey;

    if (ctrlKey) {
      toggleMultiSelectItem(fileElement, filePath, fileName, false);
    } else if (shiftKey && lastClickedItemPath) {
      rangeSelectItems(lastClickedItemPath, filePath);
    } else {
      clearMultiSelection();
      document.querySelectorAll('.tree-item.file').forEach(item => item.classList.remove('selected'));
      document.querySelectorAll('.tree-item.folder').forEach(item => item.classList.remove('selected'));

      fileElement.classList.add('selected');
      selectedItemPath = filePath;
      selectedItemName = fileName;
      selectedItemIsFolder = false;

      if (!isExcelFile(filePath)) {
        if (typeof window.openFileInEditor === 'function') {
          window.openFileInEditor(filePath);
        }
      }
    }

    lastClickedItemPath = filePath;
  }

  // ===== 경로 복사 =====

  function copyPath() {
    const targetPath = contextMenuTargetPath;

    hideContextMenu();

    if (!targetPath) return;

    navigator.clipboard.writeText(targetPath).then(() => {
      if (typeof window.showToast === 'function') {
        window.showToast('success', 'Path copied to clipboard');
      }
    }).catch(err => {
      console.error('Failed to copy path:', err);
      if (typeof window.showToast === 'function') {
        window.showToast('error', 'Failed to copy path');
      }
    });
  }

  // ===== 이름 변경 =====

  function renameItem() {
    const targetPath = contextMenuTargetPath;
    const targetName = contextMenuTargetName;
    const isFolder = contextMenuTargetIsFolder;

    hideContextMenu();

    if (!targetPath || !targetName) return;
    startInlineRename(targetPath, targetName, isFolder);
  }

  function startInlineRename(itemPath, itemName, isFolder = false) {
    let element;
    if (isFolder) {
      element = document.querySelector(`.tree-item.folder[data-path="${CSS.escape(itemPath)}"]`);
    } else {
      element = document.querySelector(`.tree-item.file[data-file="${CSS.escape(itemPath)}"]`);
    }
    if (!element) return;

    const labelElement = element.querySelector('.tree-item-label');
    if (!labelElement) return;

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
          if (selectedItemPath === itemPath) {
            selectedItemPath = newPath;
            selectedItemName = newName;
          }

          if (!isFolder && typeof window.updateTabPath === 'function') {
            window.updateTabPath(itemPath, newPath, newName);
          }

          await refreshExplorer();
        } else {
          if (typeof window.showToast === 'function') {
            window.showToast('error', 'Failed to rename: ' + (result.error || 'Unknown error'));
          }
        }
      } catch (error) {
        console.error('Error renaming:', error);
        if (typeof window.showToast === 'function') {
          window.showToast('error', 'Failed to rename');
        }
      }
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        finishRename();
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        input.remove();
        labelElement.style.display = '';
      }
    });

    input.addEventListener('blur', () => {
      setTimeout(() => {
        if (input.parentNode) {
          finishRename();
        }
      }, 100);
    });
  }

  // ===== 삭제 =====

  let pendingDeleteItems = null;
  let pendingDeleteCallback = null;

  function showDeleteConfirmation(items, onConfirm) {
    const overlay = document.getElementById('deleteConfirmOverlay');
    const header = document.getElementById('deleteConfirmHeader');
    const body = document.getElementById('deleteConfirmBody');
    const confirmBtn = document.getElementById('deleteConfirmBtn');
    const cancelBtn = document.getElementById('deleteCancelBtn');

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

    const newConfirmBtn = confirmBtn.cloneNode(true);
    const newCancelBtn = cancelBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
    cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);

    newConfirmBtn.addEventListener('click', () => {
      const callback = pendingDeleteCallback;
      hideDeleteConfirmation();
      if (callback) callback();
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

  async function deleteSelectedItems(items) {
    if (!items || items.length === 0) return;

    const hasFolders = items.some(item => item.isFolder);

    if (hasFolders) {
      showDeleteConfirmation(items, async () => {
        await performDelete(items);
      });
    } else {
      await performDelete(items);
    }
  }

  async function performDelete(items) {
    for (const item of items) {
      await deleteItemByPath(item.path, item.isFolder);
    }
    clearMultiSelection();
  }

  async function deleteItem() {
    const targetPath = contextMenuTargetPath;
    const isFolder = contextMenuTargetIsFolder;
    const targetName = contextMenuTargetName;

    hideContextMenu();

    if (!targetPath) return;

    const multiItems = getSelectedItems();
    if (multiItems.length > 1) {
      await deleteSelectedItems(multiItems);
    } else {
      const item = { path: targetPath, name: targetName, isFolder };
      if (isFolder) {
        showDeleteConfirmation([item], async () => {
          await deleteItemByPath(targetPath, isFolder);
        });
      } else {
        await deleteItemByPath(targetPath, isFolder);
      }
    }
  }

  async function deleteItemByPath(itemPath, isFolder = false) {
    try {
      let result;
      if (isFolder) {
        result = await window.electronAPI.fs.deleteFolder(itemPath);
      } else {
        result = await window.electronAPI.fs.delete(itemPath);
      }

      if (result.success) {
        if (selectedItemPath === itemPath) {
          selectedItemPath = null;
          selectedItemName = null;
          selectedItemIsFolder = false;
        }

        if (!isFolder && typeof window.closeTabByPath === 'function') {
          window.closeTabByPath(itemPath);
        } else if (isFolder && typeof window.closeTabsInFolder === 'function') {
          window.closeTabsInFolder(itemPath);
        }

        await refreshExplorer();
      } else {
        const itemType = isFolder ? 'folder' : 'file';
        if (typeof window.showToast === 'function') {
          window.showToast('error', `Failed to delete ${itemType}: ` + (result.error || 'Unknown error'));
        }
      }
    } catch (error) {
      console.error('Error deleting:', error);
      if (typeof window.showToast === 'function') {
        window.showToast('error', 'Failed to delete');
      }
    }
  }

  // ===== Explorer 새로고침 =====

  async function refreshExplorer() {
    if (currentProjectPath) {
      const expandedFolders = new Set();
      document.querySelectorAll('.tree-item-children.expanded').forEach(el => {
        expandedFolders.add(el.id);
      });

      await loadProjectFiles(currentProjectPath);

      expandedFolders.forEach(folderId => {
        const children = document.getElementById(folderId);
        if (children) {
          children.classList.add('expanded');
          const folder = children.previousElementSibling;
          if (folder && folder.classList.contains('folder')) {
            const chevron = folder.querySelector('.chevron');
            if (chevron) chevron.classList.add('expanded');
          }
        }
      });
    }
  }

  // ===== Explorer에서 파일 하이라이트 =====

  async function highlightFileInExplorer(filePath) {
    const testcaseFolder = document.querySelector('.tree-item.folder[data-name="testcase"]');
    if (testcaseFolder) {
      const childrenContainer = document.getElementById('testcase-children');
      if (childrenContainer && !childrenContainer.classList.contains('expanded')) {
        childrenContainer.classList.add('expanded');
        const chevron = testcaseFolder.querySelector('.chevron');
        if (chevron) chevron.classList.add('expanded');
      }
    }

    const fileElement = document.querySelector(`.tree-item.file[data-file="${CSS.escape(filePath)}"]`);
    if (fileElement) {
      document.querySelectorAll('.tree-item.file').forEach(item => item.classList.remove('selected'));

      fileElement.classList.add('selected');
      selectedItemPath = filePath;
      selectedItemName = window.electronAPI.fs.path.basename(filePath);
      selectedItemIsFolder = false;

      fileElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  // ===== Explorer 키보드 이벤트 =====

  function handleExplorerKeyDown(e) {
    const activeElement = document.activeElement;
    if (activeElement && (
      activeElement.closest('#monaco-container') ||
      activeElement.closest('#terminalContent') ||
      activeElement.tagName === 'INPUT' ||
      activeElement.tagName === 'TEXTAREA'
    )) {
      return;
    }

    if (e.key === 'Delete') {
      const itemsToDelete = getSelectedItems();
      if (itemsToDelete.length > 0) {
        e.preventDefault();
        deleteSelectedItems(itemsToDelete);
      }
    }

    if (e.key === 'F2' && selectedItemPath) {
      e.preventDefault();
      startInlineRename(selectedItemPath, selectedItemName, selectedItemIsFolder);
    }

    // 화살표 키 네비게이션
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      navigateExplorer(e.key === 'ArrowUp' ? -1 : 1);
    }
  }

  // ===== 화살표 키 네비게이션 =====

  function navigateExplorer(direction) {
    // 보이는 모든 항목 수집 (확장된 폴더의 자식들만)
    const visibleItems = getVisibleTreeItems();
    if (visibleItems.length === 0) return;

    // 현재 선택된 항목의 인덱스 찾기
    let currentIndex = -1;
    if (selectedItemPath) {
      currentIndex = visibleItems.findIndex(item => {
        const path = item.dataset.file || item.dataset.path;
        return path === selectedItemPath;
      });
    }

    // 다음/이전 항목 계산
    let nextIndex;
    if (currentIndex === -1) {
      nextIndex = direction === 1 ? 0 : visibleItems.length - 1;
    } else {
      nextIndex = currentIndex + direction;
      if (nextIndex < 0) nextIndex = 0;
      if (nextIndex >= visibleItems.length) nextIndex = visibleItems.length - 1;
    }

    if (nextIndex === currentIndex) return;

    const nextItem = visibleItems[nextIndex];
    const isFolder = nextItem.dataset.type === 'folder';
    const path = nextItem.dataset.file || nextItem.dataset.path;
    const name = nextItem.querySelector('.tree-item-label')?.textContent || '';

    // 이전 선택 해제
    clearMultiSelection();
    document.querySelectorAll('.tree-item.file').forEach(item => item.classList.remove('selected'));
    document.querySelectorAll('.tree-item.folder').forEach(item => item.classList.remove('selected'));

    // 새 항목 선택
    nextItem.classList.add('selected');
    selectedItemPath = path;
    selectedItemName = name;
    selectedItemIsFolder = isFolder;
    lastClickedItemPath = path;

    // 스크롤하여 보이게
    nextItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    // 파일인 경우 현재 탭 내용 교체 (새 탭 열지 않음)
    if (!isFolder && !isExcelFile(path)) {
      replaceCurrentTabWithFile(path);
    }
  }

  function getVisibleTreeItems() {
    const items = [];
    const allItems = document.querySelectorAll('.tree-item.file, .tree-item.folder:not(.root)');

    allItems.forEach(item => {
      // 부모 컨테이너들이 모두 expanded인지 확인
      let parent = item.parentElement;
      let isVisible = true;

      while (parent && !parent.id?.includes('explorer')) {
        if (parent.classList.contains('tree-item-children') && !parent.classList.contains('expanded')) {
          isVisible = false;
          break;
        }
        parent = parent.parentElement;
      }

      if (isVisible) {
        items.push(item);
      }
    });

    return items;
  }

  async function replaceCurrentTabWithFile(filePath) {
    const fileName = window.electronAPI.fs.path.basename(filePath);
    const openTabs = window.getOpenTabs ? window.getOpenTabs() : [];
    const activeTabIndex = window.getActiveTabIndex ? window.getActiveTabIndex() : -1;

    // 이미 열린 탭인지 확인
    const existingTabIndex = openTabs.findIndex(tab => tab.filePath === filePath);
    if (existingTabIndex !== -1) {
      // 이미 열려있으면 해당 탭으로 전환
      if (typeof window.switchToTab === 'function') {
        window.switchToTab(existingTabIndex);
      }
      return;
    }

    // 현재 활성 탭이 있고, 일반 파일 탭인 경우 내용 교체
    if (activeTabIndex >= 0 && activeTabIndex < openTabs.length) {
      const currentTab = openTabs[activeTabIndex];

      // 특수 탭이 아닌 일반 파일 탭인 경우에만 교체
      if (currentTab.type === 'text' && currentTab.filePath && !currentTab.filePath.startsWith('__')) {
        // 변경사항이 없는 경우에만 교체
        if (currentTab.content === currentTab.originalContent) {
          // 이전 파일 감시 중지
          if (currentTab.filePath) {
            window.electronAPI.fileWatch.stop(currentTab.filePath);
          }

          // 새 파일 내용 읽기
          const fileContent = await window.electronAPI.fs.readFile(filePath);
          const isCanvas = fileName.endsWith('.canvas');

          // 현재 탭 정보 업데이트
          currentTab.filePath = filePath;
          currentTab.fileName = fileName;
          currentTab.type = isCanvas ? 'canvas' : 'text';
          currentTab.content = fileContent;
          currentTab.originalContent = fileContent;

          // 새 파일 감시 시작
          window.electronAPI.fileWatch.start(filePath);

          // UI 업데이트
          if (typeof window.renderTabs === 'function') {
            window.renderTabs();
          }
          if (typeof window.renderActiveTabContent === 'function') {
            window.renderActiveTabContent();
          }
          return;
        }
      }
    }

    // 교체할 수 없는 경우 (특수 탭이거나 변경사항 있음) 새 탭으로 열기
    if (typeof window.openFileInEditor === 'function') {
      window.openFileInEditor(filePath);
    }
  }

  // ===== Getter 함수들 =====

  function getCurrentProjectPath() {
    return currentProjectPath;
  }

  function getSelectedItemInfo() {
    return {
      path: selectedItemPath,
      name: selectedItemName,
      isFolder: selectedItemIsFolder
    };
  }

  function getContextMenuTarget() {
    return {
      path: contextMenuTargetPath,
      name: contextMenuTargetName,
      isFolder: contextMenuTargetIsFolder
    };
  }

  // ===== 전역 노출 =====
  window.loadProjectFiles = loadProjectFiles;
  window.createFolderElement = createFolderElement;
  window.createFileElement = createFileElement;
  window.showContextMenu = showContextMenu;
  window.hideContextMenu = hideContextMenu;
  window.showExcelContextMenu = showExcelContextMenu;
  window.openExcelWithProgram = openExcelWithProgram;
  window.showTestcaseFolderContextMenu = showTestcaseFolderContextMenu;
  window.getFileIcon = getFileIcon;
  window.loadFolderContents = loadFolderContents;
  window.setupTreeInteraction = setupTreeInteraction;
  window.isExcelFile = isExcelFile;
  window.openWithDefaultProgram = openWithDefaultProgram;
  window.clearMultiSelection = clearMultiSelection;
  window.toggleMultiSelectItem = toggleMultiSelectItem;
  window.rangeSelectItems = rangeSelectItems;
  window.getSelectedItems = getSelectedItems;
  window.toggleFolder = toggleFolder;
  window.selectFile = selectFile;
  window.copyPath = copyPath;
  window.renameItem = renameItem;
  window.startInlineRename = startInlineRename;
  window.showDeleteConfirmation = showDeleteConfirmation;
  window.hideDeleteConfirmation = hideDeleteConfirmation;
  window.deleteSelectedItems = deleteSelectedItems;
  window.deleteItem = deleteItem;
  window.deleteItemByPath = deleteItemByPath;
  window.refreshExplorer = refreshExplorer;
  window.highlightFileInExplorer = highlightFileInExplorer;
  window.handleExplorerKeyDown = handleExplorerKeyDown;
  window.getCurrentProjectPath = getCurrentProjectPath;
  window.getSelectedItemInfo = getSelectedItemInfo;
  window.getContextMenuTarget = getContextMenuTarget;

})();
