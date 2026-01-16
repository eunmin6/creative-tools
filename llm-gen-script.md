# Robot Script Generator 구현 계획

## 개요
tc.md 파일 또는 testcase 폴더를 우클릭하여 "Generate Script" 메뉴를 통해 Robot Framework 스크립트를 자동 생성하는 기능

## 요구사항 정리

### 기능 흐름
1. `.md` 파일 우클릭 → "Generate Script" 메뉴 표시
2. `testcase` 폴더 우클릭 → "Generate Script" 메뉴 표시 (폴더 내 모든 .md 처리)
3. 메뉴 클릭 시:
   - LLM을 통해 robot 스크립트 생성
   - 디폴트 모델: `gpt-oss:20b`
   - Chat에서 선택한 모델이 있으면 해당 모델 사용
4. 생성된 `.robot` 파일을 탭으로 열고 실시간 스트리밍으로 내용 표시
5. 완료 후 `robot --dryrun` 실행하여 문법 검증
6. 결과를 Output 패널에 표시

### 파일명 규칙
- `34228217.md` → `34228217.robot`
- 확장자만 변경

---

## 구현 계획

### 1단계: 컨텍스트 메뉴 추가

**파일: `public/index.html`**

```html
<!-- MD 파일용 컨텍스트 메뉴 추가 (line ~1478 근처) -->
<div class="file-context-menu" id="mdFileContextMenu" style="display: none;">
  <div class="context-menu-item" onclick="generateRobotScript()">
    <i class="codicon codicon-robot"></i>
    <span class="context-menu-label">Generate Script</span>
  </div>
  <div class="context-menu-separator"></div>
  <div class="context-menu-item" onclick="renameItem()">
    <i class="codicon codicon-edit"></i>
    <span class="context-menu-label">Rename</span>
    <span class="context-menu-shortcut">F2</span>
  </div>
  <div class="context-menu-item danger" onclick="deleteItem()">
    <i class="codicon codicon-trash"></i>
    <span class="context-menu-label">Delete</span>
    <span class="context-menu-shortcut">Del</span>
  </div>
</div>
```

**파일: `public/js/modules/file-explorer.js`**

- `showMdFileContextMenu(e, filePath, fileName)` 함수 추가
- 파일 우클릭 시 `.md` 확장자 체크하여 MD 컨텍스트 메뉴 표시
- `hideContextMenu()`에 mdFileContextMenu 숨기기 추가

**파일: `public/index.html` (testcase 폴더 메뉴 수정)**

- 기존 `testcaseFolderContextMenu`에 "Generate Script" 항목 추가

---

### 2단계: Robot Script 생성 모듈

**새 파일: `public/js/modules/robot-generator.js`**

```javascript
// ===== Robot Script Generator =====

const DEFAULT_MODEL = 'gpt-oss:20b';

// 현재 선택된 LLM 모델 가져오기
function getCurrentLLMModel() {
  const llmSelect = document.getElementById('llmSelect');
  if (llmSelect && llmSelect.value) {
    return {
      model: llmSelect.value,
      provider: llmSelect.selectedOptions[0]?.dataset?.provider || 'ollama'
    };
  }
  return { model: DEFAULT_MODEL, provider: 'ollama' };
}

// 단일 MD 파일에서 Robot 스크립트 생성
async function generateRobotScript() {
  const target = window.getContextMenuTarget();
  const mdFilePath = target.path;
  const mdFileName = target.name;

  hideContextMenu();

  // .robot 파일 경로 생성
  const robotFilePath = mdFilePath.replace(/\.md$/i, '.robot');
  const robotFileName = mdFileName.replace(/\.md$/i, '.robot');

  // 빈 .robot 파일 생성 및 탭 열기
  await createAndOpenRobotTab(robotFilePath, robotFileName);

  // MD 파일 내용 읽기
  const mdContent = await electronAPI.fs.readFile(mdFilePath);

  // LLM으로 스크립트 생성 (스트리밍)
  await streamGenerateRobotScript(mdContent, robotFilePath);

  // 완료 후 dry-run 실행
  await runRobotDryRun(robotFilePath);
}

// 폴더 내 모든 MD 파일 처리
async function generateScriptsFromFolder() {
  const target = window.getContextMenuTarget();
  const folderPath = target.path;

  hideContextMenu();

  // 폴더 내 .md 파일 목록 가져오기
  const files = await electronAPI.fs.readdir(folderPath);
  const mdFiles = files.filter(f => f.name.endsWith('.md') && !f.isDirectory);

  // 각 파일에 대해 순차 처리
  for (const file of mdFiles) {
    const mdFilePath = `${folderPath}/${file.name}`;
    const robotFilePath = mdFilePath.replace(/\.md$/i, '.robot');
    const robotFileName = file.name.replace(/\.md$/i, '.robot');

    await createAndOpenRobotTab(robotFilePath, robotFileName);
    const mdContent = await electronAPI.fs.readFile(mdFilePath);
    await streamGenerateRobotScript(mdContent, robotFilePath);
    await runRobotDryRun(robotFilePath);
  }
}

// 빈 Robot 파일 생성 및 탭 열기
async function createAndOpenRobotTab(filePath, fileName) {
  // 빈 파일 생성
  await electronAPI.fs.writeFile(filePath, '');

  // 탭 열기
  await openFileInEditor(filePath);

  // Output에 시작 메시지
  appendOutput(`Generating: ${fileName}`, 'info');
}

// LLM 스트리밍으로 Robot 스크립트 생성
async function streamGenerateRobotScript(mdContent, robotFilePath) {
  const { model, provider } = getCurrentLLMModel();

  // 프롬프트 구성
  const prompt = buildRobotGeneratorPrompt(mdContent);

  // LLM 설정 로드
  const settings = await loadLLMSettings();
  const endpoint = settings[provider]?.endpoint || 'http://localhost:11434';

  // 스트리밍 호출
  let fullContent = '';

  if (provider === 'ollama') {
    const response = await fetch(`${endpoint}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, stream: true })
    });

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
            fullContent += json.response;
            // 탭 내용 실시간 업데이트
            updateActiveTabContent(fullContent);
          }
        } catch (e) {}
      }
    }
  }
  // vLLM, Gemini 지원도 추가...

  // 최종 파일 저장
  await electronAPI.fs.writeFile(robotFilePath, fullContent);
  appendOutput(`Generated: ${robotFilePath}`, 'success');
}

