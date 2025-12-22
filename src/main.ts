import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { spawn, ChildProcess } from 'child_process';
import * as chokidar from 'chokidar';

let mainWindow: BrowserWindow | null = null;

// 터미널 프로세스 관리
const terminalProcesses: Map<string, ChildProcess> = new Map();
let terminalCounter = 0;

// 파일 감시자 관리
const fileWatchers: Map<string, chokidar.FSWatcher> = new Map();

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

  // 파일 이름 변경
  ipcMain.handle('fs:rename', async (event, oldPath: string, newPath: string) => {
    try {
      fs.renameSync(oldPath, newPath);
      return { success: true };
    } catch (error) {
      console.error('Error renaming file:', error);
      return { success: false, error: String(error) };
    }
  });

  // 파일 삭제
  ipcMain.handle('fs:delete', async (event, filePath: string) => {
    try {
      fs.unlinkSync(filePath);
      return { success: true };
    } catch (error) {
      console.error('Error deleting file:', error);
      return { success: false, error: String(error) };
    }
  });

  // 폴더 삭제 (재귀적)
  ipcMain.handle('fs:deleteFolder', async (event, folderPath: string) => {
    try {
      fs.rmSync(folderPath, { recursive: true, force: true });
      return { success: true };
    } catch (error) {
      console.error('Error deleting folder:', error);
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

  // Shell - 기본 프로그램으로 파일 열기
  ipcMain.handle('shell:openPath', async (event, filePath: string) => {
    try {
      const result = await shell.openPath(filePath);
      if (result) {
        // result가 비어있지 않으면 에러
        return { success: false, error: result };
      }
      return { success: true };
    } catch (error) {
      console.error('Error opening file:', error);
      return { success: false, error: String(error) };
    }
  });

  // Python 스크립트 실행 (일반 모드 - 완료 후 결과 반환)
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

  // Python 스크립트 실행 (스트리밍 모드 - 실시간 출력)
  const pythonProcesses: Map<string, ChildProcess> = new Map();
  let pythonCounter = 0;

  ipcMain.handle('python:runStreaming', async (event, scriptPath: string, args: string[] = []) => {
    const processId = `python-${++pythonCounter}`;

    // venv 환경의 Python 경로
    const projectRoot = process.cwd();
    const isWindows = process.platform === 'win32';
    const venvPython = isWindows
      ? path.join(projectRoot, 'venv', 'Scripts', 'python.exe')
      : path.join(projectRoot, 'venv', 'bin', 'python');

    // venv가 없으면 시스템 Python 사용
    const pythonPath = fs.existsSync(venvPython) ? venvPython : 'python';

    console.log(`Running Python (streaming): ${pythonPath} ${scriptPath} ${args.join(' ')}`);

    const pythonProcess = spawn(pythonPath, ['-u', scriptPath, ...args], {
      cwd: projectRoot,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }
    });

    pythonProcesses.set(processId, pythonProcess);

    // stdout 실시간 전송
    pythonProcess.stdout.on('data', (data) => {
      if (mainWindow) {
        mainWindow.webContents.send('python:output', {
          processId,
          data: data.toString(),
          isError: false
        });
      }
    });

    // stderr 실시간 전송
    pythonProcess.stderr.on('data', (data) => {
      if (mainWindow) {
        mainWindow.webContents.send('python:output', {
          processId,
          data: data.toString(),
          isError: true
        });
      }
    });

    // 프로세스 종료 시
    pythonProcess.on('close', (code) => {
      if (mainWindow) {
        mainWindow.webContents.send('python:exit', {
          processId,
          code
        });
      }
      pythonProcesses.delete(processId);
    });

    pythonProcess.on('error', (err) => {
      if (mainWindow) {
        mainWindow.webContents.send('python:exit', {
          processId,
          code: -1,
          error: err.message
        });
      }
      pythonProcesses.delete(processId);
    });

    return { processId };
  });

  // Python 프로세스 중지
  ipcMain.handle('python:kill', async (event, processId: string) => {
    const pythonProcess = pythonProcesses.get(processId);
    if (pythonProcess) {
      pythonProcess.kill();
      pythonProcesses.delete(processId);
      return { success: true };
    }
    return { success: false, error: 'Process not found' };
  });

  // ===== 터미널 관련 핸들러 =====

  // 새 터미널 생성
  ipcMain.handle('terminal:create', async (event, cwd?: string) => {
    const terminalId = `terminal-${++terminalCounter}`;
    const isWindows = process.platform === 'win32';

    const shell = isWindows ? 'cmd.exe' : '/bin/bash';
    const shellArgs = isWindows ? ['/Q'] : [];  // /Q: 에코 off

    // cwd가 지정되면 해당 경로 사용, 아니면 기본 경로 사용
    const workingDir = cwd || process.cwd();

    const terminalProcess = spawn(shell, shellArgs, {
      cwd: workingDir,
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
      cwd: workingDir
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

  // ===== 파일 감시 관련 핸들러 (Chokidar) =====

  // 파일 감시 시작
  ipcMain.handle('fileWatch:start', async (event, filePath: string) => {
    // 이미 감시 중이면 무시
    if (fileWatchers.has(filePath)) {
      return { success: true, message: 'Already watching' };
    }

    try {
      const watcher = chokidar.watch(filePath, {
        persistent: true,
        ignoreInitial: true,
        awaitWriteFinish: {
          stabilityThreshold: 300,
          pollInterval: 100
        }
      });

      watcher.on('change', () => {
        console.log(`File changed: ${filePath}`);
        if (mainWindow) {
          mainWindow.webContents.send('fileWatch:changed', filePath);
        }
      });

      watcher.on('unlink', () => {
        console.log(`File deleted: ${filePath}`);
        if (mainWindow) {
          mainWindow.webContents.send('fileWatch:deleted', filePath);
        }
        // 감시 중지
        watcher.close();
        fileWatchers.delete(filePath);
      });

      watcher.on('error', (error) => {
        console.error(`Watcher error for ${filePath}:`, error);
      });

      fileWatchers.set(filePath, watcher);
      console.log(`Started watching: ${filePath}`);
      return { success: true };
    } catch (error) {
      console.error('Error starting file watch:', error);
      return { success: false, error: String(error) };
    }
  });

  // 파일 감시 중지
  ipcMain.handle('fileWatch:stop', async (event, filePath: string) => {
    const watcher = fileWatchers.get(filePath);
    if (watcher) {
      await watcher.close();
      fileWatchers.delete(filePath);
      console.log(`Stopped watching: ${filePath}`);
      return { success: true };
    }
    return { success: false, message: 'Not watching this file' };
  });

  // 모든 파일 감시 중지
  ipcMain.handle('fileWatch:stopAll', async () => {
    for (const [filePath, watcher] of fileWatchers) {
      await watcher.close();
      console.log(`Stopped watching: ${filePath}`);
    }
    fileWatchers.clear();
    return { success: true };
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
