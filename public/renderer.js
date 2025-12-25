/**
 * Creative Tools - Main Renderer
 * 이 파일은 모듈들을 조율하고 초기화하는 역할을 담당합니다.
 *
 * 모듈 구성:
 * - constants.js: 상수 및 전역 상태
 * - file-explorer.js: 파일 탐색기 기능
 * - tab-manager.js: 탭 관리 기능
 * - menu-dialog.js: 메뉴, 모달, 토스트, 윈도우 컨트롤
 * - canvas-editor.js: 캔버스 에디터
 * - chat-panel.js: AI Chat 패널
 * - output-panel.js: OUTPUT 패널
 * - terminal.js: 터미널
 */

// DOM 로드 완료 시 초기화
window.addEventListener('DOMContentLoaded', () => {
  initializeApp();
});

function initializeApp() {
  // 모듈 초기화 (setupTreeInteraction은 file-explorer.js에서 제공)
  if (typeof window.setupTreeInteraction === 'function') {
    window.setupTreeInteraction();
  }
  if (typeof window.setupActivityBar === 'function') {
    window.setupActivityBar();
  }
  if (typeof window.setupSidebarResizer === 'function') {
    window.setupSidebarResizer();
  }
  setupGlobalKeyboardEvents();
  initMonaco();
  setupPythonStreamListeners();
  setupFileWatchListeners();
  if (typeof window.initChat === 'function') {
    window.initChat();
  }
}

// ===== 파일 감시 이벤트 리스너 =====

function setupFileWatchListeners() {
  window.electronAPI.fileWatch.onChanged((filePath) => {
    console.log('File changed:', filePath);
    handleFileChanged(filePath);
  });

  window.electronAPI.fileWatch.onDeleted((filePath) => {
    console.log('File deleted:', filePath);
    handleFileDeleted(filePath);
  });
}

async function handleFileChanged(filePath) {
  const openTabs = window.getOpenTabs ? window.getOpenTabs() : [];
  const activeTabIndex = window.getActiveTabIndex ? window.getActiveTabIndex() : -1;

  const tabIndex = openTabs.findIndex(tab => tab.filePath === filePath);
  if (tabIndex === -1) return;

  const tab = openTabs[tabIndex];

  if (tab.content === tab.originalContent) {
    const newContent = await window.electronAPI.fs.readFile(filePath);
    tab.content = newContent;
    tab.originalContent = newContent;

    if (tabIndex === activeTabIndex) {
      const monacoEditor = window.getMonacoEditor ? window.getMonacoEditor() : null;
      if (monacoEditor && tab.type === 'text') {
        const currentPosition = monacoEditor.getPosition();
        monacoEditor.setValue(newContent);
        if (currentPosition) {
          monacoEditor.setPosition(currentPosition);
        }
      } else if (tab.type === 'canvas') {
        if (typeof window.renderActiveTabContent === 'function') {
          window.renderActiveTabContent();
        }
      }
    }

    console.log('File auto-reloaded:', filePath);
  } else {
    showFileChangedNotification(tabIndex, filePath);
  }
}

function showFileChangedNotification(tabIndex, filePath) {
  const openTabs = window.getOpenTabs ? window.getOpenTabs() : [];
  const activeTabIndex = window.getActiveTabIndex ? window.getActiveTabIndex() : -1;
  const tab = openTabs[tabIndex];
  const fileName = tab.fileName;

  if (typeof window.showModal === 'function') {
    window.showModal(
      'File Changed',
      `The file "${fileName}" has been changed externally. Do you want to reload it? Your unsaved changes will be lost.`,
      async () => {
        const newContent = await window.electronAPI.fs.readFile(filePath);
        tab.content = newContent;
        tab.originalContent = newContent;

        if (tabIndex === activeTabIndex) {
          const monacoEditor = window.getMonacoEditor ? window.getMonacoEditor() : null;
          if (monacoEditor && tab.type === 'text') {
            monacoEditor.setValue(newContent);
          } else {
            if (typeof window.renderActiveTabContent === 'function') {
              window.renderActiveTabContent();
            }
          }
        }
        if (typeof window.renderTabs === 'function') {
          window.renderTabs();
        }
      },
      () => { },
      null,
      'Reload',
      'Keep My Changes'
    );
  }
}

function handleFileDeleted(filePath) {
  const openTabs = window.getOpenTabs ? window.getOpenTabs() : [];
  const tabIndex = openTabs.findIndex(tab => tab.filePath === filePath);
  if (tabIndex === -1) return;

  const tab = openTabs[tabIndex];
  const fileName = tab.fileName;

  if (typeof window.showModal === 'function') {
    window.showModal(
      'File Deleted',
      `The file "${fileName}" has been deleted externally.`,
      () => {
        if (typeof window.performCloseTab === 'function') {
          window.performCloseTab(tabIndex);
        }
      },
      () => { },
      null,
      'Close Tab',
      'Keep Open'
    );
  }
}

// ===== Python 스트리밍 이벤트 =====

let currentPythonProcessId = null;
let tcSyncRunning = false;

function setupPythonStreamListeners() {
  window.electronAPI.python.onOutput((data) => {
    if (data.processId === currentPythonProcessId) {
      handlePythonOutput(data.data, data.isError);
    }
  });

  window.electronAPI.python.onExit((data) => {
    if (data.processId === currentPythonProcessId) {
      handlePythonExit(data.code, data.error);
    }
  });
}

