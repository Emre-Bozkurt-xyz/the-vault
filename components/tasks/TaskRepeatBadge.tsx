import { Badge } from "@/components/ui/badge";
import { Repeat } from "lucide-react";
import { parseRecurrence } from "@/lib/tasks/recurrence";

export function TaskRepeatBadge({
  repeat,
}: {
  repeat: string | null | undefined;
}) {
  if (!repeat || !parseRecurrence(repeat)) return null;
  return (
    <Badge
      variant="outline"
      className="vault-md-task-repeat"
      title={`Repeats ${repeat}`}
    >
      <Repeat aria-hidden="true" />
      {repeat}
    </Badge>
  );
}
