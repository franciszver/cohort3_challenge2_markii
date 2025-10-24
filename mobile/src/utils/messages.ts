export type Message = {
  id: string;
  conversationId: string;
  content?: string;
  attachments?: string[];
  messageType?: string;
  senderId: string;
  createdAt: string;
  updatedAt?: string;
  _localStatus?: 'PENDING' | 'SENT' | 'FAILED';
  __status?: 'sent' | 'delivered' | 'read';
};

export function toCreatedAtMs(iso: string | undefined): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

export function mergeDedupSort(existing: Message[], incoming: Message[]): Message[] {
  const byId: Record<string, Message> = Object.create(null);
  for (const m of existing) byId[m.id] = m;
  for (const m of incoming) byId[m.id] = m;
  const all = Object.values(byId);
  all.sort((a, b) => {
    const at = toCreatedAtMs(a.createdAt);
    const bt = toCreatedAtMs(b.createdAt);
    if (at === bt) return a.id < b.id ? 1 : -1; // stable but desc
    return bt - at; // desc by createdAtMs
  });
  return all;
}