function handlePythonOutput(output, isError) {
  const lines = output.split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;

    if (line.startsWith('PROGRESS:')) {
      const match = line.match(/PROGRESS:(\d+)\/(\d+)/);
      if (match) {
        const current = parseInt(match[1]);
        const total = parseInt(match[2]);
        const percent = Math.round((current / total) * 100);
        updateTcProgress(percent, `Processing ${current} of ${total}...`);
      }
    } else if (line.startsWith('CREATED:')) {
      const fileName = line.replace('CREATED:', '').trim();
      updateTcCurrentFile(fileName);
      if (typeof window.appendOutput === 'function') {
        window.appendOutput(`Created: ${fileName}`, 'success');
      }
      const currentProjectPath = window.getCurrentProjectPath ? window.getCurrentProjectPath() : null;
      if (typeof window.refreshExplorer === 'function') {
        window.refreshExplorer().then(() => {
          if (typeof window.highlightFileInExplorer === 'function' && currentProjectPath) {
            window.highlightFileInExplorer(currentProjectPath + '\\testcase\\' + fileName);
          }
        });
      }
    } else {
      if (typeof window.appendOutput === 'function') {
        window.appendOutput(line, isError ? 'error' : 'info');
      }
    }
  }
}

function handlePythonExit(code, error) {
  if (code === 0) {
    updateTcProgress(100, 'Completed!');
    if (typeof window.appendOutput === 'function') {
      window.appendOutput('TC Sync completed successfully!', 'success');
    }
  } else if (error) {
    if (typeof window.appendOutput === 'function') {
      window.appendOutput(`Error: ${error}`, 'error');
    }
    updateTcProgress(0, 'Error');
  } else {
    if (typeof window.appendOutput === 'function') {
      window.appendOutput(`Process exited with code ${code}`, 'warning');
    }
    updateTcProgress(0, 'Stopped');
  }

  tcSyncRunning = false;
  currentPythonProcessId = null;

  const startBtn = document.getElementById('tcStartBtn');
  const stopBtn = document.getElementById('tcStopBtn');
  if (startBtn) startBtn.style.display = 'flex';
  if (stopBtn) stopBtn.style.display = 'none';
}

// ===== Monaco Editor 초기화 =====

function initMonaco() {
  require(['vs/editor/editor.main'], function() {
    if (typeof window.setMonacoReady === 'function') {
      window.setMonacoReady(true);
    }

    // 다크 테마 정의
    monaco.editor.defineTheme('custom-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': '#1e1e1e',
        'editor.lineHighlightBackground': '#2a2a2a',
      }
    });

    // 라이트 테마 정의
    monaco.editor.defineTheme('custom-light', {
      base: 'vs',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': '#ffffff',
        'editor.lineHighlightBackground': '#f5f5f5',
      }
    });

    // 현재 앱 테마에 맞는 Monaco 테마 설정
    const currentThemeType = document.body.dataset.themeType || 'dark';
    monaco.editor.setTheme(currentThemeType === 'light' ? 'custom-light' : 'custom-dark');
  });
}

// ===== 전역 키보드 이벤트 =====

function setupGlobalKeyboardEvents() {
  document.addEventListener('keydown', (e) => {
    if (typeof window.handleCanvasKeyDown === 'function') {
      window.handleCanvasKeyDown(e);
    }
  });
  document.addEventListener('keydown', (e) => {
    if (typeof window.handleExplorerKeyDown === 'function') {
      window.handleExplorerKeyDown(e);
    }
  });
}

// ===== TC ID로 testcase 파일 열기 =====

async function openTestcaseFile(tcId) {
  const currentProjectPath = window.getCurrentProjectPath ? window.getCurrentProjectPath() : null;
  if (!currentProjectPath || !tcId) return;

  const testcasePath = `${currentProjectPath}/testcase/${tcId}.md`;

  try {
    const content = await window.electronAPI.fs.readFile(testcasePath);
    if (content !== null) {
      if (typeof window.openFileInEditor === 'function') {
        window.openFileInEditor(testcasePath);
      }
    } else {
      if (typeof window.showToast === 'function') {
        window.showToast('error', `Testcase file not found: ${tcId}.md`);
      }
    }
  } catch (error) {
    console.error('Error opening testcase file:', error);
    if (typeof window.showToast === 'function') {
      window.showToast('error', `Failed to open testcase: ${tcId}`);
    }
  }
}

// ===== Categorize 기능 =====

let categorizeRunning = false;
let categorizeFolderPath = null;
let categorizeProcessId = null;

function openCategorize() {
  const target = window.getContextMenuTarget ? window.getContextMenuTarget() : {};
  const folderPath = target.path;
  const folderName = target.name;

  if (typeof window.hideContextMenu === 'function') {
    window.hideContextMenu();
  }

  if (!folderPath) return;

  const openTabs = window.getOpenTabs ? window.getOpenTabs() : [];
  const existingTabIndex = openTabs.findIndex(tab =>
    tab.type === 'categorize' && tab.folderPath === folderPath
  );

  if (existingTabIndex !== -1) {
    if (typeof window.switchToTab === 'function') {
      window.switchToTab(existingTabIndex);
    }
    renderCategorize(folderPath, folderName);
    return;
  }

  if (typeof window.addSpecialTab === 'function') {
    window.addSpecialTab({
      type: 'categorize',
      fileName: `Categorize: ${folderName}`,
      folderPath: folderPath,
      folderName: folderName
    });
  }
  renderCategorize(folderPath, folderName);
}

