import { serviceRequestStatusLabel, type ServiceRequestStatus } from "@despacho/shared";

const tone: Record<ServiceRequestStatus, string> = {
  open: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  assigned: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
  awaiting_client: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
  confirmed: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300",
  en_route: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300",
  arrived: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300",
  in_progress: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300",
  completed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  cancelled: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
};

export function StatusBadge({ status }: { status: ServiceRequestStatus }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${tone[status]}`}>
      {serviceRequestStatusLabel[status]}
    </span>
  );
}
