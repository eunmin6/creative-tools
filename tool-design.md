# Appearance 테마 시스템 설계 문서

## 1. 기능 개요

### 목표
- View > Appearance 메뉴 추가
- Appearance 탭에서 6가지 테마 선택 가능
- 실시간 테마 적용 및 저장

### 사용자 흐름
```
View 메뉴 클릭 → Appearance 선택 → Appearance 탭 열림 → 테마 선택 → 즉시 적용
```

---

## 2. 구현 구조

### 2.1 파일 구조
```
public/
├── js/
│   ├── modules/
│   │   └── theme-manager.js    # 새로 생성 (테마 관리 모듈)
│   └── themes/
│       └── themes.js           # 새로 생성 (테마 정의)
├── css/
│   └── themes.css              # 새로 생성 (CSS 변수)
├── index.html                  # 메뉴 및 Appearance 탭 UI 추가
└── renderer.js                 # Appearance 탭 렌더링 로직
```

---

## 3. 상세 설계

### 3.1 테마 정의 (themes.js)

```javascript
const Themes = {
  'vscode-dark': {
    name: 'VSCode Dark',
    description: '기본 VSCode 스타일 다크 테마',
    colors: {
      '--bg-primary': '#1e1e1e',
      '--bg-secondary': '#252526',
      '--bg-tertiary': '#333333',
      '--bg-hover': '#2a2d2e',
      '--text-primary': '#cccccc',
      '--text-secondary': '#858585',
      '--accent-primary': '#0e639c',
      '--accent-hover': '#1177bb',
      '--border-color': '#3c3c3c',
      '--scrollbar-bg': '#1e1e1e',
      '--scrollbar-thumb': '#424242',
      '--tab-active-bg': '#1e1e1e',
      '--tab-inactive-bg': '#2d2d2d',
      '--sidebar-bg': '#252526',
      '--titlebar-bg': '#3c3c3c',
      '--panel-bg': '#1e1e1e',
      '--input-bg': '#3c3c3c',
      '--button-bg': '#0e639c',
      '--button-hover': '#1177bb',
      '--success': '#4ec9b0',
      '--warning': '#dcdcaa',
      '--error': '#f14c4c',
      '--info': '#3794ff'
    }
  },

  'notion-light': {
    name: 'Notion Light',
    description: '깔끔한 미니멀 라이트 테마',
    colors: {
      '--bg-primary': '#ffffff',
      '--bg-secondary': '#f7f6f3',
      '--bg-tertiary': '#f1f1ef',
      '--bg-hover': '#ebebea',
      '--text-primary': '#37352f',
      '--text-secondary': '#787774',
      '--accent-primary': '#2eaadc',
      '--accent-hover': '#0b8ec4',
      '--border-color': '#e9e9e7',
      '--scrollbar-bg': '#f7f6f3',
      '--scrollbar-thumb': '#d3d1cb',
      '--tab-active-bg': '#ffffff',
      '--tab-inactive-bg': '#f7f6f3',
      '--sidebar-bg': '#f7f6f3',
      '--titlebar-bg': '#ffffff',
      '--panel-bg': '#ffffff',
      '--input-bg': '#f7f6f3',
      '--button-bg': '#2eaadc',
      '--button-hover': '#0b8ec4',
      '--success': '#0f7b6c',
      '--warning': '#c77d48',
      '--error': '#e03e3e',
      '--info': '#2eaadc'
    }
  },

  'figma-dark': {
    name: 'Figma Dark',
    description: '크리에이티브 디자인 툴 스타일',
    colors: {
      '--bg-primary': '#2c2c2c',
      '--bg-secondary': '#1e1e1e',
      '--bg-tertiary': '#383838',
      '--bg-hover': '#444444',
      '--text-primary': '#ffffff',
      '--text-secondary': '#b3b3b3',
      '--accent-primary': '#a259ff',
      '--accent-hover': '#b77dff',
      '--border-color': '#444444',
      '--scrollbar-bg': '#2c2c2c',
      '--scrollbar-thumb': '#555555',
      '--tab-active-bg': '#2c2c2c',
      '--tab-inactive-bg': '#1e1e1e',
      '--sidebar-bg': '#1e1e1e',
      '--titlebar-bg': '#2c2c2c',
      '--panel-bg': '#383838',
      '--input-bg': '#383838',
      '--button-bg': '#a259ff',
      '--button-hover': '#b77dff',
      '--success': '#14ae5c',
      '--warning': '#ffcd29',
      '--error': '#f24822',
      '--info': '#1abcfe'
    }
  },

  'linear-dark': {
    name: 'Linear Dark',
    description: '울트라 미니멀 프리미엄 다크',
    colors: {
      '--bg-primary': '#0a0a0b',
      '--bg-secondary': '#111113',
      '--bg-tertiary': '#18181b',
      '--bg-hover': '#27272a',
      '--text-primary': '#fafafa',
      '--text-secondary': '#71717a',
      '--accent-primary': '#5e6ad2',
      '--accent-hover': '#7c85e0',
      '--border-color': '#27272a',
      '--scrollbar-bg': '#0a0a0b',
      '--scrollbar-thumb': '#3f3f46',
      '--tab-active-bg': '#18181b',
      '--tab-inactive-bg': '#111113',
      '--sidebar-bg': '#111113',
      '--titlebar-bg': '#0a0a0b',
      '--panel-bg': '#111113',
      '--input-bg': '#18181b',
      '--button-bg': '#5e6ad2',
      '--button-hover': '#7c85e0',
      '--success': '#22c55e',
      '--warning': '#eab308',
      '--error': '#ef4444',
      '--info': '#5e6ad2'
    }
  },

  'arc-gradient': {
    name: 'Arc Gradient',
    description: '트렌디한 그라데이션 테마',
    colors: {
      '--bg-primary': '#161618',
      '--bg-secondary': '#1c1c1e',
      '--bg-tertiary': '#232325',
      '--bg-hover': '#2a2a2d',
      '--text-primary': '#ffffff',
      '--text-secondary': '#8e8e93',
      '--accent-primary': '#667eea',
      '--accent-hover': '#764ba2',
      '--border-color': '#2c2c2e',
      '--scrollbar-bg': '#161618',
      '--scrollbar-thumb': '#48484a',
      '--tab-active-bg': '#232325',
      '--tab-inactive-bg': '#1c1c1e',
      '--sidebar-bg': '#1c1c1e',
      '--titlebar-bg': '#161618',
      '--panel-bg': '#1c1c1e',
      '--input-bg': '#232325',
      '--button-bg': 'linear-gradient(135deg, #667eea, #764ba2)',
      '--button-hover': 'linear-gradient(135deg, #764ba2, #667eea)',
      '--success': '#34d399',
      '--warning': '#fbbf24',
      '--error': '#f87171',
      '--info': '#60a5fa',
      '--gradient-accent': 'linear-gradient(135deg, #667eea, #764ba2)'
    }
  },

  'obsidian-dark': {
    name: 'Obsidian Dark',
    description: '지식 관리 도구 스타일',
    colors: {
      '--bg-primary': '#1e1e1e',
      '--bg-secondary': '#262626',
      '--bg-tertiary': '#2d2d2d',
      '--bg-hover': '#363636',
      '--text-primary': '#dcddde',
      '--text-secondary': '#999999',
      '--accent-primary': '#7f6df2',
      '--accent-hover': '#9685f5',
      '--border-color': '#404040',
      '--scrollbar-bg': '#1e1e1e',
      '--scrollbar-thumb': '#4a4a4a',
      '--tab-active-bg': '#2d2d2d',
      '--tab-inactive-bg': '#262626',
      '--sidebar-bg': '#262626',
      '--titlebar-bg': '#262626',
      '--panel-bg': '#1e1e1e',
      '--input-bg': '#2d2d2d',
      '--button-bg': '#7f6df2',
      '--button-hover': '#9685f5',
      '--success': '#2d5a4a',
      '--warning': '#e5c07b',
      '--error': '#e06c75',
      '--info': '#61afef',
      '--link-color': '#7f6df2',
      '--tag-color': '#e5c07b'
    }
  }
};

window.Themes = Themes;
```

