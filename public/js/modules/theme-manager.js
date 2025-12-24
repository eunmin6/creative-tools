/**
 * Theme Manager Module
 * 테마 관리 및 적용을 담당
 */
(function() {
  'use strict';

  // ===== 모듈 내부 상태 =====
  const STORAGE_KEY = 'creative-tools-theme';
  const DEFAULT_THEME = 'vscode-dark';

  let currentTheme = DEFAULT_THEME;
  let selectedTheme = DEFAULT_THEME; // 선택된 테마 (미적용 상태)

  // ===== 테마 적용 =====

  /**
   * 테마 적용 (미리보기용, 저장 안함)
   * @param {string} themeId - 테마 ID
   * @param {boolean} save - 저장 여부
   * @returns {boolean} - 성공 여부
   */
  function applyTheme(themeId, save = true) {
    if (!window.Themes) {
      console.error('Themes not loaded');
      return false;
    }

    const theme = window.Themes[themeId];
    if (!theme) {
      console.error(`Theme not found: ${themeId}`);
      return false;
    }

    const root = document.documentElement;

    // CSS 변수 적용
    Object.entries(theme.colors).forEach(([property, value]) => {
      root.style.setProperty(property, value);
    });

    // 테마 클래스 적용 (라이트/다크 구분)
    document.body.classList.remove('theme-light', 'theme-dark');
    document.body.classList.add(`theme-${theme.type}`);

    // data 속성 설정 (Monaco Editor 테마 연동용)
    document.body.dataset.theme = themeId;
    document.body.dataset.themeType = theme.type;

    // Monaco Editor 테마 변경
    updateMonacoTheme(theme.type);

    if (save) {
      // 현재 테마 저장
      currentTheme = themeId;
      selectedTheme = themeId;
      localStorage.setItem(STORAGE_KEY, themeId);

      // 테마 변경 이벤트 발생
      window.dispatchEvent(new CustomEvent('themechange', {
        detail: { themeId, theme }
      }));

      console.log(`Theme applied and saved: ${theme.name}`);
    } else {
      console.log(`Theme preview: ${theme.name}`);
    }

    return true;
  }

  /**
   * Monaco Editor 테마 업데이트
   * @param {string} themeType - 'light' 또는 'dark'
   */
  function updateMonacoTheme(themeType) {
    const monacoEditor = typeof window.getMonacoEditor === 'function'
      ? window.getMonacoEditor()
      : null;

    if (monacoEditor && window.monaco) {
      const monacoTheme = themeType === 'light' ? 'vs' : 'vs-dark';
      window.monaco.editor.setTheme(monacoTheme);
    }
  }

  /**
   * 저장된 테마 로드
   */
  function loadSavedTheme() {
    const savedTheme = localStorage.getItem(STORAGE_KEY);
    if (savedTheme && window.Themes && window.Themes[savedTheme]) {
      currentTheme = savedTheme;
      selectedTheme = savedTheme;
      applyTheme(savedTheme, false);
    } else {
      currentTheme = DEFAULT_THEME;
      selectedTheme = DEFAULT_THEME;
      applyTheme(DEFAULT_THEME, false);
    }
  }

  /**
   * 현재 테마 ID 반환
   * @returns {string}
   */
  function getCurrentTheme() {
    return currentTheme;
  }

  /**
   * 현재 테마 정보 반환
   * @returns {object}
   */
  function getCurrentThemeInfo() {
    return window.Themes ? window.Themes[currentTheme] : null;
  }

  /**
   * 테마 목록 반환
   * @returns {Array}
   */
  function getThemeList() {
    if (!window.Themes) return [];

    return Object.entries(window.Themes).map(([id, theme]) => ({
      id,
      name: theme.name,
      description: theme.description,
      type: theme.type
    }));
  }

  /**
   * Appearance 탭 열기
   */
  function openAppearanceTab() {
    if (typeof window.addSpecialTab === 'function') {
      window.addSpecialTab({
        filePath: '__appearance__',
        fileName: 'Appearance',
        type: 'appearance',
        content: '',
        originalContent: ''
      });
    }
  }

  /**
   * Appearance 탭 렌더링
   */
  function renderAppearanceTab() {
    const editorArea = document.querySelector('.editor-area');
    if (!editorArea) return;

    // 선택된 테마를 현재 테마로 초기화
    selectedTheme = currentTheme;

    const themes = getThemeList();

    const themeCards = themes.map(theme => `
      <div class="theme-card ${theme.id === currentTheme ? 'active' : ''}"
           data-theme-id="${theme.id}"
           onclick="selectTheme('${theme.id}')">
        <div class="theme-preview theme-preview-${theme.id}">
          <div class="preview-titlebar"></div>
          <div class="preview-content">
            <div class="preview-sidebar"></div>
            <div class="preview-editor">
              <div class="preview-line"></div>
              <div class="preview-line short"></div>
              <div class="preview-line"></div>
            </div>
          </div>
        </div>
        <div class="theme-info">
          <div class="theme-name">${theme.name}</div>
          <div class="theme-description">${theme.description}</div>
        </div>
        <div class="theme-check">
          ${theme.id === currentTheme ? '<span class="codicon codicon-check"></span>' : ''}
        </div>
        <div class="theme-badge ${theme.type}">${theme.type === 'light' ? 'Light' : 'Dark'}</div>
      </div>
    `).join('');

    editorArea.innerHTML = `
      <div class="appearance-container">
        <div class="appearance-header">
          <h2>Appearance</h2>
          <p>Select a theme for Creative Tools</p>
        </div>
        <div class="theme-grid">
          ${themeCards}
        </div>
        <div class="appearance-footer">
          <p class="theme-hint">
            <span class="codicon codicon-info"></span>
            Theme changes are applied immediately and saved automatically.
          </p>
        </div>
      </div>
    `;
  }

  /**
   * 테마 미리보기 (선택만, 저장 안함)
   * @param {string} themeId
   */
  function previewTheme(themeId) {
    selectedTheme = themeId;

    // 미리보기 적용 (저장 안함)
    applyTheme(themeId, false);

    // 선택 UI 업데이트
    document.querySelectorAll('.theme-card').forEach(card => {
      const isSelected = card.dataset.themeId === themeId;
      const isApplied = card.dataset.themeId === currentTheme;

      card.classList.toggle('selected', isSelected);
      card.classList.toggle('active', isApplied);

      const checkEl = card.querySelector('.theme-check');
      if (checkEl) {
        checkEl.innerHTML = isApplied ? '<span class="codicon codicon-check"></span>' : '';
      }
    });
  }

  /**
   * 테마 변경 확정
   */
  function confirmThemeChange() {
    if (selectedTheme && selectedTheme !== currentTheme) {
      // 테마 저장
      currentTheme = selectedTheme;
      localStorage.setItem(STORAGE_KEY, currentTheme);

      // UI 업데이트
      document.querySelectorAll('.theme-card').forEach(card => {
        const isApplied = card.dataset.themeId === currentTheme;
        card.classList.toggle('active', isApplied);

        const checkEl = card.querySelector('.theme-check');
        if (checkEl) {
          checkEl.innerHTML = isApplied ? '<span class="codicon codicon-check"></span>' : '';
        }
      });

      // 테마 변경 이벤트 발생
      window.dispatchEvent(new CustomEvent('themechange', {
        detail: { themeId: currentTheme, theme: window.Themes[currentTheme] }
      }));

      // 토스트 알림
      if (typeof window.showToast === 'function') {
        const themeName = window.Themes[currentTheme]?.name || currentTheme;
        window.showToast('success', `Theme applied: ${themeName}`);
      }
    } else if (selectedTheme === currentTheme) {
      if (typeof window.showToast === 'function') {
        window.showToast('info', 'This theme is already applied.');
      }
    }
  }

  /**
   * 테마 변경 취소
   */
  function cancelThemeChange() {
    if (selectedTheme !== currentTheme) {
      // 원래 테마로 복원
      selectedTheme = currentTheme;
      applyTheme(currentTheme, false);

      // UI 업데이트
      document.querySelectorAll('.theme-card').forEach(card => {
        const isApplied = card.dataset.themeId === currentTheme;
        card.classList.remove('selected');
        card.classList.toggle('active', isApplied);
      });

      if (typeof window.showToast === 'function') {
        window.showToast('info', 'Theme change cancelled.');
      }
    }
  }

  /**
   * 테마 선택 및 즉시 적용
   * @param {string} themeId
   */
  function selectTheme(themeId) {
    if (applyTheme(themeId, true)) {
      // 선택 UI 업데이트
      document.querySelectorAll('.theme-card').forEach(card => {
        const isActive = card.dataset.themeId === themeId;
        card.classList.toggle('active', isActive);

        const checkEl = card.querySelector('.theme-check');
        if (checkEl) {
          checkEl.innerHTML = isActive ? '<span class="codicon codicon-check"></span>' : '';
        }
      });

      // 토스트 알림
      if (typeof window.showToast === 'function') {
        const themeName = window.Themes[themeId]?.name || themeId;
        window.showToast('success', `Theme applied: ${themeName}`);
      }
    }
  }

  // ===== 초기화 =====

  // DOM 로드 완료 후 저장된 테마 적용
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadSavedTheme);
  } else {
    // DOM이 이미 로드된 경우
    loadSavedTheme();
  }

  // ===== 전역 노출 =====
  window.applyTheme = applyTheme;
  window.loadSavedTheme = loadSavedTheme;
  window.getCurrentTheme = getCurrentTheme;
  window.getCurrentThemeInfo = getCurrentThemeInfo;
  window.getThemeList = getThemeList;
  window.openAppearanceTab = openAppearanceTab;
  window.renderAppearanceTab = renderAppearanceTab;
  window.previewTheme = previewTheme;
  window.selectTheme = selectTheme;
  window.confirmThemeChange = confirmThemeChange;
  window.cancelThemeChange = cancelThemeChange;

})();
