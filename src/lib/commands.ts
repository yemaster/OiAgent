import { parse } from "acorn";
export interface CommandCall {
  name: string;
  command?: string;
  cwd?: string;
  input?: unknown;
  dynamic?: boolean;
}
export interface CommandDescription {
  calls: CommandCall[];
  wrapped: boolean;
  unresolved: boolean;
}
const object = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
const decode = (v: unknown): unknown => {
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
};
function string(v: unknown) {
  return typeof v === "string" ? v : undefined;
}
function shell(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) return;
  if (
    v.length === 3 &&
    /^(?:.*\/)?(?:ba|z|fi|da|k)?sh$/.test(v[0]) &&
    /^-[a-z]*c[a-z]*$/.test(v[1])
  )
    return v[2];
  return v
    .map((x) =>
      /^[a-zA-Z0-9_./:@%+=,-]+$/.test(x)
        ? x
        : `'${x.replaceAll("'", "'\\''")}'`,
    )
    .join(" ");
}
// A deliberately small static AST reader, not an evaluator. Variables, substitutions,
// getters and function calls are never executed or guessed.
function literal(value: unknown): unknown {
  const n = object(value);
  if (n.type === "Literal") return n.value;
  if (
    n.type === "TemplateLiteral" &&
    Array.isArray(n.expressions) &&
    n.expressions.length === 0
  ) {
    return object(object((n.quasis as unknown[])[0]).value).cooked;
  }
  if (n.type === "ArrayExpression")
    return (n.elements as unknown[]).map(literal);
  if (n.type === "ObjectExpression")
    return Object.fromEntries(
      (n.properties as unknown[]).flatMap((p) => {
        const prop = object(p);
        if (prop.type !== "Property" || prop.kind !== "init" || prop.computed)
          return [];
        const key = object(prop.key);
        return [[String(key.name ?? key.value), literal(prop.value)]];
      }),
    );
  return undefined;
}
function name(value: unknown): string {
  const n = object(value);
  if (n.type === "Identifier") return String(n.name);
  if (n.type === "MemberExpression")
    return `${name(n.object)}.${n.computed ? literal(n.property) : object(n.property).name}`;
  return "";
}
function fromInput(name: string, input: unknown): CommandCall {
  const args = object(decode(input));
  return {
    name,
    command: shell(args.cmd ?? args.command ?? args.command_line),
    cwd: string(args.workdir ?? args.cwd ?? args.directory),
    input: args,
  };
}
export function parseCommands(
  toolName: string,
  input: unknown,
): CommandDescription {
  const decoded = decode(input),
    args = object(decoded);
  const direct = fromInput(toolName, decoded);
  if (direct.command)
    return { calls: [direct], wrapped: false, unresolved: false };
  const source = string(args.code) ?? string(args.script) ?? string(decoded);
  if (!source) return { calls: [], wrapped: false, unresolved: false };
  const wrapper =
    /(?:tools|functions|parallel|multi_tool_use)\s*[.[(]|\b(?:await|Promise\.(?:all|allSettled))\b/.test(
      source,
    );
  if (!wrapper && /bash|shell|exec_command|command_execution/.test(toolName))
    return {
      calls: [{ name: toolName, command: source }],
      wrapped: false,
      unresolved: false,
    };
  if (!wrapper) return { calls: [], wrapped: false, unresolved: true };
  const calls: CommandCall[] = [];
  let unresolved = false;
  try {
    if (source.length > 300000) throw new Error("Too large");
    const ast = parse(source, {
      ecmaVersion: "latest",
      sourceType: "module",
      allowAwaitOutsideFunction: true,
      allowReturnOutsideFunction: true,
    });
    function visit(value: unknown, conditional = false, depth = 0) {
      if (depth > 100) {
        unresolved = true;
        return;
      }
      if (Array.isArray(value)) {
        value.forEach((v) => visit(v, conditional, depth + 1));
        return;
      }
      const node = object(value);
      if (!node.type) return;
      const dynamic =
        conditional ||
        [
          "IfStatement",
          "ConditionalExpression",
          "ForStatement",
          "ForOfStatement",
          "ForInStatement",
          "WhileStatement",
          "SwitchStatement",
          "FunctionDeclaration",
        ].includes(String(node.type));
      if (node.type === "CallExpression") {
        const target = name(node.callee);
        if (/^(?:tools|functions)\./.test(target)) {
          const parsed = literal((node.arguments as unknown[])?.[0]);
          const call = fromInput(
            target.replace(/^(?:tools|functions)\./, ""),
            parsed,
          );
          call.dynamic =
            dynamic ||
            parsed === undefined ||
            Object.values(object(parsed)).some((v) => v === undefined);
          if (call.dynamic) unresolved = true;
          calls.push(call);
        }
      }
      for (const [key, child] of Object.entries(node))
        if (!["start", "end", "loc"].includes(key))
          visit(child, dynamic, depth + 1);
    }
    visit(ast);
  } catch {
    unresolved = true;
  }
  return { calls, wrapped: true, unresolved: unresolved || calls.length === 0 };
}