function renderCategorize(folderPath, folderName) {
  const editorArea = document.querySelector('.editor-area');
  categorizeFolderPath = folderPath;

  const escapeHtml = window.escapeHtml || ((text) => text);

  editorArea.innerHTML = `
    <div class="categorize-view" style="padding: 40px 60px; font-family: 'Segoe UI', sans-serif; max-width: 600px;">
      <h1 style="font-size: 28px; font-weight: 600; margin-bottom: 8px; color: #cccccc;">Categorize</h1>
      <p style="font-size: 14px; color: #858585; margin-bottom: 32px;">Categorize testcases in <strong style="color: #cccccc;">${escapeHtml(folderName)}</strong></p>

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
              <div style="font-size: 12px; color: #858585; margin-top: 2px;">Categorize by automation status</div>
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
              <div style="font-size: 12px; color: #858585; margin-top: 2px;">Categorize by test method</div>
            </div>
          </label>
          <label class="categorize-option" style="display: flex; align-items: center; padding: 10px 0; cursor: pointer;">
            <input type="checkbox" id="catOptImplType" style="width: 18px; height: 18px; margin-right: 12px; accent-color: #007acc;">
            <div>
              <div style="font-size: 14px; color: #cccccc;">Implementation Type</div>
              <div style="font-size: 12px; color: #858585; margin-top: 2px;">Categorize by implementation type</div>
            </div>
          </label>
        </div>
      </div>

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

function updateCategorizeProgress(percent, text) {
  const progressBar = document.getElementById('catProgressBar');
  const progressText = document.getElementById('catProgressText');
  const progressPercent = document.getElementById('catProgressPercent');

  if (progressBar) progressBar.style.width = percent + '%';
  if (progressText) progressText.textContent = text;
  if (progressPercent) progressPercent.textContent = percent + '%';
}

async function startCategorize() {
  const options = {
    automation: document.getElementById('catOptAutomation')?.checked,
    module: document.getElementById('catOptModule')?.checked,
    testMethod: document.getElementById('catOptTestMethod')?.checked,
    implType: document.getElementById('catOptImplType')?.checked
  };

  if (!options.automation && !options.module && !options.testMethod && !options.implType) {
    if (typeof window.showToast === 'function') {
      window.showToast('warning', 'Please select at least one option.');
    }
    return;
  }

  if (!categorizeFolderPath) {
    if (typeof window.showToast === 'function') {
      window.showToast('error', 'No folder selected for categorization.');
    }
    return;
  }

  categorizeRunning = true;

  const startBtn = document.getElementById('catStartBtn');
  const stopBtn = document.getElementById('catStopBtn');
  const currentFileEl = document.getElementById('catCurrentFile');
  if (startBtn) startBtn.style.display = 'none';
  if (stopBtn) stopBtn.style.display = 'flex';

  updateCategorizeProgress(0, 'Starting...');
  if (typeof window.appendOutput === 'function') {
    window.appendOutput('=== Categorizer Started ===', 'info');
    window.appendOutput(`Target folder: ${categorizeFolderPath}`, 'info');
  }

  try {
    const projectRoot = await window.electronAPI.getProjectRoot();
    const scriptPath = projectRoot + '/scripts/categorizer.py';
    const optionsJson = JSON.stringify(options);

    if (typeof window.appendOutput === 'function') {
      window.appendOutput(`Options: ${optionsJson}`, 'info');
    }

    const result = await window.electronAPI.python.runStreaming(scriptPath, [categorizeFolderPath, optionsJson]);
    categorizeProcessId = result.processId;

    window.electronAPI.python.onOutput((data) => {
      if (data.processId !== categorizeProcessId) return;

      const lines = data.data.split('\n');
      for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine) continue;

        if (data.isError) {
          if (typeof window.appendOutput === 'function') {
            window.appendOutput(trimmedLine, 'error');
          }
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
          if (typeof window.appendOutput === 'function') {
            window.appendOutput(`Excel file created: ${outputPath}`, 'success');
          }
          if (typeof window.showToast === 'function') {
            window.showToast('success', 'Categorization completed! Excel file created.');
          }
          if (typeof window.refreshExplorer === 'function') {
            window.refreshExplorer();
          }
        } else if (trimmedLine.startsWith('Found ')) {
          if (currentFileEl) currentFileEl.textContent = trimmedLine;
          if (typeof window.appendOutput === 'function') {
            window.appendOutput(trimmedLine, 'info');
          }
        } else {
          if (typeof window.appendOutput === 'function') {
            window.appendOutput(trimmedLine, 'info');
          }
        }
      }
    });

    window.electronAPI.python.onExit((data) => {
      if (data.processId !== categorizeProcessId) return;

      categorizeRunning = false;
      categorizeProcessId = null;

      if (startBtn) startBtn.style.display = 'flex';
      if (stopBtn) stopBtn.style.display = 'none';

      if (data.code !== 0 && data.error) {
        if (typeof window.showToast === 'function') {
          window.showToast('error', 'Categorization failed: ' + data.error);
        }
        updateCategorizeProgress(0, 'Failed');
        if (typeof window.appendOutput === 'function') {
          window.appendOutput(`Categorization failed: ${data.error}`, 'error');
        }
      } else if (data.code === 0) {
        if (typeof window.appendOutput === 'function') {
          window.appendOutput('=== Categorizer Finished ===', 'success');
        }
      }
    });

  } catch (error) {
    console.error('Error starting categorizer:', error);
    if (typeof window.showToast === 'function') {
      window.showToast('error', 'Failed to start categorization: ' + error.message);
    }
    if (typeof window.appendOutput === 'function') {
      window.appendOutput(`Error: ${error.message}`, 'error');
    }
    categorizeRunning = false;
    if (startBtn) startBtn.style.display = 'flex';
    if (stopBtn) stopBtn.style.display = 'none';
  }
}

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

// ===== Testcase Sync =====

function openTestcaseSync(event) {
  if (event) event.stopPropagation();

  if (typeof window.closeAllMenus === 'function') {
    window.closeAllMenus();
  }

  const openTabs = window.getOpenTabs ? window.getOpenTabs() : [];
  const existingTabIndex = openTabs.findIndex(tab => tab.filePath === '__testcase_sync__');
  if (existingTabIndex !== -1) {
    if (typeof window.switchToTab === 'function') {
      window.switchToTab(existingTabIndex);
    }
    return;
  }

  if (typeof window.addSpecialTab === 'function') {
    window.addSpecialTab({
      filePath: '__testcase_sync__',
      fileName: 'Testcase Sync',
      type: 'testcase-sync',
      content: null,
      originalContent: null
    });
  }
  renderTestcaseSync();
}

async function renderTestcaseSync() {
  const editorArea = document.querySelector('.editor-area');
  const config = await loadConfiguration();
  const excelPath = config.excel?.syncPath || '';
  const escapeHtml = window.escapeHtml || ((text) => text);

  editorArea.innerHTML = `
    <div class="testcase-sync" style="padding: 40px 60px; font-family: 'Segoe UI', sans-serif; max-width: 600px;">
      <h1 style="font-size: 28px; font-weight: 600; margin-bottom: 8px; color: #cccccc;">Testcase Sync</h1>
      <p style="font-size: 14px; color: #858585; margin-bottom: 32px;">Import testcases from Excel and generate TC files.</p>

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

  const input = document.getElementById('tcExcelPath');
  if (input) {
    input.addEventListener('focus', () => input.style.borderColor = '#007acc');
    input.addEventListener('blur', () => input.style.borderColor = '#5a5a5a');
  }
}

