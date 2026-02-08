export type SidecarCommand =
  | { command: "plan.validate"; params: { planPath: string } }
  | { command: "plan.migrate"; params: { planPath: string; write: boolean } }
  | { command: "project.init"; params: { projectName: string; template?: string; skipGuidance: boolean } }
  | { command: "guidance.installFromPack"; params: { packPath: string; forceReplace: boolean } }
  | { command: "workflow.auto.stream"; params: { planPath: string; adapter: "codex" | "claude"; push: boolean } }
  | { command: "codex.session.stream"; params: { autoSkill?: string } };

export const SIDECAR_PROTOCOL_VERSION = 1;

export * from "./sidecar.js";
