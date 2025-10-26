import React, { useState } from 'react';
import { View, TextInput, Text, TouchableOpacity } from 'react-native';
import { useTheme } from '../utils/theme';
import { getCurrentUser } from 'aws-amplify/auth';
import { createConversation } from '../graphql/conversations';

export default function GroupCreateScreen({ navigation }: any) {
  const theme = useTheme();
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
    <View style={{ flex: 1, padding: 16, justifyContent: 'center', alignItems: 'center', backgroundColor: theme.colors.background }}>
      <View style={{ width: '100%', maxWidth: 480, padding: 16, borderRadius: 12, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border }}>
        <Text style={{ fontSize: 20, fontWeight: '700', marginBottom: 12, color: theme.colors.textPrimary, textAlign: 'center' }}>New Conversation</Text>

        <Text style={{ marginBottom: 6, color: theme.colors.textSecondary }}>Conversation name</Text>
        <TextInput
          placeholder="Optional name"
          value={name}
          onChangeText={setName}
          style={{ borderWidth: 1, padding: 10, marginBottom: 12, backgroundColor: 'white', borderColor: theme.colors.border, borderRadius: 8 }}
        />

        <Text style={{ marginBottom: 6, color: theme.colors.textSecondary }}>Participants</Text>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <TextInput
            placeholder="Paste a User ID"
            value={participantInput}
            onChangeText={setParticipantInput}
            style={{ flex: 1, borderWidth: 1, padding: 10, backgroundColor: 'white', borderColor: theme.colors.border, borderRadius: 8 }}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="go"
            onSubmitEditing={addParticipant}
          />
          <TouchableOpacity onPress={addParticipant} accessibilityLabel="Add participant" style={{ paddingHorizontal: 12, paddingVertical: 8 }}>
            <Text style={{ fontSize: 20, color: theme.colors.textPrimary }}>+</Text>
          </TouchableOpacity>
        </View>
        <Text style={{ marginTop: -4, marginBottom: 8, color: theme.colors.textSecondary, fontSize: 12 }}>User ID</Text>
        <View style={{ gap: 8, marginBottom: 12 }}>
          {participants.map((id) => (
            <View key={id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: theme.colors.border, padding: 8, borderRadius: 8, backgroundColor: theme.colors.surface }}>
              <Text style={{ color: theme.colors.textPrimary }}>{id.length > 24 ? `${id.slice(0, 24)}…` : id}</Text>
              <TouchableOpacity onPress={() => removeParticipant(id)} accessibilityLabel={`Remove ${id}`} style={{ paddingHorizontal: 8, paddingVertical: 4 }}>
                <Text style={{ fontSize: 18, color: '#ef4444' }}>-</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
        <TouchableOpacity
          onPress={onCreate}
          disabled={!hasParticipants}
          style={{ backgroundColor: '#F2EFEA', padding: 12, borderRadius: 8, alignItems: 'center', borderWidth: 1, borderColor: theme.colors.border, opacity: !hasParticipants ? 0.6 : 1 }}
          accessibilityLabel="Create conversation"
        >
          <Text style={{ color: theme.colors.textPrimary, fontWeight: '600' }}>Create</Text>
        </TouchableOpacity>
        {error ? <Text style={{ color: 'red', marginTop: 12, textAlign: 'center' }}>{error}</Text> : null}
      </View>
    </View>
  );
}


