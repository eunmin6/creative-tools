/**
 * Terminal Module
 * 터미널 기능을 담당하는 모듈
 */

(function() {
  'use strict';

  // ===== 모듈 내부 상태 =====
  let terminals = []; // { id, name, output: [], currentInput, cwd }
  let activeTerminalId = null;
  let currentBottomTab = 'output';

  // ===== 하단 탭 전환 =====

  function switchBottomTab(tabName) {
    currentBottomTab = tabName;

    document.querySelectorAll('.bottom-panel-tab').forEach(tab => {
      if (tab.dataset.panel === tabName) {
        tab.classList.add('active');
      } else {
        tab.classList.remove('active');
      }
    });

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

      if (terminals.length === 0) {
        createNewTerminal();
      } else {
        setTimeout(() => focusTerminal(), 100);
      }
    }
  }

  // ===== 터미널 기본 경로 =====

  async function getTerminalDefaultPath() {
    if (window.currentProjectPath) {
      return window.currentProjectPath;
    }

    try {
      const dItems = await window.electronAPI.fs.readdir('D:\\');
      if (dItems && dItems.length >= 0) {
        return 'D:\\';
      }
    } catch (e) {
      // D:\ 접근 불가
    }

    return 'C:\\';
  }

  // ===== 터미널 생성 =====

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
        currentInput: '',
        tabIndex: 0,
        tabMatches: []
      };

      terminals.push(terminal);
      activeTerminalId = terminal.id;

      renderTerminalList();
      renderTerminalContent();

      setTimeout(() => focusTerminal(), 100);

    } catch (error) {
      console.error('Failed to create terminal:', error);
      if (typeof window.showToast === 'function') {
        window.showToast('error', 'Failed to create terminal');
      }
    }
  }

  // ===== 터미널 목록 렌더링 =====

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

  // ===== 터미널 전환 =====

  function switchTerminal(terminalId) {
    activeTerminalId = terminalId;
    renderTerminalList();
    renderTerminalContent();
    setTimeout(() => focusTerminal(), 50);
  }

  // ===== 터미널 내용 렌더링 =====

  function renderTerminalContent() {
    const contentEl = document.getElementById('terminalContent');
    if (!contentEl) return;

    const terminal = terminals.find(t => t.id === activeTerminalId);
    if (!terminal) {
      contentEl.innerHTML = '<div class="terminal-output-line">No terminal selected</div>';
      return;
    }

    const escapeHtml = window.escapeHtml || ((text) => {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    });

    let html = terminal.output.map(line =>
      `<div class="terminal-output-line ${line.type || ''}">${escapeHtml(line.text)}</div>`
    ).join('');

    html += `<div class="terminal-output-line">${escapeHtml(terminal.currentInput)}<span class="terminal-cursor"></span></div>`;

    contentEl.innerHTML = html;
    contentEl.scrollTop = contentEl.scrollHeight;
  }

  // ===== 터미널 포커스 =====

  function focusTerminal() {
    const contentEl = document.getElementById('terminalContent');
    if (contentEl) {
      contentEl.focus();
    }
  }

  // ===== 터미널 출력 추가 =====

  function appendTerminalOutput(terminalId, text, type = '') {
    const terminal = terminals.find(t => t.id === terminalId);
    if (!terminal) return;

    const lines = text.split('\n');
    lines.forEach(line => {
      if (line.trim() || lines.length === 1) {
        terminal.output.push({ text: line, type });
      }
    });

    if (terminalId === activeTerminalId) {
      renderTerminalContent();
    }
  }

  // ===== 터미널 닫기 =====

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

  function killActiveTerminal() {
    if (activeTerminalId) {
      closeTerminal(activeTerminalId);
    }
  }

  function clearTerminal() {
    const terminal = terminals.find(t => t.id === activeTerminalId);
    if (terminal) {
      terminal.output = [];
      renderTerminalContent();
    }
  }

  // ===== 터미널 입력 처리 =====

  async function handleTerminalInput(command) {
    if (!activeTerminalId) return;

    const terminal = terminals.find(t => t.id === activeTerminalId);
    if (!terminal) return;

    terminal.output.push({ text: command, type: '' });
    renderTerminalContent();

    if (!command.trim()) return;

    try {
      await window.electronAPI.terminal.write(activeTerminalId, command);
    } catch (error) {
      appendTerminalOutput(activeTerminalId, `Error: ${error.message}`, 'error');
    }
  }

  // ===== 터미널 이벤트 리스너 =====

  function setupTerminalListeners() {
    window.electronAPI.terminal.onData((data) => {
      appendTerminalOutput(data.terminalId, data.data, data.isError ? 'error' : '');

      const terminal = terminals.find(t => t.id === data.terminalId);
      if (terminal && data.data.includes('>')) {
        const match = data.data.match(/([A-Za-z]:\\[^\r\n>]*)/);
        if (match) {
          terminal.cwd = match[1];
        }
      }
    });

    window.electronAPI.terminal.onExit((data) => {
      appendTerminalOutput(data.terminalId, `\nProcess exited with code ${data.code}`, 'error');
    });

    const contentEl = document.getElementById('terminalContent');
    if (contentEl) {
      contentEl.addEventListener('keydown', handleTerminalKeyDown);
    }
  }

  // ===== 터미널 키보드 이벤트 =====

  function handleTerminalKeyDown(e) {
    const terminal = terminals.find(t => t.id === activeTerminalId);
    if (!terminal) return;

    if (e.key === 'Tab') {
      e.preventDefault();
      handleTabCompletion(terminal);
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      const command = terminal.currentInput;
      terminal.currentInput = '';
      terminal.tabMatches = [];
      terminal.tabIndex = 0;
      handleTerminalInput(command);
      return;
    }

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

    if (e.key === 'Escape') {
      e.preventDefault();
      terminal.currentInput = '';
      terminal.tabMatches = [];
      terminal.tabIndex = 0;
      renderTerminalContent();
      return;
    }

    if (e.ctrlKey && e.key === 'c') {
      e.preventDefault();
      terminal.output.push({ text: `${terminal.currentInput}^C`, type: '' });
      terminal.currentInput = '';
      terminal.tabMatches = [];
      terminal.tabIndex = 0;
      renderTerminalContent();
      return;
    }

    if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      terminal.currentInput += e.key;
      terminal.tabMatches = [];
      terminal.tabIndex = 0;
      renderTerminalContent();
    }
  }

  // ===== Tab 자동완성 =====

  async function handleTabCompletion(terminal) {
    const input = terminal.currentInput;
    const tokens = input.split(/\s+/);
    const lastToken = tokens[tokens.length - 1] || '';

    let searchDir = terminal.cwd;
    let prefix = lastToken;

    const lastSlash = Math.max(lastToken.lastIndexOf('/'), lastToken.lastIndexOf('\\'));
    if (lastSlash >= 0) {
      const pathPart = lastToken.substring(0, lastSlash + 1);
      prefix = lastToken.substring(lastSlash + 1);

      if (/^[A-Za-z]:/.test(pathPart)) {
        searchDir = pathPart;
      } else {
        searchDir = terminal.cwd + '\\' + pathPart;
      }
    }

    if (terminal.tabMatches.length > 0) {
      terminal.tabIndex = (terminal.tabIndex + 1) % terminal.tabMatches.length;
      applyTabCompletion(terminal, tokens, lastSlash, prefix);
      return;
    }

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

  function applyTabCompletion(terminal, tokens, lastSlash, prefix) {
    const match = terminal.tabMatches[terminal.tabIndex];
    const completedName = match.isDirectory ? match.name + '\\' : match.name;

    if (lastSlash >= 0) {
      const pathPart = tokens[tokens.length - 1].substring(0, lastSlash + 1);
      tokens[tokens.length - 1] = pathPart + completedName;
    } else {
      tokens[tokens.length - 1] = completedName;
    }

    terminal.currentInput = tokens.join(' ');
    renderTerminalContent();
  }

  // ===== 전역 노출 =====
  window.switchBottomTab = switchBottomTab;
  window.createNewTerminal = createNewTerminal;
  window.switchTerminal = switchTerminal;
  window.closeTerminal = closeTerminal;
  window.killActiveTerminal = killActiveTerminal;
  window.clearTerminal = clearTerminal;
  window.setupTerminalListeners = setupTerminalListeners;
  window.handleTerminalKeyDown = handleTerminalKeyDown;
  window.renderTerminalContent = renderTerminalContent;
  window.appendTerminalOutput = appendTerminalOutput;

})();
