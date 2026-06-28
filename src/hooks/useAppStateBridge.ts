import { emit, listen } from "@tauri-apps/api/event";
import { useEffect } from "react";
import {
  APP_STATE_REQUESTED_EVENT,
  APP_STATE_UPDATED_EVENT,
} from "../lib/appEvents";
import { type AppSnapshot, useAppStore } from "../store/appStore";

export function useAppStateBridge(): void {
  useEffect(() => {
    const unlistenPromise = listen<AppSnapshot>(
      APP_STATE_UPDATED_EVENT,
      (event) => {
        useAppStore.getState().hydrateSnapshot(event.payload);
      },
    );
    void emit(APP_STATE_REQUESTED_EVENT);

    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);
}