---

### 3.2 테마 매니저 모듈 (theme-manager.js)

```javascript
/**
 * Theme Manager Module
 * 테마 관리 및 적용을 담당
 */
(function() {
  'use strict';

  const STORAGE_KEY = 'creative-tools-theme';
  const DEFAULT_THEME = 'vscode-dark';

  let currentTheme = DEFAULT_THEME;

  /**
   * 테마 적용
   */
  function applyTheme(themeId) {
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
    if (themeId.includes('light')) {
      document.body.classList.add('theme-light');
    } else {
      document.body.classList.add('theme-dark');
    }

    // 현재 테마 저장
    currentTheme = themeId;
    localStorage.setItem(STORAGE_KEY, themeId);

    // 테마 변경 이벤트 발생
    window.dispatchEvent(new CustomEvent('themechange', {
      detail: { themeId, theme }
    }));

    return true;
  }

  /**
   * 저장된 테마 로드
   */
  function loadSavedTheme() {
    const savedTheme = localStorage.getItem(STORAGE_KEY);
    if (savedTheme && window.Themes[savedTheme]) {
      applyTheme(savedTheme);
    } else {
      applyTheme(DEFAULT_THEME);
    }
  }

  /**
   * 현재 테마 ID 반환
   */
  function getCurrentTheme() {
    return currentTheme;
  }

  /**
   * 테마 목록 반환
   */
  function getThemeList() {
    return Object.entries(window.Themes).map(([id, theme]) => ({
      id,
      name: theme.name,
      description: theme.description
    }));
  }

  /**
   * Appearance 탭 열기
   */
  function openAppearanceTab() {
    if (typeof window.addSpecialTab === 'function') {
      window.addSpecialTab('appearance', 'Appearance');
    }
  }

  // 전역 노출
  window.applyTheme = applyTheme;
  window.loadSavedTheme = loadSavedTheme;
  window.getCurrentTheme = getCurrentTheme;
  window.getThemeList = getThemeList;
  window.openAppearanceTab = openAppearanceTab;

  // DOM 로드 시 저장된 테마 적용
  document.addEventListener('DOMContentLoaded', loadSavedTheme);

})();
```

