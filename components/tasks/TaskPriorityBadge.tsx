import { Badge } from "@/components/ui/badge";
import { isTaskPriority } from "@/lib/tasks/parse";

export function TaskPriorityBadge({ priority }: { priority: unknown }) {
  if (!isTaskPriority(priority)) return null;
  const label = `${priority[0].toUpperCase()}${priority.slice(1)} priority`;
  return (
    <Badge
      className="vault-md-task-priority"
      data-priority={priority}
      variant={
        priority === "high"
          ? "destructive"
          : priority === "medium"
            ? "secondary"
            : "outline"
      }
    >
      {label}
    </Badge>
  );
}
