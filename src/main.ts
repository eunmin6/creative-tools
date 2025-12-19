import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { spawn, ChildProcess } from 'child_process';

let mainWindow: BrowserWindow | null = null;

// 터미널 프로세스 관리
const terminalProcesses: Map<string, ChildProcess> = new Map();
let terminalCounter = 0;

function createWindow(): void {
  // 브라우저 윈도우 생성
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    frame: false, // 기본 프레임 제거
    titleBarStyle: 'hidden', // 타이틀바 숨기기
    backgroundColor: '#1e1e1e', // 배경색 설정
    icon: path.join(__dirname, '../public/vvu-icon2.png'), // 작업 표시줄 아이콘
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // index.html 로드
  mainWindow.loadFile(path.join(__dirname, '../public/index.html'));

  // 윈도우가 닫힐 때
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// IPC 핸들러 설정
function setupIpcHandlers(): void {
  // 디렉토리 읽기
  ipcMain.handle('fs:readdir', async (event, dirPath: string) => {
    try {
      const items = fs.readdirSync(dirPath, { withFileTypes: true });
      return items.map(item => ({
        name: item.name,
        isDirectory: item.isDirectory(),
        isFile: item.isFile(),
        path: path.join(dirPath, item.name)
      }));
    } catch (error) {
      console.error('Error reading directory:', error);
      return [];
    }
  });

  // 파일 읽기
  ipcMain.handle('fs:readFile', async (event, filePath: string) => {
    try {
      return fs.readFileSync(filePath, 'utf-8');
    } catch (error) {
      console.error('Error reading file:', error);
      return `Error reading file: ${error}`;
    }
  });

  // 파일 쓰기
  ipcMain.handle('fs:writeFile', async (event, filePath: string, content: string) => {
    try {
      fs.writeFileSync(filePath, content, 'utf-8');
      return { success: true };
    } catch (error) {
      console.error('Error writing file:', error);
      return { success: false, error: String(error) };
    }
  });

  // 프로젝트 루트 경로
  ipcMain.handle('getProjectRoot', async () => {
    return process.cwd();
  });

  // 윈도우 제어
  ipcMain.on('window:minimize', () => {
    if (mainWindow) mainWindow.minimize();
  });

  ipcMain.on('window:maximize', () => {
    if (mainWindow) {
      if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
      } else {
        mainWindow.maximize();
      }
    }
  });

  ipcMain.on('window:close', () => {
    if (mainWindow) mainWindow.close();
  });

  // 개발자 도구 토글
  ipcMain.on('devtools:toggle', () => {
    if (mainWindow) {
      if (mainWindow.webContents.isDevToolsOpened()) {
        mainWindow.webContents.closeDevTools();
      } else {
        mainWindow.webContents.openDevTools();
      }
    }
  });

  // 폴더 선택 다이얼로그
  ipcMain.handle('dialog:openFolder', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory']
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return result.filePaths[0];
  });

  // 파일 선택 다이얼로그
  ipcMain.handle('dialog:openFile', async (event, options?: { filters?: { name: string; extensions: string[] }[] }) => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openFile'],
      filters: options?.filters || [{ name: 'All Files', extensions: ['*'] }]
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return result.filePaths[0];
  });

  // Python 스크립트 실행
  ipcMain.handle('python:run', async (event, scriptPath: string, args: string[] = []) => {
    return new Promise((resolve) => {
      // venv 환경의 Python 경로
      const projectRoot = process.cwd();
      const isWindows = process.platform === 'win32';
      const venvPython = isWindows
        ? path.join(projectRoot, 'venv', 'Scripts', 'python.exe')
        : path.join(projectRoot, 'venv', 'bin', 'python');

      // venv가 없으면 시스템 Python 사용
      const pythonPath = fs.existsSync(venvPython) ? venvPython : 'python';

      console.log(`Running Python: ${pythonPath} ${scriptPath} ${args.join(' ')}`);

      const pythonProcess = spawn(pythonPath, ['-u', scriptPath, ...args], {
        cwd: projectRoot,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }
      });

      let stdout = '';
      let stderr = '';

      pythonProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      pythonProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      pythonProcess.on('close', (code) => {
        resolve({
          code,
          stdout,
          stderr,
          error: code !== 0 ? `Process exited with code ${code}` : null
        });
      });

      pythonProcess.on('error', (err) => {
        resolve({
          code: -1,
          stdout,
          stderr,
          error: err.message
        });
      });
    });
  });

  // ===== 터미널 관련 핸들러 =====

  // 새 터미널 생성
  ipcMain.handle('terminal:create', async () => {
    const terminalId = `terminal-${++terminalCounter}`;
    const isWindows = process.platform === 'win32';

    const shell = isWindows ? 'cmd.exe' : '/bin/bash';
    const shellArgs = isWindows ? ['/Q'] : [];  // /Q: 에코 off

    const terminalProcess = spawn(shell, shellArgs, {
      cwd: process.cwd(),
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      shell: false
    });

    // Windows에서 UTF-8 코드페이지 설정
    if (isWindows && terminalProcess.stdin) {
      terminalProcess.stdin.write('chcp 65001\n');
    }

    terminalProcesses.set(terminalId, terminalProcess);

    // stdout 데이터 전송
    terminalProcess.stdout?.on('data', (data) => {
      if (mainWindow) {
        mainWindow.webContents.send('terminal:data', {
          terminalId,
          data: data.toString()
        });
      }
    });

    // stderr 데이터 전송
    terminalProcess.stderr?.on('data', (data) => {
      if (mainWindow) {
        mainWindow.webContents.send('terminal:data', {
          terminalId,
          data: data.toString(),
          isError: true
        });
      }
    });

    // 프로세스 종료 시
    terminalProcess.on('close', (code) => {
      if (mainWindow) {
        mainWindow.webContents.send('terminal:exit', {
          terminalId,
          code
        });
      }
      terminalProcesses.delete(terminalId);
    });

    return {
      terminalId,
      cwd: process.cwd()
    };
  });

  // 터미널에 입력 전송
  ipcMain.handle('terminal:write', async (event, terminalId: string, data: string) => {
    const terminalProcess = terminalProcesses.get(terminalId);
    if (terminalProcess && terminalProcess.stdin) {
      terminalProcess.stdin.write(data + '\n');
      return { success: true };
    }
    return { success: false, error: 'Terminal not found' };
  });

  // 터미널 종료
  ipcMain.handle('terminal:kill', async (event, terminalId: string) => {
    const terminalProcess = terminalProcesses.get(terminalId);
    if (terminalProcess) {
      terminalProcess.kill();
      terminalProcesses.delete(terminalId);
      return { success: true };
    }
    return { success: false, error: 'Terminal not found' };
  });

  // 현재 작업 디렉토리 가져오기
  ipcMain.handle('terminal:getCwd', async () => {
    return process.cwd();
  });
}

// Electron 준비 완료 시 윈도우 생성
app.whenReady().then(() => {
  setupIpcHandlers();
  createWindow();

  app.on('activate', () => {
    // macOS에서 dock 아이콘 클릭 시 윈도우 재생성
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// 모든 윈도우가 닫힐 때
app.on('window-all-closed', () => {
  // macOS가 아닌 경우 앱 종료
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
