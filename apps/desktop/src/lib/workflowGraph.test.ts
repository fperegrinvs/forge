import { describe, expect, it } from "vitest";
import { buildWorkflowGraph } from "./workflowGraph";
import type { PhaseGateBindings, WorkflowPhase } from "../composables/useControlPlane";

describe("buildWorkflowGraph", () => {
  it("creates sequential nodes and edges", () => {
    const phases: WorkflowPhase[] = [
      { id: "spec", gate: "spec", commit: true, diagnostic: true },
      { id: "implement", gate: "green", commit: true, diagnostic: false },
      { id: "refactor", gate: "refactor", commit: true, diagnostic: false }
    ];

    const bindings: PhaseGateBindings = { spec: "scripts/spec.sh" };
    const defaults = { spec: "scripts/spec.sh" };

    const graph = buildWorkflowGraph(phases, bindings, defaults);
    expect(graph.nodes).toHaveLength(3);
    expect(graph.edges).toHaveLength(2);
    expect(graph.edges[0]).toEqual({ id: "spec->implement", source: "spec", target: "implement" });
    expect(graph.edges[1]).toEqual({ id: "implement->refactor", source: "implement", target: "refactor" });
  });

  it("classifies binding status as default/custom/disabled/unbound", () => {
    const phases: WorkflowPhase[] = [
      { id: "spec", gate: "spec", commit: true, diagnostic: true },
      { id: "implement", gate: "green", commit: true, diagnostic: false },
      { id: "refactor", gate: "refactor", commit: true, diagnostic: false },
      { id: "document", gate: "docs", commit: true, diagnostic: false }
    ];

    const defaults = {
      spec: "scripts/phase-gates/spec.sh",
      implement: "scripts/phase-gates/implement.sh"
    };

    const bindings: PhaseGateBindings = {
      spec: "scripts/phase-gates/spec.sh", // default
      implement: "scripts/custom/implement.sh", // custom
      refactor: null // disabled
      // document: unbound
    };

    const graph = buildWorkflowGraph(phases, bindings, defaults);
    const byId = new Map(graph.nodes.map((n) => [n.id, n.data.status]));
    expect(byId.get("spec")).toBe("default");
    expect(byId.get("implement")).toBe("custom");
    expect(byId.get("refactor")).toBe("disabled");
    expect(byId.get("document")).toBe("unbound");
  });
});