---

### 3.3 HTML 변경사항

#### View 메뉴에 Appearance 추가 (index.html)

```html
<!-- View 메뉴 드롭다운 -->
<div class="dropdown-menu" id="viewDropdown">
  <div class="dropdown-item" onclick="toggleOutputPanel(event)">
    <span>Output</span>
    <span class="shortcut" id="outputCheckmark"></span>
  </div>
  <div class="dropdown-item" onclick="toggleDevToolsFromMenu(event)">
    <span>Toggle Developer Tools</span>
    <span class="shortcut">Ctrl+Shift+I</span>
  </div>
  <div class="dropdown-divider"></div>
  <div class="dropdown-item" onclick="openAppearanceTab(); closeAllMenus();">
    <span>Appearance</span>
    <span class="shortcut"></span>
  </div>
</div>
```

#### Appearance 탭 컨텐츠 영역 (index.html)

```html
<!-- Appearance 탭 템플릿 -->
<template id="appearanceTabTemplate">
  <div class="appearance-container">
    <div class="appearance-header">
      <h2>Appearance</h2>
      <p>Select a theme for Creative Tools</p>
    </div>

    <div class="theme-grid" id="themeGrid">
      <!-- 테마 카드가 동적으로 생성됨 -->
    </div>
  </div>
</template>
```

---

### 3.4 Appearance 탭 렌더링 (renderer.js에 추가)

