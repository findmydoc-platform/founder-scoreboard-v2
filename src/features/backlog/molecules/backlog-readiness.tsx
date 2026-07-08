import type { BacklogItem } from "@/features/backlog/model/backlog-view-model";

export function BacklogReadiness({ item }: { item: BacklogItem }) {
  return (
    <div className="flex items-center gap-1.5">
      {item.readiness.map((chip) => (
        <span
          key={chip.id}
          title={chip.id === "owner" ? "Zuständigkeit" : chip.id === "initiative" ? "Initiative" : "Sprint"}
          className={`grid h-6 w-6 place-items-center rounded-md border text-[11px] font-bold ${
            chip.ready ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-white text-slate-400"
          }`}
        >
          {chip.label}
        </span>
      ))}
    </div>
  );
}
