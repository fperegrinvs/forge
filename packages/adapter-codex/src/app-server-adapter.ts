import type { AdapterEvent, AgentAdapter, RunContext, RunHandle } from "@forge/shared-utils";

export type CodexAppServerAdapterOptions = {
  spawnCommand?: string;
  spawnArgs?: string[];
};

export class CodexAppServerAdapter implements AgentAdapter {
  constructor(private readonly options: CodexAppServerAdapterOptions = {}) {
    void options;
  }

  startRun(_context: RunContext): Promise<RunHandle> {
    return Promise.resolve({ runId: "unimplemented" });
  }

  async *streamEvents(runId: string): AsyncIterable<AdapterEvent> {
    yield { type: "run.failed", runId, reason: "not implemented", at: new Date().toISOString() } as const;
  }

  resume(runId: string): Promise<RunHandle> {
    return Promise.resolve({ runId });
  }

  cancel(_runId: string): Promise<void> {
    return Promise.resolve();
  }
}

