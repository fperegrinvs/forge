import type { AdapterEvent, AgentAdapter, CheckResult } from "@forge/shared-utils";

export type AdapterType = "codex" | "claude";

export type TaskState = "pending" | "running" | "completed" | "paused" | "failed";

export type RuntimeState = {
  planPath: string;
  tasks: Record<string, TaskState>;
  pausedRunId?: string;
};

export type RunNextResult = {
  taskId?: string;
  state: TaskState;
  classification?: "transient" | "structural" | "semantic" | "infrastructure";
  runId?: string;
  checks?: CheckResult[];
  events?: AdapterEvent[];
  message: string;
};

export type AdapterFactory = (type: AdapterType) => AgentAdapter;
