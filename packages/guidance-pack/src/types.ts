export type InstallGuidanceOptions = {
  forceReplace?: boolean;
  installGitHooks?: boolean;
};

export type InstallGuidanceResult = {
  installed: string[];
  updated: string[];
  skipped: string[];
};

export type SkillDescriptor = {
  name: string;
  hasSkillFile: boolean;
  hasScripts: boolean;
  hasReferences: boolean;
  hasAssets: boolean;
};

export type RegisteredCommands = {
  claude: string[];
  codex: string[];
};
