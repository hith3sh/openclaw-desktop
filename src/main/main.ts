import { app, BrowserWindow, ipcMain, Menu, nativeImage, shell, Tray } from "electron";
import { existsSync } from "node:fs";
import path from "node:path";
import type {
  ManagedChannel,
  SetupProgressEvent,
  UpdateStatusEvent,
  WorkspaceEditableFileName
} from "../shared/types";
import { AutoUpdaterService } from "./services/auto-updater";
import { ConfigStore } from "./services/config-store";
import { EnvironmentService } from "./services/environment";
import { isGatewayRunningOutput } from "./services/parsers";
import { SetupOrchestrator } from "./services/setup-orchestrator";
import { SetupStore } from "./services/setup-store";
import { WorkspaceFilesService } from "./services/workspace-files";

const environmentService = new EnvironmentService();
const autoUpdaterService = new AutoUpdaterService();
let configStore: ConfigStore;
let setupOrchestrator: SetupOrchestrator;
const workspaceFilesService = new WorkspaceFilesService();
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
const pendingSetupEvents: SetupProgressEvent[] = [];
const pendingUpdateEvents: UpdateStatusEvent[] = [];
let trayGatewayRunning = false;

function resolvePreloadFile(): string {
  return path.join(__dirname, "..", "preload", "preload.js");
}

function resolveRendererFile(): string {
  const appPath = app.getAppPath();
  const reactRendererPath = path.join(appPath, "dist", "renderer-react", "index.html");
  const legacyRendererPath = path.join(appPath, "dist", "renderer", "index.html");
  const uiMode = (process.env.OPENCLAW_UI_EXPERIMENT || "react").toLowerCase();

  // React renderer is now the default. Set OPENCLAW_UI_EXPERIMENT=legacy to force the old UI.
  if (uiMode !== "legacy" && existsSync(reactRendererPath)) {
    return reactRendererPath;
  }

  return legacyRendererPath;
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1160,
    height: 780,
    minWidth: 960,
    minHeight: 680,
    show: false,
    title: "OpenClaw Desktop",
    backgroundColor: "#181818",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      preload: resolvePreloadFile()
    }
  });

  void mainWindow.loadFile(resolveRendererFile());

  mainWindow.once("ready-to-show", () => {
    flushPendingSetupEvents();
    flushPendingUpdateEvents();
    mainWindow?.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    const currentUrl = mainWindow?.webContents.getURL() ?? "";
    if (url !== currentUrl) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.on("close", (event) => {
    if (process.platform !== "win32" || isQuitting) {
      return;
    }

    event.preventDefault();
    mainWindow?.hide();
  });
}

function buildTrayIcon() {
  const image = nativeImage.createFromDataURL(
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAMAAAAoLQ9TAAAAM1BMVEVHcEwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAx8qYvAAAAEHRSTlMAECAwQFBgcICPn6+/z9/vH+xR+AAAAG9JREFUGNNjYIACRkYmZi5uHh4+AXY2bi4eHj4gHj4Bdg5uHm4efg5+QW4eQR4+QX4BQVFBYVFRSVlFXUNTTX1Dc0NTS1tbR1dPX4BLS0dXR09fQMjI20jIyNVQ2NjarA0NfVAADEQQYlF9MZqwAAAABJRU5ErkJggg=="
  );

  return process.platform === "win32" ? image.resize({ width: 16, height: 16 }) : image;
}

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }

  if (!mainWindow.isVisible()) {
    mainWindow.show();
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.focus();
}

function showTrayMessage(content: string, title = "OpenClaw Desktop"): void {
  if (!tray || process.platform !== "win32") {
    return;
  }

  tray.displayBalloon({
    title,
    content
  });
}

async function refreshTrayGatewayStatus(showMessage = false): Promise<void> {
  const result = await environmentService.gatewayStatus();
  trayGatewayRunning = result.ok && isGatewayRunningOutput(`${result.stdout} ${result.stderr}`);
  tray?.setToolTip(`OpenClaw Desktop - Gateway ${trayGatewayRunning ? "Running" : "Stopped"}`);
  if (tray) {
    tray.setContextMenu(buildTrayMenu());
  }

  if (showMessage) {
    const detail = result.ok
      ? trayGatewayRunning ? "Gateway is running." : "Gateway is stopped."
      : result.stderr || result.stdout || "Could not check gateway status.";
    showTrayMessage(detail, "Gateway Status");
  }
}

