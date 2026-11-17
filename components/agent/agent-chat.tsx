'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowUp,
  Box,
  Download,
  Globe,
  History,
  Loader2,
  Paperclip,
  Pencil,
  Pin,
  Plus,
  Search,
  Sparkles,
  Square,
  Trash2,
  X,
  Mic,
  MicOff,
} from 'lucide-react';
import { estimateTokens, useAgent } from '@/lib/agent/store';
import { useToolApprovals } from '@/lib/store/tool-approvals';
import { useChatInputHistory } from '@/lib/store/chat-input-history';
import { chatKey, useChats } from '@/lib/agent/chats';
import { FIELD_LABEL, useValueLabel } from '@/components/agent/agent-panel';
import { useUI } from '@/lib/store/ui';
import { useData } from '@/lib/store/data';
import { useView } from '@/lib/store/view';
import { useModelTarget, isModelReady, useWorkspace } from '@/lib/agent/workspace';
import { useT } from '@/lib/use-t';
import { cn, relativeTime, isImeComposing } from '@/lib/utils';
import { Button } from '@/components/ui/primitives';
import type { AgentAttachment, AgentLogEntry } from '@/lib/agent/types';
import { readDraft, removeDraft, writeDraft } from '@/lib/agent/drafts';
import { useDocuments } from '@/lib/store/documents';
import { AttachmentChips, ContextMeter, FinalAnswer, StepGroup, UserBubble } from './chat/transcript';
import { ModelChip, ModelMenu } from './chat/model-picker';
import { useVoiceInput } from './chat/use-voice-input';

const EASE = [0.25, 0.46, 0.45, 0.94] as const;

const MAX_FILE = 1_500_000;
const MAX_IMAGE = 4_000_000;
const MAX_FILE_TEXT = 20_000;

const readAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });



/**
 * Workspace-level agent: the same tools and approval flow as the issue panel,
 * with the affordances of a chat product — conversation list, attachments,
 * model + context indicators, stop / retry / rename / pin.
 */
