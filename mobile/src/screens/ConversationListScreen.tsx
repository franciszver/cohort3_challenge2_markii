import React, { useEffect, useState } from 'react';
import { View, Text, Button, FlatList, TouchableOpacity } from 'react-native';
import { getCurrentUser } from 'aws-amplify/auth';
import { listConversationsForUser, getConversation, listParticipantsForConversation } from '../graphql/conversations';
import { batchGetUsers } from '../graphql/users';
import { getLatestMessageInConversation } from '../graphql/messages';
import { formatTimestamp } from '../utils/time';

export default function ConversationListScreen({ navigation }: any) {
  const [items, setItems] = useState<any[]>([]);
  const [nextToken, setNextToken] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setError(null);
        const me = await getCurrentUser();
        const res: any = await listConversationsForUser(me.userId, 20);
        const parts = res?.data?.conversationParticipantsByUserIdAndConversationId;
        const convIds = (parts?.items || []).map((p: any) => p.conversationId);
        const convs: any[] = [];
        for (const id of convIds) {
          const r: any = await getConversation(id);
          if (r?.data?.getConversation) {
            const c = r.data.getConversation;
            // latest message preview
            const latest = await getLatestMessageInConversation(c.id);
            // fetch participant subset (first 3 for avatars) and lastReadAt for me
            const partsRes: any = await listParticipantsForConversation(c.id, 3);
            const parts = partsRes?.data?.conversationParticipantsByConversationIdAndUserId?.items || [];
            const userMap = await batchGetUsers(parts.map((p: any) => p.userId));
            // compute unread: if I have a lastReadAt, compare to latest message createdAt
            let unread = 0;
            try {
              const myPart = parts.find((p: any) => p.userId === me.userId);
              const lastRead = myPart?.lastReadAt;
              if (latest?.createdAt && lastRead) {
                unread = new Date(latest.createdAt).getTime() > new Date(lastRead).getTime() ? 1 : 0;
              } else if (latest?.createdAt && !lastRead) {
                unread = 1;
              }
            } catch {}
            convs.push({ ...c, _latest: latest, _participants: parts, _users: userMap, _unread: unread });
          }
        }
        setItems(convs);
        setNextToken(parts?.nextToken);
      } catch (e: any) { setError(e?.message ?? 'Load failed'); }
    })();
  }, []);

  return (
    <View style={{ flex: 1, padding: 12 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 }}>
        <Text style={{ fontSize: 18, fontWeight: '600' }}>Chats</Text>
        <Button title="New Group" onPress={() => navigation.navigate('GroupCreate')} />
      </View>
      {error ? <Text style={{ color: 'red' }}>{error}</Text> : null}
      <FlatList
        data={items}
        keyExtractor={(item: any) => item.id}
        renderItem={({ item }) => (
          <TouchableOpacity onPress={() => navigation.navigate('Chat', { conversationId: item.id })}>
            <View style={{ paddingVertical: 12, flexDirection: 'row', alignItems: 'center' }}>
              <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: '#e5e7eb', marginRight: 8, overflow: 'hidden', flexDirection: 'row' }}>
                {/* Simple composite: initials from first 2 participants */}
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontSize: 10, color: '#374151' }}>{(item._users?.[item._participants?.[0]?.userId]?.username || 'U1').slice(0,2)}</Text>
                </View>
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f3f4f6' }}>
                  <Text style={{ fontSize: 10, color: '#374151' }}>{(item._users?.[item._participants?.[1]?.userId]?.username || 'U2').slice(0,2)}</Text>
                </View>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '600' }}>{item.name || (item.isGroup ? 'Group' : 'Chat')}</Text>
                <Text style={{ color: '#6b7280' }} numberOfLines={1}>
                  {(item._latest?.content || '[no messages]')} · {item._latest?.createdAt ? formatTimestamp(item._latest.createdAt) : ''}
                </Text>
              </View>
              {item._unread ? (
                <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: '#3b82f6' }} />
              ) : null}
            </View>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}


