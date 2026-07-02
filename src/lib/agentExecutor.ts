import { invoke } from "@tauri-apps/api/core";
import type { AgentPlan, AgentPlanStep } from "./agentPlan";

export interface AgentStepExecutionPayload {
  stepType: string;
  target?: string;
  query?: string;
  text?: string;
  key?: string;
  durationMs?: number;
  titleIncludes?: string;
  role?: string;
  nameIncludes?: string;
  automationId?: string;
  controlId?: string;
  selector?: string;
  url?: string;
}

export async function executeAgentPlan(
  agentPlan: AgentPlan,
): Promise<string[]> {
  const errors: string[] = [];
  if (!agentPlan.shouldExecute) {
    return ["Planner marked this request as not executable."];
  }

  for (const step of agentPlan.steps) {
    try {
      await executeAgentStep(step);
    } catch (error) {
      errors.push(String(error));
      break;
    }
  }

  return errors;
}

export async function executeAgentStep(step: AgentPlanStep): Promise<void> {
  switch (step.type) {
    case "open_app":
    case "open_folder":
    case "open_url":
      await invoke("open_windows_target", {
        kind: step.type,
        query: step.target,
      });
      return;
    case "web_search":
      await invoke("open_windows_target", {
        kind: "web_search",
        query: step.query,
      });
      return;
    case "type_text":
      await invoke("open_windows_target", {
        kind: "type_text",
        query: step.text,
      });
      return;
    default:
      await invoke("execute_agent_step", {
        step: stepToExecutionPayload(step),
      });
  }
}

export function stepToExecutionPayload(
  step: AgentPlanStep,
): AgentStepExecutionPayload {
  switch (step.type) {
    case "wait_ms":
    case "browser_wait":
      return { stepType: step.type, durationMs: step.durationMs };
    case "press_key":
      return { stepType: step.type, key: step.key };
    case "wait_for_window":
      return {
        stepType: step.type,
        titleIncludes: step.titleIncludes,
        durationMs: step.timeoutMs,
      };
    case "find_control":
      return {
        stepType: step.type,
        role: step.role,
        nameIncludes: step.nameIncludes,
        automationId: step.automationId,
      };
    case "click_control":
      return { stepType: step.type, controlId: step.controlId };
    case "set_value":
      return {
        stepType: step.type,
        controlId: step.controlId,
        text: step.text,
      };
    case "browser_open":
      return { stepType: step.type, url: step.url };
    case "browser_snapshot":
      return { stepType: step.type };
    case "browser_click":
      return { stepType: step.type, selector: step.selector, text: step.text };
    case "browser_type":
      return { stepType: step.type, selector: step.selector, text: step.text };
    case "open_app":
    case "open_folder":
    case "open_url":
      return { stepType: step.type, target: step.target };
    case "web_search":
      return { stepType: step.type, query: step.query };
    case "type_text":
      return { stepType: step.type, text: step.text };
  }
}
