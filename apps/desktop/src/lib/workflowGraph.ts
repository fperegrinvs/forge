import type { WorkflowPhase, PhaseGateBindings } from "../composables/useControlPlane.js";

export type PhaseBindingStatus = "custom" | "default" | "disabled" | "unbound";

export type WorkflowGraphNode = {
  id: string;
  position: { x: number; y: number };
  data: {
    phaseId: string;
    title: string;
    gate: string;
    status: PhaseBindingStatus;
  };
};

export type WorkflowGraphEdge = {
  id: string;
  source: string;
  target: string;
};

export type WorkflowGraph = {
  nodes: WorkflowGraphNode[];
  edges: WorkflowGraphEdge[];
};

function computeStatus(
  phaseId: string,
  bindings: PhaseGateBindings,
  defaults: Record<string, string>
): PhaseBindingStatus {
  const bound = bindings[phaseId];
  if (bound === null) return "disabled";
  if (typeof bound === "string") {
    return defaults[phaseId] && bound === defaults[phaseId] ? "default" : "custom";
  }
  return "unbound";
}

export function buildWorkflowGraph(
  phases: WorkflowPhase[],
  bindings: PhaseGateBindings,
  defaultPhaseGateBindings: Record<string, string>
): WorkflowGraph {
  const nodes: WorkflowGraphNode[] = phases.map((phase, index) => ({
    id: phase.id,
    position: { x: index * 260, y: 0 },
    data: {
      phaseId: phase.id,
      title: phase.id,
      gate: phase.gate,
      status: computeStatus(phase.id, bindings, defaultPhaseGateBindings)
    }
  }));

  const edges: WorkflowGraphEdge[] = [];
  for (let i = 0; i < phases.length - 1; i += 1) {
    const fromPhase = phases[i];
    const toPhase = phases[i + 1];
    if (!fromPhase || !toPhase) continue;
    const from = fromPhase.id;
    const to = toPhase.id;
    edges.push({ id: `${from}->${to}`, source: from, target: to });
  }

  return { nodes, edges };
}
