import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType
} from "react";
import {
  Activity,
  ArrowUpCircle,
  Bot,
  Boxes,
  Cable,
  FileText,
  Folder,
  MessageSquare,
  LockKeyhole,
  Moon,
  Play,
  RefreshCw,
  Settings,
  Sparkles,
  Square,
  Sun,
  UserRoundCheck,
  Wrench
} from "lucide-react";
import type {
  AlwaysOnGatewayStatus,
  AppConfig,
  ChannelStatusItem,
  ChannelStatusResult,
  CommandResult,
  EnvironmentStatus,
  ModelStatusResult,
  SetupProgressEvent,
  SetupState,
  UpdateStatusEvent,
  WorkspaceEditableFileName,
  WorkspaceFilePayload
} from "../../shared/types";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./components/ui/card";
import { Input } from "./components/ui/input";
import { ScrollArea } from "./components/ui/scroll-area";
import { Select } from "./components/ui/select";
import { Separator } from "./components/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset
} from "./components/ui/sidebar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";
import { Textarea } from "./components/ui/textarea";

const CONTROL_UI_URL = "http://127.0.0.1:18789/";
const CLERK_SIGN_IN_URL = "https://clerk.openclaw.ai/sign-in";

const DEFAULT_SETUP: SetupState = {
  stage: "idle",
  requiresReboot: false,
  message: "Setup has not started yet.",
  updatedAt: new Date(0).toISOString()
};

const FILE_OPTIONS: WorkspaceEditableFileName[] = [
  "openclaw.json",
  "soul.md",
  "skills.md",
  "bootstrap.md",
  "AGENTS.md",
  "HEARTBEAT.md"
];

type Workspace = "chat" | "setup" | "control";
type FeaturePane = "onboarding" | "channels" | "models" | "files" | "settings" | "updates" | "logs";
type ThemeMode = "dark" | "light";

interface NavItem {
  key: FeaturePane;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

interface StatusTableRow {
  label: string;
  value: string;
  variant: "default" | "success" | "warning" | "danger";
}

const navItems: NavItem[] = [
  { key: "onboarding", label: "Onboarding", icon: Sparkles },
  { key: "channels", label: "Channels", icon: Cable },
  { key: "models", label: "Models", icon: Bot },
  { key: "files", label: "Files", icon: Folder },
  { key: "settings", label: "Settings", icon: Settings },
  { key: "updates", label: "Updates", icon: ArrowUpCircle },
  { key: "logs", label: "Logs", icon: FileText }
];

function toVariant(value: boolean | null) {
  if (value === true) {
    return "success" as const;
  }
  if (value === false) {
    return "danger" as const;
  }
  return "warning" as const;
}

function readinessText(value: boolean | null, ok = "Ready", bad = "Missing") {
  if (value === null) {
    return "Pending";
  }
  return value ? ok : bad;
}

function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function getChannel(result: ChannelStatusResult | null, channel: "whatsapp" | "telegram"): ChannelStatusItem {
  const fallback: ChannelStatusItem = {
    channel,
    configured: false,
    connected: false,
    summary: "Unknown",
    detail: "Not checked."
  };

  return result?.channels.find((item) => item.channel === channel) ?? fallback;
}

function summarizeCommandResult(title: string, result: CommandResult, appendLog: (line: string) => void) {
  const summary = `${title}: ${result.ok ? "ok" : "failed"}${result.code === null ? "" : ` (code ${result.code})`}`;
  appendLog(summary);

  const details = [result.stdout, result.stderr]
    .map((item) => item.trim())
    .filter(Boolean)
    .join("\n");

  if (details) {
    appendLog(details);
  }
}

export function App() {
  const [workspace, setWorkspace] = useState<Workspace>("setup");
  const [pane, setPane] = useState<FeaturePane>("onboarding");
  const [environment, setEnvironment] = useState<EnvironmentStatus | null>(null);
  const [setupState, setSetupState] = useState<SetupState>(DEFAULT_SETUP);
  const [configDraft, setConfigDraft] = useState<AppConfig | null>(null);
  const [alwaysOnStatus, setAlwaysOnStatus] = useState<AlwaysOnGatewayStatus | null>(null);
  const [channelStatus, setChannelStatus] = useState<ChannelStatusResult | null>(null);
  const [modelStatus, setModelStatus] = useState<ModelStatusResult | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatusEvent | null>(null);
  const [workspaceFile, setWorkspaceFile] = useState<WorkspaceFilePayload | null>(null);
  const [selectedFile, setSelectedFile] = useState<WorkspaceEditableFileName>("openclaw.json");
  const [workspaceFileEditor, setWorkspaceFileEditor] = useState("");
  const [manageProvider, setManageProvider] = useState("");
  const [manageModel, setManageModel] = useState("");
  const [telegramToken, setTelegramToken] = useState("");
  const [accountEmailInput, setAccountEmailInput] = useState("");
  const [clerkUserIdInput, setClerkUserIdInput] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const [error, setError] = useState("");
  const [logs, setLogs] = useState<string[]>(["App ready."]);
  const [theme, setTheme] = useState<ThemeMode>("light");
  const [chatStatusText, setChatStatusText] = useState("Waiting for gateway readiness check...");
  const [chatFallbackVisible, setChatFallbackVisible] = useState(false);
  const [controlStatusText, setControlStatusText] = useState("Waiting for gateway readiness check...");
  const [controlFallbackVisible, setControlFallbackVisible] = useState(false);

  const chatWebviewRef = useRef<any>(null);
  const controlWebviewRef = useRef<any>(null);
  const chatTabSelectionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runtimeReady = useMemo(() => {
    if (!environment) {
      return null;
    }

    return environment.nodeInstalled && environment.npmInstalled;
  }, [environment]);

  const gatewayReady = useMemo(() => {
    if (!environment) {
      return null;
    }

    return environment.isWindows && environment.openClawInstalled && environment.gatewayRunning;
  }, [environment]);

  const isBusy = Boolean(busyAction);
  const onboardingLocked = Boolean(configDraft && !configDraft.onboardingCompleted);

  const renderStatusTable = (rows: StatusTableRow[], compact = false) => (
    <div className="rounded-md border bg-muted/30">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className={compact ? "h-8 text-xs" : "text-xs"}>Item</TableHead>
            <TableHead className={compact ? "h-8 text-xs text-right" : "text-xs text-right"}>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.label}>
              <TableCell className={compact ? "py-2 text-xs text-muted-foreground" : "text-sm text-muted-foreground"}>
                {row.label}
              </TableCell>
              <TableCell className={compact ? "py-2 text-right" : "text-right"}>
                <Badge variant={row.variant}>{row.value}</Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );

