/**
 * Tab Manager Module
 * 탭 관리 기능을 담당하는 모듈
 */

(function() {
  'use strict';

  // ===== 모듈 내부 상태 =====

  // 탭 관리
  let openTabs = [];
  let activeTabIndex = -1;

  // Monaco Editor 인스턴스
  let monacoEditor = null;
  let monacoReady = false;

  // ===== Getter/Setter =====

  function getOpenTabs() {
    return openTabs;
  }

  function getActiveTabIndex() {
    return activeTabIndex;
  }

  function setActiveTabIndex(index) {
    activeTabIndex = index;
  }

  function getActiveTab() {
    if (activeTabIndex >= 0 && activeTabIndex < openTabs.length) {
      return openTabs[activeTabIndex];
    }
    return null;
  }

  function getMonacoEditor() {
    return monacoEditor;
  }

  function isMonacoReady() {
    return monacoReady;
  }

  function setMonacoReady(ready) {
    monacoReady = ready;
  }

  function setMonacoEditor(editor) {
    monacoEditor = editor;
  }

  // ===== 에디터에 파일 열기 =====

  async function openFileInEditor(filePath) {
    const fileName = window.electronAPI.fs.path.basename(filePath);

    if (!window.electronAPI || !window.electronAPI.fs) {
      const editorArea = document.querySelector('.editor-area');
      editorArea.innerHTML = '<div style="padding: 20px; color: #f48771;">파일 시스템 API를 사용할 수 없습니다.</div>';
      return;
    }

    // 이미 열린 탭인지 확인
    const existingTabIndex = openTabs.findIndex(tab => tab.filePath === filePath);
    if (existingTabIndex !== -1) {
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

  // ===== 탭 렌더링 =====

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
      tabIcon.src = typeof window.getFileIcon === 'function'
        ? window.getFileIcon(tab.fileName)
        : `icons/default.svg`;
      tabIcon.style.width = '16px';
      tabIcon.style.height = '16px';
      tabIcon.style.marginRight = '6px';
      tabIcon.style.verticalAlign = 'middle';
      tabIcon.style.flexShrink = '0';

      // 파일 이름
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
      tabLabel.title = tab.fileName;
      tabLabel.addEventListener('click', () => switchToTab(index));

      const closeBtn = document.createElement('span');
      closeBtn.textContent = '×';
      closeBtn.style.marginLeft = '8px';
      closeBtn.style.cursor = 'pointer';
      closeBtn.style.fontSize = '18px';
      closeBtn.style.color = '#858585';
      closeBtn.style.transition = 'color 0.2s';
      closeBtn.style.verticalAlign = 'middle';
      closeBtn.addEventListener('mouseenter', () => closeBtn.style.color = '#ffffff');
      closeBtn.addEventListener('mouseleave', () => closeBtn.style.color = '#858585');
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeTab(index);
      });

      tabEl.appendChild(tabIcon);
      tabEl.appendChild(tabLabel);
      tabEl.appendChild(closeBtn);
      editorTabs.appendChild(tabEl);

      if (index === activeTabIndex) {
        setTimeout(() => {
          tabEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
        }, 0);
      }
    });

    // Chat 첨부 파일 목록 업데이트
    updateChatAttachments();
  }

  // ===== Chat 첨부 파일 =====

  function updateChatAttachments() {
    const container = document.getElementById('chatAttachments');
    if (!container) return;

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

  function toggleChatAttachment(tabIndex, checkbox) {
    if (tabIndex >= 0 && tabIndex < openTabs.length) {
      openTabs[tabIndex].chatAttached = checkbox.checked;
      const label = checkbox.closest('.chat-attachment-item');
      if (label) {
        label.classList.toggle('checked', checkbox.checked);
      }
    }
  }

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

  // ===== 탭 전환 =====

  function switchToTab(index) {
    if (index < 0 || index >= openTabs.length) return;
    if (activeTabIndex === index) return;

    activeTabIndex = index;
    renderTabs();
    renderActiveTabContent();
  }

  // ===== 탭 닫기 =====

  function closeTab(index) {
    if (index < 0 || index >= openTabs.length) return;

    if (hasUnsavedChanges(index)) {
      const tab = openTabs[index];
      if (typeof window.showModal === 'function') {
        window.showModal(
          'Unsaved Changes',
          `Do you want to save the changes you made to ${tab.fileName}?`,
          async () => {
            await saveCurrentFile();
            performCloseTab(index);
          },
          () => {
            performCloseTab(index);
          },
          () => {}
        );
      } else {
        performCloseTab(index);
      }
    } else {
      performCloseTab(index);
    }
  }

  function performCloseTab(index) {
    if (index < 0 || index >= openTabs.length) return;

    const tab = openTabs[index];
    if (tab.filePath && !tab.filePath.startsWith('__')) {
      window.electronAPI.fileWatch.stop(tab.filePath).then(result => {
        if (result.success) {
          console.log('Stopped watching file:', tab.filePath);
        }
      });
    }

    openTabs.splice(index, 1);

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

  // ===== 탭 경로 업데이트 (이름 변경 시) =====

  function updateTabPath(oldPath, newPath, newName) {
    const tabIndex = openTabs.findIndex(tab => tab.filePath === oldPath);
    if (tabIndex !== -1) {
      openTabs[tabIndex].filePath = newPath;
      openTabs[tabIndex].fileName = newName;
      renderTabs();
    }
  }

  // ===== 경로로 탭 닫기 =====

  function closeTabByPath(filePath) {
    const tabIndex = openTabs.findIndex(tab => tab.filePath === filePath);
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
  }

  // ===== 폴더 내 탭들 닫기 =====

  function closeTabsInFolder(folderPath) {
    const tabsToClose = openTabs.filter(tab => tab.filePath && tab.filePath.startsWith(folderPath + '\\'));
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

  // ===== 활성 탭 컨텐츠 렌더링 =====

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
      if (typeof window.openCanvasEditorForTab === 'function') {
        window.openCanvasEditorForTab(tab);
      }
    } else if (tab.type === 'testcase-sync') {
      if (typeof window.renderTestcaseSync === 'function') {
        window.renderTestcaseSync();
      }
    } else if (tab.type === 'configuration') {
      if (typeof window.renderConfiguration === 'function') {
        window.renderConfiguration();
      }
    } else if (tab.type === 'categorize') {
      if (typeof window.renderCategorize === 'function') {
        window.renderCategorize(tab.folderPath, tab.folderName);
      }
    } else if (tab.type === 'categoryViewer') {
      if (typeof window.renderCategoryViewer === 'function') {
        window.renderCategoryViewer(tab);
      }
    } else if (tab.type === 'appearance') {
      if (typeof window.renderAppearanceTab === 'function') {
        window.renderAppearanceTab();
      }
    } else if (tab.type === 'llmSetting') {
      if (typeof window.renderLLMSettingTab === 'function') {
        window.renderLLMSettingTab();
      }
    } else {
      // Monaco 에디터로 텍스트 파일 편집
      editorArea.innerHTML = '<div id="monaco-container" style="width: 100%; height: 100%;"></div>';

      if (!monacoReady) {
        setTimeout(() => renderActiveTabContent(), 100);
        return;
      }

      const language = getLanguageFromFileName(tab.fileName);

      // 현재 앱 테마에 맞는 Monaco 테마 설정
      const currentThemeType = document.body.dataset.themeType || 'dark';
      const monacoTheme = currentThemeType === 'light' ? 'custom-light' : 'custom-dark';

      monacoEditor = monaco.editor.create(document.getElementById('monaco-container'), {
        value: tab.content,
        language: language,
        theme: monacoTheme,
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
        mouseWheelZoom: true,
      });

      monacoEditor.onDidChangeModelContent(() => {
        tab.content = monacoEditor.getValue();
        renderTabs();
      });

      monacoEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        saveCurrentFile();
      });
    }
  }

  // ===== 파일명에서 언어 타입 추출 =====

  function getLanguageFromFileName(fileName) {
    const ext = fileName.split('.').pop().toLowerCase();
    const languageMap = {
      'js': 'javascript', 'ts': 'typescript', 'json': 'json',
      'html': 'html', 'htm': 'html', 'css': 'css',
      'scss': 'scss', 'less': 'less', 'md': 'markdown',
      'py': 'python', 'java': 'java', 'c': 'c', 'cpp': 'cpp',
      'h': 'c', 'hpp': 'cpp', 'cs': 'csharp', 'go': 'go',
      'rs': 'rust', 'rb': 'ruby', 'php': 'php', 'sql': 'sql',
      'xml': 'xml', 'yaml': 'yaml', 'yml': 'yaml',
      'sh': 'shell', 'bash': 'shell', 'txt': 'plaintext',
    };
    return languageMap[ext] || 'plaintext';
  }

  // ===== 환영 화면 =====

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

    const welcomeLink = editorArea.querySelector('.welcome-link');
    if (welcomeLink) {
      welcomeLink.addEventListener('mouseenter', () => welcomeLink.style.color = '#4da6ff');
      welcomeLink.addEventListener('mouseleave', () => welcomeLink.style.color = '#3794ff');
    }
  }

  // ===== 변경사항 확인 =====

  function hasUnsavedChanges(tabIndex) {
    if (tabIndex < 0 || tabIndex >= openTabs.length) return false;

    const tab = openTabs[tabIndex];

    if (tab.type === 'canvas') {
      const canvasData = typeof window.getCanvasData === 'function' ? window.getCanvasData() : { shapes: [] };
      const currentContent = JSON.stringify(canvasData, null, 2);
      return currentContent !== tab.originalContent;
    }

    return tab.content !== tab.originalContent;
  }

  // ===== 파일 저장 =====

  async function saveCurrentFile() {
    if (activeTabIndex < 0 || activeTabIndex >= openTabs.length) return;

    const tab = openTabs[activeTabIndex];

    if (!tab.filePath || tab.filePath.startsWith('__')) return;

    try {
      let contentToSave = tab.content;

      if (tab.type === 'canvas') {
        const canvasData = typeof window.getCanvasData === 'function' ? window.getCanvasData() : { shapes: [] };
        contentToSave = JSON.stringify(canvasData, null, 2);
      }

      const result = await window.electronAPI.fs.writeFile(tab.filePath, contentToSave);

      if (result.success) {
        tab.originalContent = contentToSave;
        tab.content = contentToSave;
        renderTabs();
        if (typeof window.showToast === 'function') {
          window.showToast('success', `Saved ${tab.fileName}`);
        }
      } else {
        if (typeof window.showToast === 'function') {
          window.showToast('error', 'Failed to save file');
        }
      }
    } catch (error) {
      console.error('Error saving file:', error);
      if (typeof window.showToast === 'function') {
        window.showToast('error', 'Failed to save file');
      }
    }
  }

  // ===== 특수 탭 추가 =====

  function addSpecialTab(tabConfig) {
    const existingTabIndex = openTabs.findIndex(tab => tab.filePath === tabConfig.filePath);
    if (existingTabIndex !== -1) {
      switchToTab(existingTabIndex);
      return existingTabIndex;
    }

    openTabs.push(tabConfig);
    activeTabIndex = openTabs.length - 1;
    renderTabs();
    renderActiveTabContent(); // 탭 컨텐츠도 렌더링
    return activeTabIndex;
  }

  // ===== 전역 노출 =====
  window.openTabs = openTabs; // 직접 접근용 (호환성)
  window.getOpenTabs = getOpenTabs;
  window.getActiveTabIndex = getActiveTabIndex;
  window.setActiveTabIndex = setActiveTabIndex;
  window.getActiveTab = getActiveTab;
  window.getMonacoEditor = getMonacoEditor;
  window.isMonacoReady = isMonacoReady;
  window.setMonacoReady = setMonacoReady;
  window.setMonacoEditor = setMonacoEditor;
  window.openFileInEditor = openFileInEditor;
  window.renderTabs = renderTabs;
  window.updateChatAttachments = updateChatAttachments;
  window.toggleChatAttachment = toggleChatAttachment;
  window.getAttachedFilesContent = getAttachedFilesContent;
  window.switchToTab = switchToTab;
  window.closeTab = closeTab;
  window.performCloseTab = performCloseTab;
  window.updateTabPath = updateTabPath;
  window.closeTabByPath = closeTabByPath;
  window.closeTabsInFolder = closeTabsInFolder;
  window.renderActiveTabContent = renderActiveTabContent;
  window.getLanguageFromFileName = getLanguageFromFileName;
  window.showWelcomeScreen = showWelcomeScreen;
  window.hasUnsavedChanges = hasUnsavedChanges;
  window.saveCurrentFile = saveCurrentFile;
  window.addSpecialTab = addSpecialTab;

})();