```javascript
/**
 * Appearance 탭 렌더링
 */
function renderAppearanceTab() {
  const contentArea = document.getElementById('editorContent');
  const themes = window.getThemeList();
  const currentTheme = window.getCurrentTheme();

  const themeCards = themes.map(theme => `
    <div class="theme-card ${theme.id === currentTheme ? 'active' : ''}"
         data-theme-id="${theme.id}"
         onclick="selectTheme('${theme.id}')">
      <div class="theme-preview theme-preview-${theme.id}">
        <div class="preview-titlebar"></div>
        <div class="preview-content">
          <div class="preview-sidebar"></div>
          <div class="preview-editor"></div>
        </div>
      </div>
      <div class="theme-info">
        <div class="theme-name">${theme.name}</div>
        <div class="theme-description">${theme.description}</div>
      </div>
      <div class="theme-check">
        ${theme.id === currentTheme ? '<span class="codicon codicon-check"></span>' : ''}
      </div>
    </div>
  `).join('');

  contentArea.innerHTML = `
    <div class="appearance-container">
      <div class="appearance-header">
        <h2>Appearance</h2>
        <p>Select a theme for Creative Tools</p>
      </div>
      <div class="theme-grid">
        ${themeCards}
      </div>
    </div>
  `;
}

/**
 * 테마 선택
 */
function selectTheme(themeId) {
  if (window.applyTheme(themeId)) {
    // 선택 UI 업데이트
    document.querySelectorAll('.theme-card').forEach(card => {
      const isActive = card.dataset.themeId === themeId;
      card.classList.toggle('active', isActive);
      card.querySelector('.theme-check').innerHTML =
        isActive ? '<span class="codicon codicon-check"></span>' : '';
    });

    window.showToast('success', `Theme changed to ${window.Themes[themeId].name}`);
  }
}

window.selectTheme = selectTheme;
window.renderAppearanceTab = renderAppearanceTab;
```

---

### 3.5 CSS 스타일 (themes.css)

```css
/* ===== CSS 변수 기본값 ===== */
:root {
  --bg-primary: #1e1e1e;
  --bg-secondary: #252526;
  --bg-tertiary: #333333;
  --bg-hover: #2a2d2e;
  --text-primary: #cccccc;
  --text-secondary: #858585;
  --accent-primary: #0e639c;
  --accent-hover: #1177bb;
  --border-color: #3c3c3c;
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --transition-fast: 0.15s ease;
  --transition-normal: 0.25s ease;
}

/* ===== Appearance 탭 스타일 ===== */
.appearance-container {
  padding: 40px;
  max-width: 1200px;
  margin: 0 auto;
}

.appearance-header {
  margin-bottom: 32px;
}

.appearance-header h2 {
  font-size: 24px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 8px 0;
}

.appearance-header p {
  font-size: 14px;
  color: var(--text-secondary);
  margin: 0;
}

/* ===== 테마 그리드 ===== */
.theme-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 20px;
}

/* ===== 테마 카드 ===== */
.theme-card {
  background: var(--bg-secondary);
  border: 2px solid var(--border-color);
  border-radius: var(--radius-lg);
  padding: 16px;
  cursor: pointer;
  transition: all var(--transition-normal);
  position: relative;
}

.theme-card:hover {
  border-color: var(--accent-primary);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

.theme-card.active {
  border-color: var(--accent-primary);
  background: var(--bg-tertiary);
}

/* ===== 테마 프리뷰 ===== */
.theme-preview {
  height: 140px;
  border-radius: var(--radius-md);
  overflow: hidden;
  margin-bottom: 12px;
  border: 1px solid var(--border-color);
}

.preview-titlebar {
  height: 24px;
  background: #3c3c3c;
}

.preview-content {
  display: flex;
  height: calc(100% - 24px);
}

.preview-sidebar {
  width: 40px;
  background: #252526;
}

.preview-editor {
  flex: 1;
  background: #1e1e1e;
}

/* 각 테마별 프리뷰 색상 */
.theme-preview-notion-light .preview-titlebar { background: #ffffff; }
.theme-preview-notion-light .preview-sidebar { background: #f7f6f3; }
.theme-preview-notion-light .preview-editor { background: #ffffff; }

.theme-preview-figma-dark .preview-titlebar { background: #2c2c2c; }
.theme-preview-figma-dark .preview-sidebar { background: #1e1e1e; }
.theme-preview-figma-dark .preview-editor { background: #2c2c2c; }

.theme-preview-linear-dark .preview-titlebar { background: #0a0a0b; }
.theme-preview-linear-dark .preview-sidebar { background: #111113; }
.theme-preview-linear-dark .preview-editor { background: #0a0a0b; }

.theme-preview-arc-gradient .preview-titlebar {
  background: linear-gradient(135deg, #667eea, #764ba2);
}
.theme-preview-arc-gradient .preview-sidebar { background: #1c1c1e; }
.theme-preview-arc-gradient .preview-editor { background: #161618; }

.theme-preview-obsidian-dark .preview-titlebar { background: #262626; }
.theme-preview-obsidian-dark .preview-sidebar { background: #262626; }
.theme-preview-obsidian-dark .preview-editor { background: #1e1e1e; }

/* ===== 테마 정보 ===== */
.theme-info {
  padding-right: 30px;
}

.theme-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 4px;
}

.theme-description {
  font-size: 12px;
  color: var(--text-secondary);
}

/* ===== 체크 표시 ===== */
.theme-check {
  position: absolute;
  top: 16px;
  right: 16px;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--accent-primary);
  font-size: 18px;
}

/* ===== 전역 CSS 변수 적용 ===== */
body {
  background-color: var(--bg-primary);
  color: var(--text-primary);
}

.titlebar {
  background-color: var(--titlebar-bg, var(--bg-tertiary));
}

.sidebar {
  background-color: var(--sidebar-bg, var(--bg-secondary));
}

.activity-bar {
  background-color: var(--bg-secondary);
}

.tab-bar {
  background-color: var(--bg-secondary);
}

.tab.active {
  background-color: var(--tab-active-bg, var(--bg-primary));
}

.tab:not(.active) {
  background-color: var(--tab-inactive-bg, var(--bg-secondary));
}

#editorContent {
  background-color: var(--bg-primary);
}

.bottom-panel {
  background-color: var(--panel-bg, var(--bg-primary));
  border-top-color: var(--border-color);
}

/* 스크롤바 스타일 */
::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}

::-webkit-scrollbar-track {
  background: var(--scrollbar-bg, var(--bg-primary));
}

::-webkit-scrollbar-thumb {
  background: var(--scrollbar-thumb, #424242);
  border-radius: 5px;
}

::-webkit-scrollbar-thumb:hover {
  background: var(--accent-primary);
}
```

