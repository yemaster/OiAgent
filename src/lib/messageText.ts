/** Remove only complete, leading agent context blocks; leave quoted examples intact. */
export function visibleUserText(text: string): string {
  let rest = text;
  for (;;) {
    if (/^(?:\r?\n)*(?: {4}|\t)/.test(rest)) break;
    const candidate = rest.trimStart();
    const tag = [
      "environment_context",
      "user_instructions",
      "system-reminder",
    ].find((name) => candidate.startsWith(`<${name}>`));
    const agents = candidate.startsWith("# AGENTS.md instructions for ");
    const close = tag ? `</${tag}>` : agents ? "</INSTRUCTIONS>" : undefined;
    if (!close || (agents && !candidate.includes("<INSTRUCTIONS>"))) break;
    const end = candidate.indexOf(close);
    if (end < 0) break;
    rest = candidate.slice(end + close.length).replace(/^(?:\r?\n)+/, "");
  }
  return rest;
}