  const appendLog = useCallback((message: string) => {
    const line = `[${new Date().toLocaleTimeString()}] ${message}`;
    setLogs((current) => [line, ...current].slice(0, 300));
  }, []);

  const runAction = useCallback(async (
    label: string,
    fn: () => Promise<void>
  ) => {
    setBusyAction(label);
    setError("");
    appendLog(`${label}...`);

    try {
      await fn();
      appendLog(`${label}: done.`);
    } catch (err) {
      const message = formatError(err);
      setError(message);
      appendLog(`${label}: failed - ${message}`);
    } finally {
      setBusyAction("");
    }
  }, [appendLog]);

  const refreshEnvironmentSetup = useCallback(async (withLog = false) => {
    const [env, setup] = await Promise.all([
      window.openclaw.getEnvironmentStatus(),
      window.openclaw.getSetupState()
    ]);

    setEnvironment(env);
    setSetupState(setup);

    if (withLog) {
      appendLog("Environment refreshed.");
    }

    return env;
  }, [appendLog]);

  const refreshConfig = useCallback(async () => {
    const config = await window.openclaw.loadConfig();
    setConfigDraft(config);
    setAccountEmailInput(config.accountEmail || "");
    setClerkUserIdInput(config.clerkUserId || "");
    return config;
  }, []);

  const refreshAlwaysOn = useCallback(async () => {
    const status = await window.openclaw.getAlwaysOnGatewayStatus();
    setAlwaysOnStatus(status);
    return status;
  }, []);

  const refreshChannels = useCallback(async (withLog = false) => {
    const status = await window.openclaw.getChannelStatuses();
    setChannelStatus(status);
    if (withLog) {
      appendLog("Channels refreshed.");
    }
    return status;
  }, [appendLog]);

  const refreshModels = useCallback(async (withLog = false) => {
    const status = await window.openclaw.getModelStatus();
    setModelStatus(status);
    if (!manageProvider && status.provider) {
      setManageProvider(status.provider);
    }
    if (!manageModel && status.model) {
      setManageModel(status.model);
    }
    if (withLog) {
      appendLog(status.detail);
    }
    return status;
  }, [appendLog, manageModel, manageProvider]);

  const refreshUpdate = useCallback(async () => {
    const status = await window.openclaw.getUpdateStatus();
    setUpdateStatus(status);
    return status;
  }, []);

  const refreshAll = useCallback(async (withLog = false) => {
    const env = await refreshEnvironmentSetup(withLog);
    await Promise.all([refreshConfig(), refreshAlwaysOn(), refreshUpdate()]);

    if (env.openClawInstalled) {
      await Promise.all([refreshChannels(), refreshModels()]);
    }

    return env;
  }, [refreshAlwaysOn, refreshChannels, refreshConfig, refreshEnvironmentSetup, refreshModels, refreshUpdate]);

  useEffect(() => {
    void refreshAll();

    const removeSetupProgressListener = window.openclaw.onSetupProgress((event: SetupProgressEvent) => {
      setSetupState((current) => ({
        ...current,
        stage: event.stage,
        message: event.message,
        updatedAt: event.timestamp
      }));
      appendLog(`${event.stage}: ${event.message}`);
    });

    const removeUpdateStatusListener = window.openclaw.onUpdateStatus((event: UpdateStatusEvent) => {
      setUpdateStatus(event);
      appendLog(`Update: ${event.message}`);
    });

    return () => {
      removeSetupProgressListener();
      removeUpdateStatusListener();
    };
  }, [appendLog, refreshAll]);

  useEffect(() => {
    const savedTheme = window.localStorage.getItem("openclaw-theme");
    if (savedTheme === "light" || savedTheme === "dark") {
      setTheme(savedTheme);
    }
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("light", theme === "light");
    window.localStorage.setItem("openclaw-theme", theme);
  }, [theme]);

  const applyManagedModelProvider = (provider: string) => {
    setManageProvider(provider);
    const models = modelStatus?.modelsByProvider?.[provider] ?? [];
    setManageModel(models[0] || "");
  };

  const modelProviders = modelStatus?.availableProviders ?? [];
  const modelOptions = manageProvider ? modelStatus?.modelsByProvider?.[manageProvider] ?? [] : [];

  const settingsProvider = configDraft?.modelProvider ?? "";
  const settingsModelOptions = settingsProvider ? modelStatus?.modelsByProvider?.[settingsProvider] ?? [] : [];

  const runGuidedSetup = () => runAction("Guided setup", async () => {
    const setup = await window.openclaw.runGuidedSetup();
    setSetupState(setup);
    await refreshAll();
  });

  const installNode = () => runAction("Node install", async () => {
    const result = await window.openclaw.installNodeRuntime();
    summarizeCommandResult("Node install", result, appendLog);
    await refreshAll();
  });

  const installOpenClaw = () => runAction("OpenClaw install", async () => {
    const result = await window.openclaw.installOpenClaw();
    summarizeCommandResult("OpenClaw install", result, appendLog);
    await refreshAll();
  });

