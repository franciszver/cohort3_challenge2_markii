import React, { useState } from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import Avatar from './Avatar';
import ProfileModal from './ProfileModal';
import { getFlags } from '../utils/flags';
import { useTheme } from '../utils/theme';

type Props = {
  username: string;
  avatar?: string;
  online?: boolean;
  subtitle?: string;
  profile?: { userId: string; firstName?: string; lastName?: string; email?: string; avatarColor?: string };
};

export default function ChatHeader({ username, avatar, online, subtitle, profile }: Props) {
  const { ENABLE_PROFILES } = getFlags();
  const theme = useTheme();
  const [showProfile, setShowProfile] = useState(false);
  return (
    <View style={[styles.container, { backgroundColor: theme.colors.surface, padding: theme.spacing.md }] }>
      {ENABLE_PROFILES && profile?.email ? (
        <View style={{ position: 'relative' }}>
          <Avatar userId={profile.userId} firstName={profile.firstName} lastName={profile.lastName} email={profile.email} color={profile.avatarColor || undefined} size={32} onPress={() => setShowProfile(true)} />
          <View style={[styles.presenceDot, { backgroundColor: online ? theme.colors.accent : theme.colors.muted, borderColor: theme.colors.surface }]} />
        </View>
      ) : null}
      <View>
        <Text style={[styles.username, { color: theme.colors.textPrimary }]}>{(() => {
          if (ENABLE_PROFILES && profile) {
            const full = `${profile.firstName || ''} ${profile.lastName || ''}`.trim();
            if (full) return full;
            if (profile.email) return profile.email;
          }
          return username;
        })()}</Text>
        {subtitle ? <Text style={[styles.subtitle, { color: theme.colors.textSecondary }]}>{subtitle}</Text> : null}
      </View>
      <ProfileModal visible={!!(ENABLE_PROFILES && showProfile)} onClose={() => setShowProfile(false)} user={profile && profile.email ? { userId: profile.userId, firstName: profile.firstName, lastName: profile.lastName, email: profile.email!, avatarColor: profile.avatarColor } : null} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flexDirection: 'row', alignItems: 'center' },
  avatar: { width: 32, height: 32, borderRadius: 16, marginRight: 8 },
  placeholder: { width: 32, height: 32, borderRadius: 16, marginRight: 8 },
  presenceDot: { position: 'absolute', width: 10, height: 10, borderRadius: 5, right: 4, bottom: 4, borderWidth: 2 },
  username: { fontSize: 16, fontWeight: '600' },
  subtitle: { fontSize: 12 },
});