async function selectTcExcelFile() {
  try {
    const filePath = await window.electronAPI.dialog.openFile({
      filters: [{ name: 'Excel Files', extensions: ['xlsx', 'xls'] }]
    });

    if (filePath) {
      const inputEl = document.getElementById('tcExcelPath');
      if (inputEl) {
        inputEl.value = filePath;
      }
      await saveTcExcelPath(filePath);
    }
  } catch (error) {
    console.error('Error selecting Excel file:', error);
  }
}

async function saveTcExcelPath(filePath) {
  const currentProjectPath = window.getCurrentProjectPath ? window.getCurrentProjectPath() : null;
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

async function startTcSync() {
  const excelPath = document.getElementById('tcExcelPath')?.value;
  const currentProjectPath = window.getCurrentProjectPath ? window.getCurrentProjectPath() : null;

  if (!excelPath) {
    if (typeof window.showToast === 'function') {
      window.showToast('error', 'Please select an Excel file first.');
    }
    return;
  }

  if (!currentProjectPath) {
    if (typeof window.showToast === 'function') {
      window.showToast('error', 'Please open a folder first.');
    }
    return;
  }

  tcSyncRunning = true;

  const startBtn = document.getElementById('tcStartBtn');
  const stopBtn = document.getElementById('tcStopBtn');
  if (startBtn) startBtn.style.display = 'none';
  if (stopBtn) stopBtn.style.display = 'flex';

  updateTcProgress(0, 'Starting...');

  const outputPanelVisible = window.isOutputPanelVisible ? window.isOutputPanelVisible() : true;
  if (!outputPanelVisible) {
    const panel = document.getElementById('bottomPanel');
    const checkmark = document.getElementById('outputCheckmark');
    panel.classList.add('show');
    if (checkmark) checkmark.textContent = '✓';
    if (typeof window.setOutputPanelVisible === 'function') {
      window.setOutputPanelVisible(true);
    }
  }
  if (typeof window.switchBottomTab === 'function') {
    window.switchBottomTab('output');
  }

  if (typeof window.appendOutput === 'function') {
    window.appendOutput('Starting TC Sync...', 'info');
    window.appendOutput(`Excel: ${excelPath}`, 'info');
    window.appendOutput(`Output: ${currentProjectPath}\\testcase`, 'info');
  }

  try {
    const result = await window.electronAPI.python.runStreaming('scripts/tc_generator.py', [excelPath, currentProjectPath]);
    currentPythonProcessId = result.processId;
  } catch (error) {
    console.error('TC Sync error:', error);
    if (typeof window.appendOutput === 'function') {
      window.appendOutput(`Error: ${error.message}`, 'error');
    }
    updateTcProgress(0, 'Error');

    tcSyncRunning = false;
    currentPythonProcessId = null;

    if (startBtn) startBtn.style.display = 'flex';
    if (stopBtn) stopBtn.style.display = 'none';
  }
}

async function stopTcSync() {
  if (currentPythonProcessId) {
    await window.electronAPI.python.kill(currentPythonProcessId);
    if (typeof window.appendOutput === 'function') {
      window.appendOutput('TC Sync stopped by user.', 'warning');
    }
  }

  tcSyncRunning = false;
  currentPythonProcessId = null;
  updateTcProgress(0, 'Stopped');

  const startBtn = document.getElementById('tcStartBtn');
  const stopBtn = document.getElementById('tcStopBtn');
  if (startBtn) startBtn.style.display = 'flex';
  if (stopBtn) stopBtn.style.display = 'none';
}

function updateTcProgress(percent, text) {
  const progressBar = document.getElementById('tcProgressBar');
  const progressText = document.getElementById('tcProgressText');
  const progressPercent = document.getElementById('tcProgressPercent');

  if (progressBar) progressBar.style.width = percent + '%';
  if (progressText) progressText.textContent = text;
  if (progressPercent) progressPercent.textContent = percent + '%';
}

function updateTcCurrentFile(fileName) {
  const el = document.getElementById('tcCurrentFile');
  if (el) el.textContent = `Creating: ${fileName}`;
}

// ===== Configuration =====

function openConfiguration(event) {
  if (event) event.stopPropagation();

  if (typeof window.closeAllMenus === 'function') {
    window.closeAllMenus();
  }

  const folderOpened = window.isFolderOpened ? window.isFolderOpened() : false;
  const currentProjectPath = window.getCurrentProjectPath ? window.getCurrentProjectPath() : null;
  if (!folderOpened || !currentProjectPath) return;

  const openTabs = window.getOpenTabs ? window.getOpenTabs() : [];
  const existingTabIndex = openTabs.findIndex(tab => tab.filePath === '__configuration__');
  if (existingTabIndex !== -1) {
    if (typeof window.switchToTab === 'function') {
      window.switchToTab(existingTabIndex);
    }
    return;
  }

  if (typeof window.addSpecialTab === 'function') {
    window.addSpecialTab({
      filePath: '__configuration__',
      fileName: 'Configuration',
      type: 'configuration',
      content: null,
      originalContent: null
    });
  }
  renderConfiguration();
}

async function renderConfiguration() {
  const editorArea = document.querySelector('.editor-area');
  const config = await loadConfiguration();
  const escapeHtml = window.escapeHtml || ((text) => text);

  editorArea.innerHTML = `
    <div class="configuration-screen" style="padding: 40px 60px; font-family: 'Segoe UI', sans-serif; max-width: 600px;">
      <h1 style="font-size: 28px; font-weight: 600; margin-bottom: 8px; color: #cccccc;">Configuration</h1>
      <p style="font-size: 14px; color: #858585; margin-bottom: 32px;">Project settings for Validation Studio</p>

      <div style="display: flex; flex-direction: column; gap: 24px;">
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

        <div style="margin-top: 16px;">
          <button onclick="saveConfiguration()" style="padding: 10px 24px; background: #0e639c; border: none; border-radius: 4px; color: white; cursor: pointer; font-size: 14px; font-weight: 500;">
            Save Configuration
          </button>
          <span id="configSaveStatus" style="margin-left: 16px; font-size: 13px; color: #858585;"></span>
        </div>
      </div>
    </div>
  `;

  const inputs = editorArea.querySelectorAll('input');
  inputs.forEach(input => {
    input.addEventListener('focus', () => input.style.borderColor = '#007acc');
    input.addEventListener('blur', () => input.style.borderColor = '#5a5a5a');
  });
}

async function loadConfiguration() {
  const currentProjectPath = window.getCurrentProjectPath ? window.getCurrentProjectPath() : null;
  if (!currentProjectPath) return {};

  try {
    const configPath = currentProjectPath + '\\.vvu.config';
    const content = await window.electronAPI.fs.readFile(configPath);
    return JSON.parse(content);
  } catch (error) {
    return {};
  }
}

async function saveConfiguration() {
  const currentProjectPath = window.getCurrentProjectPath ? window.getCurrentProjectPath() : null;
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

      if (typeof window.refreshExplorer === 'function') {
        await window.refreshExplorer();
      }
    } else {
      statusEl.textContent = 'Failed to save configuration.';
      statusEl.style.color = '#f14c4c';
    }

    setTimeout(() => {
      statusEl.textContent = '';
    }, 3000);
  } catch (error) {
    console.error('Error saving configuration:', error);
  }
}

