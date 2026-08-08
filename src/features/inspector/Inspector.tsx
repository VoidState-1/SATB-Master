import { useState } from "react";
import { ProjectInspector } from "./ProjectInspector";
import { SelectionInspector } from "./SelectionInspector";
import { SoundInspector } from "./SoundInspector";
import type { InspectorProps } from "./types";

type InspectorTab = "selection" | "project" | "sound";

export type { InspectorProps } from "./types";

export function Inspector(props: InspectorProps) {
  const [tab, setTab] = useState<InspectorTab>("selection");

  return (
    <aside className="inspector">
      <div className="inspector-tabs" role="tablist">
        <button
          type="button"
          className={tab === "selection" ? "is-active" : ""}
          onClick={() => setTab("selection")}
        >
          属性
        </button>
        <button
          type="button"
          className={tab === "project" ? "is-active" : ""}
          onClick={() => setTab("project")}
        >
          工程
        </button>
        <button
          type="button"
          className={tab === "sound" ? "is-active" : ""}
          onClick={() => setTab("sound")}
        >
          音源
        </button>
      </div>

      <div className="inspector-content">
        {tab === "selection" ? <SelectionInspector {...props} /> : null}
        {tab === "project" ? <ProjectInspector {...props} /> : null}
        {tab === "sound" ? <SoundInspector {...props} /> : null}
      </div>
    </aside>
  );
}
