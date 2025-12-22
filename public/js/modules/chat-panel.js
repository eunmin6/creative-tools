/**
 * Chat Panel Module
 * Ollama 기반 AI Chat 기능을 담당하는 모듈
 */

(function() {
  'use strict';

  // ===== 모듈 내부 상태 =====
  let chatMessages = [];
  let isChatLoading = false;
  let isChatResizing = false;
  let chatSystemPrompt = '';
  let chatPromptHistory = '';  // .vvu.prompt.history.md 내용
  let chatPromptLast = '';     // .vvu.prompt.last.md 내용
  let chatUserHistory = [];    // 사용자 질문 히스토리 (Up/Down 키용)
  let chatHistoryIndex = -1;   // 현재 히스토리 인덱스
  let chatTempInput = '';      // Up 키 누르기 전 임시 저장
  let codeBlockCounter = 0;

  // ===== 초기화 =====

  async function initChat() {
    await loadOllamaModels();
    setupChatPanelResizer();
    await loadChatSystemPrompt();
    await loadChatHistoryFiles();
  }

  // ===== 시스템 프롬프트 =====

  async function loadChatSystemPrompt() {
    const currentProjectPath = window.currentProjectPath;
    if (!currentProjectPath) {
      chatSystemPrompt = '';
      console.log('No project opened, chat system prompt not loaded');
      return;
    }

    try {
      const promptPath = currentProjectPath + '/.vvu.prompt.base.md';
      const content = await window.electronAPI.fs.readFile(promptPath);

      if (content && !content.startsWith('Error reading file')) {
        chatSystemPrompt = content;
        console.log('Chat system prompt loaded from:', promptPath);
      } else {
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
        if (typeof window.refreshExplorer === 'function') {
          window.refreshExplorer();
        }
      }
    } catch (error) {
      console.error('Error loading chat system prompt:', error);
    }
  }

  // ===== 히스토리 파일 =====

  async function loadChatHistoryFiles() {
    const currentProjectPath = window.currentProjectPath;
    if (!currentProjectPath) return;

    try {
      const historyPath = currentProjectPath + '/.vvu.prompt.history.md';
      const historyContent = await window.electronAPI.fs.readFile(historyPath);

      if (historyContent && !historyContent.startsWith('Error reading file')) {
        chatPromptHistory = historyContent;
        const questions = historyContent.split('\n')
          .filter(line => line.startsWith('- '))
          .map(line => line.substring(2).trim());
        chatUserHistory = questions;
      } else {
        chatPromptHistory = '';
        chatUserHistory = [];
      }

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

  async function saveChatHistoryFiles(userQuestion, aiResponse) {
    const currentProjectPath = window.currentProjectPath;
    if (!currentProjectPath) return;

    try {
      if (chatPromptLast) {
        const lastLines = chatPromptLast.split('\n');
        const questionLine = lastLines.find(line => line.startsWith('**Q:**'));
        if (questionLine) {
          const prevQuestion = questionLine.replace('**Q:** ', '').trim();
          if (!chatUserHistory.includes(prevQuestion)) {
            chatUserHistory.push(prevQuestion);
          }
        }
      }

      if (!chatUserHistory.includes(userQuestion)) {
        chatUserHistory.push(userQuestion);
      }

      while (chatUserHistory.length > 30) {
        chatUserHistory.shift();
      }

      const historyQuestions = chatUserHistory.slice(0, -1);
      if (historyQuestions.length > 0) {
        const historyContent = `# Chat History (Previous Questions)\n\n${historyQuestions.map(q => '- ' + q).join('\n')}\n`;
        const historyPath = currentProjectPath + '/.vvu.prompt.history.md';
        await window.electronAPI.fs.writeFile(historyPath, historyContent);
        chatPromptHistory = historyContent;
      }

      const lastContent = `# Last Conversation\n\n**Q:** ${userQuestion}\n\n**A:** ${aiResponse}\n`;
      const lastPath = currentProjectPath + '/.vvu.prompt.last.md';
      await window.electronAPI.fs.writeFile(lastPath, lastContent);
      chatPromptLast = lastContent;

      chatHistoryIndex = -1;
      chatTempInput = '';

      console.log('Chat history files saved, total questions:', chatUserHistory.length);
    } catch (error) {
      console.error('Error saving chat history files:', error);
    }
  }

  // ===== 리사이저 =====

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

  // ===== 마크다운 렌더링 =====

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

      const headerCells = lines[0].split('|').filter(cell => cell.trim() !== '');
      const alignLine = lines[1].split('|').filter(cell => cell.trim() !== '');
      const alignments = alignLine.map(cell => {
        const trimmed = cell.trim();
        if (trimmed.startsWith(':') && trimmed.endsWith(':')) return 'center';
        if (trimmed.endsWith(':')) return 'right';
        return 'left';
      });

      const dataRows = lines.slice(2);

      let tableHtml = '<table style="border-collapse: collapse; margin: 8px 0; width: 100%; font-size: 12px;">';
      tableHtml += '<thead><tr>';
      headerCells.forEach((cell, i) => {
        const align = alignments[i] || 'left';
        tableHtml += `<th style="border: 1px solid #555; padding: 8px 12px; background: #2d2d2d; text-align: ${align}; color: #e0e0e0; font-weight: 600;">${cell.trim()}</th>`;
      });
      tableHtml += '</tr></thead>';

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

    // 볼드
    text = text.replace(/\*\*(.+?)\*\*/g, '<strong style="color: #ffffff;">$1</strong>');
    text = text.replace(/__(.+?)__/g, '<strong style="color: #ffffff;">$1</strong>');

    // 이탤릭
    text = text.replace(/\*([^\*]+)\*/g, '<em>$1</em>');
    text = text.replace(/_([^_]+)_/g, '<em>$1</em>');

    // 리스트
    text = text.replace(/^[\-\*] (.+)$/gm, '<li style="margin-left: 16px; margin-bottom: 4px;">$1</li>');
    text = text.replace(/^\d+\. (.+)$/gm, '<li style="margin-left: 16px; margin-bottom: 4px;">$1</li>');

    // 줄바꿈
    text = text.replace(/\n/g, '<br>');

    return text;
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function copyCodeBlock(codeId) {
    const codeElement = document.getElementById(codeId);
    if (codeElement) {
      const code = codeElement.textContent;
      navigator.clipboard.writeText(code).then(() => {
        if (typeof window.showToast === 'function') {
          window.showToast('success', 'Code copied to clipboard!');
        }
      }).catch(err => {
        console.error('Failed to copy:', err);
        if (typeof window.showToast === 'function') {
          window.showToast('error', 'Failed to copy code');
        }
      });
    }
  }

  // ===== Ollama =====

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

          if (!data.models.find(m => m.name === 'gpt-oss:20b')) {
            select.value = data.models[0].name;
          }
        }
      }
    } catch (error) {
      console.log('Ollama not available:', error.message);
    }
  }

  // ===== Chat 패널 토글 =====

  async function toggleChatPanel(event) {
    if (event) {
      event.stopPropagation();
      if (typeof window.closeAllMenus === 'function') {
        window.closeAllMenus();
      }
    }

    const chatPanel = document.getElementById('chatPanel');
    if (chatPanel.style.display === 'none') {
      chatPanel.style.display = 'flex';
      document.getElementById('chatInput').focus();

      const currentProjectPath = window.currentProjectPath;
      if (currentProjectPath) {
        const historyPath = currentProjectPath + '/.vvu.prompt.history.md';
        try {
          await window.electronAPI.fs.delete(historyPath);
          console.log('Deleted chat history file on Open Chat');
        } catch (error) {
          // 파일이 없어도 무시
        }
      }

      await loadChatSystemPrompt();
      await loadChatHistoryFiles();

      if (typeof window.updateChatAttachments === 'function') {
        window.updateChatAttachments();
      }
    } else {
      chatPanel.style.display = 'none';
    }
  }

  // ===== Chat 히스토리 관리 =====

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

  async function resetChat() {
    chatMessages = [];
    const messagesContainer = document.getElementById('chatMessages');
    messagesContainer.innerHTML = `
      <div class="chat-welcome">
        <div style="font-size: 16px; font-weight: 600; margin-bottom: 8px;">Welcome to Chat</div>
        <div style="color: #858585;">Ask me anything about your project or code.</div>
      </div>
    `;

    chatUserHistory = [];
    chatHistoryIndex = -1;
    chatTempInput = '';
    chatPromptHistory = '';
    chatPromptLast = '';

    const input = document.getElementById('chatInput');
    if (input) {
      input.value = '';
      input.style.height = 'auto';
    }

    const currentProjectPath = window.currentProjectPath;
    if (currentProjectPath) {
      try {
        await window.electronAPI.fs.delete(currentProjectPath + '/.vvu.prompt.history.md');
      } catch (error) { /* 무시 */ }
      try {
        await window.electronAPI.fs.delete(currentProjectPath + '/.vvu.prompt.last.md');
      } catch (error) { /* 무시 */ }
    }

    // 탭의 첨부 상태 해제
    const tabs = window.AppState ? window.AppState.tabs.list : (window.openTabs || []);
    tabs.forEach(tab => {
      tab.chatAttached = false;
    });

    if (typeof window.updateChatAttachments === 'function') {
      window.updateChatAttachments();
    }

    console.log('Chat fully reset');
  }

  // ===== 키보드 이벤트 =====

  function handleChatKeydown(event) {
    const textarea = event.target;

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendChatMessage();
      return;
    }

    if (event.key === 'ArrowUp' && chatUserHistory.length > 0) {
      event.preventDefault();
      if (chatHistoryIndex === -1) {
        chatTempInput = textarea.value;
        chatHistoryIndex = chatUserHistory.length - 1;
      } else if (chatHistoryIndex > 0) {
        chatHistoryIndex--;
      }
      textarea.value = chatUserHistory[chatHistoryIndex] || '';
      return;
    }

    if (event.key === 'ArrowDown' && chatHistoryIndex !== -1) {
      event.preventDefault();
      if (chatHistoryIndex < chatUserHistory.length - 1) {
        chatHistoryIndex++;
        textarea.value = chatUserHistory[chatHistoryIndex] || '';
      } else {
        chatHistoryIndex = -1;
        textarea.value = chatTempInput;
      }
      return;
    }

    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
  }

  // ===== 메시지 전송 =====

  async function sendChatMessage() {
    const input = document.getElementById('chatInput');
    const message = input.value.trim();

    if (!message || isChatLoading) return;

    addChatMessage('user', message);
    input.value = '';
    input.style.height = 'auto';

    isChatLoading = true;
    const loadingId = showChatLoading();

    try {
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

  function addChatMessage(role, content) {
    chatMessages.push({ role, content });

    const messagesContainer = document.getElementById('chatMessages');
    const welcome = messagesContainer.querySelector('.chat-welcome');
    if (welcome) welcome.remove();

    const messageDiv = document.createElement('div');
    messageDiv.className = `chat-message ${role}`;

    const renderedContent = role === 'assistant' ? renderMarkdown(content) : escapeHtml(content);

    messageDiv.innerHTML = `
      <div class="chat-message-role">${role === 'user' ? 'You' : 'Assistant'}</div>
      <div class="chat-message-content">${renderedContent}</div>
    `;

    messagesContainer.appendChild(messageDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    return messageDiv;
  }

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

  function removeChatLoading(loadingId) {
    const loadingDiv = document.getElementById(loadingId);
    if (loadingDiv) loadingDiv.remove();
  }

  // ===== Ollama 스트리밍 =====

  async function streamOllamaResponse(prompt, model, loadingId) {
    const messagesContainer = document.getElementById('chatMessages');
    let messageDiv = null;
    let contentDiv = null;
    let fullResponse = '';
    let firstChunkReceived = false;
    const userQuestion = prompt;

    try {
      let fullPrompt = '';

      if (chatSystemPrompt) {
        fullPrompt += `[System Instructions]\n${chatSystemPrompt}\n\n`;
      }

      // 첨부된 파일 내용 추가
      if (typeof window.getAttachedFilesContent === 'function') {
        const attachedContent = window.getAttachedFilesContent();
        if (attachedContent) {
          fullPrompt += attachedContent;
        }
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
              contentDiv.textContent = fullResponse;
              messagesContainer.scrollTop = messagesContainer.scrollHeight;
            }
          } catch (e) {
            // JSON 파싱 실패 무시
          }
        }
      }

      if (contentDiv) {
        contentDiv.innerHTML = renderMarkdown(fullResponse);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
      }

      chatMessages.push({ role: 'assistant', content: fullResponse });
      await saveChatHistoryFiles(userQuestion, fullResponse);

    } catch (error) {
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

  // ===== 전역 노출 =====
  window.initChat = initChat;
  window.toggleChatPanel = toggleChatPanel;
  window.clearChatHistory = clearChatHistory;
  window.resetChat = resetChat;
  window.handleChatKeydown = handleChatKeydown;
  window.sendChatMessage = sendChatMessage;
  window.copyCodeBlock = copyCodeBlock;
  window.escapeHtml = escapeHtml;
  window.renderMarkdown = renderMarkdown;

  // 내부 상태 접근용 (필요시)
  window.getChatMessages = () => chatMessages;
  window.loadChatHistoryFiles = loadChatHistoryFiles;

})();