// ===== Category Viewer =====

async function openCategoryViewer() {
  const target = window.getContextMenuTarget ? window.getContextMenuTarget() : {};
  let filePath = target.path;
  let fileName = target.name;
  const isFolder = target.isFolder;

  if (typeof window.hideContextMenu === 'function') {
    window.hideContextMenu();
  }

  if (!filePath) return;

  // If target is .vvu.category folder, use ctg_final.xlsx inside it
  if (isFolder && fileName === '.vvu.category') {
    filePath = filePath.replace(/\\/g, '/') + '/ctg_final.xlsx';
    fileName = 'ctg_final.xlsx';
  }

  const openTabs = window.getOpenTabs ? window.getOpenTabs() : [];
  const existingTabIndex = openTabs.findIndex(tab =>
    tab.type === 'categoryViewer' && tab.filePath === filePath
  );

  if (existingTabIndex !== -1) {
    if (typeof window.switchToTab === 'function') {
      window.switchToTab(existingTabIndex);
    }
    renderCategoryViewer(openTabs[existingTabIndex]);
    return;
  }

  if (typeof window.appendOutput === 'function') {
    window.appendOutput(`Reading Excel file: ${fileName}`, 'info');
  }

  try {
    const projectRoot = await window.electronAPI.getProjectRoot();
    const scriptPath = `${projectRoot}/scripts/excel_reader.py`;
    const result = await window.electronAPI.python.run(scriptPath, [filePath]);

    if (result.error) {
      if (typeof window.appendOutput === 'function') {
        window.appendOutput(`Failed to read Excel: ${result.error}`, 'error');
        if (result.stderr) {
          window.appendOutput(result.stderr, 'error');
        }
      }
      if (typeof window.showToast === 'function') {
        window.showToast('error', 'Failed to read Excel file');
      }
      return;
    }

    const data = JSON.parse(result.stdout);
    if (!data.success) {
      if (typeof window.appendOutput === 'function') {
        window.appendOutput(`Excel read error: ${data.error}`, 'error');
      }
      if (typeof window.showToast === 'function') {
        window.showToast('error', data.error);
      }
      return;
    }

    const tabIndex = window.addSpecialTab ? window.addSpecialTab({
      type: 'categoryViewer',
      fileName: 'View Category',
      filePath: filePath,
      excelData: data,
      activeSubTab: 'overview'
    }) : -1;

    if (tabIndex >= 0) {
      const tabs = window.getOpenTabs ? window.getOpenTabs() : [];
      renderCategoryViewer(tabs[tabIndex]);
    }

    if (typeof window.appendOutput === 'function') {
      window.appendOutput(`Loaded ${data.rows.length} rows from Excel`, 'success');
    }
  } catch (error) {
    console.error('Error opening category viewer:', error);
    if (typeof window.appendOutput === 'function') {
      window.appendOutput(`Error: ${error.message}`, 'error');
    }
    if (typeof window.showToast === 'function') {
      window.showToast('error', 'Failed to open category viewer');
    }
  }
}