  const runCliOnboard = () => runAction("CLI onboarding", async () => {
    const result = await window.openclaw.runOnboarding();
    summarizeCommandResult("CLI onboard", result, appendLog);
    await refreshAll();
  });

  const startGateway = () => runAction("Gateway start", async () => {
    const result = await window.openclaw.gatewayStart();
    summarizeCommandResult("Gateway start", result, appendLog);
    await refreshAll();
  });

  const stopGateway = () => runAction("Gateway stop", async () => {
    const result = await window.openclaw.gatewayStop();
    summarizeCommandResult("Gateway stop", result, appendLog);
    await refreshAll();
  });

  const checkGatewayStatus = () => runAction("Gateway status", async () => {
    const result = await window.openclaw.gatewayStatus();
    summarizeCommandResult("Gateway status", result, appendLog);
    await refreshEnvironmentSetup();
  });

  const completeOnboarding = () => runAction("Complete onboarding", async () => {
    if (!configDraft?.accountAuthorized || !configDraft.accountEmail) {
      throw new Error("Authorize a Clerk account in Step 1 before completing onboarding.");
    }

    const setup = await window.openclaw.completeOnboardingFromUi();
    setSetupState(setup);
    const nextConfig = await window.openclaw.saveConfig({ onboardingCompleted: true });
    setConfigDraft(nextConfig);
    await refreshAll();
    setWorkspace("chat");
  });

  const handleReconnectChannel = (channel: "whatsapp" | "telegram") => runAction(`${channel} reconnect`, async () => {
    const item = await window.openclaw.reconnectChannel(channel);
    appendLog(`${channel}: ${item.summary}`);
    await refreshChannels();
  });

  const handleDisableChannel = (channel: "whatsapp" | "telegram") => runAction(`${channel} disable`, async () => {
    const item = await window.openclaw.disableChannel(channel);
    appendLog(`${channel}: ${item.summary}`);
    await refreshChannels();
  });

  const saveTelegramToken = () => runAction("Telegram token", async () => {
    if (!telegramToken.trim()) {
      throw new Error("Bot token is required.");
    }

    const item = await window.openclaw.configureTelegramBot(telegramToken.trim());
    appendLog(`telegram: ${item.summary}`);
    setTelegramToken("");
    await refreshChannels();
  });

  const applyModelSelection = () => runAction("Apply model", async () => {
    if (!manageProvider || !manageModel) {
      throw new Error("Select provider and model first.");
    }

    const status = await window.openclaw.applyModelSelection(manageProvider, manageModel);
    setModelStatus(status);
    const nextConfig = await window.openclaw.saveConfig({
      modelProvider: manageProvider,
      modelName: manageModel
    });
    setConfigDraft(nextConfig);
    appendLog(status.detail);
  });

  const saveSettings = () => runAction("Save settings", async () => {
    if (!configDraft) {
      return;
    }

    const saved = await window.openclaw.saveConfig({
      profileName: configDraft.profileName,
      workspacePath: configDraft.workspacePath,
      modelProvider: configDraft.modelProvider,
      modelName: configDraft.modelName,
      modelApiKey: configDraft.modelApiKey,
      accountEmail: configDraft.accountEmail,
      accountAuthorized: configDraft.accountAuthorized,
      clerkUserId: configDraft.clerkUserId,
      autoStartGateway: configDraft.autoStartGateway,
      onboardingCompleted: configDraft.onboardingCompleted
    });

    setConfigDraft(saved);
    appendLog("Settings saved.");
  });

  const toggleAlwaysOn = (enabled: boolean) => runAction(enabled ? "Enable always-on" : "Disable always-on", async () => {
    const status = await window.openclaw.setAlwaysOnGatewayEnabled(enabled);
    setAlwaysOnStatus(status);
    appendLog(status.detail);
  });

  const loadWorkspaceFile = () => runAction(`Load ${selectedFile}`, async () => {
    if (!configDraft?.workspacePath) {
      throw new Error("Set workspace path in Settings first.");
    }

    const payload = await window.openclaw.getWorkspaceFile(configDraft.workspacePath, selectedFile);
    setWorkspaceFile(payload);
    setWorkspaceFileEditor(payload.content || "");
    appendLog(`Loaded ${selectedFile}.`);
  });

  const saveWorkspaceFile = () => runAction(`Save ${selectedFile}`, async () => {
    if (!configDraft?.workspacePath) {
      throw new Error("Set workspace path in Settings first.");
    }

    const payload = await window.openclaw.saveWorkspaceFile(configDraft.workspacePath, selectedFile, workspaceFileEditor);
    setWorkspaceFile(payload);
    appendLog(`Saved ${selectedFile}.`);
  });

  const checkForUpdates = () => runAction("Check updates", async () => {
    const status = await window.openclaw.checkForUpdates();
    setUpdateStatus(status);
    appendLog(status.message);
  });

  const installUpdate = () => runAction("Install update", async () => {
    await window.openclaw.installDownloadedUpdate();
    appendLog("Installer requested. App may restart.");
  });

  const refreshAllAction = () => runAction("Refresh", async () => {
    await refreshAll(true);
  });

  const openWorkspace = (next: Workspace) => {
    if ((next === "chat" || next === "control") && onboardingLocked) {
      setWorkspace("setup");
      setPane("onboarding");
      appendLog("Finish onboarding before opening chat/control.");
      return;
    }

    setWorkspace(next);
  };

  const openFeaturePane = (next: FeaturePane) => {
    setWorkspace("setup");
    setPane(next);
  };

  const clearChatTabTimer = useCallback(() => {
    if (chatTabSelectionTimerRef.current) {
      clearTimeout(chatTabSelectionTimerRef.current);
      chatTabSelectionTimerRef.current = null;
    }
  }, []);

