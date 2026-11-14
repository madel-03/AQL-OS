export function describeTaskPlan(plan, en, name) {
  const task = plan.task;
  return en ? `${plan.action === 'complete' ? 'Complete' : 'Add'} task: ${task.title}. ${task.due_date ? `Due ${task.due_date}.` : 'No deadline.'} Not executed yet. Say Hey ${name}, confirm task.` : `${plan.action === 'complete' ? 'إنجاز' : 'إضافة'} مهمة: ${task.title}. ${task.due_date ? `الاستحقاق ${task.due_date}.` : 'بدون موعد استحقاق.'} لم أنفّذ بعد. قل يا ${name}، أكّد المهمة.`;
}