function renderCategoryViewer(tab) {
  const editorArea = document.querySelector('.editor-area');
  const data = tab.excelData;
  const rows = data.rows;
  const activeSubTab = tab.activeSubTab || 'overview';

  const stats = calculateCategoryStats(rows);

  editorArea.innerHTML = `
    <div class="category-viewer" style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; height: 100%; display: flex; flex-direction: column; overflow: hidden; background: var(--bg-primary); color: var(--text-primary);">
      <div class="subtab-header" style="display: flex; background: var(--bg-secondary); border-bottom: 1px solid var(--border-color); flex-shrink: 0;">
        <div class="subtab ${activeSubTab === 'overview' ? 'active' : ''}" data-subtab="overview" onclick="switchCategorySubTab('overview')" style="padding: 10px 20px; cursor: pointer; color: ${activeSubTab === 'overview' ? 'var(--text-primary)' : 'var(--text-secondary)'}; border-bottom: 2px solid ${activeSubTab === 'overview' ? 'var(--accent-primary)' : 'transparent'}; transition: all 0.2s;">Overview</div>
        <div class="subtab ${activeSubTab === 'modules' ? 'active' : ''}" data-subtab="modules" onclick="switchCategorySubTab('modules')" style="padding: 10px 20px; cursor: pointer; color: ${activeSubTab === 'modules' ? 'var(--text-primary)' : 'var(--text-secondary)'}; border-bottom: 2px solid ${activeSubTab === 'modules' ? 'var(--accent-primary)' : 'transparent'}; transition: all 0.2s;">Modules</div>
        <div class="subtab ${activeSubTab === 'implGroups' ? 'active' : ''}" data-subtab="implGroups" onclick="switchCategorySubTab('implGroups')" style="padding: 10px 20px; cursor: pointer; color: ${activeSubTab === 'implGroups' ? 'var(--text-primary)' : 'var(--text-secondary)'}; border-bottom: 2px solid ${activeSubTab === 'implGroups' ? 'var(--accent-primary)' : 'transparent'}; transition: all 0.2s;">Impl Groups</div>
        <div class="subtab ${activeSubTab === 'testMethods' ? 'active' : ''}" data-subtab="testMethods" onclick="switchCategorySubTab('testMethods')" style="padding: 10px 20px; cursor: pointer; color: ${activeSubTab === 'testMethods' ? 'var(--text-primary)' : 'var(--text-secondary)'}; border-bottom: 2px solid ${activeSubTab === 'testMethods' ? 'var(--accent-primary)' : 'transparent'}; transition: all 0.2s;">Test Methods</div>
      </div>

      <div class="subtab-content" style="flex: 1; overflow: hidden; display: flex; flex-direction: column;">
        ${renderCategorySubTabContent(activeSubTab, rows, stats)}
      </div>
    </div>
  `;

  if (activeSubTab === 'overview') {
    setupFilterEvents(rows);
  }
}

function switchCategorySubTab(subTabName) {
  const openTabs = window.getOpenTabs ? window.getOpenTabs() : [];
  const activeTabIndex = window.getActiveTabIndex ? window.getActiveTabIndex() : -1;
  const tab = openTabs[activeTabIndex];
  if (!tab || tab.type !== 'categoryViewer') return;

  tab.activeSubTab = subTabName;
  renderCategoryViewer(tab);
}

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