async function handleTrayGatewayStart(): Promise<void> {
  const result = await environmentService.gatewayStart();
  await refreshTrayGatewayStatus(false);
  const detail = result.ok
    ? "Gateway start requested."
    : result.stderr || result.stdout || "Gateway start failed.";
  showTrayMessage(detail, "Gateway Start");
}

async function handleTrayGatewayStop(): Promise<void> {
  const result = await environmentService.gatewayStop();
  await refreshTrayGatewayStatus(false);
  const detail = result.ok
    ? "Gateway stop requested."
    : result.stderr || result.stdout || "Gateway stop failed.";
  showTrayMessage(detail, "Gateway Stop");
}

function buildTrayMenu(): Menu {
  return Menu.buildFromTemplate([
    {
      label: `Gateway: ${trayGatewayRunning ? "Running" : "Stopped"}`,
      enabled: false
    },
    {
      label: "Gateway Status",
      click: () => {
        void refreshTrayGatewayStatus(true);
      }
    },
    {
      label: "Start Gateway",
      click: () => {
        void handleTrayGatewayStart();
      }
    },
    {
      label: "Stop Gateway",
      click: () => {
        void handleTrayGatewayStop();
      }
    },
    {
      type: "separator"
    },
    {
      label: "Open OpenClaw Desktop",
      click: () => {
        showMainWindow();
      }
    },
    {
      type: "separator"
    },
    {
      label: "Quit",
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);
}

function createTray(): void {
  if (tray) {
    return;
  }

  tray = new Tray(buildTrayIcon());
  tray.setToolTip("OpenClaw Desktop - Gateway Unknown");
  tray.setContextMenu(buildTrayMenu());

  tray.on("click", () => {
    if (mainWindow && mainWindow.isVisible()) {
      mainWindow.hide();
      return;
    }

    showMainWindow();
  });

  void refreshTrayGatewayStatus(false);
}

function broadcastSetupProgress(event: SetupProgressEvent): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    pendingSetupEvents.push(event);
    if (pendingSetupEvents.length > 200) {
      pendingSetupEvents.shift();
    }
    return;
  }

  mainWindow.webContents.send("setup:progress", event);
}

function broadcastUpdateStatus(event: UpdateStatusEvent): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    pendingUpdateEvents.push(event);
    if (pendingUpdateEvents.length > 200) {
      pendingUpdateEvents.shift();
    }
    return;
  }

  mainWindow.webContents.send("update:status", event);
}

function flushPendingSetupEvents(): void {
  if (!mainWindow || mainWindow.isDestroyed() || pendingSetupEvents.length === 0) {
    return;
  }

  for (const event of pendingSetupEvents) {
    mainWindow.webContents.send("setup:progress", event);
  }

  pendingSetupEvents.length = 0;
}

function flushPendingUpdateEvents(): void {
  if (!mainWindow || mainWindow.isDestroyed() || pendingUpdateEvents.length === 0) {
    return;
  }

  for (const event of pendingUpdateEvents) {
    mainWindow.webContents.send("update:status", event);
  }

  pendingUpdateEvents.length = 0;
}

