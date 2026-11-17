export interface NavigationHistoryState {
  cursor: number;
  stack: string[];
}

export function createNavigationHistory(
  initialPath: string,
): NavigationHistoryState {
  return { cursor: 0, stack: [initialPath] };
}

export function applyNavigation(
  state: NavigationHistoryState,
  path: string,
  type: "PUSH" | "POP" | "REPLACE",
): NavigationHistoryState {
  if (type === "PUSH") {
    const stack = [...state.stack.slice(0, state.cursor + 1), path];
    return { stack, cursor: stack.length - 1 };
  }

  if (type === "REPLACE") {
    const stack = [...state.stack];
    stack[state.cursor] = path;
    return { ...state, stack };
  }

  const previous = state.stack[state.cursor - 1];
  if (previous === path) {
    return { ...state, cursor: state.cursor - 1 };
  }

  const next = state.stack[state.cursor + 1];
  if (next === path) {
    return { ...state, cursor: state.cursor + 1 };
  }

  return state;
}

export function canNavigateBack(state: NavigationHistoryState): boolean {
  return state.cursor > 0;
}

export function canNavigateForward(state: NavigationHistoryState): boolean {
  return state.cursor < state.stack.length - 1;
}
