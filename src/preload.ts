import { contextBridge, ipcRenderer } from 'electron';

// 렌더러 프로세스에서 안전하게 사용할 수 있는 API 노출
contextBridge.exposeInMainWorld('electronAPI', {
  // 메인 프로세스와 통신하는 예제 함수
  sendMessage: (message: string) => {
    console.log('Message from renderer:', message);
  },

  // 앱 정보 가져오기
  getAppInfo: () => {
    return {
      name: 'Electron TypeScript App',
      version: '1.0.0'
    };
  },

  // 파일 시스템 API (IPC를 통해 메인 프로세스에 요청)
  fs: {
    // 디렉토리 읽기
    readdir: async (dirPath: string) => {
      return await ipcRenderer.invoke('fs:readdir', dirPath);
    },

    // 파일 읽기
    readFile: async (filePath: string) => {
      return await ipcRenderer.invoke('fs:readFile', filePath);
    },

    // 파일 쓰기
    writeFile: async (filePath: string, content: string) => {
      return await ipcRenderer.invoke('fs:writeFile', filePath, content);
    },

    // 경로 정보 (순수 JavaScript로 처리)
    path: {
      basename: (filePath: string) => {
        return filePath.split(/[\\/]/).pop() || filePath;
      },
      dirname: (filePath: string) => {
        const parts = filePath.split(/[\\/]/);
        parts.pop();
        return parts.join('/');
      }
    }
  },

  // 프로젝트 루트 경로
  getProjectRoot: async () => {
    return await ipcRenderer.invoke('getProjectRoot');
  },

  // 윈도우 제어
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close')
  },

  // 개발자 도구
  devtools: {
    toggle: () => ipcRenderer.send('devtools:toggle')
  },

  // 다이얼로그
  dialog: {
    openFolder: async () => {
      return await ipcRenderer.invoke('dialog:openFolder');
    },
    openFile: async (options?: { filters?: { name: string; extensions: string[] }[] }) => {
      return await ipcRenderer.invoke('dialog:openFile', options);
    }
  },

  // Python 실행
  python: {
    run: async (scriptPath: string, args: string[] = []) => {
      return await ipcRenderer.invoke('python:run', scriptPath, args);
    }
  },

  // 터미널
  terminal: {
    create: async () => {
      return await ipcRenderer.invoke('terminal:create');
    },
    write: async (terminalId: string, data: string) => {
      return await ipcRenderer.invoke('terminal:write', terminalId, data);
    },
    kill: async (terminalId: string) => {
      return await ipcRenderer.invoke('terminal:kill', terminalId);
    },
    getCwd: async () => {
      return await ipcRenderer.invoke('terminal:getCwd');
    },
    onData: (callback: (data: { terminalId: string; data: string; isError?: boolean }) => void) => {
      ipcRenderer.on('terminal:data', (event, data) => callback(data));
    },
    onExit: (callback: (data: { terminalId: string; code: number }) => void) => {
      ipcRenderer.on('terminal:exit', (event, data) => callback(data));
    }
  }
});
