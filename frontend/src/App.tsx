/**
 * Root application component — desktop-first dashboard layout shell (Task 12.1,
 * Req 15).
 *
 * Assembles the layout: a full-width top toolbar, a middle row splitting into a
 * fixed-width left sidebar, a flex-grow center map (largest space, Req 15.3),
 * and a fixed-width right sidebar, followed by a bottom tab strip. Engine health
 * is refreshed on mount (Req 16.5); the probe is resilient and never throws, so
 * the dashboard stays usable even when engines are unreachable.
 */
import { useEffect, useState } from "react";
import "./App.css";
import Toolbar from "./components/Toolbar";
import LeftSidebar from "./components/LeftSidebar";
import MapView from "./components/MapView";
import RightSidebar from "./components/RightSidebar";
import BottomTabs from "./components/BottomTabs";
import { useStore } from "./store";
import TraceInspector from "./components/TraceInspector";

type Screen = "comparison" | "trace";

export default function App() {
  const refreshHealth = useStore((s) => s.refreshHealth);
  const [screen, setScreen] = useState<Screen>("comparison");

  useEffect(() => {
    void refreshHealth();
  }, [refreshHealth]);

  return (
    <div className="app-shell">
      <nav className="app-nav" aria-label="Dashboard screens">
        <button
          type="button"
          className={screen === "comparison" ? "app-nav__active" : ""}
          aria-current={screen === "comparison" ? "page" : undefined}
          onClick={() => setScreen("comparison")}
        >
          Route Comparison
        </button>
        <button
          type="button"
          className={screen === "trace" ? "app-nav__active" : ""}
          aria-current={screen === "trace" ? "page" : undefined}
          onClick={() => setScreen("trace")}
        >
          Trace Inspector
        </button>
      </nav>
      {screen === "comparison" ? (
        <div className="comparison-screen">
          <Toolbar />
          <div className="middle-row">
            <LeftSidebar />
            <MapView />
            <RightSidebar />
          </div>
          <BottomTabs />
        </div>
      ) : (
        <TraceInspector />
      )}
    </div>
  );
}
