import React from 'react';
import { Modal, View, Text, Button } from 'react-native';
import Avatar from './Avatar';

type Props = {
  visible: boolean;
  onClose: () => void;
  user: { userId: string; firstName?: string; lastName?: string; email: string; avatarColor?: string } | null;
};

export default function ProfileModal({ visible, onClose, user }: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center' }}>
        <View style={{ backgroundColor: 'white', padding: 16, borderRadius: 8, width: '85%' }}>
          {user ? (
            <View style={{ alignItems: 'center' }}>
              <Avatar userId={user.userId} firstName={user.firstName} lastName={user.lastName} email={user.email} color={user.avatarColor || undefined} size={64} />
              <Text style={{ marginTop: 12, fontSize: 16, fontWeight: '600' }}>
                {`${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email}
              </Text>
              <Text style={{ marginTop: 4, color: '#6b7280' }}>{user.email}</Text>
            </View>
          ) : null}
          <View style={{ marginTop: 16, flexDirection: 'row', justifyContent: 'flex-end' }}>
            <Button title="Close" onPress={onClose} />
          </View>
        </View>
      </View>
    </Modal>
  );
}


