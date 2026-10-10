import type { Project } from "./schema";

const creationTime = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

// Keep saved names intact; give existing unnamed projects useful identity too.
export function projectLabel(project: Pick<Project, "name" | "created_at">) {
  if (project.name !== "Untitled project") return project.name;
  const created = new Date(project.created_at);
  return Number.isNaN(created.getTime())
    ? project.name
    : `${project.name} · ${creationTime.format(created)}`;
}
