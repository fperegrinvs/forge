export function getSkillInvocation(adapter: string): string {
  if (adapter === "codex") {
    return "Guided plan creation starts automatically";
  }
  return "Type `/plan-guided` and press Enter";
}
