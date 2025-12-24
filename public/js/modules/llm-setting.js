/**
 * LLM Setting Module
 * LLM 프로바이더 설정을 관리하는 모듈
 */

(function() {
  'use strict';

  // ===== 모듈 내부 상태 =====
  const CONFIG_FILE_NAME = '.vvu.config';

  const DEFAULT_SETTINGS = {
    ollama: {
      enabled: true, // 기본으로 활성화
      endpoint: 'http://localhost:11434',
      status: 'unknown', // 'connected', 'disconnected', 'unknown'
      statusMessage: ''
    },
    vllm: {
      enabled: false,
      endpoint: 'http://localhost:8000',
      status: 'unknown',
      statusMessage: ''
    },
    gemini: {
      enabled: false,
      apiKey: '',
      model: 'gemini-pro',
      status: 'unknown',
      statusMessage: ''
    }
  };

  let currentSettings = null;

  // ===== 설정 파일 경로 =====

  function getConfigFilePath() {
    if (window.currentProjectPath) {
      return window.currentProjectPath + '/' + CONFIG_FILE_NAME;
    }
    return null;
  }

  // ===== 설정 로드 =====

  async function loadLLMSettings() {
    const configPath = getConfigFilePath();

    if (!configPath) {
      currentSettings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
      return currentSettings;
    }

    try {
      const content = await window.electronAPI.fs.readFile(configPath);
      const config = JSON.parse(content);

      // LLM 설정만 추출 (다른 설정이 있을 수 있음)
      if (config.llm) {
        currentSettings = {
          ...JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
          ...config.llm
        };
      } else {
        currentSettings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
      }
    } catch (error) {
      // 파일이 없거나 읽기 실패시 기본값 사용
      currentSettings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    }

    return currentSettings;
  }

  // ===== 설정 저장 =====

  async function saveLLMSettings(settings) {
    const configPath = getConfigFilePath();

    if (!configPath) {
      console.error('No project opened, cannot save settings');
      return false;
    }

    try {
      let config = {};

      // 기존 설정 파일 읽기 (다른 설정 보존)
      try {
        const content = await window.electronAPI.fs.readFile(configPath);
        config = JSON.parse(content);
      } catch (e) {
        // 파일이 없으면 새로 생성
      }

      // LLM 설정 업데이트
      config.llm = settings;

      // 파일 저장
      await window.electronAPI.fs.writeFile(configPath, JSON.stringify(config, null, 2));

      currentSettings = settings;

      // 모델 목록 갱신 이벤트 발생
      window.dispatchEvent(new CustomEvent('llmsettingschange', {
        detail: { settings }
      }));

      return true;
    } catch (error) {
      console.error('Failed to save LLM settings:', error);
      return false;
    }
  }

  // ===== 연결 테스트 =====

  async function testOllamaConnection(endpoint) {
    try {
      const response = await fetch(`${endpoint}/api/tags`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });

      if (response.ok) {
        const data = await response.json();
        const modelCount = data.models ? data.models.length : 0;
        return {
          success: true,
          status: 'connected',
          message: `연결됨 (${modelCount}개 모델 발견)`,
          models: data.models || []
        };
      } else {
        return {
          success: false,
          status: 'disconnected',
          message: `연결 실패 (HTTP ${response.status})`,
          models: []
        };
      }
    } catch (error) {
      return {
        success: false,
        status: 'disconnected',
        message: '로컬 Ollama 설치 안됨 또는 서버 미실행',
        models: []
      };
    }
  }

  async function testVLLMConnection(endpoint) {
    try {
      const response = await fetch(`${endpoint}/v1/models`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });

      if (response.ok) {
        const data = await response.json();
        const modelCount = data.data ? data.data.length : 0;
        return {
          success: true,
          status: 'connected',
          message: `연결됨 (${modelCount}개 모델 발견)`,
          models: data.data || []
        };
      } else {
        return {
          success: false,
          status: 'disconnected',
          message: `연결 실패 (HTTP ${response.status})`,
          models: []
        };
      }
    } catch (error) {
      return {
        success: false,
        status: 'disconnected',
        message: 'vLLM 서버 연결 실패',
        models: []
      };
    }
  }

  async function testGeminiConnection(apiKey, model) {
    if (!apiKey) {
      return {
        success: false,
        status: 'disconnected',
        message: 'API Key가 설정되지 않음',
        models: []
      };
    }

    try {
      // Gemini API 테스트 - 간단한 요청으로 API Key 유효성 확인
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`,
        {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' }
        }
      );

      if (response.ok) {
        const data = await response.json();
        const models = data.models || [];
        return {
          success: true,
          status: 'connected',
          message: `API Key 유효함 (${models.length}개 모델)`,
          models: models.map(m => ({ id: m.name, name: m.displayName }))
        };
      } else {
        const error = await response.json();
        return {
          success: false,
          status: 'disconnected',
          message: error.error?.message || 'API Key 유효하지 않음',
          models: []
        };
      }
    } catch (error) {
      return {
        success: false,
        status: 'disconnected',
        message: 'Gemini API 연결 실패',
        models: []
      };
    }
  }

  // ===== LLM Setting 탭 열기 =====

  function openLLMSettingTab() {
    if (typeof window.addSpecialTab === 'function') {
      window.addSpecialTab({
        filePath: '__llm_setting__',
        fileName: 'LLM Setting',
        type: 'llmSetting',
        content: '',
        originalContent: ''
      });
    }
  }

  // ===== LLM Setting 탭 렌더링 =====

  async function renderLLMSettingTab() {
    const editorArea = document.querySelector('.editor-area');
    if (!editorArea) return;

    // 설정 로드
    const settings = await loadLLMSettings();

    // Ollama 초기 연결 테스트 (활성화된 경우)
    if (settings.ollama.enabled) {
      const ollamaResult = await testOllamaConnection(settings.ollama.endpoint);
      settings.ollama.status = ollamaResult.status;
      settings.ollama.statusMessage = ollamaResult.message;
    }

    const renderProviderCard = (provider, config, title, description) => {
      const isEnabled = config.enabled;
      const statusClass = config.status === 'connected' ? 'status-connected' :
                          config.status === 'disconnected' ? 'status-disconnected' : 'status-unknown';
      const statusIcon = config.status === 'connected' ? 'codicon-pass-filled' :
                         config.status === 'disconnected' ? 'codicon-error' : 'codicon-question';

      let fieldsHtml = '';

      if (provider === 'ollama' || provider === 'vllm') {
        fieldsHtml = `
          <div class="llm-setting-field">
            <label>Endpoint</label>
            <input type="text" id="${provider}Endpoint" value="${config.endpoint}"
                   placeholder="http://localhost:${provider === 'ollama' ? '11434' : '8000'}" />
          </div>
        `;
      } else if (provider === 'gemini') {
        fieldsHtml = `
          <div class="llm-setting-field">
            <label>API Key</label>
            <input type="password" id="geminiApiKey" value="${config.apiKey}"
                   placeholder="Enter your Gemini API Key" />
          </div>
        `;
      }

      return `
        <div class="llm-provider-card ${isEnabled ? 'active' : ''}" data-provider="${provider}">
          <div class="llm-provider-header">
            <div class="llm-provider-info">
              <div class="llm-provider-title">${title}</div>
              <div class="llm-provider-description">${description}</div>
            </div>
            <div class="llm-provider-toggle">
              <label class="toggle-switch">
                <input type="checkbox" id="enable_${provider}" ${isEnabled ? 'checked' : ''}
                       onchange="toggleLLMProvider('${provider}', this.checked)" />
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>
          <div class="llm-provider-divider"></div>
          <div class="llm-provider-fields">
            ${fieldsHtml}
          </div>
          <div class="llm-provider-status ${statusClass}">
            <span class="codicon ${statusIcon}"></span>
            <span id="${provider}Status">${config.statusMessage || '상태 확인 필요'}</span>
          </div>
          <div class="llm-provider-actions">
            <button class="llm-test-btn" onclick="testLLMConnection('${provider}')">
              <span class="codicon codicon-debug-start"></span>
              Test Connection
            </button>
          </div>
        </div>
      `;
    };

    editorArea.innerHTML = `
      <div class="llm-setting-container">
        <div class="llm-setting-header">
          <h2>LLM Setting</h2>
          <p>Configure your LLM providers. Enable multiple providers to see all models in the dropdown.</p>
        </div>

        <div class="llm-providers-list">
          ${renderProviderCard('ollama', settings.ollama, 'Ollama', 'Local LLM server (default: localhost:11434)')}
          ${renderProviderCard('vllm', settings.vllm, 'vLLM', 'High-performance LLM server (OpenAI compatible)')}
          ${renderProviderCard('gemini', settings.gemini, 'Gemini Cloud API', 'Google Gemini API')}
        </div>

        <div class="llm-setting-footer">
          <button class="llm-save-btn" onclick="saveCurrentLLMSettings()">
            <span class="codicon codicon-save"></span>
            Save Settings
          </button>
          <p class="llm-setting-hint">
            <span class="codicon codicon-info"></span>
            Enable providers and save to see their models in the Chat panel.
          </p>
        </div>
      </div>
    `;
  }

  // ===== Provider 토글 =====

  function toggleLLMProvider(provider, enabled) {
    const card = document.querySelector(`.llm-provider-card[data-provider="${provider}"]`);
    if (card) {
      card.classList.toggle('active', enabled);
    }
  }

  // ===== 연결 테스트 실행 =====

  async function testLLMConnection(provider) {
    const statusEl = document.getElementById(`${provider}Status`);
    const cardEl = document.querySelector(`.llm-provider-card[data-provider="${provider}"]`);
    const statusContainer = cardEl?.querySelector('.llm-provider-status');

    if (statusEl) {
      statusEl.textContent = '테스트 중...';
    }
    if (statusContainer) {
      statusContainer.className = 'llm-provider-status status-unknown';
    }

    let result;

    if (provider === 'ollama') {
      const endpoint = document.getElementById('ollamaEndpoint')?.value || DEFAULT_SETTINGS.ollama.endpoint;
      result = await testOllamaConnection(endpoint);
    } else if (provider === 'vllm') {
      const endpoint = document.getElementById('vllmEndpoint')?.value || DEFAULT_SETTINGS.vllm.endpoint;
      result = await testVLLMConnection(endpoint);
    } else if (provider === 'gemini') {
      const apiKey = document.getElementById('geminiApiKey')?.value || '';
      const model = document.getElementById('geminiModel')?.value || 'gemini-pro';
      result = await testGeminiConnection(apiKey, model);
    }

    if (statusEl) {
      statusEl.textContent = result.message;
    }
    if (statusContainer) {
      const statusClass = result.success ? 'status-connected' : 'status-disconnected';
      statusContainer.className = `llm-provider-status ${statusClass}`;

      const iconEl = statusContainer.querySelector('.codicon');
      if (iconEl) {
        iconEl.className = `codicon ${result.success ? 'codicon-pass-filled' : 'codicon-error'}`;
      }
    }

    return result;
  }

  // ===== 현재 설정 저장 =====

  async function saveCurrentLLMSettings() {
    const settings = {
      ollama: {
        enabled: document.getElementById('enable_ollama')?.checked || false,
        endpoint: document.getElementById('ollamaEndpoint')?.value || DEFAULT_SETTINGS.ollama.endpoint,
        status: currentSettings?.ollama?.status || 'unknown',
        statusMessage: currentSettings?.ollama?.statusMessage || ''
      },
      vllm: {
        enabled: document.getElementById('enable_vllm')?.checked || false,
        endpoint: document.getElementById('vllmEndpoint')?.value || DEFAULT_SETTINGS.vllm.endpoint,
        status: currentSettings?.vllm?.status || 'unknown',
        statusMessage: currentSettings?.vllm?.statusMessage || ''
      },
      gemini: {
        enabled: document.getElementById('enable_gemini')?.checked || false,
        apiKey: document.getElementById('geminiApiKey')?.value || '',
        model: 'gemini-pro', // 기본 모델
        status: currentSettings?.gemini?.status || 'unknown',
        statusMessage: currentSettings?.gemini?.statusMessage || ''
      }
    };

    const success = await saveLLMSettings(settings);

    if (success) {
      if (typeof window.showToast === 'function') {
        window.showToast('success', 'LLM settings saved successfully');
      }
      // 모델 목록 갱신
      if (typeof window.refreshModelList === 'function') {
        await window.refreshModelList();
      }
    } else {
      if (typeof window.showToast === 'function') {
        window.showToast('error', 'Failed to save LLM settings');
      }
    }
  }

  // ===== 현재 설정 반환 =====

  function getLLMSettings() {
    return currentSettings || DEFAULT_SETTINGS;
  }

  // ===== 활성화된 모든 프로바이더에서 모델 목록 가져오기 =====

  async function getModelsFromEnabledProviders() {
    const settings = await loadLLMSettings();
    let allModels = [];

    // Ollama 모델 가져오기
    if (settings.ollama.enabled) {
      const result = await testOllamaConnection(settings.ollama.endpoint);
      if (result.success && result.models) {
        const models = result.models.map(m => ({
          id: m.name,
          name: m.name,
          provider: 'ollama',
          displayName: `${m.name} (Ollama)`
        }));
        allModels = allModels.concat(models);
      }
    }

    // vLLM 모델 가져오기
    if (settings.vllm.enabled) {
      const result = await testVLLMConnection(settings.vllm.endpoint);
      if (result.success && result.models) {
        const models = result.models.map(m => ({
          id: m.id,
          name: m.id,
          provider: 'vllm',
          displayName: `${m.id} (vLLM)`
        }));
        allModels = allModels.concat(models);
      }
    }

    // Gemini 모델 가져오기
    if (settings.gemini.enabled && settings.gemini.apiKey) {
      // Gemini는 고정 모델 목록 사용
      const geminiModels = [
        { id: 'gemini-pro', name: 'gemini-pro', provider: 'gemini', displayName: 'gemini-pro (Gemini)' },
        { id: 'gemini-1.5-pro', name: 'gemini-1.5-pro', provider: 'gemini', displayName: 'gemini-1.5-pro (Gemini)' },
        { id: 'gemini-1.5-flash', name: 'gemini-1.5-flash', provider: 'gemini', displayName: 'gemini-1.5-flash (Gemini)' }
      ];
      allModels = allModels.concat(geminiModels);
    }

    return allModels;
  }

  // 하위 호환성을 위한 별칭
  async function getModelsFromActiveProvider() {
    return await getModelsFromEnabledProviders();
  }

  // ===== 전역 노출 =====
  window.loadLLMSettings = loadLLMSettings;
  window.saveLLMSettings = saveLLMSettings;
  window.getLLMSettings = getLLMSettings;
  window.openLLMSettingTab = openLLMSettingTab;
  window.renderLLMSettingTab = renderLLMSettingTab;
  window.toggleLLMProvider = toggleLLMProvider;
  window.testLLMConnection = testLLMConnection;
  window.saveCurrentLLMSettings = saveCurrentLLMSettings;
  window.getModelsFromActiveProvider = getModelsFromActiveProvider;
  window.getModelsFromEnabledProviders = getModelsFromEnabledProviders;
  window.testOllamaConnection = testOllamaConnection;
  window.testVLLMConnection = testVLLMConnection;
  window.testGeminiConnection = testGeminiConnection;

})();
