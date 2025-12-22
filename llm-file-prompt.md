# LLM 파일 첨부 프롬프트 구조

## 개요
Chat 패널에서 파일을 체크하면 해당 파일의 내용이 LLM 프롬프트에 포함되어 전송됩니다.

---

## 프롬프트 구성 순서

LLM에게 전달되는 전체 프롬프트는 다음 순서로 구성됩니다:

```
1. [System Instructions]     - .vvu.prompt.base.md 파일 내용
2. [Attached Files]          - 체크된 파일들의 내용
3. [Previous Questions History] - .vvu.prompt.history.md 파일 내용
4. [Last Conversation]       - .vvu.prompt.last.md 파일 내용
5. [Current Question]        - 사용자가 입력한 현재 질문
```

---

## 코드 위치

### 1. 첨부 파일 내용 수집 함수
**파일:** `public/renderer.js`
**함수:** `getAttachedFilesContent()` (라인 1965)

```javascript
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
```

### 2. 전체 프롬프트 구성
**파일:** `public/renderer.js`
**함수:** `streamOllamaResponse()` (라인 5849)

```javascript
async function streamOllamaResponse(prompt, model, loadingId) {
  // ...
  try {
    // 전체 프롬프트 구성: 시스템 + 첨부파일 + 히스토리 + 마지막 대화 + 현재 질문
    let fullPrompt = '';

    if (chatSystemPrompt) {
      fullPrompt += `[System Instructions]\n${chatSystemPrompt}\n\n`;
    }

    // 첨부된 파일 내용 추가
    const attachedContent = getAttachedFilesContent();
    if (attachedContent) {
      fullPrompt += attachedContent;
    }

    if (chatPromptHistory) {
      fullPrompt += `[Previous Questions History]\n${chatPromptHistory}\n\n`;
    }

    if (chatPromptLast) {
      fullPrompt += `[Last Conversation]\n${chatPromptLast}\n\n`;
    }

    fullPrompt += `[Current Question]\n${prompt}`;

    // Ollama API 호출
    const response = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model,
        prompt: fullPrompt,
        stream: true
      })
    });
    // ...
  }
}
```

---

## 실제 프롬프트 예시

파일 2개 (config.json, utils.js)를 체크하고 "이 파일들의 구조를 설명해줘"라고 질문한 경우:

```
[System Instructions]
# VVU Chat System Instructions

아래 지시사항을 숙지하고 사용자의 질문에 답변하세요.
...

[Attached Files]

--- config.json ---
{
  "name": "my-app",
  "version": "1.0.0"
}
--- End of config.json ---

--- utils.js ---
export function formatDate(date) {
  return date.toISOString();
}
--- End of utils.js ---

[Previous Questions History]
- 이전 질문 1
- 이전 질문 2

[Last Conversation]
Q: 마지막 질문
A: 마지막 답변

[Current Question]
이 파일들의 구조를 설명해줘
```

---

## 관련 변수

| 변수명 | 설명 | 저장 위치 |
|--------|------|-----------|
| `chatSystemPrompt` | 시스템 지시사항 | `.vvu.prompt.base.md` |
| `chatPromptHistory` | 이전 질문 히스토리 | `.vvu.prompt.history.md` |
| `chatPromptLast` | 마지막 대화 (Q&A) | `.vvu.prompt.last.md` |
| `openTabs[].chatAttached` | 파일 첨부 여부 | 메모리 (런타임) |
| `openTabs[].content` | 파일 내용 | 메모리 (런타임) |

---

## 흐름도

```
사용자 질문 입력
       ↓
sendChatMessage() 호출
       ↓
loadChatSystemPrompt() - 시스템 프롬프트 로드
       ↓
streamOllamaResponse() 호출
       ↓
┌──────────────────────────────────┐
│ fullPrompt 구성                   │
│ 1. chatSystemPrompt 추가          │
│ 2. getAttachedFilesContent() 호출 │
│    → 체크된 파일들 내용 수집       │
│ 3. chatPromptHistory 추가         │
│ 4. chatPromptLast 추가            │
│ 5. 현재 질문 추가                 │
└──────────────────────────────────┘
       ↓
Ollama API 호출 (POST /api/generate)
       ↓
스트리밍 응답 수신 및 표시
       ↓
saveChatHistoryFiles() - 히스토리 저장
```