function registerIpcHandlers(): void {
  ipcMain.handle("env:get-status", () => environmentService.getEnvironmentStatus());
  ipcMain.handle("channels:get-status", () => environmentService.getChannelStatuses());
  ipcMain.handle("channels:reconnect", (_event, channel: ManagedChannel) => environmentService.reconnectChannel(channel));
  ipcMain.handle("channels:disable", (_event, channel: ManagedChannel) => environmentService.disableChannel(channel));
  ipcMain.handle("telegram:configure", (_event, token: string) => environmentService.configureTelegramBot(token));
  ipcMain.handle("models:get-status", () => environmentService.getModelStatus());
  ipcMain.handle("models:apply", (_event, provider: string, model: string) =>
    environmentService.applyModelSelection(provider, model)
  );
  ipcMain.handle("workspace-files:get", (_event, workspacePath: string, fileName: WorkspaceEditableFileName) =>
    workspaceFilesService.getFile(workspacePath, fileName)
  );
  ipcMain.handle("workspace-files:save", (_event, workspacePath: string, fileName: WorkspaceEditableFileName, content: string) =>
    workspaceFilesService.saveFile(workspacePath, fileName, content)
  );
  ipcMain.handle("always-on:get-status", () => environmentService.getAlwaysOnGatewayStatus());
  ipcMain.handle("always-on:set-enabled", (_event, enabled: boolean) =>
    environmentService.setAlwaysOnGatewayEnabled(Boolean(enabled))
  );
  ipcMain.handle("update:get-status", () => autoUpdaterService.getStatus());
  ipcMain.handle("update:check", () => autoUpdaterService.checkForUpdates());
  ipcMain.handle("update:install", () => {
    autoUpdaterService.installDownloadedUpdate();
  });
  ipcMain.handle("env:install-node", () => environmentService.installNodeRuntime());
  ipcMain.handle("env:install-node-stream", () =>
    environmentService.installNodeRuntimeStreaming((line, stream) => {
      broadcastSetupProgress({
        timestamp: new Date().toISOString(),
        stage: "installing_node",
        level: stream === "stderr" ? "warning" : "info",
        source: stream,
        message: line
      });
    })
  );
  ipcMain.handle("env:install-openclaw", () => environmentService.installOpenClaw());
  ipcMain.handle("env:install-openclaw-stream", () =>
    environmentService.installOpenClawStreaming((line, stream) => {
      broadcastSetupProgress({
        timestamp: new Date().toISOString(),
        stage: "installing_openclaw",
        level: stream === "stderr" ? "warning" : "info",
        source: stream,
        message: line
      });
    })
  );
  ipcMain.handle("env:run-onboarding", () => environmentService.runOnboarding());

  ipcMain.handle("gateway:status", async () => {
    const result = await environmentService.gatewayStatus();
    await refreshTrayGatewayStatus(false);
    return result;
  });
  ipcMain.handle("gateway:start", async () => {
    const result = await environmentService.gatewayStart();
    await refreshTrayGatewayStatus(false);
    return result;
  });
  ipcMain.handle("gateway:start-stream", async () => {
    const result = await environmentService.gatewayStartStreaming((line, stream) => {
      broadcastSetupProgress({
        timestamp: new Date().toISOString(),
        stage: "starting_gateway",
        level: stream === "stderr" ? "warning" : "info",
        source: stream,
        message: line
      });
    });
    await refreshTrayGatewayStatus(false);
    return result;
  });
  ipcMain.handle("gateway:stop", async () => {
    const result = await environmentService.gatewayStop();
    await refreshTrayGatewayStatus(false);
    return result;
  });

  ipcMain.handle("external:open-url", async (_event, url: string) => {
    if (!url || typeof url !== "string") {
      return false;
    }

    await shell.openExternal(url);
    return true;
  });

  ipcMain.handle("config:load", () => configStore.load());
  ipcMain.handle("config:save", (_event, config) => configStore.save(config));

  ipcMain.handle("setup:get-state", () => setupOrchestrator.getState());
  ipcMain.handle("setup:run-guided", () => setupOrchestrator.runGuidedSetup());
  ipcMain.handle("setup:complete-onboarding", () => setupOrchestrator.completeOnboardingFromUi());

  ipcMain.handle("wizard:start", (_event, params) => environmentService.wizardStart(params));
  ipcMain.handle("wizard:next", (_event, sessionId, answer) => environmentService.wizardNext(sessionId, answer));
  ipcMain.handle("wizard:status", (_event, sessionId) => environmentService.wizardStatus(sessionId));
  ipcMain.handle("wizard:cancel", (_event, sessionId) => environmentService.wizardCancel(sessionId));
}

async function maybeAutoStartGateway(): Promise<void> {
  const config = await configStore.load();
  if (!config.autoStartGateway) {
    return;
  }

  const status = await environmentService.getEnvironmentStatus();
  if (status.isWindows && status.openClawInstalled && !status.gatewayRunning) {
    void environmentService.gatewayStart();
  }
}

app.whenReady().then(async () => {
  configStore = new ConfigStore(app.getPath("userData"));
  setupOrchestrator = new SetupOrchestrator(
    environmentService,
    new SetupStore(app.getPath("userData"))
  );
  setupOrchestrator.onProgress((event) => {
    broadcastSetupProgress(event);
  });
  autoUpdaterService.onStatus((event) => {
    broadcastUpdateStatus(event);
  });
  registerIpcHandlers();
  createWindow();
  createTray();
  await maybeAutoStartGateway();
  autoUpdaterService.startBackgroundChecks();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0 || !mainWindow) {
      createWindow();
      return;
    }

    showMainWindow();
  });
});

app.on("before-quit", () => {
  isQuitting = true;
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin" && isQuitting) {
    app.quit();
  }
});
