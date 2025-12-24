# LLM Setting 구현 제안서

## 개요

Chat 뷰에서 LLM 설정을 관리할 수 있는 Setting 탭을 구현합니다.

---

## UI 구성

### 1. Chat 패널 하단 - Setting 버튼 추가

```
현재:
[Model: ▼ gpt-oss:20b]

변경 후:
[Model: ▼ gpt-oss:20b] [⚙ Setting]
```

- 모델 선택 드롭다운 옆에 설정 아이콘 버튼 추가
- `codicon-settings-gear` 아이콘 사용
- 클릭 시 Setting 탭 열기

### 2. Setting 탭

Theme 탭과 유사한 구조로 LLM Setting 탭 생성

```
┌─────────────────────────────────────────────┐
│  LLM Setting                                │
│  Configure your LLM providers              │
├─────────────────────────────────────────────┤
│                                             │
│  ┌─────────────────────────────────────┐   │
│  │ Ollama                         [●]  │   │
│  │ Local LLM server                    │   │
│  │ ─────────────────────────────────── │   │
│  │ Endpoint: [http://localhost:11434] │   │
│  │ [Test Connection]                   │   │
│  └─────────────────────────────────────┘   │
│                                             │
│  ┌─────────────────────────────────────┐   │
│  │ vLLM                           [○]  │   │
│  │ High-performance LLM server         │   │
│  │ ─────────────────────────────────── │   │
│  │ Endpoint: [http://localhost:8000 ] │   │
│  │ [Test Connection]                   │   │
│  └─────────────────────────────────────┘   │
│                                             │
│  ┌─────────────────────────────────────┐   │
│  │ Gemini Cloud API               [○]  │   │
│  │ Google Gemini API                   │   │
│  │ ─────────────────────────────────── │   │
│  │ API Key: [••••••••••••••••••••••••]│   │
│  │ Model:   [▼ gemini-pro           ] │   │
│  │ [Test Connection]                   │   │
│  └─────────────────────────────────────┘   │
│                                             │
│  ─────────────────────────────────────────  │
│  ℹ Settings are saved automatically.       │
│                                             │
└─────────────────────────────────────────────┘
```

---

## 3가지 LLM Provider 설정

### 1. Ollama (로컬 LLM)

| 항목 | 설명 |
|------|------|
| Endpoint | Ollama 서버 URL (기본값: `http://localhost:11434`) |
| 활성화 | 라디오 버튼으로 선택 |
| Test Connection | 연결 테스트 버튼 (`/api/tags` 호출) |

**API 형식:**
```javascript
// 모델 목록
GET http://localhost:11434/api/tags

// 생성 요청
POST http://localhost:11434/api/generate
{
  "model": "gpt-oss:20b",
  "prompt": "...",
  "stream": true
}
```

### 2. vLLM (고성능 LLM 서버)

| 항목 | 설명 |
|------|------|
| Endpoint | vLLM 서버 URL (기본값: `http://localhost:8000`) |
| 활성화 | 라디오 버튼으로 선택 |
| Test Connection | 연결 테스트 버튼 (`/v1/models` 호출) |

**API 형식 (OpenAI 호환):**
```javascript
// 모델 목록
GET http://localhost:8000/v1/models

// 생성 요청
POST http://localhost:8000/v1/chat/completions
{
  "model": "model-name",
  "messages": [{"role": "user", "content": "..."}],
  "stream": true
}
```

### 3. Gemini Cloud API

| 항목 | 설명 |
|------|------|
| API Key | Google AI Studio에서 발급받은 API 키 |
| Model | 사용할 Gemini 모델 선택 (gemini-pro, gemini-1.5-pro 등) |
| 활성화 | 라디오 버튼으로 선택 |
| Test Connection | 연결 테스트 버튼 |

**API 형식:**
```javascript
// 생성 요청
POST https://generativelanguage.googleapis.com/v1/models/{model}:generateContent?key={API_KEY}
{
  "contents": [{"parts": [{"text": "..."}]}]
}
```

---

## 파일 구조

```
public/
├── js/
│   └── modules/
│       └── llm-setting.js     # LLM 설정 모듈 (신규)
├── css/
│   └── llm-setting.css        # LLM 설정 스타일 (신규, 또는 themes.css에 추가)
└── index.html                  # Setting 버튼 추가
```

---

## 데이터 저장

localStorage에 설정 저장:

```javascript
const LLM_SETTINGS_KEY = 'creative-tools-llm-settings';

// 저장 형식
{
  activeProvider: 'ollama' | 'vllm' | 'gemini',
  ollama: {
    endpoint: 'http://localhost:11434'
  },
  vllm: {
    endpoint: 'http://localhost:8000'
  },
  gemini: {
    apiKey: '...',
    model: 'gemini-pro'
  }
}
```

---

## 구현 순서

1. **index.html**: Chat 패널 하단에 Setting 버튼 추가
2. **llm-setting.js**: LLM 설정 모듈 생성
   - `openLLMSettingTab()`: Setting 탭 열기
   - `renderLLMSettingTab()`: Setting 탭 렌더링
   - `saveLLMSettings()`: 설정 저장
   - `loadLLMSettings()`: 설정 로드
   - `testConnection()`: 연결 테스트
3. **tab-manager.js**: 'llmSetting' 탭 타입 추가
4. **chat-panel.js**: 선택된 provider에 따라 API 호출 분기
5. **themes.css**: Setting 탭 스타일 추가

---

## 추가 고려사항

- API Key는 마스킹 처리 (입력 시 `type="password"`)
- 연결 테스트 성공/실패 시 시각적 피드백
- Provider 변경 시 모델 목록 자동 갱신
- 테마에 맞는 스타일 적용 (CSS 변수 사용)