---

## 대화 히스토리 관리 (30개 제한)

### 개요
이전 대화 내용을 LLM에게 전달하여 맥락을 유지합니다. 최대 30개의 질문만 저장되며, 초과 시 오래된 것부터 삭제됩니다.

### 히스토리 구조

```
┌─────────────────────────────────────────────────────────────┐
│ chatUserHistory (배열, 메모리)                               │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ [0] 가장 오래된 질문                                     │ │
│ │ [1] ...                                                  │ │
│ │ ...                                                      │ │
│ │ [28] 직전 질문                                           │ │
│ │ [29] 현재 질문 (최대 30개)                               │ │
│ └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                    ↓ 파일로 저장
┌─────────────────────────────────────────────────────────────┐
│ .vvu.prompt.history.md                                      │
│ (질문 [0] ~ [28] 저장, 마지막 질문 제외)                     │
├─────────────────────────────────────────────────────────────┤
│ # Chat History (Previous Questions)                         │
│                                                             │
│ - 질문 1                                                    │
│ - 질문 2                                                    │
│ - ...                                                       │
│ - 질문 29                                                   │
└─────────────────────────────────────────────────────────────┘
                    +
┌─────────────────────────────────────────────────────────────┐
│ .vvu.prompt.last.md                                         │
│ (마지막 Q&A만 저장)                                          │
├─────────────────────────────────────────────────────────────┤
│ # Last Conversation                                         │
│                                                             │
│ **Q:** 마지막 질문                                          │
│                                                             │
│ **A:** AI 응답 내용...                                      │
└─────────────────────────────────────────────────────────────┘
```

### 히스토리 저장 함수
**파일:** `public/renderer.js`
**함수:** `saveChatHistoryFiles()` (라인 5413)

```javascript
async function saveChatHistoryFiles(userQuestion, aiResponse) {
  if (!currentProjectPath) return;

  try {
    // 1. 기존 last의 질문을 history로 이동 (AI 답변 제외)
    if (chatPromptLast) {
      const lastLines = chatPromptLast.split('\n');
      const questionLine = lastLines.find(line => line.startsWith('**Q:**'));
      if (questionLine) {
        const prevQuestion = questionLine.replace('**Q:** ', '').trim();
        // 이미 history에 없으면 추가
        if (!chatUserHistory.includes(prevQuestion)) {
          chatUserHistory.push(prevQuestion);
        }
      }
    }

    // 2. 현재 질문을 userHistory에 추가 (Up/Down 키용)
    if (!chatUserHistory.includes(userQuestion)) {
      chatUserHistory.push(userQuestion);
    }

    // 3. 30개 제한 (오래된 것 삭제)
    while (chatUserHistory.length > 30) {
      chatUserHistory.shift();  // 배열 맨 앞(오래된 것) 제거
    }

    // 4. .vvu.prompt.history.md 저장 (마지막 질문 제외한 이전 질문들만)
    const historyQuestions = chatUserHistory.slice(0, -1);  // 마지막 제외
    if (historyQuestions.length > 0) {
      const historyContent = `# Chat History (Previous Questions)\n\n${historyQuestions.map(q => '- ' + q).join('\n')}\n`;
      const historyPath = currentProjectPath + '/.vvu.prompt.history.md';
      await window.electronAPI.fs.writeFile(historyPath, historyContent);
      chatPromptHistory = historyContent;
    }

    // 5. .vvu.prompt.last.md 저장 (마지막 Q&A)
    const lastContent = `# Last Conversation\n\n**Q:** ${userQuestion}\n\n**A:** ${aiResponse}\n`;
    const lastPath = currentProjectPath + '/.vvu.prompt.last.md';
    await window.electronAPI.fs.writeFile(lastPath, lastContent);
    chatPromptLast = lastContent;

    // 히스토리 인덱스 리셋
    chatHistoryIndex = -1;
    chatTempInput = '';

    console.log('Chat history files saved, total questions:', chatUserHistory.length);
  } catch (error) {
    console.error('Error saving chat history files:', error);
  }
}
```

### 히스토리 저장 흐름도

```
사용자가 질문 입력 → AI 응답 완료
                ↓
        saveChatHistoryFiles(질문, 응답) 호출
                ↓
