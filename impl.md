# Implementation Notes

## Testcase Sync 탭 구현

### 일반 파일 vs Testcase Sync 탭 비교

```
┌─────────────────────────────────────────────────────────────────┐
│  일반 파일 열기                 │  Testcase Sync 탭              │
├─────────────────────────────────────────────────────────────────┤
│  filePath: "C:/path/to/file"   │  filePath: "__testcase_sync__" │
│  fileName: "example.js"        │  fileName: "Testcase Sync"     │
│  type: undefined               │  type: "testcase-sync"         │
│  content: 파일 내용            │  content: null                 │
│  → Monaco Editor로 렌더링      │  → 커스텀 UI 렌더링            │
└─────────────────────────────────────────────────────────────────┘
```

### 탭 데이터 구조 (renderer.js)

```javascript
// 일반 파일 탭
openTabs.push({
  filePath: 'C:/path/to/file.js',
  fileName: 'file.js',
  type: undefined,  // 또는 'canvas'
  content: '파일 내용...',
  originalContent: '파일 내용...'
});

// Testcase Sync 탭 (특수 탭)
openTabs.push({
  filePath: '__testcase_sync__',  // 가상 경로
  fileName: 'Testcase Sync',
  type: 'testcase-sync',          // 특수 타입
  content: null,
  originalContent: null
});
```

### 렌더링 분기 (renderer.js:545)

```javascript
function renderActiveTabContent() {
  const tab = openTabs[activeTabIndex];

  if (tab.type === 'canvas') {
    openCanvasEditorForTab(tab);      // Canvas 에디터
  } else if (tab.type === 'testcase-sync') {
    renderTestcaseSync();              // Testcase Sync UI
  } else {
    // Monaco Editor로 텍스트 파일 편집
  }
}
```

### Testcase Sync UI 렌더링 (renderer.js:734)

```javascript
function renderTestcaseSync() {
  const editorArea = document.querySelector('.editor-area');
  editorArea.innerHTML = `
    <div class="testcase-sync">
      <h1>Testcase Sync</h1>
      <div onclick="loadFromCodebeamer()">Load from Codebeamer</div>
      <div onclick="importFromExcel()">Import from Excel</div>
    </div>
  `;
}
```

---

## Import from Excel → Python 호출 구조

```
┌──────────────────────────────────────────────────────────────────────────┐
│                              호출 흐름                                    │
└──────────────────────────────────────────────────────────────────────────┘

  [Renderer Process]              [Main Process]              [Python]
        │                              │                          │
        │  1. 파일 선택 다이얼로그      │                          │
        │─────────────────────────────>│                          │
        │     dialog:openFile          │                          │
        │<─────────────────────────────│                          │
        │     filePath 반환            │                          │
        │                              │                          │
        │  2. Python 스크립트 실행      │                          │
        │─────────────────────────────>│                          │
        │     python:run               │  spawn(python, [script]) │
        │                              │─────────────────────────>│
        │                              │                          │
        │                              │     stdout/stderr        │
        │                              │<─────────────────────────│
        │<─────────────────────────────│                          │
        │     결과 반환                 │                          │
        │                              │                          │
        │  3. OUTPUT 패널에 출력        │                          │
        ▼                              │                          │

```

### 1단계: 파일 선택 (renderer.js:790)

```javascript
async function importFromExcel() {
  // 파일 탐색기 열기
  const filePath = await window.electronAPI.dialog.openFile({
    filters: [{ name: 'Excel Files', extensions: ['xlsx', 'xls'] }]
  });

  if (filePath) {
    // Python 스크립트 실행
    await runPythonScript('scripts/excel_handler.py', [filePath]);
  }
}
```

### 2단계: IPC 통신

**preload.ts** - API 노출
```typescript
contextBridge.exposeInMainWorld('electronAPI', {
  python: {
    run: async (scriptPath, args) => {
      return await ipcRenderer.invoke('python:run', scriptPath, args);
    }
  }
});
```

**main.ts** - Python 실행
```typescript
ipcMain.handle('python:run', async (event, scriptPath, args) => {
  // venv 환경 자동 감지
  const venvPython = 'venv/Scripts/python.exe';
  const pythonPath = fs.existsSync(venvPython) ? venvPython : 'python';

  // child_process.spawn으로 실행
  const process = spawn(pythonPath, [scriptPath, ...args]);

  return { stdout, stderr, code };
});
```

### 3단계: Python 스크립트 (scripts/excel_handler.py)

```python
import sys

def main():
    file_path = sys.argv[1]  # 전달받은 Excel 파일 경로
    print(f"File path: {file_path}")
    # Excel 처리 로직...

if __name__ == "__main__":
    main()
```

### 4단계: 결과 출력 (renderer.js:2585)

```javascript
async function runPythonScript(scriptPath, args) {
  const result = await window.electronAPI.python.run(scriptPath, args);

  // stdout → OUTPUT 패널에 출력
  result.stdout.split('\n').forEach(line => {
    appendOutput(line, 'success');
  });
}
```

---

## 파일 구조 요약

```
creative-tools/
├── src/
│   ├── main.ts          # IPC 핸들러 (python:run, dialog:openFile)
│   └── preload.ts       # API 노출 (electronAPI.python, electronAPI.dialog)
├── public/
│   ├── index.html       # OUTPUT 패널 UI, View 메뉴
│   └── renderer.js      # Testcase Sync 렌더링, importFromExcel()
├── scripts/
│   └── excel_handler.py # Python 스크립트
└── venv/                # Python 가상환경 (선택)
```