  const ensureChatTabSelected = useCallback((attempt = 0) => {
    if (workspace !== "chat") {
      return;
    }

    const chatWebview = chatWebviewRef.current;
    if (!chatWebview?.executeJavaScript) {
      return;
    }

    const script = `(() => {
      const nodes = [...document.querySelectorAll('button, [role="tab"], a')];
      const target = nodes.find((node) => {
        const text = (node.textContent || '').trim().toLowerCase();
        const label = (node.getAttribute('aria-label') || '').trim().toLowerCase();
        return text === 'chat' || label === 'chat' || text.includes('chat') || label.includes('chat');
      });
      if (!target) return false;
      target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      return true;
    })();`;

    chatWebview.executeJavaScript(script, true)
      .then((found: boolean) => {
        if (found) {
          setChatStatusText("Chat UI loaded.");
          return;
        }

        if (attempt < 10) {
          clearChatTabTimer();
          chatTabSelectionTimerRef.current = setTimeout(() => {
            ensureChatTabSelected(attempt + 1);
          }, 280);
        }
      })
      .catch(() => {
        if (attempt < 5) {
          clearChatTabTimer();
          chatTabSelectionTimerRef.current = setTimeout(() => {
            ensureChatTabSelected(attempt + 1);
          }, 380);
        }
      });
  }, [clearChatTabTimer, workspace]);

  const updateControlSurface = useCallback(() => {
    const ready = gatewayReady === true;
    const controlWebview = controlWebviewRef.current;

    if (!ready) {
      setControlStatusText("Gateway is not ready yet.");
      setControlFallbackVisible(true);
      if (controlWebview?.getAttribute && controlWebview.getAttribute("src") !== "about:blank") {
        controlWebview.setAttribute("src", "about:blank");
      }
      return;
    }

    setControlStatusText(`Connected to ${CONTROL_UI_URL}`);
    setControlFallbackVisible(false);
    if (controlWebview?.getAttribute && controlWebview.getAttribute("src") !== CONTROL_UI_URL) {
      controlWebview.setAttribute("src", CONTROL_UI_URL);
    }
  }, [gatewayReady]);

  const updateChatSurface = useCallback((ensureChatTab = false) => {
    const ready = gatewayReady === true;
    const chatWebview = chatWebviewRef.current;

    if (!ready) {
      setChatStatusText("Gateway is not ready yet.");
      setChatFallbackVisible(true);
      if (chatWebview?.getAttribute && chatWebview.getAttribute("src") !== "about:blank") {
        chatWebview.setAttribute("src", "about:blank");
      }
      return;
    }

    setChatStatusText(`Connected to ${CONTROL_UI_URL}`);
    setChatFallbackVisible(false);
    if (chatWebview?.getAttribute && chatWebview.getAttribute("src") !== CONTROL_UI_URL) {
      chatWebview.setAttribute("src", CONTROL_UI_URL);
      return;
    }

    if (ensureChatTab) {
      ensureChatTabSelected(0);
    }
  }, [ensureChatTabSelected, gatewayReady]);

  useEffect(() => {
    if (onboardingLocked) {
      return;
    }

    if (gatewayReady === true && workspace === "setup") {
      setWorkspace("chat");
      appendLog("Gateway is ready. Switched to in-app Chat.");
    }
  }, [appendLog, gatewayReady, onboardingLocked, workspace]);

  useEffect(() => {
    if (workspace === "chat") {
      updateChatSurface(true);
      return;
    }

    if (workspace === "control") {
      updateControlSurface();
      return;
    }

    clearChatTabTimer();
  }, [clearChatTabTimer, updateChatSurface, updateControlSurface, workspace]);

  useEffect(() => {
    const chatWebview = chatWebviewRef.current;
    if (!chatWebview?.addEventListener) {
      return;
    }

    const onDomReady = () => {
      if (chatWebview.getAttribute("src") === CONTROL_UI_URL) {
        setChatStatusText("Chat UI loaded.");
        ensureChatTabSelected(0);
      }
    };

    const onDidFailLoad = (event: any) => {
      if (event?.errorCode === -3) {
        return;
      }

      setChatStatusText("Could not load embedded Chat UI.");
      setChatFallbackVisible(true);
      appendLog(`Chat UI load failed (${event?.errorCode ?? "?"}): ${event?.errorDescription ?? "Unknown error"}`);
    };

    chatWebview.addEventListener("dom-ready", onDomReady);
    chatWebview.addEventListener("did-fail-load", onDidFailLoad);

    return () => {
      chatWebview.removeEventListener("dom-ready", onDomReady);
      chatWebview.removeEventListener("did-fail-load", onDidFailLoad);
    };
  }, [appendLog, ensureChatTabSelected, workspace]);

  useEffect(() => {
    const controlWebview = controlWebviewRef.current;
    if (!controlWebview?.addEventListener) {
      return;
    }

    const onDomReady = () => {
      if (controlWebview.getAttribute("src") === CONTROL_UI_URL) {
        setControlStatusText("Control UI loaded.");
      }
    };

    const onDidFailLoad = (event: any) => {
      if (event?.errorCode === -3) {
        return;
      }

      setControlStatusText("Could not load embedded Control UI.");
      setControlFallbackVisible(true);
      appendLog(`Control UI load failed (${event?.errorCode ?? "?"}): ${event?.errorDescription ?? "Unknown error"}`);
    };

    controlWebview.addEventListener("dom-ready", onDomReady);
    controlWebview.addEventListener("did-fail-load", onDidFailLoad);

    return () => {
      controlWebview.removeEventListener("dom-ready", onDomReady);
      controlWebview.removeEventListener("did-fail-load", onDidFailLoad);
    };
  }, [appendLog, workspace]);

  useEffect(() => {
    return () => {
      clearChatTabTimer();
    };
  }, [clearChatTabTimer]);


