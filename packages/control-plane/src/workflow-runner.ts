import type { AdapterEvent } from "@forge/shared-utils";
import type { AdapterFactory, AdapterType } from "./types.js";

export type GateResult = {
  ok: boolean;
  name?: string;
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type WorkflowGitClient = {
  currentBranch(): Promise<string>;
  commit(message: string): Promise<void>;
  push(remote: string): Promise<void>;
};

export type WorkflowRunnerDeps = {
  gateRunner: (phase: string, cwd: string) => Promise<GateResult>;
  git: WorkflowGitClient;
  onAdapterEvent?: (event: AdapterEvent) => void;
};

export type WorkflowAutoOptions = {
  maxRetries: number;
  push: boolean;
  remote?: string;
};

export type WorkflowAutoResult =
  | { state: "running"; taskId: string; phase: string }
  | { state: "paused"; taskId: string; phase: string; message: string }
  | { state: "completed"; message: string };

export class ForgeWorkflowRunner {
  constructor(
    private readonly workspaceRoot: string,
    private readonly adapterFactory: AdapterFactory,
    private readonly deps: WorkflowRunnerDeps
  ) {}

  async runAuto(planPath: string, adapterType: AdapterType, options: WorkflowAutoOptions): Promise<WorkflowAutoResult> {
    void planPath;
    void adapterType;
    void options;
    throw new Error("not implemented");
  }
}
