export type RunId = string;

export type RunContext = {
  taskId: string;
  prompt: string;
  workingDirectory: string;
  allowedTools: string[];
  env?: Record<string, string>;
};

export type AdapterEvent =
  | { type: "run.started"; runId: RunId; at: string }
  | { type: "run.output"; runId: RunId; stream: "stdout" | "stderr"; chunk: string; at: string }
  | { type: "run.tool"; runId: RunId; tool: string; status: "started" | "completed" | "failed"; at: string }
  | { type: "run.completed"; runId: RunId; exitCode: number; at: string }
  | { type: "run.failed"; runId: RunId; reason: string; at: string };

export type RunHandle = {
  runId: RunId;
};

export interface AgentAdapter {
  startRun(context: RunContext): Promise<RunHandle>;
  streamEvents(runId: RunId): AsyncIterable<AdapterEvent>;
  resume(runId: RunId): Promise<RunHandle>;
  cancel(runId: RunId): Promise<void>;
}

export type CheckStatus = "pass" | "fail" | "flaky" | "infra_error";

export type CheckResult = {
  name: string;
  status: CheckStatus;
  summary: string;
  evidencePath?: string;
  startedAt: string;
  finishedAt: string;
};
