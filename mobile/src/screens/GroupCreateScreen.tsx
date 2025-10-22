import React, { useState } from 'react';
import { View, TextInput, Button, Text } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { getCurrentUser } from 'aws-amplify/auth';
import { createConversation } from '../graphql/conversations';

export default function GroupCreateScreen({ navigation }: any) {
  const [name, setName] = useState('');
  const [participantIds, setParticipantIds] = useState('');
  const [error, setError] = useState<string | null>(null);

  const onCreate = async () => {
    try {
      setError(null);
      const me = await getCurrentUser();
      const tokens = participantIds
        .split(/[\s,;]+/)
        .map(s => s.trim())
        .filter(Boolean);
      const dedup = Array.from(new Set(tokens));
      const ids = [me.userId, ...dedup];
      const conv = await createConversation(name || undefined, true, ids);
      navigation.replace('Chat', { conversationId: conv.id });
    } catch (e: any) {
      setError(e?.message ?? 'Create failed');
    }
  };

  return (
    <View style={{ flex: 1, padding: 16 }}>
      <Text style={{ fontSize: 18, fontWeight: '600', marginBottom: 8 }}>New Group</Text>
      <TextInput placeholder="Group name" value={name} onChangeText={setName} style={{ borderWidth: 1, padding: 8, marginBottom: 8 }} />
      <TextInput
        placeholder="Participant IDs (paste comma/newline separated)"
        value={participantIds}
        onChangeText={setParticipantIds}
        style={{ borderWidth: 1, padding: 8, marginBottom: 8, minHeight: 80, textAlignVertical: 'top' }}
        autoCapitalize="none"
        autoCorrect={false}
        multiline
      />
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
        <Button title="Paste" onPress={async () => { try { const v = await Clipboard.getStringAsync(); setParticipantIds(prev => (prev ? `${prev}\n${v}` : v)); } catch {} }} />
        <Button title="Clear" onPress={() => setParticipantIds('')} />
      </View>
      <Button title="Create" onPress={onCreate} />
      {error ? <Text style={{ color: 'red', marginTop: 8 }}>{error}</Text> : null}
    </View>
  );
}