  const startClerkAuthorization = () => runAction("Open Clerk sign-in", async () => {
    const opened = await window.openclaw.openExternalUrl(CLERK_SIGN_IN_URL);
    if (!opened) {
      throw new Error("Could not open Clerk sign-in.");
    }

    appendLog("Opened Clerk sign-in in your browser.");
  });

  const confirmClerkAuthorization = () => runAction("Confirm Clerk authorization", async () => {
    const email = accountEmailInput.trim().toLowerCase();
    const clerkUserId = clerkUserIdInput.trim();
    if (!email || !email.includes("@")) {
      throw new Error("Enter the Clerk account email first.");
    }
    if (!clerkUserId || !clerkUserId.startsWith("user_")) {
      throw new Error("Enter a valid Clerk user ID (starts with user_).");
    }

    const nextConfig = await window.openclaw.saveConfig({
      accountEmail: email,
      accountAuthorized: true,
      clerkUserId
    });

    setConfigDraft(nextConfig);
    setAccountEmailInput(nextConfig.accountEmail);
    setClerkUserIdInput(nextConfig.clerkUserId);
    appendLog(`Clerk account authorized: ${email} (${clerkUserId})`);
  });

  const resetClerkAuthorization = () => runAction("Reset Clerk authorization", async () => {
    const nextConfig = await window.openclaw.saveConfig({
      accountEmail: "",
      accountAuthorized: false,
      clerkUserId: ""
    });

    setConfigDraft(nextConfig);
    setAccountEmailInput("");
    setClerkUserIdInput("");
    appendLog("Clerk authorization reset.");
  });

  const renderOnboardingPane = () => (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>First-Time Setup</CardTitle>
          <CardDescription>{setupState.message}</CardDescription>
        </CardHeader>
        <CardContent>
          {renderStatusTable([
            {
              label: "Node.js runtime",
              value: readinessText(environment ? environment.nodeInstalled : null, "Installed"),
              variant: toVariant(environment ? environment.nodeInstalled : null)
            },
            {
              label: "npm package manager",
              value: readinessText(environment ? environment.npmInstalled : null, "Installed"),
              variant: toVariant(environment ? environment.npmInstalled : null)
            },
            {
              label: "OpenClaw CLI",
              value: readinessText(environment ? environment.openClawInstalled : null, "Installed"),
              variant: toVariant(environment ? environment.openClawInstalled : null)
            },
            {
              label: "Gateway process",
              value: readinessText(environment ? environment.gatewayRunning : null, "Running", "Stopped"),
              variant: toVariant(environment ? environment.gatewayRunning : null)
            }
          ])}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Step 1 · Clerk account authorization</CardTitle>
          <CardDescription>Require Clerk sign-in before the rest of onboarding can be completed.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 gap-2">
            <Input
              value={accountEmailInput}
              onChange={(event) => setAccountEmailInput(event.target.value)}
              placeholder="clerk-email@example.com"
            />
            <Input
              value={clerkUserIdInput}
              onChange={(event) => setClerkUserIdInput(event.target.value)}
              placeholder="user_xxxxxxxxxxxxx"
            />
            <div className="flex flex-wrap gap-2">
            <Button onClick={startClerkAuthorization} disabled={isBusy}>
              <LockKeyhole className="h-3.5 w-3.5" />
              Open Clerk Sign-In
            </Button>
            <Button variant="outline" onClick={confirmClerkAuthorization} disabled={isBusy}>
              <UserRoundCheck className="h-3.5 w-3.5" />
              Confirm
            </Button>
            </div>
          </div>
          <div className="flex items-center justify-between rounded-md border bg-muted/30 p-2 text-xs text-muted-foreground">
            <span>Current Clerk account: {configDraft?.accountEmail || "Not authorized"}{configDraft?.clerkUserId ? ` · ${configDraft.clerkUserId}` : ""}</span>
            <Badge variant={configDraft?.accountAuthorized ? "success" : "warning"}>
              {configDraft?.accountAuthorized ? "Authorized" : "Pending"}
            </Badge>
          </div>
          <div>
            <Button variant="ghost" onClick={resetClerkAuthorization} disabled={isBusy || !configDraft?.accountAuthorized}>Reset authorization</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Step 2 · Setup Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <Button variant="primary" onClick={runGuidedSetup} disabled={isBusy}>
              <Sparkles className="h-3.5 w-3.5" />
              Guided Setup
            </Button>
            <Button onClick={installNode} disabled={isBusy || !environment?.isWindows}>
              <Wrench className="h-3.5 w-3.5" />
              Install Node
            </Button>
            <Button onClick={installOpenClaw} disabled={isBusy || runtimeReady !== true}>
              <Bot className="h-3.5 w-3.5" />
              Install OpenClaw
            </Button>
            <Button onClick={startGateway} disabled={isBusy || !environment?.openClawInstalled}>
              <Play className="h-3.5 w-3.5" />
              Start Gateway
            </Button>
            <Button onClick={runCliOnboard} disabled={isBusy || !environment?.openClawInstalled}>
              <Settings className="h-3.5 w-3.5" />
              CLI Onboard
            </Button>
            <Button variant="outline" onClick={completeOnboarding} disabled={isBusy || gatewayReady !== true || !configDraft?.accountAuthorized}>
              <Sparkles className="h-3.5 w-3.5" />
              Complete Onboarding
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );

  const whatsapp = getChannel(channelStatus, "whatsapp");
  const telegram = getChannel(channelStatus, "telegram");