// Robot 스크립트 생성용 프롬프트
function buildRobotGeneratorPrompt(mdContent) {
  return `You are a Robot Framework script generator.
Convert the following test case specification (in Markdown format) into a Robot Framework test script.

Requirements:
- Use Robot Framework syntax
- Include proper Settings, Variables, Keywords, and Test Cases sections
- Handle ADB commands appropriately
- Include proper documentation

Test Case Specification:
${mdContent}

Generate only the Robot Framework script code, no explanations:`;
}

// Robot --dryrun 실행
async function runRobotDryRun(robotFilePath) {
  appendOutput(`Running dry-run: ${robotFilePath}`, 'info');

  const result = await electronAPI.python.run('robot', ['--dryrun', robotFilePath]);

  if (result.success) {
    appendOutput('Dry-run completed successfully', 'success');
  } else {
    appendOutput(`Dry-run failed: ${result.error}`, 'error');
  }
}

// 탭 내용 실시간 업데이트
function updateActiveTabContent(content) {
  const activeTab = getActiveTab();
  if (activeTab && window.monacoEditor) {
    window.monacoEditor.setValue(content);
    // 커서를 끝으로 이동
    const lastLine = window.monacoEditor.getModel().getLineCount();
    window.monacoEditor.revealLine(lastLine);
  }
}

// 전역 함수 등록
window.generateRobotScript = generateRobotScript;
window.generateScriptsFromFolder = generateScriptsFromFolder;
```

---

### 3단계: 메인 프로세스 수정

**파일: `src/main.ts`**

Robot Framework 실행을 위한 IPC 핸들러 추가:

```typescript
// Robot Framework dry-run 실행
ipcMain.handle('robot:dryrun', async (event, robotFilePath: string) => {
  return new Promise((resolve) => {
    const process = spawn('robot', ['--dryrun', robotFilePath], {
      shell: true
    });

    let stdout = '';
    let stderr = '';

    process.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    process.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    process.on('close', (code) => {
      resolve({
        success: code === 0,
        stdout,
        stderr,
        code
      });
    });
  });
});
```

**파일: `src/preload.ts`**

```typescript
robot: {
  dryrun: (filePath: string) => ipcRenderer.invoke('robot:dryrun', filePath)
}
```

---

### 4단계: 파일 로드 순서

**파일: `public/index.html`**

```html
<script src="js/modules/robot-generator.js"></script>
```

---

## 수정할 파일 목록

| 파일 | 변경 내용 |
|------|----------|
| `public/index.html` | MD 파일 컨텍스트 메뉴 추가, testcase 폴더 메뉴에 Generate Script 추가 |
| `public/js/modules/file-explorer.js` | `showMdFileContextMenu()` 함수 추가, `.md` 파일 감지 로직 |
| `public/js/modules/robot-generator.js` | **새 파일** - 스크립트 생성 로직 |
| `src/main.ts` | `robot:dryrun` IPC 핸들러 추가 |
| `src/preload.ts` | `robot.dryrun` API 노출 |

---

## 실행 흐름도

```
[사용자 우클릭]
       ↓
[.md 파일 / testcase 폴더 감지]
       ↓
[컨텍스트 메뉴 표시: "Generate Script"]
       ↓
[메뉴 클릭]
       ↓
[.robot 파일 생성 (빈 파일)]
       ↓
[탭 열기]
       ↓
[LLM 스트리밍 호출]
       ↓
[실시간 탭 내용 업데이트] ←── 스트리밍 청크
       ↓
[파일 저장]
       ↓
[robot --dryrun 실행]
       ↓
[Output 패널에 결과 표시]
```

---

## 추가 고려사항

1. **에러 처리**: LLM 연결 실패, 파일 쓰기 실패 등
2. **진행률 표시**: 폴더 처리 시 진행률 표시
3. **취소 기능**: 생성 중 취소 가능하도록
4. **프롬프트 커스터마이징**: `.vvu.prompt.robot.md` 파일로 프롬프트 커스터마이징 지원