---

## 4. 구현 순서

### Step 1: 기반 작업
1. `public/js/themes/themes.js` 생성 (테마 정의)
2. `public/js/modules/theme-manager.js` 생성 (테마 관리)
3. `public/css/themes.css` 생성 (CSS 변수)

### Step 2: HTML 수정
4. `index.html`에 스크립트/CSS 로드 추가
5. View 메뉴에 Appearance 항목 추가

### Step 3: 렌더링 로직
6. `renderer.js`에 Appearance 탭 렌더링 함수 추가
7. `tab-manager.js`에서 'appearance' 탭 타입 처리

### Step 4: 스타일 마이그레이션
8. 기존 하드코딩된 색상을 CSS 변수로 변경
9. 각 테마 프리뷰 스타일 적용

### Step 5: 테스트
10. 모든 테마 전환 테스트
11. 새로고침 후 테마 유지 확인
12. UI 요소별 테마 적용 확인

---

## 5. 예상 작업량

| 항목 | 예상 라인 수 | 난이도 |
|------|-------------|--------|
| themes.js | ~200줄 | 낮음 |
| theme-manager.js | ~80줄 | 중간 |
| themes.css | ~300줄 | 중간 |
| index.html 수정 | ~20줄 | 낮음 |
| renderer.js 수정 | ~80줄 | 중간 |
| 기존 CSS 마이그레이션 | ~200줄 | 높음 |
| **총계** | **~880줄** | |

---

## 6. 확장 가능성

### 향후 추가 기능
- 커스텀 테마 생성기
- 테마 내보내기/가져오기 (JSON)
- 시간대별 자동 테마 전환
- 폰트 크기/패밀리 설정
- 아이콘 테마 선택

---

*작성일: 2024-12-24*