  const renderChannelsPane = () => (
    <div className="space-y-3">
      <Card>
        <CardHeader>
          <CardTitle>Channel Management</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <Card className="bg-muted/40">
              <CardHeader>
                <CardTitle className="text-sm">WhatsApp</CardTitle>
                <Badge variant={whatsapp.connected ? "success" : whatsapp.configured ? "warning" : "danger"}>{whatsapp.summary}</Badge>
              </CardHeader>
              <CardContent className="space-y-2 text-xs text-muted-foreground">
                <div className="grid grid-cols-2 gap-2">
                  <Button onClick={() => void handleReconnectChannel("whatsapp")} disabled={isBusy || !environment?.openClawInstalled}>Reconnect</Button>
                  <Button variant="outline" onClick={() => void handleDisableChannel("whatsapp")} disabled={isBusy || !environment?.openClawInstalled}>Disable</Button>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-muted/40">
              <CardHeader>
                <CardTitle className="text-sm">Telegram</CardTitle>
                <Badge variant={telegram.connected ? "success" : telegram.configured ? "warning" : "danger"}>{telegram.summary}</Badge>
              </CardHeader>
              <CardContent className="space-y-2 text-xs text-muted-foreground">
                <div className="grid grid-cols-2 gap-2">
                  <Button onClick={() => void handleReconnectChannel("telegram")} disabled={isBusy || !environment?.openClawInstalled}>Reconnect</Button>
                  <Button variant="outline" onClick={() => void handleDisableChannel("telegram")} disabled={isBusy || !environment?.openClawInstalled}>Disable</Button>
                </div>
              </CardContent>
            </Card>
          </div>

          <Separator />

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
            <Input
              value={telegramToken}
              onChange={(event) => setTelegramToken(event.target.value)}
              placeholder="Bot token"
            />
            <Button onClick={saveTelegramToken} disabled={isBusy || !telegramToken.trim()}>Save Token</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );

  const renderModelsPane = () => (
    <Card>
      <CardHeader>
        <CardTitle>Model Management</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          <div className="space-y-1">
            <p className="text-[11px] text-muted-foreground">Provider</p>
            <Select value={manageProvider} onChange={(event) => applyManagedModelProvider(event.target.value)}>
              <option value="">Select provider</option>
              {modelProviders.map((provider) => (
                <option key={provider} value={provider}>{provider}</option>
              ))}
            </Select>
          </div>

          <div className="space-y-1">
            <p className="text-[11px] text-muted-foreground">Model</p>
            <Select value={manageModel} onChange={(event) => setManageModel(event.target.value)}>
              <option value="">Select model</option>
              {modelOptions.map((model) => (
                <option key={model} value={model}>{model}</option>
              ))}
            </Select>
          </div>
        </div>

        <div className="flex gap-2">
          <Button variant="primary" onClick={applyModelSelection} disabled={isBusy || !manageProvider || !manageModel}>
            Apply Model
          </Button>
          <Button variant="outline" onClick={() => void runAction("Refresh models", async () => { await refreshModels(true); })} disabled={isBusy || !environment?.openClawInstalled}>
            Refresh
          </Button>
        </div>
      </CardContent>
    </Card>
  );

  const renderFilesPane = () => (
    <Card>
      <CardHeader>
        <CardTitle>Workspace Files</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_auto_auto]">
          <Select value={selectedFile} onChange={(event) => setSelectedFile(event.target.value as WorkspaceEditableFileName)}>
            {FILE_OPTIONS.map((file) => (
              <option key={file} value={file}>{file}</option>
            ))}
          </Select>
          <Button onClick={loadWorkspaceFile} disabled={isBusy || !configDraft?.workspacePath}>Load</Button>
          <Button variant="primary" onClick={saveWorkspaceFile} disabled={isBusy || !configDraft?.workspacePath}>Save</Button>
        </div>

        <p className="text-[11px] text-muted-foreground">
          Path: {workspaceFile?.path ?? "Not loaded"}
        </p>

