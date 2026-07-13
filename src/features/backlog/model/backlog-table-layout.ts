export const backlogTableMinWidth = 900;
export const backlogTableMinWidthClass = "min-w-[900px]";
export const backlogSkeletonGridClassName = "grid-cols-[48px_48px_2fr_120px_1.4fr_120px_100px_130px_110px]";

export const backlogTableColumns = [
  { id: "drag", label: "", skeletonWidth: "w-16" },
  { id: "rank", label: "#", skeletonWidth: "w-16" },
  { id: "title", label: "Titel", skeletonWidth: "w-16" },
  { id: "approval", label: "Freigabe", skeletonWidth: "w-16" },
  { id: "initiative", label: "Initiative", skeletonWidth: "w-16" },
  { id: "owner", label: "Zuständig", skeletonWidth: "w-16" },
  { id: "priority", label: "Priorität", skeletonWidth: "w-16" },
  { id: "readiness", label: "Bereitschaft", skeletonWidth: "w-16" },
  { id: "status", label: "Status", skeletonWidth: "w-16" },
] as const;

export const backlogTableColumnCount = backlogTableColumns.length;
