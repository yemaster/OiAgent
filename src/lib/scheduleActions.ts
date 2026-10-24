import { toast } from "sonner";
import { call } from "./api";
import type { Detail, Task } from "./types";
import type { ScheduleRun } from "./schedules";
export async function openScheduledRun(
  run: ScheduleRun,
  onOpen: (task: Task) => void,
) {
  if (!run.taskId) return;
  try {
    const detail = await call<Detail>("get_detail", { id: run.taskId });
    onOpen(detail.task);
  } catch (error) {
    toast.error(String(error));
  }
}