        <Textarea
          className="min-h-[340px] font-mono text-[11px]"
          value={workspaceFileEditor}
          onChange={(event) => setWorkspaceFileEditor(event.target.value)}
          placeholder="Load a file to edit"
        />
      </CardContent>
    </Card>
  );

  const renderSettingsPane = () => (
    <Card>
      <CardHeader>
        <CardTitle>Settings</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <p className="text-[11px] text-muted-foreground">Profile Name</p>
            <Input
              value={configDraft?.profileName ?? ""}
              onChange={(event) => setConfigDraft((current) => current ? { ...current, profileName: event.target.value } : current)}
              placeholder="Default"
            />
          </div>

          <div className="space-y-1">
            <p className="text-[11px] text-muted-foreground">Workspace Path</p>
            <Input
              value={configDraft?.workspacePath ?? ""}
              onChange={(event) => setConfigDraft((current) => current ? { ...current, workspacePath: event.target.value } : current)}
              placeholder="C:\\Users\\You\\OpenClaw"
            />
          </div>

          <div className="space-y-1">
            <p className="text-[11px] text-muted-foreground">Model Provider</p>
            <Select
              value={configDraft?.modelProvider ?? ""}
              onChange={(event) => setConfigDraft((current) => current ? { ...current, modelProvider: event.target.value, modelName: "" } : current)}
            >
              <option value="">Select provider</option>
              {modelProviders.map((provider) => (
                <option key={provider} value={provider}>{provider}</option>
              ))}
            </Select>
          </div>

          <div className="space-y-1">
            <p className="text-[11px] text-muted-foreground">Model Name</p>
            <Select
              value={configDraft?.modelName ?? ""}
              onChange={(event) => setConfigDraft((current) => current ? { ...current, modelName: event.target.value } : current)}
            >
              <option value="">Select model</option>
              {settingsModelOptions.map((model) => (
                <option key={model} value={model}>{model}</option>
              ))}
            </Select>
          </div>
        </div>

        <div className="grid gap-2">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={Boolean(configDraft?.autoStartGateway)}
              onChange={(event) => setConfigDraft((current) => current ? { ...current, autoStartGateway: event.target.checked } : current)}
            />
            Start gateway on app launch
          </label>

          <label className="flex items-center justify-between rounded-sm border border-border bg-muted/40 p-2 text-xs text-muted-foreground">
            <span>Always-on gateway (Windows sign-in)</span>
            <input
              type="checkbox"
              checked={Boolean(alwaysOnStatus?.enabled)}
              disabled={isBusy || !alwaysOnStatus?.supported}
              onChange={(event) => void toggleAlwaysOn(event.target.checked)}
            />
          </label>
          <p className="text-[11px] text-muted-foreground">{alwaysOnStatus?.detail ?? "Checking..."}</p>
        </div>

        <div className="flex gap-2">
          <Button variant="primary" onClick={saveSettings} disabled={isBusy || !configDraft}>Save Settings</Button>
          <Button variant="outline" onClick={() => void runAction("Reload config", async () => { await refreshConfig(); })} disabled={isBusy}>Reload</Button>
        </div>
      </CardContent>
    </Card>
  );

  const canInstallUpdate = updateStatus?.state === "downloaded" && updateStatus?.canInstall;

  const renderUpdatesPane = () => (
    <Card>
      <CardHeader>
        <CardTitle>Updates</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          State: {updateStatus?.state ?? "idle"}
          {typeof updateStatus?.progress === "number" ? ` (${Math.round(updateStatus.progress)}%)` : ""}
        </p>

        <div className="flex gap-2">
          <Button onClick={checkForUpdates} disabled={isBusy}>Check</Button>
          <Button variant="primary" onClick={installUpdate} disabled={isBusy || !canInstallUpdate}>Install + Restart</Button>
        </div>
      </CardContent>
    </Card>
  );

  const renderLogsPane = () => (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Live Log</CardTitle>
      </CardHeader>
      <CardContent>
        <pre className="h-[calc(100vh-13rem)] overflow-auto rounded-sm border border-border bg-[#141414] p-3 text-[11px] leading-5 text-muted-foreground">
          {logs.join("\n")}
        </pre>
      </CardContent>
    </Card>
  );

  const renderSetupWorkspace = () => {
    const selectedNav = navItems.find((item) => item.key === pane);

    const renderSelectedPane = () => {
      switch (pane) {
        case "onboarding":
          return renderOnboardingPane();
        case "channels":
          return renderChannelsPane();
        case "models":
          return renderModelsPane();
        case "files":
          return renderFilesPane();
        case "settings":
          return renderSettingsPane();
        case "updates":
          return renderUpdatesPane();
        case "logs":
          return renderLogsPane();
        default:
          return renderOnboardingPane();
      }
    };

    return (
      <div className="space-y-4">
        <div>
          <h3 className="text-base font-semibold">{selectedNav?.label ?? "Setup"}</h3>
        </div>
        {renderSelectedPane()}
      </div>
    );
  };

  const renderWebviewWorkspace = (mode: "chat" | "control") => {
    const isChat = mode === "chat";
    const title = isChat ? "Chat" : "Control";
    const webviewRef = isChat ? chatWebviewRef : controlWebviewRef;
    const ready = gatewayReady === true;
    const statusText = isChat ? chatStatusText : controlStatusText;
    const fallbackVisible = isChat ? chatFallbackVisible : controlFallbackVisible;
    const fallbackText = "Gateway is not ready. Start + Retry.";

    return (
      <Card className="h-full">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{statusText}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => {
                if (!ready) {
                  return;
                }
                webviewRef.current?.reload?.();
                appendLog(`Reloaded embedded ${title} UI.`);
              }}
              disabled={!ready}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Reload
            </Button>
            <Button onClick={startGateway} disabled={isBusy || !environment?.openClawInstalled}>
              <Play className="h-3.5 w-3.5" />
              {isChat ? "Start Gateway" : "Start + Retry"}
            </Button>
            {isChat ? (
              <Button
                variant="outline"
                onClick={() => setWorkspace("control")}
                disabled={onboardingLocked}
              >
                <Boxes className="h-3.5 w-3.5" />
                Open Control
              </Button>
            ) : (
              <Button variant="outline" onClick={() => setWorkspace("setup")}>
                <Wrench className="h-3.5 w-3.5" />
                Back to Setup
              </Button>
            )}
          </div>

          {fallbackVisible ? (
            <p className="text-xs text-[#d2bb86]">{fallbackText}</p>
          ) : null}

          <webview
            ref={webviewRef}
            className="h-[calc(100vh-16.5rem)] w-full rounded-sm border border-border bg-[#141414]"
            src={ready ? CONTROL_UI_URL : "about:blank"}
            allowpopups="false"
            partition="persist:openclaw-control"
          />
        </CardContent>
      </Card>
    );
  };

  const workspaceTitle = workspace === "setup" ? "Setup" : workspace === "chat" ? "Chat" : "Control";
  const workspaceDescription = workspace === "setup"
    ? "Install and control"
    : workspace === "chat"
      ? "Live chat"
      : "Gateway control";

  return (
    <Tabs value={workspace} onValueChange={(value) => openWorkspace(value as Workspace)} className="h-full w-full bg-background p-3">
      <div className="grid h-full grid-cols-[290px_minmax(0,1fr)_320px] gap-3 max-[1360px]:grid-cols-1">
        <Sidebar>
          <SidebarHeader>
            <img src="./openclaw_logo.png" alt="OpenClaw" className="h-auto w-36" />
            <h1 className="text-[42px] font-semibold tracking-tight leading-none">Control Center</h1>
          </SidebarHeader>

          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>Workspace</SidebarGroupLabel>
              <SidebarGroupContent>
                <TabsList className="grid h-auto grid-cols-1 gap-1 bg-transparent p-0">
                  <TabsTrigger value="setup" className="justify-start gap-2">
                    <Wrench className="h-4 w-4" />
                    Setup
                  </TabsTrigger>
                  <TabsTrigger value="chat" className="justify-start gap-2">
                    <MessageSquare className="h-4 w-4" />
                    Chat
                  </TabsTrigger>
                  <TabsTrigger value="control" className="justify-start gap-2">
                    <Boxes className="h-4 w-4" />
                    Control
                  </TabsTrigger>
                </TabsList>
              </SidebarGroupContent>
            </SidebarGroup>

            <SidebarGroup>
              <SidebarGroupLabel>Sections</SidebarGroupLabel>
              <SidebarGroupContent>
                {navItems.map((item) => {
                  const Icon = item.icon;
                  const active = workspace === "setup" && pane === item.key;
                  return (
                    <Button
                      key={item.key}
                      variant={active ? "primary" : "ghost"}
                      className="w-full justify-start"
                      onClick={() => openFeaturePane(item.key)}
                    >
                      <Icon className="h-4 w-4" />
                      {item.label}
                    </Button>
                  );
                })}
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>

          <SidebarFooter>
            {renderStatusTable([
              {
                label: "Node/npm",
                value: readinessText(runtimeReady, "Ready", "Missing"),
                variant: toVariant(runtimeReady)
              },
              {
                label: "OpenClaw",
                value: readinessText(environment ? environment.openClawInstalled : null, "Installed"),
                variant: toVariant(environment ? environment.openClawInstalled : null)
              },
              {
                label: "Gateway",
                value: readinessText(environment ? environment.gatewayRunning : null, "Running", "Stopped"),
                variant: toVariant(environment ? environment.gatewayRunning : null)
              }
            ], true)}
          </SidebarFooter>
        </Sidebar>

        <SidebarInset className="overflow-hidden p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight">{workspaceTitle}</h2>
              <p className="text-xs text-muted-foreground">{workspaceDescription}</p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="default">{setupState.stage}</Badge>
              <Button
                variant="outline"
                className="px-2"
                onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
                title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
              >
                {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </Button>
              <Button variant="outline" onClick={refreshAllAction} disabled={isBusy}>
                <RefreshCw className="h-4 w-4" />
                Refresh
              </Button>
            </div>
          </div>

          <Separator className="my-4" />

          <TabsContent value="setup" className="mt-0 h-[calc(100%-6rem)] min-h-0">
            <ScrollArea className="h-full pr-1">
              {renderSetupWorkspace()}
            </ScrollArea>
          </TabsContent>
          <TabsContent value="chat" className="mt-0 h-[calc(100%-6rem)]">
            {renderWebviewWorkspace("chat")}
          </TabsContent>
          <TabsContent value="control" className="mt-0 h-[calc(100%-6rem)]">
            {renderWebviewWorkspace("control")}
          </TabsContent>
        </SidebarInset>

        <Sidebar>
          <SidebarHeader>
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">Quick Actions</h2>
              {busyAction ? <Badge variant="warning">Working</Badge> : <Badge variant="default">Idle</Badge>}
            </div>
          </SidebarHeader>

          <SidebarContent className="px-3">
            <div className="grid grid-cols-1 gap-2">
              <Button variant="primary" onClick={runGuidedSetup} disabled={isBusy}>
                <Sparkles className="h-4 w-4" />
                Guided Setup
              </Button>
              <Button onClick={installNode} disabled={isBusy || !environment?.isWindows}>
                <Wrench className="h-4 w-4" />
                Install Node
              </Button>
              <Button onClick={installOpenClaw} disabled={isBusy || runtimeReady !== true}>
                <Bot className="h-4 w-4" />
                Install OpenClaw
              </Button>
              <Button onClick={startGateway} disabled={isBusy || !environment?.openClawInstalled}>
                <Play className="h-4 w-4" />
                Start Gateway
              </Button>
              <Button onClick={stopGateway} disabled={isBusy || !environment?.openClawInstalled}>
                <Square className="h-4 w-4" />
                Stop Gateway
              </Button>
              <Button variant="outline" onClick={checkGatewayStatus} disabled={isBusy || !environment?.openClawInstalled}>
                <Activity className="h-4 w-4" />
                Gateway Status
              </Button>
            </div>

            <Separator className="my-4" />

            {renderStatusTable([
              {
                label: "Node/npm",
                value: readinessText(runtimeReady, "Ready", "Missing"),
                variant: toVariant(runtimeReady)
              },
              {
                label: "OpenClaw",
                value: readinessText(environment ? environment.openClawInstalled : null, "Installed"),
                variant: toVariant(environment ? environment.openClawInstalled : null)
              },
              {
                label: "Gateway",
                value: readinessText(environment ? environment.gatewayRunning : null, "Running", "Stopped"),
                variant: toVariant(environment ? environment.gatewayRunning : null)
              },
              {
                label: "Clerk account",
                value: configDraft?.accountAuthorized ? (configDraft.accountEmail || "Authorized") : "Pending",
                variant: configDraft?.accountAuthorized ? "success" : "warning"
              },
              {
                label: "Onboarding",
                value: configDraft?.onboardingCompleted ? "Completed" : "Pending",
                variant: configDraft?.onboardingCompleted ? "success" : "warning"
              }
            ])}

            <Separator className="my-4" />

            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">System Notes</p>
            <ul className="mt-2 space-y-2 text-sm text-muted-foreground">
              {(environment?.notes ?? ["No notes."]).map((note) => (
                <li key={note}>- {note}</li>
              ))}
            </ul>
          </SidebarContent>

          <SidebarFooter>
            {busyAction ? (
              <p className="text-xs text-muted-foreground">Working: {busyAction}</p>
            ) : null}
            {error ? <p className="mt-1 text-xs text-[#f3c2c8]">{error}</p> : null}
          </SidebarFooter>
        </Sidebar>
      </div>
    </Tabs>
  );
}
