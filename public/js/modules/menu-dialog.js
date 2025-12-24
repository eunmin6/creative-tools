/**
 * Menu & Dialog Module
 * 메뉴, 모달, 토스트, 윈도우 컨트롤, Activity Bar 기능을 담당하는 모듈
 */

(function() {
  'use strict';

  // ===== 모듈 내부 상태 =====

  // 메뉴 상태
  let menuOpen = false;
  let activeMenuId = null;

  // 사이드바 상태
  let sidebarVisible = false;
  let currentActiveView = null;
  let folderOpened = false;

  // Output 패널 상태
  let outputPanelVisible = true;

  // ===== 메뉴 관련 =====

  function closeAllMenus() {
    document.querySelectorAll('.dropdown-menu').forEach(menu => {
      menu.classList.remove('show');
    });
    menuOpen = false;
    activeMenuId = null;
  }

  function openMenu(menuId) {
    closeAllMenus();
    const dropdown = document.getElementById(menuId + 'Dropdown');
    if (dropdown) {
      dropdown.classList.add('show');
      menuOpen = true;
      activeMenuId = menuId;
    }
  }

  function toggleMenu(menuId, event) {
    event.stopPropagation();

    if (activeMenuId === menuId && menuOpen) {
      closeAllMenus();
    } else {
      openMenu(menuId);

      const closeOnClick = (e) => {
        if (!e.target.closest('.menu-with-dropdown')) {
          closeAllMenus();
          document.removeEventListener('click', closeOnClick);
        }
      };
      setTimeout(() => document.addEventListener('click', closeOnClick), 0);
    }
  }

  function hoverMenu(menuId, event) {
    if (menuOpen && activeMenuId !== menuId) {
      openMenu(menuId);
    }
  }

  // ===== 폴더 열기 =====

  async function openFolder() {
    if (!window.electronAPI || !window.electronAPI.dialog) {
      console.error('Dialog API not available');
      return;
    }

    const folderPath = await window.electronAPI.dialog.openFolder();
    if (folderPath) {
      await window.loadProjectFiles(folderPath);

      // 기존 Chat 히스토리 파일들 삭제
      try {
        await window.electronAPI.fs.delete(folderPath + '/.vvu.prompt.history.md');
      } catch (error) { }
      try {
        await window.electronAPI.fs.delete(folderPath + '/.vvu.prompt.last.md');
      } catch (error) { }

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

      enableConfigurationMenu();
    }
  }

  function openFolderFromMenu(event) {
    if (event) event.stopPropagation();
    closeAllMenus();
    openFolder();
  }

  // ===== Configuration 메뉴 =====

  function enableConfigurationMenu() {
    const configMenuItem = document.getElementById('configMenuItem');
    if (configMenuItem) {
      configMenuItem.style.color = '#cccccc';
      configMenuItem.style.pointerEvents = 'auto';
    }
  }

  function disableConfigurationMenu() {
    const configMenuItem = document.getElementById('configMenuItem');
    if (configMenuItem) {
      configMenuItem.style.color = '#6e6e6e';
      configMenuItem.style.pointerEvents = 'none';
    }
  }

  // ===== Activity Bar =====

  function setupActivityBar() {
    const activityBarItems = document.querySelectorAll('.activity-bar-item');
    const sidebar = document.querySelector('.sidebar');
    const resizer = document.querySelector('.sidebar-resizer');

    activityBarItems.forEach(item => {
      item.addEventListener('click', () => {
        const view = item.dataset.view;

        if (!folderOpened) return;

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

        if (!sidebarVisible) {
          sidebarVisible = true;
          sidebar.style.display = 'flex';
          resizer.style.display = 'block';
        }

        activityBarItems.forEach(i => i.classList.remove('active'));
        item.classList.add('active');
        currentActiveView = view;

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

  // ===== 사이드바 리사이저 =====

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

  // ===== 윈도우 컨트롤 =====

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

  function toggleDevTools() {
    if (window.electronAPI && window.electronAPI.devtools) {
      window.electronAPI.devtools.toggle();
    }
  }

  // ===== 모달 =====

  function showModal(title, message, onSave, onDontSave, onCancel, saveLabel = 'Save', dontSaveLabel = "Don't Save") {
    const overlay = document.getElementById('modalOverlay');
    const headerEl = document.getElementById('modalHeader');
    const bodyEl = document.getElementById('modalBody');

    headerEl.textContent = title;
    bodyEl.textContent = message;

    overlay.classList.add('show');

    const saveBtn = document.getElementById('modalSaveBtn');
    const dontSaveBtn = document.getElementById('modalDontSaveBtn');
    const cancelBtn = document.getElementById('modalCancelBtn');

    // 버튼 라벨 업데이트
    if (saveBtn) saveBtn.textContent = saveLabel;
    if (dontSaveBtn) dontSaveBtn.textContent = dontSaveLabel;

    const newSaveBtn = saveBtn.cloneNode(true);
    const newDontSaveBtn = dontSaveBtn.cloneNode(true);
    const newCancelBtn = cancelBtn.cloneNode(true);

    saveBtn.parentNode.replaceChild(newSaveBtn, saveBtn);
    dontSaveBtn.parentNode.replaceChild(newDontSaveBtn, dontSaveBtn);
    cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);

    newSaveBtn.addEventListener('click', () => {
      hideModal();
      if (onSave) onSave();
    });

    newDontSaveBtn.addEventListener('click', () => {
      hideModal();
      if (onDontSave) onDontSave();
    });

    newCancelBtn.addEventListener('click', () => {
      hideModal();
      if (onCancel) onCancel();
    });

    const escHandler = (e) => {
      if (e.key === 'Escape') {
        hideModal();
        if (onCancel) onCancel();
        document.removeEventListener('keydown', escHandler);
      }
    };
    document.addEventListener('keydown', escHandler);
  }

  function hideModal() {
    const overlay = document.getElementById('modalOverlay');
    overlay.classList.remove('show');
  }

  // ===== 토스트 =====

  function showToast(type, message, duration = 3000) {
    // 토스트 알림 비활성화
    return;

    /*
    const container = document.getElementById('toastContainer');

    let icon = '';
    switch(type) {
      case 'success': icon = '✓'; break;
      case 'error': icon = '✕'; break;
      case 'warning': icon = '⚠'; break;
      case 'info':
      default: icon = 'ℹ';
    }

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    toast.innerHTML = `
      <div class="toast-icon">${icon}</div>
      <div class="toast-message">${message}</div>
      <div class="toast-close">✕</div>
    `;

    const closeBtn = toast.querySelector('.toast-close');
    closeBtn.addEventListener('click', () => removeToast(toast));

    container.appendChild(toast);

    setTimeout(() => removeToast(toast), duration);
    */
  }

  function removeToast(toast) {
    toast.classList.add('removing');
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 300);
  }

  // ===== HTML 이스케이프 =====

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ===== Excel 파일 찾아보기 =====

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

  // ===== Codebeamer =====

  function loadFromCodebeamer() {
    showToast('info', 'Codebeamer connection feature coming soon.');
  }

  // ===== Excel에서 가져오기 =====

  async function importFromExcel() {
    try {
      const filePath = await window.electronAPI.dialog.openFile({
        filters: [{ name: 'Excel Files', extensions: ['xlsx', 'xls'] }]
      });

      if (filePath) {
        if (!outputPanelVisible) {
          const panel = document.getElementById('bottomPanel');
          const checkmark = document.getElementById('outputCheckmark');
          panel.classList.add('show');
          if (checkmark) checkmark.textContent = '✓';
          outputPanelVisible = true;
        }

        if (typeof window.switchBottomTab === 'function') {
          window.switchBottomTab('output');
        }

        if (typeof window.appendOutput === 'function') {
          window.appendOutput(`Selected Excel file: ${filePath}`, 'info');
        }
        if (typeof window.runPythonScript === 'function') {
          await window.runPythonScript('scripts/excel_handler.py', [filePath]);
        }
      }
    } catch (error) {
      console.error('Error opening file dialog:', error);
    }
  }

  // ===== Getter/Setter =====

  function isFolderOpened() {
    return folderOpened;
  }

  function setFolderOpened(value) {
    folderOpened = value;
  }

  function isOutputPanelVisible() {
    return outputPanelVisible;
  }

  function setOutputPanelVisible(value) {
    outputPanelVisible = value;
  }

  // ===== 전역 노출 =====
  window.closeAllMenus = closeAllMenus;
  window.openMenu = openMenu;
  window.toggleMenu = toggleMenu;
  window.hoverMenu = hoverMenu;
  window.openFolder = openFolder;
  window.openFolderFromMenu = openFolderFromMenu;
  window.enableConfigurationMenu = enableConfigurationMenu;
  window.disableConfigurationMenu = disableConfigurationMenu;
  window.setupActivityBar = setupActivityBar;
  window.setupSidebarResizer = setupSidebarResizer;
  window.minimizeWindow = minimizeWindow;
  window.maximizeWindow = maximizeWindow;
  window.closeWindow = closeWindow;
  window.toggleDevTools = toggleDevTools;
  window.showModal = showModal;
  window.hideModal = hideModal;
  window.showToast = showToast;
  window.removeToast = removeToast;
  window.escapeHtml = escapeHtml;
  window.browseExcelFile = browseExcelFile;
  window.loadFromCodebeamer = loadFromCodebeamer;
  window.importFromExcel = importFromExcel;
  window.isFolderOpened = isFolderOpened;
  window.setFolderOpened = setFolderOpened;
  window.isOutputPanelVisible = isOutputPanelVisible;
  window.setOutputPanelVisible = setOutputPanelVisible;

})();
