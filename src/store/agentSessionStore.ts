import { create } from "zustand";

export type AgentSessionMode = "coach" | "do";
export type AgentSessionStatus =
  | "idle"
  | "observing"
  | "thinking"
  | "guiding"
  | "acting"
  | "waiting";

export interface CoachTarget {
  x: number;
  y: number;
  label: string;
  screenIndex: number;
}

export interface AgentSessionStep {
  instruction: string;
  expectedResult: string;
  target: CoachTarget | null;
  userTranscript: string;
  screenSignature: string;
  appName: string | null;
  observedAt: number;
}

export interface AgentSession {
  id: string;
  mode: AgentSessionMode;
  goal: string;
  appName: string | null;
  status: AgentSessionStatus;
  steps: AgentSessionStep[];
  workingMemory: string[];
  lastScreenSignature: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface StoredAgentTask {
  id: string;
  mode: AgentSessionMode;
  goal: string;
  appName: string | null;
  steps: AgentSessionStep[];
  workingMemory: string[];
  completedAt: number;
}

interface AgentSessionState {
  activeSession: AgentSession | null;
  storedTasks: StoredAgentTask[];
  startSession: (
    mode: AgentSessionMode,
    goal: string,
    appName?: string | null,
  ) => AgentSession;
  setSessionStatus: (status: AgentSessionStatus) => void;
  updateSessionApp: (appName: string | null) => void;
  appendSessionStep: (step: AgentSessionStep) => void;
  appendWorkingMemory: (memory: string) => void;
  completeSession: () => void;
  endSession: () => void;
  clearStoredTasks: () => void;
}

const STORAGE_KEY = "awaaz-agent-session-v1";
const MAX_STORED_TASKS = 20;

interface PersistedAgentSessionState {
  activeSession: AgentSession | null;
  storedTasks: StoredAgentTask[];
}

function loadPersistedState(): PersistedAgentSessionState {
  if (typeof window === "undefined") {
    return { activeSession: null, storedTasks: [] };
  }

  try {
    const rawState = window.localStorage.getItem(STORAGE_KEY);
    if (!rawState) {
      return { activeSession: null, storedTasks: [] };
    }
    const parsedState = JSON.parse(
      rawState,
    ) as Partial<PersistedAgentSessionState>;
    return {
      activeSession: parsedState.activeSession ?? null,
      storedTasks: Array.isArray(parsedState.storedTasks)
        ? parsedState.storedTasks.slice(0, MAX_STORED_TASKS)
        : [],
    };
  } catch {
    return { activeSession: null, storedTasks: [] };
  }
}

function persistState(state: AgentSessionState): void {
  if (typeof window === "undefined") {
    return;
  }

  const persistedState: PersistedAgentSessionState = {
    activeSession: state.activeSession,
    storedTasks: state.storedTasks.slice(0, MAX_STORED_TASKS),
  };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(persistedState));
  } catch {
    // Local storage is best-effort memory, not part of the critical path.
  }
}

const persistedInitialState = loadPersistedState();

export const useAgentSessionStore = create<AgentSessionState>((set) => ({
  activeSession: persistedInitialState.activeSession,
  storedTasks: persistedInitialState.storedTasks,
  startSession: (mode, goal, appName = null) => {
    const now = Date.now();
    const session: AgentSession = {
      id: crypto.randomUUID(),
      mode,
      goal,
      appName,
      status: "observing",
      steps: [],
      workingMemory: [],
      lastScreenSignature: null,
      createdAt: now,
      updatedAt: now,
    };
    set((state) => {
      const nextState = { ...state, activeSession: session };
      persistState(nextState);
      return nextState;
    });
    return session;
  },
  setSessionStatus: (status) =>
    set((state) => {
      if (!state.activeSession) {
        return state;
      }
      const nextState = {
        ...state,
        activeSession: {
          ...state.activeSession,
          status,
          updatedAt: Date.now(),
        },
      };
      persistState(nextState);
      return nextState;
    }),
  updateSessionApp: (appName) =>
    set((state) => {
      if (!state.activeSession || state.activeSession.appName === appName) {
        return state;
      }
      const nextState = {
        ...state,
        activeSession: {
          ...state.activeSession,
          appName,
          updatedAt: Date.now(),
        },
      };
      persistState(nextState);
      return nextState;
    }),
  appendSessionStep: (step) =>
    set((state) => {
      if (!state.activeSession) {
        return state;
      }
      const nextState = {
        ...state,
        activeSession: {
          ...state.activeSession,
          steps: [...state.activeSession.steps, step].slice(-24),
          lastScreenSignature: step.screenSignature,
          updatedAt: Date.now(),
        },
      };
      persistState(nextState);
      return nextState;
    }),
  appendWorkingMemory: (memory) => {
    const trimmedMemory = memory.trim();
    if (!trimmedMemory) {
      return;
    }
    set((state) => {
      if (!state.activeSession) {
        return state;
      }
      const nextState = {
        ...state,
        activeSession: {
          ...state.activeSession,
          workingMemory: [
            ...state.activeSession.workingMemory.slice(-8),
            trimmedMemory,
          ],
          updatedAt: Date.now(),
        },
      };
      persistState(nextState);
      return nextState;
    });
  },
  completeSession: () =>
    set((state) => {
      if (!state.activeSession) {
        return state;
      }
      const completedTask: StoredAgentTask = {
        id: state.activeSession.id,
        mode: state.activeSession.mode,
        goal: state.activeSession.goal,
        appName: state.activeSession.appName,
        steps: state.activeSession.steps,
        workingMemory: state.activeSession.workingMemory,
        completedAt: Date.now(),
      };
      const nextState = {
        ...state,
        activeSession: null,
        storedTasks: [completedTask, ...state.storedTasks].slice(
          0,
          MAX_STORED_TASKS,
        ),
      };
      persistState(nextState);
      return nextState;
    }),
  endSession: () =>
    set((state) => {
      const nextState = { ...state, activeSession: null };
      persistState(nextState);
      return nextState;
    }),
  clearStoredTasks: () =>
    set((state) => {
      const nextState = { ...state, storedTasks: [] };
      persistState(nextState);
      return nextState;
    }),
}));

export function getActiveAgentSession(): AgentSession | null {
  return useAgentSessionStore.getState().activeSession;
}

export function getStoredAgentTasks(): StoredAgentTask[] {
  return useAgentSessionStore.getState().storedTasks;
}
