'use client';

import * as React from 'react';
import { BookOpen, ChevronRight, MessageSquarePlus, Plus, Sparkles } from 'lucide-react';
import { useData } from '@/lib/store/data';
import { useWorkspace } from '@/lib/agent/workspace';
import { useChats } from '@/lib/agent/chats';
import { useUI } from '@/lib/store/ui';
import { useT } from '@/lib/use-t';
import { Button } from '@/components/ui/primitives';
import { relativeTime } from '@/lib/utils';

export function ProjectSpace({ projectId }: { projectId: string }) {
  const t = useT();
  const project = useData((state) => state.projects.find((item) => item.id === projectId));
  const updateProject = useData((state) => state.updateProject);
  const knowledge = useWorkspace((state) => state.knowledge);
  const allChats = useChats((state) => state.chats);
  const projectChats = React.useMemo(
    () => allChats.filter((chat) => chat.projectId === projectId && !chat.archivedAt),
    [allChats, projectId],
  );
  const create = useChats((state) => state.newChat);
  const select = useChats((state) => state.select);
  const [editing, setEditing] = React.useState(false);
  const [instructions, setInstructions] = React.useState('');
  const [picker, setPicker] = React.useState(false);
  if (!project) return null;

  const start = () => {
    create({ projectId });
    useUI.getState().openChat(projectId);
  };
  const selectKnowledge = (id: string) => {
    const current = project.knowledgeIds ?? [];
    updateProject(projectId, { knowledgeIds: current.includes(id) ? current.filter((item) => item !== id) : [...current, id] });
  };

  return (
    <section data-project-space className="mt-6 rounded-r10 bg-[var(--bg-elevated)] shadow-[inset_0_0_0_1px_var(--line-subtle)]">
      <div className="flex h-[48px] items-center gap-2 border-b border-[var(--line-subtle)] px-3.5">
        <Sparkles size={14} className="text-[var(--accent)]" />
        <h2 className="text-[14px] font-[590] text-t1">{t('Project agent')}</h2>
        <span className="text-[12px] text-t4">{t('Chats, instructions and knowledge stay with this project')}</span>
        <span className="flex-1" />
        <Button variant="secondary" size="sm" onClick={start} className="gap-1.5"><MessageSquarePlus size={13} />{t('New project chat')}</Button>
      </div>
      <div className="grid md:grid-cols-[1.2fr_.8fr]">
        <div className="min-w-0 p-3.5">
          <div className="flex items-center gap-2">
            <h3 className="text-[12.5px] font-[510] text-t3">{t('Project instructions')}</h3>
            <button className="ml-auto text-[12px] text-t4 hover:text-t1" onClick={() => { setInstructions(project.agentInstructions ?? ''); setEditing(!editing); }}>{editing ? t('Cancel') : t('Edit')}</button>
          </div>
          {editing ? (
            <div className="mt-2 rounded-r8 bg-panel p-2 shadow-[inset_0_0_0_1px_var(--line)]">
              <textarea data-project-instructions autoFocus value={instructions} onChange={(event) => setInstructions(event.target.value)} placeholder={t('Tell the agent how to work on this project…')} className="min-h-[76px] w-full resize-y bg-transparent px-1 text-[13px] leading-[1.6] text-t2 outline-none placeholder:text-t4" />
              <div className="flex justify-end"><Button variant="primary" size="sm" onClick={() => { updateProject(projectId, { agentInstructions: instructions.trim() }); setEditing(false); }}>{t('Save')}</Button></div>
            </div>
          ) : <p className="mt-2 whitespace-pre-wrap text-[13px] leading-[1.6] text-t4">{project.agentInstructions || t('Add instructions to guide every conversation in this project.')}</p>}
          <div className="mt-4">
            <div className="mb-1.5 flex items-center gap-2"><h3 className="text-[12.5px] font-[510] text-t3">{t('Recent project chats')}</h3><span className="text-[11px] text-t4">{projectChats.length}</span></div>
            {projectChats.slice(0, 4).map((chat) => <button key={chat.id} onClick={() => { select(chat.id); useUI.getState().openChat(projectId); }} className="group flex h-[32px] w-full items-center gap-2 rounded-r6 px-1.5 text-left text-[13px] text-t2 hover:bg-[var(--bg-hover)]"><MessageSquarePlus size={12} className="text-t4" /><span className="min-w-0 flex-1 truncate">{chat.title || t('New conversation')}</span><span className="text-[11px] text-t4">{relativeTime(new Date(chat.at).toISOString())}</span><ChevronRight size={12} className="text-t4 opacity-0 group-hover:opacity-100" /></button>)}
            {!projectChats.length ? <button onClick={start} className="flex h-[32px] items-center gap-1.5 rounded-r6 px-1.5 text-[12.5px] text-t4 hover:bg-[var(--bg-hover)] hover:text-t2"><Plus size={12} />{t('Ask about this project')}</button> : null}
          </div>
        </div>
        <div className="border-t border-[var(--line-subtle)] p-3.5 md:border-l md:border-t-0">
          <div className="flex items-center gap-2"><BookOpen size={12} className="text-t4" /><h3 className="text-[12.5px] font-[510] text-t3">{t('Knowledge for this project')}</h3><span className="ml-auto text-[11px] text-t4">{project.knowledgeIds?.length ?? 0}</span></div>
          <p className="mt-2 text-[12px] leading-[1.55] text-t4">{t('Selected entries are prioritized in project conversations.')}</p>
          <button onClick={() => setPicker(!picker)} className="mt-2 text-[12.5px] text-[var(--accent)] hover:underline">{t('Choose knowledge')}</button>
          {picker ? <div className="scroll-container mt-2 max-h-[180px] overflow-y-auto rounded-r6 bg-panel p-1 shadow-[inset_0_0_0_1px_var(--line)]">{knowledge.map((item) => <label key={item.id} className="flex cursor-pointer items-center gap-2 rounded-r4 px-2 py-1.5 text-[12.5px] text-t2 hover:bg-[var(--bg-hover)]"><input type="checkbox" checked={project.knowledgeIds?.includes(item.id) ?? false} onChange={() => selectKnowledge(item.id)} /><span className="truncate">{item.title}</span></label>)}{!knowledge.length ? <p className="p-2 text-[12px] text-t4">{t('No knowledge entries yet.')}</p> : null}</div> : null}
        </div>
      </div>
    </section>
  );
}
