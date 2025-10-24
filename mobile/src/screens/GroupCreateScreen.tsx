import React, { useState } from 'react';
import { View, TextInput, Button, Text, TouchableOpacity } from 'react-native';
import { getCurrentUser } from 'aws-amplify/auth';
import { createConversation } from '../graphql/conversations';

export default function GroupCreateScreen({ navigation }: any) {
  const [name, setName] = useState('');
  const [participantInput, setParticipantInput] = useState('');
  const [participants, setParticipants] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const hasParticipants = participants.length > 0;

  const addParticipant = () => {
    try {
      const raw = participantInput.trim();
      if (!raw) return;
      const nextSet = new Set([...participants, raw]);
      setParticipants(Array.from(nextSet));
      setParticipantInput('');
    } catch {}
  };

  const removeParticipant = (id: string) => {
    setParticipants(prev => prev.filter(p => p !== id));
  };

  const onCreate = async () => {
    try {
      setError(null);
      const me = await getCurrentUser();
      const tokens = participants.map(s => s.trim()).filter(Boolean);
      if (tokens.length === 0) {
        setError('Add at least one participant ID');
        return;
      }
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
      <Text style={{ fontSize: 18, fontWeight: '600', marginBottom: 8 }}>Start a chat</Text>
      <TextInput placeholder="Chat name" value={name} onChangeText={setName} style={{ borderWidth: 1, padding: 8, marginBottom: 8 }} />
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <TextInput
          placeholder="Paste a participant ID"
          value={participantInput}
          onChangeText={setParticipantInput}
          style={{ flex: 1, borderWidth: 1, padding: 8 }}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <TouchableOpacity onPress={addParticipant} accessibilityLabel="Add participant" style={{ paddingHorizontal: 12, paddingVertical: 8 }}>
          <Text style={{ fontSize: 20, color: '#3b82f6' }}>+</Text>
        </TouchableOpacity>
      </View>
      <View style={{ gap: 8, marginBottom: 8 }}>
        {participants.map((id) => (
          <View key={id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: '#e5e7eb', padding: 8 }}>
            <Text style={{ color: '#111827' }}>{id.length > 24 ? `${id.slice(0, 24)}…` : id}</Text>
            <TouchableOpacity onPress={() => removeParticipant(id)} accessibilityLabel={`Remove ${id}`} style={{ paddingHorizontal: 8, paddingVertical: 4 }}>
              <Text style={{ fontSize: 18, color: '#ef4444' }}>-</Text>
            </TouchableOpacity>
          </View>
        ))}
      </View>
      <Button title="Create" onPress={onCreate} disabled={!hasParticipants} />
      {error ? <Text style={{ color: 'red', marginTop: 8 }}>{error}</Text> : null}
    </View>
  );
}