export function AgentChat() {
  const t = useT();
  const router = useRouter();
  const open = useUI((s) => s.chatOpen);
  const closeChat = useUI((s) => s.closeChat);
  const pushToast = useUI((s) => s.pushToast);
  const issues = useData((s) => s.issues);

  const chats = useChats((s) => s.chats);
  const activeId = useChats((s) => s.activeId);
  const chatsHydrated = useChats((s) => s.hydrated);
  const hydrateChats = useChats((s) => s.hydrate);
  const newChat = useChats((s) => s.newChat);
  const createChat = () => newChat({ projectId: useUI.getState().chatProjectId });
  const selectChat = useChats((s) => s.select);
  const removeChat = useChats((s) => s.remove);
  const titleChat = useChats((s) => s.title);
  const renameChat = useChats((s) => s.rename);
  const togglePin = useChats((s) => s.togglePin);

  const hydrateAgent = useAgent((s) => s.hydrate);
  const run = useAgent((s) => s.run);
  const cancel = useAgent((s) => s.cancel);
  const reset = useAgent((s) => s.reset);
  const retry = useAgent((s) => s.retry);
  const retryTool = useAgent((s) => s.retryTool);
  const approve = useAgent((s) => s.approve);
  const reject = useAgent((s) => s.reject);
  const toIssue = useAgent((s) => s.toIssue);
  const rewind = useAgent((s) => s.rewind);
  const branch = useAgent((s) => s.branch);
  const setFeedback = useAgent((s) => s.setFeedback);
  const sessions = useAgent((s) => s.sessions);
  const addKnowledge = useWorkspace((s) => s.addKnowledge);
  const createDocument = useDocuments((s) => s.create);
  const valueLabel = useValueLabel();
  const target = useModelTarget('chat');
  const ready = isModelReady(target);

  const key = activeId ? chatKey(activeId) : null;
  const session = useAgent((s) => (key ? s.sessions[key] : undefined));

  const [value, setValue] = React.useState('');
  const [historyIndex, setHistoryIndex] = React.useState(-1);
  const [attachments, setAttachments] = React.useState<AgentAttachment[]>([]);
  const [webOpen, setWebOpen] = React.useState(false);
  const [webUrl, setWebUrl] = React.useState('');
  const [webBusy, setWebBusy] = React.useState(false);
  const [modelMenuOpen, setModelMenuOpen] = React.useState(false);
  const [runsOpen, setRunsOpen] = React.useState(false);
  const [confirmClear, setConfirmClear] = React.useState(false);
  const [fileBusy, setFileBusy] = React.useState(false);
  const [dragging, setDragging] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [renaming, setRenaming] = React.useState<string | null>(null);
  const [renameValue, setRenameValue] = React.useState('');
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLTextAreaElement>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const seeded = React.useRef(false);
  const initialProjectId = useUI((s) => s.chatProjectId);
  const activeProjectId = useChats((s) => s.chats.find((chat) => chat.id === activeId)?.projectId);
  const activeIdRef = React.useRef(activeId);
  const draftLoadedRef = React.useRef<string | null>(null);

  React.useEffect(() => { activeIdRef.current = activeId; }, [activeId]);

  React.useEffect(() => {
    if (!open) return;
    hydrateChats();
    void hydrateAgent();
  }, [open, hydrateChats, hydrateAgent]);

  React.useEffect(() => {
    if (!open) {
      seeded.current = false;
      return;
    }
    if (!chatsHydrated || activeId || seeded.current) return;
    // one blank conversation at most: remounts and StrictMode both re-run effects
    seeded.current = true;
    const blank = chats.find((chat) => !chat.title);
    if (blank) selectChat(blank.id);
    else newChat({ projectId: initialProjectId });
  }, [open, chatsHydrated, activeId, chats, newChat, selectChat, initialProjectId]);

  React.useEffect(() => {
    if (!open) return;
    const node = scrollRef.current;
    if (node) node.scrollTo({ top: node.scrollHeight, behavior: 'smooth' });
  }, [open, session?.log.length, session?.status]);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        closeChat();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, closeChat]);

  React.useEffect(() => {
    if (!open || !activeId) return;
    draftLoadedRef.current = activeId;
    const draft = readDraft(activeId);
    setValue(draft.text);
    setAttachments(draft.attachments);
    window.setTimeout(() => inputRef.current?.focus(), 120);
  }, [open, activeId]);

  React.useEffect(() => {
    if (!activeId || draftLoadedRef.current !== activeId) return;
    const id = activeId;
    const timer = window.setTimeout(() => {
      if (activeIdRef.current === id) writeDraft(id, value, attachments);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [activeId, value, attachments]);

  /** Always flush the outgoing conversation before switching, so a slow
   *  debounce can never write this conversation's text onto another key. */
  const switchChat = (id: string) => {
    if (activeId && activeId !== id) writeDraft(activeId, value, attachments);
    draftLoadedRef.current = null;
    selectChat(id);
  };

  const running = session?.status === 'running';
  const waiting = session?.status === 'waiting';
  const pending = session?.pending ?? null;
  const log = React.useMemo(() => session?.log ?? [], [session?.log]);

  /** Group each assistant turn + its tool calls into one collapsible step. */
  const timeline = React.useMemo(() => {
    const out: Array<
      { kind: 'entry'; item: AgentLogEntry } | { kind: 'step'; items: AgentLogEntry[]; index: number }
    > = [];
    let stepItems: AgentLogEntry[] = [];
    let stepIndex = 0;
    const flush = () => {
      if (!stepItems.length) return;
      stepIndex += 1;
      out.push({ kind: 'step', items: stepItems, index: stepIndex });
      stepItems = [];
    };
    for (const item of log) {
      if (item.kind === 'user' || item.kind === 'final') {
        flush();
        out.push({ kind: 'entry', item });
        continue;
      }
      if (item.kind === 'assistant' && stepItems.some((entry) => entry.kind === 'assistant')) flush();
      stepItems.push(item);
    }
    flush();
    return out;
  }, [log]);
  const lastStep = timeline.reduce((max, node) => (node.kind === 'step' ? Math.max(max, node.index) : max), 0);
  const billed = session?.usage ? session.usage.promptTokens + session.usage.completionTokens : 0;
  const used = session?.messages.reduce((sum, message) => sum + estimateTokens(message.content), 0) ?? 0;
  const visibleChats = query.trim()
    ? chats.filter((chat) => {
        const needle = query.trim().toLowerCase();
        if ((chat.title || t('New conversation')).toLowerCase().includes(needle)) return true;
        const session = sessions[chatKey(chat.id)];
        return Boolean(session?.log.some((entry) => entry.text.toLowerCase().includes(needle)));
      })
    : chats;

  const voice = useVoiceInput((text) => {
    setValue((current) => (current ? `${current} ${text}` : text));
    window.setTimeout(() => inputRef.current?.focus(), 30);
  });

  React.useEffect(() => {
    useChatInputHistory.getState().hydrate();
  }, []);

  const send = (text = value) => {
    const prompt = text.trim();
    if (!prompt || !activeId || running || waiting) return;
    // two local commands, handled before the model sees anything
    if (prompt === '/clear') {
      setValue('');
      setAttachments([]);
      reset(chatKey(activeId));
      return;
    }
    if (prompt === '/new') {
      setValue('');
      setAttachments([]);
      createChat();
      return;
    }
    useChatInputHistory.getState().push(prompt);
    setHistoryIndex(-1);
    setValue('');
    setAttachments([]);
    removeDraft(activeId);
    titleChat(activeId, prompt);
    void run(chatKey(activeId), prompt, attachments);
  };

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setFileBusy(true);
    const next: AgentAttachment[] = [];
    for (const file of Array.from(files).slice(0, 4)) {
      try {
        if (file.type.startsWith('image/')) {
          if (file.size > MAX_IMAGE) {
            pushToast({ title: t('That image is too large'), description: file.name, tone: 'danger' });
            continue;
          }
          next.push({
            id: `att_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
            name: file.name,
            kind: 'image',
            mime: file.type,
            size: file.size,
            dataUrl: await readAsDataUrl(file),
          });
        } else if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
          if (file.size > 12_000_000) {
            pushToast({ title: t('That file is too large'), description: file.name, tone: 'danger' });
            continue;
          }
          const dataUrl = await readAsDataUrl(file);
          const response = await fetch('/api/agent/extract', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: file.name, mime: file.type, data: dataUrl.split(',')[1] ?? '' }),
          });
          const json = (await response.json()) as { ok?: boolean; text?: string; note?: string; error?: string };
          if (!json.ok || !json.text) {
            pushToast({
              title: t('No selectable text in that PDF'),
              description: json.note ?? json.error,
              tone: 'danger',
            });
            continue;
          }
          next.push({
            id: `att_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
            name: file.name,
            kind: 'file',
            mime: file.type,
            size: file.size,
            text: `[PDF] ${json.text}`.slice(0, MAX_FILE_TEXT),
          });
        } else {
          if (file.size > MAX_FILE) {
            pushToast({ title: t('That file is too large'), description: file.name, tone: 'danger' });
            continue;
          }
          const text = await file.text();
          next.push({
            id: `att_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
            name: file.name,
            kind: 'file',
            mime: file.type,
            size: file.size,
            text: text.slice(0, MAX_FILE_TEXT),
          });
        }
      } catch {
        pushToast({ title: t('Could not read {name}', { name: file.name }), tone: 'danger' });
      }
    }
    if (next.length) setAttachments((current) => [...current, ...next].slice(0, 6));
    setFileBusy(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  const readPage = async () => {
    const url = webUrl.trim();
    if (!url || webBusy) return;
    setWebBusy(true);
    try {
      const response = await fetch('/api/agent/fetch-page', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const json = (await response.json()) as { ok?: boolean; error?: string; page?: { title: string; text: string; url: string; chars: number } };
      if (!json.ok || !json.page) {
        pushToast({ title: t('Could not read that page'), description: json.error, tone: 'danger' });
        return;
      }
      setAttachments((current) =>
        [
          ...current,
          {
            id: `att_${Date.now()}`,
            name: json.page!.title,
            kind: 'web' as const,
            url: json.page!.url,
            size: json.page!.chars,
            text: json.page!.text.slice(0, 30_000),
          },
        ].slice(0, 6),
      );
      setWebUrl('');
      setWebOpen(false);
    } catch {
      pushToast({ title: t('Could not read that page'), tone: 'danger' });
    } finally {
      setWebBusy(false);
    }
  };

  const exportJson = () => {
    const chat = chats.find((item) => item.id === activeId);
    const payload = {
      id: activeId,
      title: chat?.title ?? '',
      at: chat?.at,
      provider: target?.providerName ?? '',
      model: target?.model ?? '',
      usage: session?.usage ?? null,
      runs: session?.runs ?? [],
      log: log.map((entry) => ({
        kind: entry.kind,
        text: entry.text,
        name: entry.name,
        ok: entry.ok,
        at: entry.at,
      })),
      messages: (session?.messages ?? []).map((message) => ({ role: message.role, content: message.content })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${(chat?.title || 'aether-chat')
      .replace(/[^\w\u4e00-\u9fa5-]+/g, '-')
      .slice(0, 60)}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
    pushToast({ title: t('Exported JSON'), tone: 'success' });
  };

  const exportChat = () => {
    const chat = chats.find((item) => item.id === activeId);
    const usage = session?.usage;
    const body = log
      .map((item) => {
        if (item.kind === 'user') return `## You\n\n${item.text}`;
        if (item.kind === 'final') return `## Aether\n\n${item.text}`;
        if (item.kind === 'tool') return `- \`${item.name}\` · ${item.text}`;
        if (item.kind === 'error') return `> error: ${item.text}`;
        return '';
      })
      .filter(Boolean)
      .join('\n\n');

    const meta = [
      target ? `> Model: ${target.providerName} · ${target.model}` : '',
      usage
        ? `> Tokens: prompt ${usage.promptTokens} · completion ${usage.completionTokens} · steps ${usage.steps} · tools ${usage.tools}`
        : '',
      `> Exported: ${new Date().toISOString()}`,
    ]
      .filter(Boolean)
      .join('\n');

    const sources = [
      ...new Set(
        log
          .filter((item) => item.kind === 'final')
          .flatMap((item) => [...item.text.matchAll(/\[([^\]]{2,40})\]/g)].map((match) => match[1])),
      ),
    ];

    const footer = sources.length ? `\n\n---\n\nReferenced sources: ${sources.join(' · ')}` : '';
    const blob = new Blob([`# ${chat?.title || 'Aether conversation'}\n\n${meta}\n\n${body}${footer}\n`], {
      type: 'text/markdown',
    });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${(chat?.title || 'aether-chat').replace(/[^\w\u4e00-\u9fa5-]+/g, '-').slice(0, 60)}.md`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const suggestions = [
    t('What is still open in the current cycle?'),
    t('List the issues nobody is assigned to'),
    t('Draft a plan for the next two weeks and create the issues'),
  ];

  const openSettings = () => {
    closeChat();
    router.push('/settings/agents');
  };

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          key="agent-chat"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.14, ease: EASE }}
          className="fixed inset-0 z-[690] flex items-center justify-center bg-[rgba(24,25,27,.34)] px-3 backdrop-blur-[3px] sm:px-6"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeChat();
          }}
          data-agent-chat
        >
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.994 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.2, ease: EASE }}
            role="dialog"
            aria-modal="true"
            aria-label={t('Aether agent')}
            className="flex h-[min(820px,86vh)] w-full max-w-[1120px] overflow-hidden rounded-[14px] bg-panel shadow-[0_32px_80px_-16px_rgba(9,10,12,.34),0_2px_6px_rgba(9,10,12,.06),inset_0_0_0_1px_var(--line)]"
          >
            {/* conversations */}
            <aside className="hidden w-[248px] shrink-0 flex-col border-r border-[var(--line-subtle)] bg-base sm:flex">
              <div className="flex h-[48px] items-center gap-2 px-3">
                <span className="flex min-w-0 items-center gap-1.5">
                  <Sparkles size={13} strokeWidth={1.9} className="text-t3" />
                  <span className="truncate text-[13px] font-[590] text-t1">{t('Aether agent')}</span>
                </span>
                <span className="flex-1" />
                <button
                  type="button"
                  aria-label={t('New conversation')}
                  onClick={createChat}
                  className="grid h-[24px] w-[24px] place-items-center rounded-r5 text-t4 transition-colors hover:bg-[var(--bg-hover)] hover:text-t1"
                >
                  <Plus size={13} strokeWidth={2} />
                </button>
              </div>

              <div className="px-2.5 pb-1.5">
                <div className="flex h-[30px] items-center gap-1.5 rounded-r6 bg-[var(--bg-hover)] px-2 shadow-[inset_0_0_0_1px_var(--line-subtle)] focus-within:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--accent)_45%,transparent)]">
                  <Search size={12} strokeWidth={1.9} className="shrink-0 text-t4" />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={t('Search conversations')}
                    className="min-w-0 flex-1 bg-transparent text-[12.5px] text-t1 outline-none placeholder:text-t4"
                  />
                  {query ? (
                    <button type="button" onClick={() => setQuery('')} className="text-t4 hover:text-t2" aria-label={t('Clear')}>
                      <X size={11} strokeWidth={2} />
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="scroll-container flex-1 overflow-y-auto px-1.5 pb-2">
                {visibleChats.length === 0 ? (
                  <p className="px-2 py-3 text-[12.5px] leading-[1.6] text-t4">
                    {query ? t('No conversations match.') : t('No conversations yet.')}
                  </p>
                ) : null}
                {visibleChats.map((chat) => (
                  <div
                    key={chat.id}
                    className={cn(
                      'group relative flex flex-col gap-0.5 rounded-r6 px-2 py-1 text-[13px] transition-colors',
                      chat.id === activeId ? 'bg-[var(--bg-selected)] text-t1' : 'text-t3 hover:bg-[var(--bg-hover)]',
                    )}
                  >
                    <div className="flex min-w-0 items-center gap-1">
                    {chat.pinned ? <Pin size={10} strokeWidth={2} className="shrink-0 text-t4" /> : null}
                    {renaming === chat.id ? (
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={(event) => setRenameValue(event.target.value)}
                        onBlur={() => {
                          renameChat(chat.id, renameValue);
                          void useAgent.getState().syncChat(chat.id);
                          setRenaming(null);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            renameChat(chat.id, renameValue);
                            void useAgent.getState().syncChat(chat.id);
                            setRenaming(null);
                          }
                          if (event.key === 'Escape') setRenaming(null);
                        }}
                        className="h-[22px] min-w-0 flex-1 rounded-r4 bg-[var(--bg-elevated)] px-1 text-[12.5px] text-t1 outline-none shadow-[inset_0_0_0_1px_var(--line)]"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => switchChat(chat.id)}
                        onDoubleClick={() => {
                          setRenaming(chat.id);
                          setRenameValue(chat.title || t('New conversation'));
                        }}
                        className="min-w-0 flex-1 truncate text-left"
                        data-chat-id={chat.id}
                      >
                        {chat.title || t('New conversation')}
                      </button>
                    )}
                    <span className="hidden items-center gap-0.5 group-hover:flex">
                      <button
                        type="button"
                        aria-label={t('Rename')}
                        onClick={() => {
                          setRenaming(chat.id);
                          setRenameValue(chat.title || t('New conversation'));
                        }}
                        className="grid h-[18px] w-[18px] place-items-center rounded-r4 text-t4 hover:text-t1"
                      >
                        <Pencil size={10} strokeWidth={1.9} />
                      </button>
                      <button
                        type="button"
                        aria-label={chat.pinned ? t('Unpin') : t('Pin')}
                        onClick={() => togglePin(chat.id)}
                        className={cn('grid h-[18px] w-[18px] place-items-center rounded-r4 hover:text-t1', chat.pinned ? 'text-accent' : 'text-t4')}
                      >
                        <Pin size={10} strokeWidth={1.9} />
                      </button>
                      <button
                        type="button"
                        aria-label={t('Delete conversation')}
                        onClick={() => {
                          if (!window.confirm(`${t('Delete conversation')}「${chat.title || t('New conversation')}」?`)) return;
                          reset(chatKey(chat.id));
                          removeChat(chat.id);
                          removeDraft(chat.id);
                        }}
                        className="grid h-[18px] w-[18px] place-items-center rounded-r4 text-t4 hover:text-[var(--red)]"
                      >
                        <Trash2 size={10} strokeWidth={1.9} />
                      </button>
                    </span>
                    </div>
                    {renaming !== chat.id ? (
                      <div className="flex items-center gap-1.5 pl-0.5 text-[10.5px] text-t4">
                        <span>
                          {sessions[chatKey(chat.id)]?.log.filter((entry) => entry.kind === 'user').length ?? 0}{' '}
                          {t('turns')}
                        </span>
                        <span className="text-[var(--line-strong)]">·</span>
                        <span>{relativeTime(new Date(chat.at).toISOString())}</span>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>

              <div className="border-t border-[var(--line-subtle)] px-2.5 py-2.5">
                <ModelChip onClick={openSettings} />
                <p className="mt-1.5 px-0.5 text-[11.5px] leading-[1.5] text-t4">
                  {t('Model calls go straight to your own provider.')}
                </p>
              </div>
            </aside>

            {/* conversation */}
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex h-[48px] shrink-0 items-center gap-2 border-b border-[var(--line-subtle)] px-4">
                <span className="min-w-0 truncate text-[14px] font-[590] text-t1">
                  {chats.find((chat) => chat.id === activeId)?.title || t('New conversation')}
                </span>
                {activeProjectId ? <span data-chat-project className="hidden shrink-0 items-center gap-1 rounded-full bg-[var(--bg-accent-subtle)] px-2 py-0.5 text-[11px] text-[var(--accent)] sm:flex"><Box size={10} />{useData.getState().projects.find((project) => project.id === activeProjectId)?.name}</span> : null}
                <button
                  type="button"
                  aria-label={t('New conversation')}
                  onClick={createChat}
                  className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-r6 text-t4 transition-colors hover:bg-[var(--bg-hover)] hover:text-t1 sm:hidden"
                >
                  <Plus size={14} strokeWidth={2} />
                </button>
                {running ? <Loader2 size={12} className="animate-spin text-t4" /> : null}
                <div className="flex-1" />
                <div className="hidden items-center gap-3 sm:flex">
                  {used > 0 ? <ContextMeter used={used} total={target?.contextWindow ?? 128_000} usage={session?.usage} /> : null}
                  <div className="relative">
                    <ModelChip onClick={() => setModelMenuOpen((open) => !open)} />
                    {modelMenuOpen ? (
                      <>
                        <div className="fixed inset-0 z-[695]" onMouseDown={() => setModelMenuOpen(false)} />
                        <div
                          data-model-menu
                          className="absolute right-0 top-[32px] z-[700] w-[300px] rounded-r10 bg-[var(--bg-elevated)] p-1.5 shadow-[var(--shadow-pop)]"
                        >
                          <ModelMenu onClose={() => setModelMenuOpen(false)} />
                        </div>
                      </>
                    ) : null}
                  </div>
                </div>
                <div className="relative">
                  <button
                    type="button"
                    aria-label={t('Run history')}
                    onClick={() => setRunsOpen((open) => !open)}
                    className={cn(
                      'grid h-[26px] w-[26px] shrink-0 place-items-center rounded-r6 transition-colors hover:bg-[var(--bg-hover)] hover:text-t1',
                      runsOpen ? 'bg-[var(--bg-selected)] text-t1' : 'text-t4',
                    )}
                  >
                    <History size={13} strokeWidth={1.9} />
                  </button>
                  {runsOpen ? (
                    <>
                      <div className="fixed inset-0 z-[695]" onMouseDown={() => setRunsOpen(false)} />
                      <div
                        data-run-history
                        className="absolute right-0 top-[32px] z-[700] w-[300px] rounded-r10 bg-[var(--bg-elevated)] p-2 shadow-[var(--shadow-pop)]"
                      >
                        <div className="px-1 pb-1 text-[10.5px] font-[590] uppercase tracking-[.06em] text-t4">
                          {t('Run history')}
                        </div>
                        {(session?.runs ?? [])
                          .slice()
                          .reverse()
                          .slice(0, 6)
                          .map((run) => (
                            <div key={run.id} className="flex items-start gap-2 rounded-r6 px-1 py-1.5">
                              <span
                                className={cn(
                                  'mt-[5px] h-[5px] w-[5px] shrink-0 rounded-full',
                                  run.status === 'ok'
                                    ? 'bg-[var(--green)]'
                                    : run.status === 'error'
                                      ? 'bg-[var(--red)]'
                                      : 'bg-[var(--orange)]',
                                )}
                              />
                              <div className="min-w-0 flex-1">
                                <div className="truncate font-mono text-[11.5px] text-t2">{run.model}</div>
                                <div className="text-[11px] text-t4">
                                  {run.steps} {t('steps')} · {run.tools} {t('tools')} · {(run.ms / 1000).toFixed(1)}s
                                </div>
                              </div>
                              <span className="shrink-0 text-[10.5px] text-t4">
                                {new Date(run.at).toLocaleTimeString()}
                              </span>
                            </div>
                          ))}
                        {!session?.runs?.length ? (
                          <p className="px-1 py-2 text-[11.5px] text-t4">{t('No runs yet.')}</p>
                        ) : null}
                      </div>
                    </>
                  ) : null}
                </div>
                {log.length ? (
                  <button
                    type="button"
                    aria-label={t('Export as Markdown')}
                    onClick={exportChat}
                    className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-r6 text-t4 transition-colors hover:bg-[var(--bg-hover)] hover:text-t1"
                  >
                    <Download size={13} strokeWidth={1.9} />
                  </button>
                ) : null}
                {log.length ? (
                  <button
                    type="button"
                    aria-label={t('Export as JSON')}
                    title={t('Export as JSON')}
                    onClick={exportJson}
                    className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-r6 text-t4 transition-colors hover:bg-[var(--bg-hover)] hover:text-t1"
                  >
                    <span className="font-mono text-[10.5px]">{'{}'}</span>
                  </button>
                ) : null}
                {session && log.length && !running && !waiting ? (
                  <button
                    type="button"
                    onClick={() => activeId && retry(chatKey(activeId))}
                    className="flex h-[26px] shrink-0 items-center whitespace-nowrap rounded-r6 px-1.5 text-[13px] text-t4 transition-colors hover:bg-[var(--bg-hover)] hover:text-t2"
                  >
                    {t('Retry')}
                  </button>
                ) : null}
                {session && log.length ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (!activeId) return;
                      if (confirmClear) {
                        reset(chatKey(activeId));
                        setConfirmClear(false);
                        return;
                      }
                      setConfirmClear(true);
                      window.setTimeout(() => setConfirmClear(false), 3000);
                    }}
                    className={cn(
                      'flex h-[26px] shrink-0 items-center whitespace-nowrap rounded-r6 px-1.5 text-[13px] transition-colors hover:bg-[var(--bg-hover)]',
                      confirmClear ? 'text-[var(--red)]' : 'text-t4 hover:text-t2',
                    )}
                  >
                    {confirmClear ? t('Click again to clear') : t('Clear')}
                  </button>
                ) : null}
                <button
                  type="button"
                  aria-label={t('Close')}
                  onClick={closeChat}
                  className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-r6 text-t4 transition-colors hover:bg-[var(--bg-hover)] hover:text-t1"
                >
                  <X size={15} strokeWidth={1.9} />
                </button>
              </div>

              <div ref={scrollRef} className="scroll-container flex-1 overflow-y-auto px-4 py-5">
                {log.length === 0 ? (
                  <div className="mx-auto mt-[6vh] max-w-[520px] text-center">
                    <div className="mx-auto grid h-10 w-10 place-items-center rounded-[12px] bg-[var(--bg-elevated)] text-[var(--accent)] shadow-[0_1px_2px_rgba(9,10,12,.06),inset_0_0_0_1px_var(--line)]">
                      <Sparkles size={17} strokeWidth={1.8} />
                    </div>
                    <h2 className="mt-4 text-[17px] font-[590] tracking-[-0.01em] text-t1">{t('What should we do next?')}</h2>
                    <p className="mx-auto mt-1.5 max-w-[420px] text-[13.5px] leading-[1.6] text-t3">
                      {t('Aether reads every issue, project and cycle — and changes them through tools, with your approval first.')}
                    </p>
                    <div className="mt-5 flex flex-col gap-1.5">
                      {suggestions.map((text) => (
                        <button
                          key={text}
                          type="button"
                          onClick={() => {
                            if (!activeId) return;
                            titleChat(activeId, text);
                            void run(chatKey(activeId), text);
                          }}
                          className="group flex items-center gap-2.5 rounded-r8 bg-[var(--bg-elevated)] px-3 py-2.5 text-left text-[13px] text-t2 shadow-[0_1px_2px_rgba(9,10,12,.04),inset_0_0_0_1px_var(--line-subtle)] transition-colors hover:text-t1 hover:shadow-[0_2px_6px_rgba(9,10,12,.06),inset_0_0_0_1px_var(--line)]"
                        >
                          <span className="grid h-[20px] w-[20px] shrink-0 place-items-center rounded-full bg-[var(--bg-hover)] text-t4 group-hover:text-t2">
                            <ArrowUp size={10} strokeWidth={2.2} className="rotate-45" />
                          </span>
                          <span className="min-w-0 flex-1">{text}</span>
                        </button>
                      ))}
                    </div>
                    {!ready ? (
                      <button
                        type="button"
                        onClick={openSettings}
                        className="mt-5 text-[13px] text-[var(--accent)] underline decoration-[color-mix(in_srgb,var(--accent)_40%,transparent)] underline-offset-2"
                      >
                        {t('Configure a model in Settings → Agents')}
                      </button>
                    ) : null}
                    <p className="mt-6 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center text-[11.5px] leading-[1.6] text-t4">
                      <span className="inline-flex items-center gap-1">
                        {t('Tip')} ·{' '}
                        <kbd className="rounded-[4px] bg-[var(--bg-selected)] px-1 py-[1px] font-mono text-[11px]">
                          {t('⌘J')}
                        </kbd>
                        {t('opens this panel from anywhere')}
                      </span>
                      <span className="hidden sm:inline">{t('@issue or @knowledge title pulls context in')}</span>
                    </p>
                  </div>
                ) : (
                  <div className="mx-auto max-w-[720px]">
                    {timeline.map((node) =>
                      node.kind === 'step' ? (
                        <StepGroup
                          key={`step-${node.index}`}
                          items={node.items}
                          index={node.index}
                          defaultOpen={node.index === lastStep}
                          retryStatus={session?.status ?? 'idle'}
                          onRetryTool={(item) => {
                            if (key) void retryTool(key, item.id);
                          }}
                        />
                      ) : node.item.kind === 'user' ? (
                        <UserBubble
                          key={node.item.id}
                          item={node.item}
                          onEdit={() => {
                            if (!activeId) return;
                            rewind(chatKey(activeId), node.item.id);
                            setValue(node.item.text);
                            window.setTimeout(() => inputRef.current?.focus(), 60);
                          }}
                          onBranch={() => {
                            if (!activeId || running || waiting) return;
                            const id = branch(chatKey(activeId), node.item.id);
                            if (id) {
                              switchChat(id);
                              pushToast({ title: t('Branched from this message'), tone: 'success' });
                            }
                          }}
                        />
                      ) : (
                        <FinalAnswer
                          key={node.item.id}
                          item={node.item}
                          onIssue={() => {
                            if (!activeId) return;
                            const issueKey = toIssue(chatKey(activeId), node.item.text);
                            if (issueKey) pushToast({ title: t('Issue {key} created', { key: issueKey }), tone: 'success' });
                          }}
                          onKnowledge={async () => {
                            const result = await addKnowledge({
                              kind: 'note',
                              title: node.item.text.split('\n').find(Boolean)?.slice(0, 80) || t('Agent note'),
                              content: node.item.text,
                              tags: ['agent'],
                            });
                            pushToast({
                              title: result.ok ? t('Saved to knowledge') : t('Could not save the entry'),
                              description: result.error,
                              tone: result.ok ? 'success' : 'danger',
                            });
                          }}
                          onIssueLink={(issueKey) => {
                            const issue = useData
                              .getState()
                              .issues.find((entry) => entry.key.toUpperCase() === issueKey);
                            if (!issue) return;
                            closeChat();
                            useView.getState().openIssue(issue.id);
                          }}
                          onFeedback={(value) => {
                            if (!activeId) return;
                            setFeedback(chatKey(activeId), node.item.id, value);
                          }}
                          onDocument={() => {
                            const title = node.item.text.split('\n').map((line) => line.trim()).find(Boolean)?.replace(/^#+\s*/, '').slice(0, 90) || t('Agent document');
                            const doc = createDocument({
                              title,
                              content: node.item.text,
                              source: activeId ? chatKey(activeId) : undefined,
                            });
                            pushToast({
                              title: doc ? t('Saved to Documents') : t('Could not save the document'),
                              description: doc ? t('Open Documents to edit or download it.') : undefined,
                              tone: doc ? 'success' : 'danger',
                            });
                          }}
                        />
                      ),
                    )}
                  </div>
                )}
              </div>

              {pending ? (
                <div
                  data-agent-pending
                  className="mx-4 mb-2 rounded-r8 bg-[var(--bg-elevated)] px-3 py-2.5 shadow-[0_1px_2px_rgba(9,10,12,.04),inset_0_0_0_1px_color-mix(in_srgb,var(--accent)_38%,transparent)]"
                >
                  <div className="flex items-center gap-1.5 text-[12.5px] text-t3">
                    <span className="h-[6px] w-[6px] rounded-full bg-[var(--accent)]" />
                    {t('Approval needed')} · <span className="font-mono text-[11.5px]">{pending.name}</span>
                  </div>
                  <div className="mt-1 text-[14px] font-[510] text-t1">{pending.title}</div>
                  {pending.rows.map((row, index) => (
                    <div key={`${row.field}-${index}`} className="mt-0.5 flex items-center gap-1.5 text-[13px] text-t4">
                      <span className="w-[64px] shrink-0">{t(FIELD_LABEL[row.field] ?? row.field)}</span>
                      {row.from ? <span className="line-through opacity-60">{valueLabel({ ...row, to: row.from })}</span> : null}
                      {row.from ? <span>→</span> : null}
                      <span className="text-t2">{valueLabel(row)}</span>
                    </div>
                  ))}
                  <div className="mt-2 flex items-center gap-1.5">
                    <Button variant="primary" size="sm" onClick={() => activeId && approve(chatKey(activeId))}>
                      {t('Approve')}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => activeId && reject(chatKey(activeId))}>
                      {t('Reject')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      data-always-allow
                      onClick={() => {
                        useToolApprovals.getState().allow(pending.name);
                        if (activeId) approve(chatKey(activeId));
                      }}
                      title={t('Allow this tool for the rest of this browser session')}
                    >
                      {t('Always allow')}
                    </Button>
                  </div>
                </div>
              ) : null}

              <div className="shrink-0 px-4 pb-3 pt-1">
                <div
                  className={cn(
                    'mx-auto max-w-[720px] rounded-[14px] transition-[background-color,box-shadow]',
                    dragging && 'bg-[var(--bg-accent-subtle)] p-1 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--accent)_55%,transparent)]',
                  )}
                  onDragOver={(event) => {
                    event.preventDefault();
                    if (ready && !running) setDragging(true);
                  }}
                  onDragLeave={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    setDragging(false);
                    if (ready && !running) void addFiles(event.dataTransfer.files);
                  }}
                >
                  {dragging ? (
                    <p className="mb-1.5 flex items-center justify-center gap-1.5 py-1 text-[12.5px] text-[var(--accent)]">
                      <Paperclip size={12} strokeWidth={2} />
                      {t('Drop files to attach')}
                    </p>
                  ) : null}
                  {value.startsWith('/') && !value.includes(' ') ? (
                    <div className="mb-1.5 flex flex-wrap gap-1.5">
                      {[
                        ['/clear', t('Clear this conversation')],
                        ['/new', t('Start a new conversation')],
                      ].map(([command, label]) => (
                        <button
                          key={command}
                          type="button"
                          onClick={() => send(command)}
                          className="flex items-center gap-1.5 rounded-r6 bg-[var(--bg-elevated)] px-2 py-1 text-[12px] text-t2 shadow-[inset_0_0_0_1px_var(--line-subtle)] transition-colors hover:bg-[var(--bg-hover)] hover:text-t1"
                        >
                          <span className="font-mono text-[11.5px] text-t3">{command}</span>
                          <span className="text-[11.5px] text-t4">{label}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {attachments.length ? <AttachmentChips files={attachments} data-draft-attachments onRemove={(id) => setAttachments((current) => current.filter((file) => file.id !== id))} /> : null}
                  {webOpen ? (
                    <div className="mb-1.5 flex items-center gap-1.5 rounded-r8 bg-[var(--bg-elevated)] p-1.5 shadow-[inset_0_0_0_1px_var(--line)]">
                      <Globe size={13} strokeWidth={1.9} className="ml-1 shrink-0 text-t4" />
                      <input
                        autoFocus
                        value={webUrl}
                        onChange={(event) => setWebUrl(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' && !isImeComposing(event)) void readPage();
                          if (event.key === 'Escape') setWebOpen(false);
                        }}
                        placeholder="https://example.com/post"
                        spellCheck={false}
                        className="h-[26px] min-w-0 flex-1 bg-transparent font-mono text-[12.5px] text-t1 outline-none placeholder:text-t4"
                      />
                      <Button variant="primary" size="sm" onClick={readPage} disabled={!webUrl.trim() || webBusy}>
                        {webBusy ? <Loader2 size={11} className="animate-spin" /> : null}
                        {t('Read page')}
                      </Button>
                      <button
                        type="button"
                        onClick={() => setWebOpen(false)}
                        aria-label={t('Close')}
                        className="grid h-[24px] w-[24px] place-items-center rounded-r5 text-t4 hover:text-t1"
                      >
                        <X size={12} strokeWidth={2} />
                      </button>
                    </div>
                  ) : null}

                  <div className="rounded-[12px] bg-[var(--bg-elevated)] p-1.5 shadow-[0_2px_8px_rgba(9,10,12,.05),inset_0_0_0_1px_var(--line)] transition-shadow focus-within:shadow-[0_2px_10px_rgba(9,10,12,.07),inset_0_0_0_1px_color-mix(in_srgb,var(--accent)_45%,transparent)]">
                    <textarea
                      ref={inputRef}
                      data-agent-chat-input
                      value={value}
                      rows={1}
                      onChange={(event) => {
                        setValue(event.target.value);
                        setHistoryIndex(-1);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && !event.shiftKey && !isImeComposing(event)) {
                          event.preventDefault();
                          send();
                          return;
                        }
                        const entries = useChatInputHistory.getState().entries;
                        if (event.key === 'ArrowUp' && !event.shiftKey && entries.length) {
                          const el = event.currentTarget;
                          const browsing = historyIndex >= 0;
                          if (browsing || (el.selectionStart === 0 && el.selectionEnd === 0)) {
                            event.preventDefault();
                            const next = Math.min(historyIndex + 1, entries.length - 1);
                            setHistoryIndex(next);
                            setValue(entries[next]);
                            requestAnimationFrame(() => el.setSelectionRange(el.value.length, el.value.length));
                          }
                        } else if (event.key === 'ArrowDown' && !event.shiftKey && historyIndex >= 0) {
                          event.preventDefault();
                          const next = historyIndex - 1;
                          setHistoryIndex(next);
                          setValue(next >= 0 ? entries[next] : '');
                        }
                      }}
                      disabled={!ready || running || waiting}
                      placeholder={ready ? t('Ask, plan, or change something…') : t('Add a provider to start')}
                      className="max-h-[168px] min-h-[42px] w-full resize-none bg-transparent px-2 py-1.5 text-[14px] leading-[1.55] text-t1 outline-none placeholder:text-t4 disabled:opacity-60"
                    />
                    <div className="flex items-center gap-1 px-0.5">
                      <input
                        ref={fileRef}
                        type="file"
                        multiple
                        accept="image/*,.txt,.md,.markdown,.json,.csv,.yaml,.yml,.ts,.tsx,.js,.jsx,.py,.go,.rs,.sql,.html,.css,.log,.pdf"
                        className="hidden"
                        onChange={(event) => void addFiles(event.target.files)}
                      />
                      <button
                        type="button"
                        aria-label={t('Attach a file')}
                        onClick={() => fileRef.current?.click()}
                        disabled={!ready || running || waiting || fileBusy}
                        className="grid h-[26px] w-[26px] place-items-center rounded-r5 text-t4 transition-colors hover:bg-[var(--bg-hover)] hover:text-t1 disabled:opacity-40"
                      >
                        {fileBusy ? <Loader2 size={13} className="animate-spin" /> : <Paperclip size={13} strokeWidth={1.9} />}
                      </button>
                      <button
                        type="button"
                        aria-label={t('Add a web page')}
                        onClick={() => setWebOpen((open) => !open)}
                        disabled={!ready || running || waiting}
                        className={cn(
                          'grid h-[26px] w-[26px] place-items-center rounded-r5 transition-colors disabled:opacity-40',
                          webOpen ? 'bg-[var(--bg-selected)] text-t1' : 'text-t4 hover:bg-[var(--bg-hover)] hover:text-t1',
                        )}
                      >
                        <Globe size={13} strokeWidth={1.9} />
                      </button>
                      {voice.supported ? (
                        <button
                          type="button"
                          data-voice-input
                          aria-label={voice.listening ? t('Stop voice input') : t('Start voice input')}
                          aria-pressed={voice.listening}
                          onClick={voice.toggle}
                          disabled={!ready || running || waiting}
                          className={cn(
                            'grid h-[26px] w-[26px] place-items-center rounded-r5 transition-colors disabled:opacity-40',
                            voice.listening
                              ? 'bg-[color-mix(in_srgb,var(--red)_16%,transparent)] text-[var(--red)]'
                              : 'text-t4 hover:bg-[var(--bg-hover)] hover:text-t1',
                          )}
                        >
                          {voice.listening ? <MicOff size={13} strokeWidth={1.9} /> : <Mic size={13} strokeWidth={1.9} />}
                        </button>
                      ) : null}
                      <span className="flex-1" />
                      <span className="mr-1 hidden items-center gap-1 text-[11.5px] text-t4 sm:flex">
                        {ready ? (
                          <>
                            {target?.providerName ? <span className="truncate">{target.providerName}</span> : null}
                            <span className="text-[var(--line-strong)]">·</span>
                            <span className="font-mono">{target?.model || '—'}</span>
                          </>
                        ) : (
                          <span>{t('No model configured')}</span>
                        )}
                      </span>
                      {running || waiting ? (
                        <Button variant="secondary" size="sm" onClick={() => activeId && cancel(chatKey(activeId))}>
                          <Square size={10} strokeWidth={2.4} />
                          {t('Stop')}
                        </Button>
                      ) : (
                        <button
                          type="button"
                          aria-label={t('Send')}
                          onClick={() => send()}
                          disabled={!value.trim() || !ready}
                          className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full bg-[var(--accent)] text-[var(--accent-fg)] transition-colors hover:bg-[var(--accent-hover)] disabled:bg-[var(--bg-selected)] disabled:text-t4"
                        >
                          <ArrowUp size={13} strokeWidth={2.3} />
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2 px-1 text-[11.5px] text-t4">
                    <span>
                      {t('{issues} issues', { issues: issues.length })}
                      {session?.usage ? ` · ${t('{n} tokens', { n: billed })}` : ''}
                    </span>
                    <span className="flex-1" />
                    <span className="hidden md:inline">{t('Enter sends · Shift+Enter adds a line')}</span>
                    {used > 0 ? (
                      <span className="sm:hidden">
                        <ContextMeter used={used} total={target?.contextWindow ?? 128_000} usage={session?.usage} />
                      </span>
                    ) : null}
                    {session?.at ? <span>{relativeTime(new Date(session.at).toISOString())}</span> : null}
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
