import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "../../shared/types";

const defaultConfig: AppConfig = {
  profileName: "Default",
  workspacePath: "",
  modelProvider: "",
  modelName: "",
  modelApiKey: "",
  accountEmail: "",
  accountAuthorized: false,
  clerkUserId: "",
  autoStartGateway: true,
  onboardingCompleted: false,
  updatedAt: new Date(0).toISOString()
};

export class ConfigStore {
  private readonly filePath: string;

  constructor(userDataPath: string) {
    this.filePath = path.join(userDataPath, "openclaw-desktop.json");
  }

  public async load(): Promise<AppConfig> {
    try {
      const payload = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(payload) as Partial<AppConfig>;
      return {
        profileName: parsed.profileName ?? defaultConfig.profileName,
        workspacePath: parsed.workspacePath ?? defaultConfig.workspacePath,
        modelProvider: parsed.modelProvider ?? defaultConfig.modelProvider,
        modelName: parsed.modelName ?? defaultConfig.modelName,
        modelApiKey: parsed.modelApiKey ?? defaultConfig.modelApiKey,
        accountEmail: parsed.accountEmail ?? defaultConfig.accountEmail,
        accountAuthorized: parsed.accountAuthorized ?? defaultConfig.accountAuthorized,
        clerkUserId: parsed.clerkUserId ?? defaultConfig.clerkUserId,
        autoStartGateway: parsed.autoStartGateway ?? defaultConfig.autoStartGateway,
        onboardingCompleted: parsed.onboardingCompleted ?? defaultConfig.onboardingCompleted,
        updatedAt: parsed.updatedAt ?? defaultConfig.updatedAt
      };
    } catch {
      return { ...defaultConfig };
    }
  }

  public async save(next: Partial<AppConfig>): Promise<AppConfig> {
    const current = await this.load();
    const merged: AppConfig = {
      ...current,
      ...next,
      updatedAt: new Date().toISOString()
    };

    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(merged, null, 2), "utf8");

    return merged;
  }
}
