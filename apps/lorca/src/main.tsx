import { useEffect, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { LorcaShell } from "./ui/LorcaShell";
import { LorcaController } from "./core/controller";
import { createDemoBridge } from "./core/demo";
import type { LorcaBridge } from "./core/bridge";
import "@fontsource-variable/inter";
import "./styles.css";

const demo = new URLSearchParams(location.search).get("demo") === "1";
const unavailable: LorcaBridge = {
  getStatus: async () => ({
    status: "disconnected",
    endpoint: "ws://127.0.0.1:4862/ws",
    generation: 0,
    authMode: "token",
    detail: "Open the desktop app to connect securely to your local Lorca CLI.",
  }),
  connect: async () => {
    throw new Error(
      "The secure Lorca bridge is available in the desktop app. For a synthetic browser preview, add ?demo=1.",
    );
  },
  request: async () => {
    throw new Error("Desktop bridge unavailable.");
  },
  onEvent: () => () => {},
  onStatus: () => () => {},
};
const controller = new LorcaController(
  demo ? createDemoBridge() : (window.lorca ?? unavailable),
  demo,
);
function App() {
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
  );
  useEffect(() => {
    void controller.start();
    return () => controller.dispose();
  }, []);
  return <LorcaShell state={state} actions={controller.actions} />;
}
const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);
