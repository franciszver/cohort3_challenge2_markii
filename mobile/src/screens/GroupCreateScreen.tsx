import React, { useState, useEffect } from 'react';
import { View, TextInput, Text, TouchableOpacity, ScrollView } from 'react-native';
import { useTheme } from '../utils/theme';
import { getCurrentUser } from 'aws-amplify/auth';
import { createConversation } from '../graphql/conversations';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { preloadNicknames, getAllNicknames } from '../utils/nicknames';

export default function GroupCreateScreen({ navigation }: any) {
  const theme = useTheme();
  const [name, setName] = useState('');
  const [participantInput, setParticipantInput] = useState('');
  const [participants, setParticipants] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [knownContacts, setKnownContacts] = useState<Array<{ userId: string; displayName: string }>>([]);
  const hasParticipants = participants.length > 0;

  // Load known contacts on mount
  useEffect(() => {
    (async () => {
      try {
        await preloadNicknames();
        const nicknames = await getAllNicknames();
        const me = await getCurrentUser();
        
        // Collect all known userIds from cached conversations
        const knownUserIds = new Set<string>();
        const allKeys = await AsyncStorage.getAllKeys();
        
        // Helper to validate if string looks like a real userId (UUID-like format)
        const isValidUserId = (id: string): boolean => {
          if (!id || id.length < 10) return false;
          // UserIds should contain dashes and be reasonably long (UUIDs/GUIDs)
          if (!id.includes('-')) return false;
          // Exclude common non-userId values
          const invalid = ['system', 'unknown', 'deleted', 'anonymous', 'guest', 'admin'];
          if (invalid.includes(id.toLowerCase())) return false;
          return true;
        };
        
        // Scan message history for userIds
        for (const key of allKeys) {
          if (key.startsWith('history:')) {
            try {
              const cached = await AsyncStorage.getItem(key);
              if (cached) {
                const messages = JSON.parse(cached);
                if (Array.isArray(messages)) {
                  messages.forEach((msg: any) => {
                    if (msg.senderId && 
                        msg.senderId !== me.userId && 
                        msg.senderId !== 'assistant-bot' && 
                        !msg.senderId.startsWith('assistant-') &&
                        isValidUserId(msg.senderId)) {
                      knownUserIds.add(msg.senderId);
                    }
                  });
                }
              }
            } catch {}
          }
        }
        
        // Build contact list
        const contacts: Array<{ userId: string; displayName: string }> = [];
        
        // Add all users with nicknames (only valid userIds)
        for (const [userId, nickname] of Object.entries(nicknames)) {
          if (userId !== me.userId && 
              userId !== 'assistant-bot' && 
              !userId.startsWith('assistant-') &&
              isValidUserId(userId)) {
            contacts.push({
              userId,
              displayName: `${nickname} (${userId.slice(0, 11)}${userId.length > 11 ? '...' : ''})`
            });
          }
        }
        
        // Add known users without nicknames
        for (const userId of knownUserIds) {
          if (!nicknames[userId]) {
            contacts.push({
              userId,
              displayName: userId.length > 14 ? `${userId.slice(0, 14)}...` : userId
            });
          }
        }
        
        // Sort alphabetically
        contacts.sort((a, b) => a.displayName.localeCompare(b.displayName));
        
        setKnownContacts(contacts);
      } catch (e) {
        console.warn('[GroupCreate] Failed to load contacts:', e);
      }
    })();
  }, []);

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
      setCreating(true);
      const me = await getCurrentUser();
      const tokens = participants.map(s => s.trim()).filter(Boolean);
      if (tokens.length === 0) {
        setError('Add at least one participant ID');
        setCreating(false);
        return;
      }
      const dedup = Array.from(new Set(tokens));
      const ids = [me.userId, ...dedup];
      const conv = await createConversation(name || undefined, true, ids);
      // Wait for participant records to be visible (eventual consistency) before allowing first send
      try {
        const { listParticipantsForConversation } = await import('../graphql/conversations');
        const start = Date.now();
        let seen = 0;
        // Poll up to ~3 seconds
        while (Date.now() - start < 3000) {
          try {
            const r: any = await listParticipantsForConversation(conv.id, 100);
            const items = r?.data?.conversationParticipantsByConversationIdAndUserId?.items || [];
            seen = items.length || 0;
            if (seen >= ids.length) break;
          } catch {}
          await new Promise(res => setTimeout(res, 250));
        }
      } catch {}
      navigation.replace('Chat', { conversationId: conv.id });
    } catch (e: any) {
      setError(e?.message ?? 'Create failed');
    } finally {
      setCreating(false);
    }
  };

  return (
    <View style={{ flex: 1, padding: 16, justifyContent: 'center', alignItems: 'center', backgroundColor: theme.colors.background }}>
      <View style={{ width: '100%', maxWidth: 480, padding: theme.spacing.lg, borderRadius: theme.radii.lg, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border }}>
        <Text style={{ fontSize: 20, fontWeight: '700', marginBottom: 12, color: theme.colors.textPrimary, textAlign: 'center' }}>New Conversation</Text>

        <Text style={{ marginBottom: 6, color: theme.colors.textSecondary }}>Conversation name</Text>
        <TextInput
          placeholder="Optional name"
          value={name}
          onChangeText={setName}
          style={{ borderWidth: 1, padding: theme.spacing.sm, marginBottom: theme.spacing.md, backgroundColor: theme.colors.inputBackground, borderColor: theme.colors.border, borderRadius: theme.radii.md }}
        />

        <Text style={{ marginBottom: 6, color: theme.colors.textSecondary }}>Participants</Text>
        
        {knownContacts.length > 0 && (
          <>
            <Text style={{ marginBottom: 4, color: theme.colors.textSecondary, fontSize: 12 }}>Known Contacts (tap to add)</Text>
            <ScrollView style={{ maxHeight: 180, marginBottom: 12, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radii.md, backgroundColor: theme.colors.surface }}>
              {knownContacts.map((contact) => (
                <TouchableOpacity
                  key={contact.userId}
                  onPress={() => {
                    const nextSet = new Set([...participants, contact.userId]);
                    setParticipants(Array.from(nextSet));
                  }}
                  disabled={participants.includes(contact.userId)}
                  style={{ padding: theme.spacing.sm, borderBottomWidth: 1, borderBottomColor: theme.colors.border, opacity: participants.includes(contact.userId) ? 0.4 : 1, minHeight: 44, justifyContent: 'center' }}
                >
                  <Text style={{ color: theme.colors.textPrimary }} numberOfLines={1}>
                    {contact.displayName}
                    {participants.includes(contact.userId) ? ' ✓' : ''}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </>
        )}

        <Text style={{ marginBottom: 4, color: theme.colors.textSecondary, fontSize: 12 }}>Or enter User ID manually</Text>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <TextInput
            placeholder="Paste a User ID"
            value={participantInput}
            onChangeText={setParticipantInput}
            style={{ flex: 1, borderWidth: 1, padding: theme.spacing.sm, backgroundColor: theme.colors.inputBackground, borderColor: theme.colors.border, borderRadius: theme.radii.md }}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="go"
            onSubmitEditing={addParticipant}
          />
          <TouchableOpacity onPress={addParticipant} accessibilityLabel="Add participant" style={{ paddingHorizontal: 12, paddingVertical: 8 }}>
            <Text style={{ fontSize: 20, color: theme.colors.textPrimary }}>+</Text>
          </TouchableOpacity>
        </View>
        <View style={{ gap: 8, marginBottom: 12 }}>
          {participants.map((id) => (
            <View key={id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: theme.colors.border, padding: theme.spacing.sm, borderRadius: theme.radii.md, backgroundColor: theme.colors.surface }}>
              <Text style={{ color: theme.colors.textPrimary }}>{id.length > 24 ? `${id.slice(0, 24)}…` : id}</Text>
              <TouchableOpacity onPress={() => removeParticipant(id)} accessibilityLabel={`Remove ${id}`} style={{ paddingHorizontal: 8, paddingVertical: 4 }}>
                <Text style={{ fontSize: 18, color: theme.colors.danger }}>-</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
        <TouchableOpacity
          onPress={onCreate}
          disabled={!hasParticipants || creating}
          style={{ backgroundColor: theme.colors.buttonPrimaryBg, padding: theme.spacing.md, borderRadius: theme.radii.md, alignItems: 'center', borderWidth: 1, borderColor: theme.colors.border, opacity: (!hasParticipants || creating) ? 0.6 : 1, minHeight: 44, justifyContent: 'center' }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityLabel="Create conversation"
        >
          <Text style={{ color: theme.colors.buttonPrimaryText, fontWeight: '600' }}>{creating ? 'Creating Chat…' : 'Create'}</Text>
        </TouchableOpacity>
        {error ? <Text style={{ color: theme.colors.danger, marginTop: theme.spacing.md, textAlign: 'center' }}>{error}</Text> : null}
      </View>
    </View>
  );
}


