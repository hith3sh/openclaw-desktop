export interface CommandResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
}

export type SetupStage =
  | "idle"
  | "checking_prereqs"
  | "installing_node"
  | "installing_openclaw"
  | "running_onboarding"
  | "starting_gateway"
  | "ready_for_manual_step"
  | "completed"
  | "failed";

export interface SetupState {
  stage: SetupStage;
  requiresReboot: boolean;
  message: string;
  updatedAt: string;
}

export interface SetupProgressEvent {
  timestamp: string;
  stage: SetupStage;
  level: "info" | "warning" | "error";
  source: "setup" | "stdout" | "stderr";
  message: string;
}

export type WizardRunStatus = "running" | "done" | "cancelled" | "error";
export type WizardStepType = "note" | "select" | "text" | "confirm" | "multiselect" | "progress" | "action";

export interface WizardStepOption {
  value: unknown;
  label: string;
  hint?: string;
}

export interface WizardStep {
  id: string;
  type: WizardStepType;
  title?: string;
  message?: string;
  options?: WizardStepOption[];
  initialValue?: unknown;
  placeholder?: string;
  sensitive?: boolean;
  executor?: "gateway" | "client";
}

export interface WizardStartParams {
  mode?: "local" | "remote";
  workspace?: string;
}

export interface WizardAnswer {
  stepId: string;
  value?: unknown;
}

export interface WizardStartResult {
  sessionId: string;
  done: boolean;
  step?: WizardStep;
  status?: WizardRunStatus;
  error?: string;
}

export interface WizardNextResult {
  done: boolean;
  step?: WizardStep;
  status?: WizardRunStatus;
  error?: string;
}

export interface WizardStatusResult {
  status: WizardRunStatus;
  error?: string;
}

export interface EnvironmentStatus {
  checkedAt: string;
  platform: NodeJS.Platform;
  isWindows: boolean;
  nodeInstalled: boolean;
  npmInstalled: boolean;
  openClawInstalled: boolean;
  gatewayRunning: boolean;
  notes: string[];
}

export interface AlwaysOnGatewayStatus {
  supported: boolean;
  enabled: boolean;
  taskName: string;
  detail: string;
}

export type ManagedChannel = "whatsapp" | "telegram";

export interface ChannelStatusItem {
  channel: ManagedChannel;
  configured: boolean;
  connected: boolean;
  summary: string;
  detail: string;
}

export interface ChannelStatusResult {
  checkedAt: string;
  channels: ChannelStatusItem[];
}

export interface ModelStatusResult {
  checkedAt: string;
  provider: string;
  model: string;
  availableProviders: string[];
  modelsByProvider: Record<string, string[]>;
  detail: string;
}

export type WorkspaceEditableFileName =
  | "openclaw.json"
  | "soul.md"
  | "skills.md"
  | "bootstrap.md"
  | "AGENTS.md"
  | "HEARTBEAT.md";

export interface WorkspaceFilePayload {
  fileName: WorkspaceEditableFileName;
  path: string;
  exists: boolean;
  content: string;
  updatedAt: string;
}

export type UpdateState =
  | "idle"
  | "checking"
  | "available"
  | "not_available"
  | "downloading"
  | "downloaded"
  | "error"
  | "unsupported";

export interface UpdateStatusEvent {
  checkedAt: string;
  state: UpdateState;
  message: string;
  version?: string;
  progress?: number;
  canInstall: boolean;
}

export interface AppConfig {
  profileName: string;
  workspacePath: string;
  modelProvider: string;
  modelName: string;
  modelApiKey: string;
  accountEmail: string;
  accountAuthorized: boolean;
  clerkUserId: string;
  autoStartGateway: boolean;
  onboardingCompleted: boolean;
  updatedAt: string;
}

export interface RendererApi {
  getEnvironmentStatus: () => Promise<EnvironmentStatus>;
  getAlwaysOnGatewayStatus: () => Promise<AlwaysOnGatewayStatus>;
  setAlwaysOnGatewayEnabled: (enabled: boolean) => Promise<AlwaysOnGatewayStatus>;
  getChannelStatuses: () => Promise<ChannelStatusResult>;
  reconnectChannel: (channel: ManagedChannel) => Promise<ChannelStatusItem>;
  disableChannel: (channel: ManagedChannel) => Promise<ChannelStatusItem>;
  configureTelegramBot: (token: string) => Promise<ChannelStatusItem>;
  getModelStatus: () => Promise<ModelStatusResult>;
  applyModelSelection: (provider: string, model: string) => Promise<ModelStatusResult>;
  getWorkspaceFile: (workspacePath: string, fileName: WorkspaceEditableFileName) => Promise<WorkspaceFilePayload>;
  saveWorkspaceFile: (
    workspacePath: string,
    fileName: WorkspaceEditableFileName,
    content: string
  ) => Promise<WorkspaceFilePayload>;
  getUpdateStatus: () => Promise<UpdateStatusEvent>;
  checkForUpdates: () => Promise<UpdateStatusEvent>;
  installDownloadedUpdate: () => Promise<void>;
  onUpdateStatus: (listener: (event: UpdateStatusEvent) => void) => () => void;
  installNodeRuntime: () => Promise<CommandResult>;
  installNodeRuntimeStreaming: () => Promise<CommandResult>;
  installOpenClaw: () => Promise<CommandResult>;
  installOpenClawStreaming: () => Promise<CommandResult>;
  runOnboarding: () => Promise<CommandResult>;
  gatewayStatus: () => Promise<CommandResult>;
  gatewayStart: () => Promise<CommandResult>;
  gatewayStartStreaming: () => Promise<CommandResult>;
  gatewayStop: () => Promise<CommandResult>;
  openExternalUrl: (url: string) => Promise<boolean>;
  loadConfig: () => Promise<AppConfig>;
  saveConfig: (config: Partial<AppConfig>) => Promise<AppConfig>;
  getSetupState: () => Promise<SetupState>;
  runGuidedSetup: () => Promise<SetupState>;
  onSetupProgress: (listener: (event: SetupProgressEvent) => void) => () => void;
  wizardStart: (params?: WizardStartParams) => Promise<WizardStartResult>;
  wizardNext: (sessionId: string, answer?: WizardAnswer) => Promise<WizardNextResult>;
  wizardStatus: (sessionId: string) => Promise<WizardStatusResult>;
  wizardCancel: (sessionId: string) => Promise<{ status: WizardRunStatus; error?: string }>;
  completeOnboardingFromUi: () => Promise<SetupState>;
}
