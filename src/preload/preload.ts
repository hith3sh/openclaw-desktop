import { contextBridge, ipcRenderer } from "electron";
import type {
  AppConfig,
  ManagedChannel,
  RendererApi,
  SetupProgressEvent,
  UpdateStatusEvent,
  WorkspaceEditableFileName,
  WizardAnswer,
  WizardStartParams
} from "../shared/types";

const api: RendererApi = {
  getEnvironmentStatus: () => ipcRenderer.invoke("env:get-status"),
  getChannelStatuses: () => ipcRenderer.invoke("channels:get-status"),
  reconnectChannel: (channel: ManagedChannel) => ipcRenderer.invoke("channels:reconnect", channel),
  disableChannel: (channel: ManagedChannel) => ipcRenderer.invoke("channels:disable", channel),
  configureTelegramBot: (token: string) => ipcRenderer.invoke("telegram:configure", token),
  getModelStatus: () => ipcRenderer.invoke("models:get-status"),
  applyModelSelection: (provider: string, model: string) => ipcRenderer.invoke("models:apply", provider, model),
  getWorkspaceFile: (workspacePath: string, fileName: WorkspaceEditableFileName) =>
    ipcRenderer.invoke("workspace-files:get", workspacePath, fileName),
  saveWorkspaceFile: (workspacePath: string, fileName: WorkspaceEditableFileName, content: string) =>
    ipcRenderer.invoke("workspace-files:save", workspacePath, fileName, content),
  getAlwaysOnGatewayStatus: () => ipcRenderer.invoke("always-on:get-status"),
  setAlwaysOnGatewayEnabled: (enabled: boolean) => ipcRenderer.invoke("always-on:set-enabled", enabled),
  getUpdateStatus: () => ipcRenderer.invoke("update:get-status"),
  checkForUpdates: () => ipcRenderer.invoke("update:check"),
  installDownloadedUpdate: () => ipcRenderer.invoke("update:install"),
  installNodeRuntime: () => ipcRenderer.invoke("env:install-node"),
  installNodeRuntimeStreaming: () => ipcRenderer.invoke("env:install-node-stream"),
  installOpenClaw: () => ipcRenderer.invoke("env:install-openclaw"),
  installOpenClawStreaming: () => ipcRenderer.invoke("env:install-openclaw-stream"),
  runOnboarding: () => ipcRenderer.invoke("env:run-onboarding"),
  gatewayStatus: () => ipcRenderer.invoke("gateway:status"),
  gatewayStart: () => ipcRenderer.invoke("gateway:start"),
  gatewayStartStreaming: () => ipcRenderer.invoke("gateway:start-stream"),
  gatewayStop: () => ipcRenderer.invoke("gateway:stop"),
  openExternalUrl: (url: string) => ipcRenderer.invoke("external:open-url", url),
  loadConfig: () => ipcRenderer.invoke("config:load"),
  saveConfig: (config: Partial<AppConfig>) => ipcRenderer.invoke("config:save", config),
  getSetupState: () => ipcRenderer.invoke("setup:get-state"),
  runGuidedSetup: () => ipcRenderer.invoke("setup:run-guided"),
  onSetupProgress: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: SetupProgressEvent) => {
      listener(payload);
    };

    ipcRenderer.on("setup:progress", handler);
    return () => {
      ipcRenderer.removeListener("setup:progress", handler);
    };
  },
  onUpdateStatus: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: UpdateStatusEvent) => {
      listener(payload);
    };

    ipcRenderer.on("update:status", handler);
    return () => {
      ipcRenderer.removeListener("update:status", handler);
    };
  },
  wizardStart: (params: WizardStartParams = {}) => ipcRenderer.invoke("wizard:start", params),
  wizardNext: (sessionId: string, answer?: WizardAnswer) => ipcRenderer.invoke("wizard:next", sessionId, answer),
  wizardStatus: (sessionId: string) => ipcRenderer.invoke("wizard:status", sessionId),
  wizardCancel: (sessionId: string) => ipcRenderer.invoke("wizard:cancel", sessionId),
  completeOnboardingFromUi: () => ipcRenderer.invoke("setup:complete-onboarding")
};

contextBridge.exposeInMainWorld("openclaw", api);
