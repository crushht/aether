import type { WorkflowTrigger } from './types';

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  prompt: string;
  trigger: WorkflowTrigger;
  createIssue: boolean;
  maxSteps: number;
}

/** Three sensible starting points; everything stays editable after applying. */
export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    id: 'cycle-check',
    name: '周期体检',
    description: '检查进行中的议题，标出阻塞、逾期与无人负责的条目',
    prompt:
      '检查当前工作区中状态为进行中的议题，列出需要关注的事项（阻塞、逾期、缺少负责人），用两句话总结。',
    trigger: { kind: 'daily', hour: 9 },
    createIssue: true,
    maxSteps: 6,
  },
  {
    id: 'release-notes',
    name: '发布说明',
    description: '汇总本周期已完成的议题，生成可直接发布的说明',
    prompt:
      '汇总当前周期内已完成的议题，按主题归类，写一段可直接贴到发布说明里的中文小结，不要编造未完成的内容。',
    trigger: { kind: 'weekly', weekday: 5, hour: 17 },
    createIssue: true,
    maxSteps: 6,
  },
  {
    id: 'risk-scan',
    name: '风险扫描',
    description: '找出长期未更新、缺少负责人或描述的议题',
    prompt:
      '扫描所有未完成议题：找出长期没有更新、没有负责人或缺少描述的条目，按风险高低列出，并给出下一步建议。',
    trigger: { kind: 'daily', hour: 10 },
    createIssue: false,
    maxSteps: 8,
  },
];