function calculateCategoryStats(rows) {
  const stats = {
    automation: { yes: 0, no: 0, values: ['Y', 'N'] },
    modules: new Set(),
    implGroups: new Set(),
    testMethods: new Set()
  };

  rows.forEach(row => {
    const automation = row['Automation'] || '';
    if (automation.toUpperCase() === 'Y' || automation.includes('Y')) {
      stats.automation.yes++;
    } else {
      stats.automation.no++;
    }

    const module = row['Module_Group'] || row['Module'] || '';
    if (module) stats.modules.add(module);

    const implGroup = row['Impl_Group'] || '';
    if (implGroup) stats.implGroups.add(implGroup);

    Object.keys(row).forEach(key => {
      if (key.startsWith('TM_') && (row[key] === 'Y' || row[key] === 'True' || row[key] === 'TRUE' || row[key] === '1')) {
        stats.testMethods.add(key.replace('TM_', ''));
      }
    });
  });

  return stats;
}

function renderOverviewTab(rows, stats) {
  return `
    <div style="padding: 20px; height: 100%; display: flex; flex-direction: column; overflow: hidden;">
      <div class="stats-summary" style="display: flex; gap: 20px; flex-wrap: wrap; margin-bottom: 20px; flex-shrink: 0;">
        <div class="stat-card" style="background: var(--bg-secondary); padding: 15px 20px; border-radius: 6px; min-width: 150px; border: 1px solid var(--border-color);">
          <div style="font-size: 24px; font-weight: 600; color: var(--info);">${rows.length}</div>
          <div style="font-size: 13px; color: var(--text-secondary); margin-top: 4px;">Total TCs</div>
        </div>
        <div class="stat-card" style="background: var(--bg-secondary); padding: 15px 20px; border-radius: 6px; min-width: 150px; border: 1px solid var(--border-color);">
          <div style="font-size: 24px; font-weight: 600; color: var(--success);">${stats.automation.yes} / ${rows.length}</div>
          <div style="font-size: 13px; color: var(--text-secondary); margin-top: 4px;">Automation (Y)</div>
        </div>
        <div class="stat-card" style="background: var(--bg-secondary); padding: 15px 20px; border-radius: 6px; min-width: 150px; border: 1px solid var(--border-color);">
          <div style="font-size: 24px; font-weight: 600; color: var(--warning);">${stats.modules.size}</div>
          <div style="font-size: 13px; color: var(--text-secondary); margin-top: 4px;">Modules</div>
        </div>
        <div class="stat-card" style="background: var(--bg-secondary); padding: 15px 20px; border-radius: 6px; min-width: 150px; border: 1px solid var(--border-color);">
          <div style="font-size: 24px; font-weight: 600; color: var(--accent-primary);">${stats.implGroups.size}</div>
          <div style="font-size: 13px; color: var(--text-secondary); margin-top: 4px;">Impl Groups</div>
        </div>
      </div>

      <div style="font-size: 13px; color: var(--text-secondary); margin-bottom: 10px; flex-shrink: 0;">
        Showing <span id="filteredCount">${rows.length}</span> of ${rows.length} TCs
      </div>

      <div class="list-view-container" style="flex: 1; overflow: auto; background: var(--bg-primary); border: 1px solid var(--border-color); border-radius: 4px;">
        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
          <thead style="position: sticky; top: 0; background: var(--bg-secondary); z-index: 1;">
            <tr>
              <th style="padding: 10px 12px; text-align: left; border-bottom: 1px solid var(--border-color); color: var(--text-primary);">TC ID</th>
              <th style="padding: 10px 12px; text-align: left; border-bottom: 1px solid var(--border-color); color: var(--text-primary);">Module</th>
              <th style="padding: 10px 12px; text-align: left; border-bottom: 1px solid var(--border-color); color: var(--text-primary);">Impl Group</th>
              <th style="padding: 10px 12px; text-align: left; border-bottom: 1px solid var(--border-color); color: var(--text-primary);">Automation</th>
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

function renderTCRows(rows) {
  return rows.map(row => {
    const tcId = row['TC_ID'] || row['ID'] || Object.values(row)[0] || '';
    const module = row['Module_Group'] || row['Module'] || '';
    const implGroup = row['Impl_Group'] || '';
    const automation = row['Automation'] || '';

    return `
      <tr class="tc-row" data-tcid="${tcId}" data-module="${module}" data-impl="${implGroup}" data-automation="${automation}" style="border-bottom: 1px solid var(--border-color);">
        <td style="padding: 10px 12px;"><span onclick="openTestcaseFile('${tcId}')" style="color: var(--info); cursor: pointer; text-decoration: underline;">${tcId}</span></td>
        <td style="padding: 10px 12px; color: var(--text-primary);">${module}</td>
        <td style="padding: 10px 12px; color: var(--text-primary);">${implGroup}</td>
        <td style="padding: 10px 12px;"><span style="background: ${automation.toUpperCase().includes('Y') ? 'var(--success)' : 'var(--text-secondary)'}; color: #fff; padding: 2px 8px; border-radius: 3px; font-size: 11px;">${automation}</span></td>
      </tr>
    `;
  }).join('');
}

function renderGroupedTab(rows, groupKey, title, color, groupSet) {
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
      <div style="font-size: 16px; font-weight: 600; color: var(--text-primary); margin-bottom: 20px;">
        ${title} <span style="color: ${color}; margin-left: 8px;">(${sortedGroups.length})</span>
      </div>
      <div class="grouped-list">
        ${sortedGroups.map(([groupName, groupRows], idx) => `
          <div class="group-item" style="margin-bottom: 2px;">
            <div class="group-header" onclick="toggleGroupExpand(${idx})" style="display: flex; align-items: center; padding: 12px 16px; background: var(--bg-secondary); cursor: pointer; border-radius: 4px; transition: background 0.2s; border: 1px solid var(--border-color);">
              <span class="group-chevron" id="chevron-${idx}" style="margin-right: 10px; color: var(--text-secondary); transition: transform 0.2s;">▶</span>
              <span style="flex: 1; font-size: 14px; color: var(--text-primary);">${groupName}</span>
              <span style="background: ${color}; color: #fff; padding: 2px 10px; border-radius: 10px; font-size: 12px; font-weight: 600;">${groupRows.length}</span>
            </div>
            <div class="group-content" id="group-content-${idx}" style="display: none; margin-left: 26px; border-left: 2px solid var(--border-color); margin-top: 2px;">
              <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                <tbody>
                  ${groupRows.map(row => {
                    const rowTcId = row['TC_ID'] || row['ID'] || '';
                    return `
                    <tr style="border-bottom: 1px solid var(--border-color);">
                      <td style="padding: 8px 12px;"><span onclick="openTestcaseFile('${rowTcId}')" style="color: var(--info); cursor: pointer; text-decoration: underline;">${rowTcId}</span></td>
                      <td style="padding: 8px 12px;"><span style="background: ${(row['Automation'] || '').toUpperCase().includes('Y') ? 'var(--success)' : 'var(--text-secondary)'}; color: #fff; padding: 2px 8px; border-radius: 3px; font-size: 12px;">${row['Automation'] || ''}</span></td>
                      <td style="padding: 8px 12px; color: var(--text-primary);">${row['Impl_Group'] || ''}</td>
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

function renderTestMethodsTab(rows, testMethodSet) {
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
      <div style="font-size: 16px; font-weight: 600; color: var(--text-primary); margin-bottom: 20px;">
        Test Methods <span style="color: var(--success); margin-left: 8px;">(${sortedMethods.length})</span>
      </div>
      <div class="grouped-list">
        ${sortedMethods.map(([methodName, methodRows], idx) => `
          <div class="group-item" style="margin-bottom: 2px;">
            <div class="group-header" onclick="toggleGroupExpand(${idx + 1000})" style="display: flex; align-items: center; padding: 12px 16px; background: var(--bg-secondary); cursor: pointer; border-radius: 4px; transition: background 0.2s; border: 1px solid var(--border-color);">
              <span class="group-chevron" id="chevron-${idx + 1000}" style="margin-right: 10px; color: var(--text-secondary); transition: transform 0.2s;">▶</span>
              <span style="flex: 1; font-size: 14px; color: var(--text-primary);">${methodName}</span>
              <span style="background: var(--success); color: #fff; padding: 2px 10px; border-radius: 10px; font-size: 12px; font-weight: 600;">${methodRows.length}</span>
            </div>
            <div class="group-content" id="group-content-${idx + 1000}" style="display: none; margin-left: 26px; border-left: 2px solid var(--border-color); margin-top: 2px;">
              <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                <tbody>
                  ${methodRows.map(row => {
                    const rowTcId = row['TC_ID'] || row['ID'] || '';
                    return `
                    <tr style="border-bottom: 1px solid var(--border-color);">
                      <td style="padding: 8px 12px;"><span onclick="openTestcaseFile('${rowTcId}')" style="color: var(--info); cursor: pointer; text-decoration: underline;">${rowTcId}</span></td>
                      <td style="padding: 8px 12px; color: var(--text-primary);">${row['Module_Group'] || row['Module'] || ''}</td>
                      <td style="padding: 8px 12px;"><span style="background: ${(row['Automation'] || '').toUpperCase().includes('Y') ? 'var(--success)' : 'var(--text-secondary)'}; color: #fff; padding: 2px 8px; border-radius: 3px; font-size: 12px;">${row['Automation'] || ''}</span></td>
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

function setupFilterEvents(originalRows) {
  // Simplified - no filter dropdowns in the simplified version
}

// ===== 전역 노출 =====
window.openTestcaseFile = openTestcaseFile;
window.openCategorize = openCategorize;
window.renderCategorize = renderCategorize;
window.updateCategorizeProgress = updateCategorizeProgress;
window.startCategorize = startCategorize;
window.stopCategorize = stopCategorize;
window.openTestcaseSync = openTestcaseSync;
window.renderTestcaseSync = renderTestcaseSync;
window.selectTcExcelFile = selectTcExcelFile;
window.startTcSync = startTcSync;
window.stopTcSync = stopTcSync;
window.updateTcProgress = updateTcProgress;
window.updateTcCurrentFile = updateTcCurrentFile;
window.openConfiguration = openConfiguration;
window.renderConfiguration = renderConfiguration;
window.loadConfiguration = loadConfiguration;
window.saveConfiguration = saveConfiguration;
window.openCategoryViewer = openCategoryViewer;
window.renderCategoryViewer = renderCategoryViewer;
window.switchCategorySubTab = switchCategorySubTab;
window.toggleGroupExpand = toggleGroupExpand;
