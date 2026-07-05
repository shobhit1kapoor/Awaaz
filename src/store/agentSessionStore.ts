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
  updatedAt: number;
}

interface AgentSessionState {
  activeSession: AgentSession | null;
  startSession: (
    mode: AgentSessionMode,
    goal: string,
    appName?: string | null,
  ) => AgentSession;
  setSessionStatus: (status: AgentSessionStatus) => void;
  appendSessionStep: (step: AgentSessionStep) => void;
  appendWorkingMemory: (memory: string) => void;
  endSession: () => void;
}

export const useAgentSessionStore = create<AgentSessionState>((set) => ({
  activeSession: null,
  startSession: (mode, goal, appName = null) => {
    const session: AgentSession = {
      id: crypto.randomUUID(),
      mode,
      goal,
      appName,
      status: "observing",
      steps: [],
      workingMemory: [],
      updatedAt: Date.now(),
    };
    set({ activeSession: session });
    return session;
  },
  setSessionStatus: (status) =>
    set((state) =>
      state.activeSession
        ? {
            activeSession: {
              ...state.activeSession,
              status,
              updatedAt: Date.now(),
            },
          }
        : state,
    ),
  appendSessionStep: (step) =>
    set((state) =>
      state.activeSession
        ? {
            activeSession: {
              ...state.activeSession,
              steps: [...state.activeSession.steps, step],
              updatedAt: Date.now(),
            },
          }
        : state,
    ),
  appendWorkingMemory: (memory) => {
    const trimmedMemory = memory.trim();
    if (!trimmedMemory) {
      return;
    }
    set((state) =>
      state.activeSession
        ? {
            activeSession: {
              ...state.activeSession,
              workingMemory: [
                ...state.activeSession.workingMemory.slice(-8),
                trimmedMemory,
              ],
              updatedAt: Date.now(),
            },
          }
        : state,
    );
  },
  endSession: () => set({ activeSession: null }),
}));

export function getActiveAgentSession(): AgentSession | null {
  return useAgentSessionStore.getState().activeSession;
}
