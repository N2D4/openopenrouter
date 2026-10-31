import { useState } from "react";
import { CopyButton } from "./lib";

export function CodeTabs({ tabs }: { tabs: Record<string, string> }) {
  const names = Object.keys(tabs);
  const [active, setActive] = useState(names[0]);
  return (
    <div>
      <div className="row">
        <div className="tabs" role="tablist">
          {names.map((n) => (
            <button key={n} type="button" role="tab" aria-selected={n === active} className={n === active ? "active" : ""} onClick={() => setActive(n)}>
              {n}
            </button>
          ))}
        </div>
        <span className="spacer" />
        <CopyButton text={tabs[active]} />
      </div>
      <pre>
        <code>{tabs[active]}</code>
      </pre>
    </div>
  );
}
