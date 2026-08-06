export type BuyerTask = Readonly<{
  id: string;
  priority: number;
  title: string;
  detail: string;
  href: string;
  deadline: number | null;
}>;

export function rankBuyerTasks(tasks: readonly BuyerTask[]): readonly BuyerTask[] {
  const unique = new Map<string, BuyerTask>();
  for (const task of tasks) {
    const current = unique.get(task.id);
    if (!current || compareTasks(task, current) < 0) unique.set(task.id, task);
  }
  return [...unique.values()].sort(compareTasks);
}

function compareTasks(left: BuyerTask, right: BuyerTask): number {
  if (left.priority !== right.priority) return left.priority - right.priority;
  if (left.deadline !== null || right.deadline !== null) {
    if (left.deadline === null) return 1;
    if (right.deadline === null) return -1;
    if (left.deadline !== right.deadline) return left.deadline - right.deadline;
  }
  return left.id.localeCompare(right.id);
}
