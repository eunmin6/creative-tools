/**
 * Output Panel Module
 * OUTPUT 패널 기능을 담당하는 모듈
 */

(function() {
  'use strict';

  // ===== 모듈 내부 상태 =====
  let outputPanelVisible = true;

  // ===== Output 패널 토글 =====

  function toggleOutputPanel(event) {
    if (event) event.stopPropagation();

    if (typeof window.closeAllMenus === 'function') {
      window.closeAllMenus();
    }

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

  // ===== Developer Tools 토글 =====

  function toggleDevToolsFromMenu(event) {
    if (event) event.stopPropagation();

    if (typeof window.closeAllMenus === 'function') {
      window.closeAllMenus();
    }

    if (typeof window.toggleDevTools === 'function') {
      window.toggleDevTools();
    }
  }

  // ===== Output 내용 추가 =====

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

    outputContent.scrollTop = outputContent.scrollHeight;
  }

  // ===== Output 클리어 =====

  function clearOutput() {
    const outputContent = document.getElementById('outputContent');
    if (outputContent) {
      outputContent.innerHTML = '<div class="output-line info">[INFO] Output cleared.</div>';
    }
  }

  // ===== 하단 패널 리사이저 =====

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

  // ===== Python 스크립트 실행 =====

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

  // ===== 초기화 =====

  function initOutputPanel() {
    setupBottomPanelResizer();
    if (typeof window.setupTerminalListeners === 'function') {
      window.setupTerminalListeners();
    }
  }

  // DOM 로드 시 초기화
  document.addEventListener('DOMContentLoaded', initOutputPanel);

  // ===== 전역 노출 =====
  window.toggleOutputPanel = toggleOutputPanel;
  window.toggleDevToolsFromMenu = toggleDevToolsFromMenu;
  window.appendOutput = appendOutput;
  window.clearOutput = clearOutput;
  window.setupBottomPanelResizer = setupBottomPanelResizer;
  window.runPythonScript = runPythonScript;

})();
