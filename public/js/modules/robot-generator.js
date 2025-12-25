/**
 * Robot Script Generator Module
 * TC.md 파일에서 Robot Framework 스크립트를 생성하는 모듈
 */

(function() {
  'use strict';

  const DEFAULT_MODEL = 'gpt-oss:20b';
  let currentGeneratingTabPath = null;

  // 폴더 생성 상태 관리
  let isFolderGenerating = false;
  let shouldStopGeneration = false;

  // ===== 탭 로딩 애니메이션 =====

  function showTabLoading(filePath) {
    currentGeneratingTabPath = filePath;
    const fileName = filePath.split(/[\\/]/).pop();

    // 탭 찾기 (data-file-name 속성으로 찾기)
    const tabs = document.querySelectorAll('.editor-tab');
    tabs.forEach(tab => {
      const label = tab.querySelector('.tab-label');
      if (label && label.dataset.fileName === fileName) {
        // 펄스 애니메이션 클래스 추가
        label.classList.add('generating');

        // 스피너 추가
        const existingSpinner = tab.querySelector('.tab-spinner');
        if (!existingSpinner) {
          const spinner = document.createElement('span');
          spinner.className = 'tab-spinner';
          label.after(spinner);
        }
      }
    });
  }

  function hideTabLoading(filePath) {
    const fileName = filePath ? filePath.split(/[\\/]/).pop() : null;

    // 모든 탭에서 로딩 제거
    const tabs = document.querySelectorAll('.editor-tab');
    tabs.forEach(tab => {
      const label = tab.querySelector('.tab-label');
      if (label) {
        if (!fileName || label.dataset.fileName === fileName) {
          // 펄스 애니메이션 클래스 제거
          label.classList.remove('generating');

          // 스피너 제거
          const spinner = tab.querySelector('.tab-spinner');
          if (spinner) spinner.remove();
        }
      }
    });

    currentGeneratingTabPath = null;
  }

  // ===== 마크다운 코드 블록 제거 =====

  function removeMarkdownCodeBlock(content) {
    if (!content) return content;

    let result = content.trim();

    // 방법 1: 코드 블록 내용만 추출 (```언어\n내용\n```)
    const codeBlockMatch = result.match(/```(?:robot|robotframework|)?\s*\n?([\s\S]*?)\n?```/i);
    if (codeBlockMatch && codeBlockMatch[1]) {
      result = codeBlockMatch[1].trim();
    } else {
      // 방법 2: 시작과 끝의 ``` 패턴 제거
      // 시작 부분 제거
      result = result.replace(/^```(?:robot|robotframework)?\s*\n?/i, '');
      // 끝 부분 제거
      result = result.replace(/\n?```\s*$/g, '');
    }

    // 추가 정리: 혹시 남아있는 ``` 제거
    result = result.replace(/^```\w*\s*\n?/, '');
    result = result.replace(/\n?```\s*$/, '');

    return result.trim();
  }

  // ===== LLM 모델 가져오기 =====

  function getCurrentLLMModel() {
    const llmSelect = document.getElementById('llmSelect');
    if (llmSelect && llmSelect.value) {
      const selectedOption = llmSelect.selectedOptions[0];
      return {
        model: llmSelect.value,
        provider: selectedOption?.dataset?.provider || 'ollama'
      };
    }
    return { model: DEFAULT_MODEL, provider: 'ollama' };
  }

  // ===== 단일 MD 파일에서 Robot 스크립트 생성 =====

  async function generateRobotScript() {
    const target = window.getContextMenuTarget();
    const mdFilePath = target.path;
    const mdFileName = target.name;

    if (typeof window.hideContextMenu === 'function') {
      window.hideContextMenu();
    }

    // .robot 파일 경로 생성
    const robotFilePath = mdFilePath.replace(/\.md$/i, '.robot');
    const robotFileName = mdFileName.replace(/\.md$/i, '.robot');

    try {
      // Output 패널 표시 및 시작 메시지
      if (typeof window.showOutputPanel === 'function') {
        window.showOutputPanel();
      }
      appendOutput(`Starting script generation: ${robotFileName}`, 'info');

      // MD 파일 내용 읽기
      const mdContent = await window.electronAPI.fs.readFile(mdFilePath);
      if (!mdContent) {
        appendOutput(`Error: Could not read ${mdFileName}`, 'error');
        return;
      }

      // 기존 .robot 파일이 있으면 삭제
      try {
        const existingContent = await window.electronAPI.fs.readFile(robotFilePath);
        if (existingContent !== null) {
          await window.electronAPI.fs.delete(robotFilePath);
        }
      } catch (e) {
        // 파일이 없으면 무시
      }

      // 빈 .robot 파일 생성
      await window.electronAPI.fs.writeFile(robotFilePath, '');

      // 탭 열기
      if (typeof window.openFileInEditor === 'function') {
        await window.openFileInEditor(robotFilePath);
      }

      // Monaco editor가 준비될 때까지 대기
      await waitForMonacoEditor();

      // 탭에 로딩 애니메이션 표시
      showTabLoading(robotFilePath);

      // LLM으로 스크립트 생성 (스트리밍)
      const success = await streamGenerateRobotScript(mdContent, robotFilePath, robotFileName);

      if (success) {
        // 완료 후 dry-run 실행
        await runRobotDryRun(robotFilePath, robotFileName);
      }

      // 파일 탐색기 새로고침 및 파일 하이라이트
      if (typeof window.refreshExplorer === 'function') {
        await window.refreshExplorer();
      }

      // 생성된 파일 하이라이트
      setTimeout(() => {
        if (typeof window.highlightFileInExplorer === 'function') {
          window.highlightFileInExplorer(robotFilePath);
        }
      }, 300);

    } catch (error) {
      appendOutput(`Error generating script: ${error.message}`, 'error');
    }
  }

  // ===== 폴더 내 모든 MD 파일 처리 =====

  async function generateScriptsFromFolder() {
    const target = window.getContextMenuTarget();
    const folderPath = target.path;
    const folderName = target.name;

    if (typeof window.hideContextMenu === 'function') {
      window.hideContextMenu();
    }

    // 이미 생성 중이면 무시
    if (isFolderGenerating) {
      return;
    }

    // 상태 초기화
    isFolderGenerating = true;
    shouldStopGeneration = false;

    try {
      // Output 패널 표시
      if (typeof window.showOutputPanel === 'function') {
        window.showOutputPanel();
      }
      appendOutput(`Scanning folder: ${folderName}`, 'info');

      // 폴더 내 파일 목록 가져오기
      const files = await window.electronAPI.fs.readdir(folderPath);
      const mdFiles = files.filter(f => f.name.endsWith('.md') && !f.isDirectory);

      if (mdFiles.length === 0) {
        appendOutput(`No .md files found in ${folderName}`, 'warning');
        isFolderGenerating = false;
        return;
      }

      appendOutput(`Found ${mdFiles.length} .md files`, 'info');

      // 각 파일에 대해 순차 처리
      let processedCount = 0;
      for (let i = 0; i < mdFiles.length; i++) {
        // 중지 요청 확인
        if (shouldStopGeneration) {
          appendOutput(`Generation stopped by user after ${processedCount} files`, 'warning');
          break;
        }

        const file = mdFiles[i];
        const mdFilePath = folderPath + '/' + file.name;
        const robotFilePath = mdFilePath.replace(/\.md$/i, '.robot');
        const robotFileName = file.name.replace(/\.md$/i, '.robot');

        appendOutput(`[${i + 1}/${mdFiles.length}] Processing: ${file.name}`, 'info');

        // MD 파일 내용 읽기
        const mdContent = await window.electronAPI.fs.readFile(mdFilePath);
        if (!mdContent) {
          appendOutput(`Error: Could not read ${file.name}`, 'error');
          continue;
        }

        // 기존 .robot 파일이 있으면 삭제
        try {
          const existingContent = await window.electronAPI.fs.readFile(robotFilePath);
          if (existingContent !== null) {
            await window.electronAPI.fs.delete(robotFilePath);
          }
        } catch (e) {
          // 파일이 없으면 무시
        }

        // 빈 .robot 파일 생성
        await window.electronAPI.fs.writeFile(robotFilePath, '');

        // 탭 열기
        if (typeof window.openFileInEditor === 'function') {
          await window.openFileInEditor(robotFilePath);
        }

        // Monaco editor가 준비될 때까지 대기
        await waitForMonacoEditor();

        // 탭에 로딩 애니메이션 표시
        showTabLoading(robotFilePath);

        // LLM으로 스크립트 생성
        const success = await streamGenerateRobotScript(mdContent, robotFilePath, robotFileName);

        if (success) {
          // dry-run 실행
          await runRobotDryRun(robotFilePath, robotFileName);
          processedCount++;

          // 파일 탐색기 새로고침 (각 파일 완료 후)
          if (typeof window.refreshExplorer === 'function') {
            await window.refreshExplorer();
          }

          // 생성된 파일 하이라이트
          if (typeof window.highlightFileInExplorer === 'function') {
            window.highlightFileInExplorer(robotFilePath);
          }
        }
      }

      if (!shouldStopGeneration) {
        appendOutput(`Completed processing ${mdFiles.length} files`, 'success');
      }

    } catch (error) {
      appendOutput(`Error processing folder: ${error.message}`, 'error');
    } finally {
      // 상태 초기화
      isFolderGenerating = false;
      shouldStopGeneration = false;
    }
  }

  // ===== 생성 중지 =====

  function stopGeneration() {
    if (typeof window.hideContextMenu === 'function') {
      window.hideContextMenu();
    }

    if (isFolderGenerating) {
      shouldStopGeneration = true;
      appendOutput('Stopping generation... (current file will complete)', 'warning');
    }
  }

  // ===== 생성 상태 확인 =====

  function isGenerating() {
    return isFolderGenerating;
  }

  // ===== LLM 스트리밍으로 Robot 스크립트 생성 =====

  async function streamGenerateRobotScript(mdContent, robotFilePath, robotFileName) {
    const { model, provider } = getCurrentLLMModel();

    appendOutput(`Using model: ${model} (${provider})`, 'info');

    // 프롬프트 구성
    const prompt = buildRobotGeneratorPrompt(mdContent);

    // LLM 설정 로드
    let settings;
    try {
      settings = await window.loadLLMSettings();
    } catch (e) {
      settings = {
        ollama: { endpoint: 'http://localhost:11434' },
        vllm: { endpoint: 'http://localhost:8000' },
        gemini: { apiKey: '' }
      };
    }

    let fullContent = '';

    try {
      if (provider === 'ollama') {
        const endpoint = settings.ollama?.endpoint || 'http://localhost:11434';
        fullContent = await streamOllama(endpoint, model, prompt, robotFilePath);
      } else if (provider === 'vllm') {
        const endpoint = settings.vllm?.endpoint || 'http://localhost:8000';
        fullContent = await streamVLLM(endpoint, model, prompt, robotFilePath);
      } else if (provider === 'gemini') {
        const apiKey = settings.gemini?.apiKey || '';
        fullContent = await callGemini(apiKey, model, prompt, robotFilePath);
      } else {
        // 기본 Ollama
        fullContent = await streamOllama('http://localhost:11434', model, prompt, robotFilePath);
      }

      // 마크다운 코드 블록 제거 (```robot ... ``` 또는 ``` ... ```)
      fullContent = removeMarkdownCodeBlock(fullContent);

      // 최종 파일 저장 (팝업 없이 자동 저장)
      await window.electronAPI.fs.writeFile(robotFilePath, fullContent);

      // 탭 내용도 정리된 내용으로 업데이트
      updateActiveTabContent(fullContent);

      // 탭 상태 업데이트 (unsaved 표시 제거)
      const activeTab = typeof window.getActiveTab === 'function' ? window.getActiveTab() : null;
      if (activeTab) {
        activeTab.content = fullContent;
        activeTab.originalContent = fullContent;
      }

      // 탭 UI 업데이트
      if (typeof window.renderTabs === 'function') {
        window.renderTabs();
      }

      appendOutput(`Saved: ${robotFileName}`, 'success');

      return true;

    } catch (error) {
      appendOutput(`LLM Error: ${error.message}`, 'error');
      return false;
    }
  }

  // ===== Ollama 스트리밍 =====

  async function streamOllama(endpoint, model, prompt, robotFilePath) {
    const response = await fetch(`${endpoint}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model,
        prompt: prompt,
        stream: true
      })
    });

    if (!response.ok) {
      throw new Error(`Ollama error: ${response.status} ${response.statusText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullContent = '';
    let firstChunkReceived = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n').filter(line => line.trim());

      for (const line of lines) {
        try {
          const json = JSON.parse(line);
          if (json.response) {
            // 첫 번째 응답 시 로딩 제거
            if (!firstChunkReceived) {
              firstChunkReceived = true;
              hideTabLoading(robotFilePath);
            }
            fullContent += json.response;
            // 탭 내용 실시간 업데이트
            updateActiveTabContent(fullContent);
          }
        } catch (e) {
          // JSON 파싱 실패 무시
        }
      }
    }

    return fullContent;
  }

  // ===== vLLM 스트리밍 =====

  async function streamVLLM(endpoint, model, prompt, robotFilePath) {
    const response = await fetch(`${endpoint}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model,
        messages: [{ role: 'user', content: prompt }],
        stream: true
      })
    });

    if (!response.ok) {
      throw new Error(`vLLM error: ${response.status} ${response.statusText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullContent = '';
    let firstChunkReceived = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n').filter(line => line.trim() && line.startsWith('data:'));

      for (const line of lines) {
        const data = line.substring(5).trim();
        if (data === '[DONE]') continue;

        try {
          const json = JSON.parse(data);
          const content = json.choices?.[0]?.delta?.content;
          if (content) {
            // 첫 번째 응답 시 로딩 제거
            if (!firstChunkReceived) {
              firstChunkReceived = true;
              hideTabLoading(robotFilePath);
            }
            fullContent += content;
            updateActiveTabContent(fullContent);
          }
        } catch (e) {
          // JSON 파싱 실패 무시
        }
      }
    }

    return fullContent;
  }

  // ===== Gemini 호출 (비스트리밍) =====

  async function callGemini(apiKey, model, prompt, robotFilePath) {
    if (!apiKey) {
      throw new Error('Gemini API key not configured');
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }]
        })
      }
    );

    if (!response.ok) {
      throw new Error(`Gemini error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const fullContent = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // 로딩 제거
    hideTabLoading(robotFilePath);

    updateActiveTabContent(fullContent);

    return fullContent;
  }

  // ===== Robot 스크립트 생성용 프롬프트 =====

  function buildRobotGeneratorPrompt(mdContent) {
    return `You are a Robot Framework script generator expert.
Convert the following test case specification (in Markdown format) into a Robot Framework test script.

Requirements:
- Use Robot Framework 7.x syntax (latest version)
- Include proper *** Settings ***, *** Variables ***, *** Keywords ***, and *** Test Cases *** sections
- IMPORTANT: Include "Library    Process" in Settings when using Run Process keyword
- IMPORTANT: Include "Library    String" in Settings when using string manipulation keywords
- IMPORTANT: Use "RETURN" statement instead of deprecated "[Return]" setting
- Handle ADB commands using "Run Process" keyword from Process library
- Include proper documentation based on the test case description
- Use descriptive keyword names
- Add appropriate [Tags] based on Priority and Feature Level
- Handle expected results with proper verification keywords

Example of correct Process library usage:
*** Settings ***
Library    Process
Library    String

*** Keywords ***
Run ADB Command
    [Arguments]    \${command}
    \${result}=    Run Process    adb    \${command}    shell=True
    RETURN    \${result.stdout}

Test Case Specification:
---
${mdContent}
---

Generate ONLY the Robot Framework script code. Do not include any explanations, markdown formatting, or code blocks. Output pure .robot file content:`;
  }

  // ===== Monaco editor 준비 대기 =====

  function waitForMonacoEditor(timeout = 5000) {
    return new Promise((resolve) => {
      const startTime = Date.now();

      function check() {
        const editor = typeof window.getMonacoEditor === 'function' ? window.getMonacoEditor() : null;
        if (editor) {
          resolve(editor);
          return;
        }

        if (Date.now() - startTime > timeout) {
          resolve(null);
          return;
        }

        setTimeout(check, 100);
      }

      check();
    });
  }

  // ===== 탭 내용 실시간 업데이트 =====

  function updateActiveTabContent(content) {
    const editor = typeof window.getMonacoEditor === 'function' ? window.getMonacoEditor() : null;
    if (editor) {
      // 현재 스크롤 위치 저장
      const scrollTop = editor.getScrollTop();

      // 내용 업데이트
      editor.setValue(content);

      // 커서를 끝으로 이동하고 스크롤
      const model = editor.getModel();
      if (model) {
        const lastLine = model.getLineCount();
        editor.revealLine(lastLine);
      }

      // 탭 내용도 업데이트
      const activeTab = typeof window.getActiveTab === 'function' ? window.getActiveTab() : null;
      if (activeTab) {
        activeTab.content = content;
      }
    }
  }

  // ===== Robot --dryrun 실행 =====

  async function runRobotDryRun(robotFilePath, robotFileName) {
    appendOutput(`Running dry-run: ${robotFileName}`, 'info');

    try {
      const result = await window.electronAPI.robot.dryrun(robotFilePath);

      if (result.success) {
        appendOutput(`Dry-run passed: ${robotFileName}`, 'success');
        if (result.stdout) {
          appendOutput(result.stdout, 'info');
        }
      } else {
        appendOutput(`Dry-run failed: ${robotFileName}`, 'error');
        if (result.stderr) {
          appendOutput(result.stderr, 'error');
        }
        if (result.stdout) {
          appendOutput(result.stdout, 'info');
        }
      }
    } catch (error) {
      appendOutput(`Dry-run error: ${error.message}`, 'error');
    }
  }

  // ===== Output 패널에 메시지 추가 =====

  function appendOutput(message, type = 'info') {
    if (typeof window.appendOutput === 'function') {
      window.appendOutput(message, type);
    } else {
      console.log(`[${type.toUpperCase()}] ${message}`);
    }
  }

  // ===== 폴더 내 모든 .robot 파일 삭제 =====

  async function deleteRobotFilesInFolder() {
    const target = window.getContextMenuTarget();
    const folderPath = target.path;
    const folderName = target.name;

    if (typeof window.hideContextMenu === 'function') {
      window.hideContextMenu();
    }

    try {
      // 폴더 내 .robot 파일 목록 가져오기
      const files = await window.electronAPI.fs.readdir(folderPath);
      const robotFiles = files.filter(f => f.name.endsWith('.robot') && !f.isDirectory);

      if (robotFiles.length === 0) {
        if (typeof window.showToast === 'function') {
          window.showToast('info', 'No .robot files found in this folder');
        }
        return;
      }

      // 확인 모달 표시
      showDeleteRobotConfirmation(folderPath, folderName, robotFiles);

    } catch (error) {
      appendOutput(`Error reading folder: ${error.message}`, 'error');
    }
  }

  function showDeleteRobotConfirmation(folderPath, folderName, robotFiles) {
    // 기존 모달이 있으면 제거
    const existingModal = document.getElementById('deleteRobotModal');
    if (existingModal) existingModal.remove();

    const modal = document.createElement('div');
    modal.id = 'deleteRobotModal';
    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 3000;
    `;

    modal.innerHTML = `
      <div style="
        background: var(--bg-secondary);
        border: 1px solid var(--border-color);
        border-radius: 8px;
        padding: 20px;
        min-width: 350px;
        max-width: 450px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
      ">
        <h3 style="margin: 0 0 15px 0; color: var(--text-primary); font-size: 16px;">
          Delete *.robot files
        </h3>
        <p style="margin: 0 0 15px 0; color: var(--text-secondary); font-size: 13px;">
          Are you sure you want to delete <strong style="color: var(--error);">${robotFiles.length}</strong> .robot file(s) in <strong>${folderName}</strong>?
        </p>
        <div style="max-height: 150px; overflow-y: auto; margin-bottom: 15px; padding: 8px; background: var(--bg-tertiary); border-radius: 4px;">
          ${robotFiles.map(f => `<div style="color: var(--text-secondary); font-size: 12px; padding: 2px 0;">${f.name}</div>`).join('')}
        </div>
        <div style="display: flex; justify-content: flex-end; gap: 10px;">
          <button id="cancelDeleteRobot" style="
            padding: 8px 16px;
            background: var(--bg-tertiary);
            border: 1px solid var(--border-color);
            border-radius: 4px;
            color: var(--text-primary);
            cursor: pointer;
          ">Cancel</button>
          <button id="confirmDeleteRobot" style="
            padding: 8px 16px;
            background: #d32f2f;
            border: none;
            border-radius: 4px;
            color: white;
            cursor: pointer;
          ">Delete All</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // 이벤트 핸들러
    document.getElementById('cancelDeleteRobot').addEventListener('click', () => {
      modal.remove();
    });

    document.getElementById('confirmDeleteRobot').addEventListener('click', async () => {
      modal.remove();
      await performDeleteRobotFiles(folderPath, robotFiles);
    });

    // 배경 클릭 시 닫기
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });
  }

  async function performDeleteRobotFiles(folderPath, robotFiles) {
    let deletedCount = 0;

    for (const file of robotFiles) {
      const filePath = folderPath + '/' + file.name;
      try {
        await window.electronAPI.fs.delete(filePath);
        deletedCount++;

        // 열려있는 탭도 닫기
        if (typeof window.closeTabByPath === 'function') {
          window.closeTabByPath(filePath);
        }
      } catch (error) {
        appendOutput(`Failed to delete: ${file.name}`, 'error');
      }
    }

    appendOutput(`Deleted ${deletedCount} .robot file(s)`, 'success');

    // 파일 탐색기 새로고침
    if (typeof window.refreshExplorer === 'function') {
      await window.refreshExplorer();
    }

    if (typeof window.showToast === 'function') {
      window.showToast('success', `Deleted ${deletedCount} .robot file(s)`);
    }
  }

  // ===== 전역 함수 등록 =====

  window.generateRobotScript = generateRobotScript;
  window.generateScriptsFromFolder = generateScriptsFromFolder;
  window.deleteRobotFilesInFolder = deleteRobotFilesInFolder;
  window.stopGeneration = stopGeneration;
  window.isGenerating = isGenerating;

})();
