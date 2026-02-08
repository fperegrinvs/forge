import type { CodexAppServerAdapterOptions } from "./app-server-adapter.js";
import { CodexAppServerAdapter } from "./app-server-adapter.js";

// Canonical Codex transport: app-server (JSON-RPC over JSONL).
export class CodexAdapter extends CodexAppServerAdapter {
  constructor(options: CodexAppServerAdapterOptions = {}) {
    super(options);
  }
}

