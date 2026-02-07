export function getSkillInvocation(adapter: string): string {
  if (adapter === "codex") {
    return "Mention `$plan-guided` and describe your feature";
  }
  return "Type `/plan-guided` and press Enter";
}
