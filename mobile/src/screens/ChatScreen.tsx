import React, { useEffect, useRef, useState } from 'react';
import { View, FlatList, TextInput, Button, Text } from 'react-native';
import { listMessages, sendMessage, subscribeMessages } from '../graphql/messages';
import { getCurrentUser } from 'aws-amplify/auth';

function conversationIdFor(a: string, b: string) {
  return [a, b].sort().join('#');
}

export default function ChatScreen({ route }: any) {
  const [messages, setMessages] = useState<any[]>([]);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const subRef = useRef<any>(null);
  const otherUserId = route.params?.otherUserSub as string;

  useEffect(() => {
    (async () => {
      try {
        const me = await getCurrentUser();
        const cid = conversationIdFor(me.userId, otherUserId);
        const res: any = await listMessages(cid, 25);
        setMessages(res.data.listMessages.items);
        const sub = subscribeMessages(cid)({
          next: (evt: any) => setMessages(prev => [evt.data.onMessage, ...prev]),
          error: (e: any) => console.log('sub error', e),
        });
        subRef.current = sub;
      } catch (e: any) {
        setError(e?.message ?? 'Failed to load chat');
      }
    })();
    return () => subRef.current?.unsubscribe?.();
  }, []);

  const onSend = async () => {
    try {
      setError(null);
      const me = await getCurrentUser();
      const cid = conversationIdFor(me.userId, otherUserId);
      const optimistic = {
        conversationId: cid,
        timestamp: new Date().toISOString(),
        messageId: `local-${Date.now()}`,
        senderId: me.userId,
        content: input,
        status: 'PENDING',
      };
      setMessages(prev => [optimistic, ...prev]);
      setInput('');
      const res: any = await sendMessage(cid, optimistic.content);
      const saved = res.data.sendMessage;
      setMessages(prev => prev.map(m => (m.messageId === optimistic.messageId ? saved : m)));
    } catch (e: any) {
      setError(e?.message ?? 'Send failed');
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        inverted
        data={messages}
        keyExtractor={(item) => item.messageId}
        renderItem={({ item }) => (
          <View style={{ padding: 8 }}>
            <Text>{item.senderId === 'me' ? 'Me' : item.senderId}: {item.content} ({item.status})</Text>
          </View>
        )}
      />
      {error ? <Text style={{ color: 'red' }}>{error}</Text> : null}
      <View style={{ flexDirection: 'row', padding: 8, gap: 8 }}>
        <TextInput style={{ flex: 1, borderWidth: 1, padding: 8 }} value={input} onChangeText={setInput} placeholder="Message" />
        <Button title="Send" onPress={onSend} />
      </View>
    </View>
  );
}
