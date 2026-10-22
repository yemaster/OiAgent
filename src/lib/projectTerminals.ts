import { newerTask } from "./taskState";
import { isActive, type Task } from "./types";

export type TerminalGroup = {
  id: string;
  number: number;
  panes: string[];
  focused: string;
};
export type TerminalWorkspace = {
  groups: TerminalGroup[];
  selected?: string;
  nextNumber: number;
};
export type ProjectTerminals = {
  projects: Record<string, TerminalWorkspace>;
  sessions: Record<string, Task>;
  retired: Record<string, true>;
};
export const emptyTerminalWorkspace: TerminalWorkspace = {
  groups: [],
  nextNumber: 1,
};
export const emptyProjectTerminals: ProjectTerminals = {
  projects: {},
  sessions: {},
  retired: {},
};
type Action =
  | { type: "begin"; project: string }
  | { type: "update"; task: Task }
  | { type: "started"; task: Task; project: string; splitGroup?: string }
  | { type: "select"; project: string; group: string }
  | { type: "focus"; project: string; group: string; pane: string }
  | { type: "ungroup"; project: string; group: string };

/** Exit is final for a PTY id, even when a launch/stop reply arrives after its exit event. */
export function projectTerminalsReducer(
  state: ProjectTerminals,
  action: Action,
): ProjectTerminals {
  if (action.type === "begin")
    return state.projects[action.project]
      ? state
      : {
          ...state,
          projects: {
            ...state.projects,
            [action.project]: emptyTerminalWorkspace,
          },
        };
  if (action.type === "update" || action.type === "started") {
    const incoming = action.task;
    if (state.retired[incoming.id]) return state;
    const task = newerTask(state.sessions[incoming.id] || incoming, incoming);
    if (!isActive(task)) {
      const sessions = { ...state.sessions };
      delete sessions[task.id];
      const projects = { ...state.projects };
      for (const [path, workspace] of Object.entries(projects)) {
        if (!workspace.groups.some((group) => group.panes.includes(task.id)))
          continue;
        const groups = workspace.groups.flatMap((group) => {
          if (!group.panes.includes(task.id)) return [group];
          const panes = group.panes.filter((id) => id !== task.id);
          return panes.length
            ? [
                {
                  ...group,
                  panes,
                  focused: group.focused === task.id ? panes[0] : group.focused,
                },
              ]
            : [];
        });
        const previousIndex = workspace.groups.findIndex(
          (group) => group.id === workspace.selected,
        );
        projects[path] = {
          ...workspace,
          groups,
          selected: groups.some((group) => group.id === workspace.selected)
            ? workspace.selected
            : groups[Math.max(0, previousIndex - 1)]?.id || groups[0]?.id,
        };
      }
      return {
        projects,
        sessions,
        retired: { ...state.retired, [task.id]: true },
      };
    }
    const next = { ...state, sessions: { ...state.sessions, [task.id]: task } };
    if (action.type === "update") return next;
    const workspace = state.projects[action.project] || emptyTerminalWorkspace;
    if (workspace.groups.some((group) => group.panes.includes(task.id)))
      return next;
    const target = workspace.groups.find(
      (group) => group.id === action.splitGroup,
    );
    const group: TerminalGroup = {
      id: task.id,
      number: workspace.nextNumber,
      panes: [task.id],
      focused: task.id,
    };
    return {
      ...next,
      projects: {
        ...state.projects,
        [action.project]: target
          ? {
              ...workspace,
              groups: workspace.groups.map((group) =>
                group.id === target.id
                  ? {
                      ...group,
                      panes: [...group.panes, task.id],
                      focused: task.id,
                    }
                  : group,
              ),
            }
          : {
              groups: [...workspace.groups, group],
              selected: group.id,
              nextNumber: workspace.nextNumber + 1,
            },
      },
    };
  }
  const workspace = state.projects[action.project];
  const group = workspace?.groups.find((group) => group.id === action.group);
  if (!workspace || !group) return state;
  let next = workspace;
  if (action.type === "select") next = { ...workspace, selected: group.id };
  if (action.type === "focus" && group.panes.includes(action.pane)) {
    next = {
      ...workspace,
      groups: workspace.groups.map((item) =>
        item.id === group.id ? { ...item, focused: action.pane } : item,
      ),
    };
  }
  if (action.type === "ungroup" && group.panes.length > 1) {
    let number = workspace.nextNumber;
    const groups = group.panes.map((pane, index) => ({
      id: index === 0 ? group.id : pane,
      panes: [pane],
      focused: pane,
      number: index === 0 ? group.number : number++,
    }));
    next = {
      groups: workspace.groups.flatMap((item) =>
        item.id === group.id ? groups : [item],
      ),
      selected: groups.find((item) => item.focused === group.focused)?.id,
      nextNumber: number,
    };
  }
  return { ...state, projects: { ...state.projects, [action.project]: next } };
}
