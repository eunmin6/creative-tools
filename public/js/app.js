/**
 * Creative Tools - Main Application Entry Point
 *
 * 이 파일은 모든 모듈이 로드된 후 앱을 초기화합니다.
 * 모듈 로드 순서:
 * 1. constants.js - 상수 및 AppState
 * 2. canvas-editor.js - 캔버스 에디터
 * 3. chat-panel.js - Chat 패널
 * 4. renderer.js - 나머지 기능 (파일 탐색기, 탭 관리 등)
 */

(function() {
  'use strict';

  // 앱이 로드되었음을 표시
  console.log('Creative Tools - App initializing...');

  // 모듈 로드 확인
  window.addEventListener('DOMContentLoaded', () => {
    console.log('DOM loaded, checking modules...');

    // Constants 로드 확인
    if (typeof window.Constants !== 'undefined') {
      console.log('✓ Constants loaded');
    } else {
      console.warn('✗ Constants not loaded');
    }

    // AppState 로드 확인
    if (typeof window.AppState !== 'undefined') {
      console.log('✓ AppState loaded');
    } else {
      console.warn('✗ AppState not loaded');
    }

    // Canvas Editor 함수 확인
    if (typeof window.openCanvasEditorForTab === 'function') {
      console.log('✓ Canvas Editor loaded');
    } else {
      console.warn('✗ Canvas Editor not loaded');
    }

    // Chat Panel 함수 확인
    if (typeof window.initChat === 'function') {
      console.log('✓ Chat Panel loaded');
    } else {
      console.warn('✗ Chat Panel not loaded');
    }

    console.log('Creative Tools - Ready');
  });

})();
