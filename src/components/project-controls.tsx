"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, Layers2 } from "lucide-react";

export function ProjectControls({
  working,
  children,
}: {
  working: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(!working);
  return (
    <details
      className="project-controls"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <Layers2 size={15} aria-hidden="true" />
        Project controls
        <ChevronDown size={15} aria-hidden="true" />
      </summary>
      {children}
    </details>
  );
}