┌───────────────────────────────────────────────┐
│ Step 1: 기존 last 질문 → history로 이동        │
│         (AI 응답은 버림, 질문만 저장)          │
└───────────────────────────────────────────────┘
                ↓
┌───────────────────────────────────────────────┐
│ Step 2: 현재 질문을 chatUserHistory에 추가     │
│         (중복 체크 후 추가)                    │
└───────────────────────────────────────────────┘
                ↓
┌───────────────────────────────────────────────┐
│ Step 3: 30개 초과 시 오래된 것 삭제            │
│         while (length > 30) shift()           │
└───────────────────────────────────────────────┘
                ↓
┌───────────────────────────────────────────────┐
│ Step 4: .vvu.prompt.history.md 저장           │
│         (마지막 질문 제외, 질문만 목록화)       │
└───────────────────────────────────────────────┘
                ↓
┌───────────────────────────────────────────────┐
│ Step 5: .vvu.prompt.last.md 저장              │
│         (마지막 Q&A 전체 저장)                 │
└───────────────────────────────────────────────┘
```

### 왜 history와 last를 분리하는가?

| 파일 | 저장 내용 | 용도 |
|------|----------|------|
| `.vvu.prompt.history.md` | 이전 질문들만 (응답 X) | LLM에게 대화 맥락 전달, 토큰 절약 |
| `.vvu.prompt.last.md` | 마지막 Q&A (질문+응답) | 바로 직전 대화 참조, 연속성 유지 |

**이유:**
- 모든 응답을 저장하면 프롬프트가 너무 길어짐 (토큰 낭비)
- 이전 질문들만 있어도 LLM이 대화 맥락 파악 가능
- 마지막 응답만 포함하면 바로 직전 맥락 유지 + 적절한 프롬프트 길이

### Up/Down 키 히스토리 탐색

`chatUserHistory` 배열은 입력창에서 Up/Down 키로 이전 질문을 탐색하는 데에도 사용됩니다.

```javascript
// Up 키: 이전 히스토리로 이동
if (event.key === 'ArrowUp' && chatUserHistory.length > 0) {
  if (chatHistoryIndex === -1) {
    chatTempInput = textarea.value;  // 현재 입력 임시 저장
    chatHistoryIndex = chatUserHistory.length - 1;  // 마지막부터 시작
  } else if (chatHistoryIndex > 0) {
    chatHistoryIndex--;
  }
  textarea.value = chatUserHistory[chatHistoryIndex] || '';
}

// Down 키: 다음 히스토리로 이동
if (event.key === 'ArrowDown' && chatHistoryIndex !== -1) {
  if (chatHistoryIndex < chatUserHistory.length - 1) {
    chatHistoryIndex++;
    textarea.value = chatUserHistory[chatHistoryIndex] || '';
  } else {
    chatHistoryIndex = -1;
    textarea.value = chatTempInput;  // 임시 저장된 입력 복원
  }
}
```

### 히스토리 초기화 시점

| 시점 | 동작 |
|------|------|
| Open Folder | `.vvu.prompt.history.md`, `.vvu.prompt.last.md` 삭제 |
| Open Chat | `.vvu.prompt.history.md` 삭제 |
| Reset Chat (새로고침 아이콘) | 모든 히스토리 초기화 + 파일 삭제 |

---

## 주의사항

1. **파일 크기**: 대용량 파일을 여러 개 첨부하면 프롬프트가 매우 길어져 LLM 토큰 제한에 걸릴 수 있음
2. **바이너리 파일**: 텍스트 파일만 첨부 가능 (이미지, 바이너리는 내용이 깨져서 표시됨)
3. **탭 상태**: 파일이 열려있는 탭만 첨부 가능 (닫힌 파일은 목록에 표시 안됨)
4. **히스토리 제한**: 30개 초과 시 오래된 질문부터 자동 삭제됨
5. **중복 방지**: 동일한 질문은 히스토리에 중복 저장되지 않음
