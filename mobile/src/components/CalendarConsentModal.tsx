import React from 'react';
import { View, Text, Modal, TouchableOpacity, ScrollView } from 'react-native';
import { useTheme } from '../utils/theme';
import { setCalendarConsent, requestCalendarPermissions, type CalendarConsent } from '../utils/calendar';
import { showToast } from '../utils/toast';
import { Linking, Platform } from 'react-native';

interface CalendarConsentModalProps {
  visible: boolean;
  onClose: () => void;
  onConsentGiven: (consent: CalendarConsent) => void;
}

export default function CalendarConsentModal({ visible, onClose, onConsentGiven }: CalendarConsentModalProps) {
  const theme = useTheme();
  const [busy, setBusy] = React.useState(false);

  const handleChoice = async (choice: CalendarConsent) => {
    if (busy) return;
    setBusy(true);

    try {
      if (choice === 'none') {
        // User declined
        await setCalendarConsent('none');
        showToast('Calendar access disabled');
        onConsentGiven('none');
        onClose();
        return;
      }

      // For 'full' or 'local', we need OS permissions
      const granted = await requestCalendarPermissions();
      
      if (granted) {
        await setCalendarConsent(choice);
        const mode = choice === 'full' ? 'smart planning' : 'local conflicts';
        showToast(`Calendar enabled for ${mode}`);
        onConsentGiven(choice);
        onClose();
      } else {
        // Permission denied by OS
        showToast('Calendar permission denied');
        
        // Show option to open settings
        if (Platform.OS === 'ios' || Platform.OS === 'android') {
          setTimeout(() => {
            showToast('Tap "Open Settings" to enable');
          }, 1500);
        }
        
        // Still save as 'none' since we can't access
        await setCalendarConsent('none');
        onConsentGiven('none');
        onClose();
      }
    } catch (error) {
      console.warn('[calendar] Consent handling failed:', error);
      showToast('Failed to update calendar settings');
      await setCalendarConsent('none');
      onConsentGiven('none');
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View
        style={{
          flex: 1,
          backgroundColor: theme.colors.overlay,
          justifyContent: 'center',
          alignItems: 'center',
          padding: theme.spacing.lg,
        }}
      >
        <View
          style={{
            backgroundColor: theme.colors.modal,
            borderRadius: theme.radii.lg,
            padding: theme.spacing.lg,
            width: '100%',
            maxWidth: 400,
            maxHeight: '80%',
          }}
        >
          <ScrollView showsVerticalScrollIndicator={false}>
            <Text
              style={{
                fontSize: 20,
                fontWeight: '700',
                marginBottom: theme.spacing.md,
                color: theme.colors.textPrimary,
                textAlign: 'center',
              }}
            >
              📅 Calendar Access
            </Text>

            <Text
              style={{
                fontSize: 14,
                color: theme.colors.textSecondary,
                marginBottom: theme.spacing.lg,
                lineHeight: 20,
              }}
            >
              The Assistant can check your calendar for conflicts when planning events. Choose how you want this to work:
            </Text>

            {/* Option 1: Full mode */}
            <TouchableOpacity
              onPress={() => handleChoice('full')}
              disabled={busy}
              style={{
                backgroundColor: theme.colors.primary + '15',
                borderColor: theme.colors.primary,
                borderWidth: 2,
                borderRadius: theme.radii.md,
                padding: theme.spacing.md,
                marginBottom: theme.spacing.md,
              }}
            >
              <Text
                style={{
                  fontSize: 16,
                  fontWeight: '600',
                  color: theme.colors.primary,
                  marginBottom: theme.spacing.xs,
                }}
              >
                ✨ Yes, use my calendar for smart planning
              </Text>
              <Text
                style={{
                  fontSize: 13,
                  color: theme.colors.textSecondary,
                  lineHeight: 18,
                }}
              >
                Shares event times (not titles) with our AI for better suggestions. Most helpful option.
              </Text>
            </TouchableOpacity>

            {/* Option 2: Local only */}
            <TouchableOpacity
              onPress={() => handleChoice('local')}
              disabled={busy}
              style={{
                backgroundColor: theme.colors.inputBackground,
                borderColor: theme.colors.border,
                borderWidth: 1,
                borderRadius: theme.radii.md,
                padding: theme.spacing.md,
                marginBottom: theme.spacing.md,
              }}
            >
              <Text
                style={{
                  fontSize: 16,
                  fontWeight: '600',
                  color: theme.colors.textPrimary,
                  marginBottom: theme.spacing.xs,
                }}
              >
                🔒 Local conflicts only (more private)
              </Text>
              <Text
                style={{
                  fontSize: 13,
                  color: theme.colors.textSecondary,
                  lineHeight: 18,
                }}
              >
                Checks for conflicts on your device only. Calendar data never leaves your phone.
              </Text>
            </TouchableOpacity>

            {/* Option 3: No thanks */}
            <TouchableOpacity
              onPress={() => handleChoice('none')}
              disabled={busy}
              style={{
                backgroundColor: theme.colors.inputBackground,
                borderColor: theme.colors.border,
                borderWidth: 1,
                borderRadius: theme.radii.md,
                padding: theme.spacing.md,
                marginBottom: theme.spacing.md,
              }}
            >
              <Text
                style={{
                  fontSize: 16,
                  fontWeight: '600',
                  color: theme.colors.textPrimary,
                  marginBottom: theme.spacing.xs,
                }}
              >
                🚫 No thanks
              </Text>
              <Text
                style={{
                  fontSize: 13,
                  color: theme.colors.textSecondary,
                  lineHeight: 18,
                }}
              >
                Assistant won't check your calendar. You can enable this later in settings.
              </Text>
            </TouchableOpacity>

            {/* Privacy note */}
            <View
              style={{
                backgroundColor: theme.colors.inputBackground,
                borderRadius: theme.radii.sm,
                padding: theme.spacing.sm,
                marginTop: theme.spacing.sm,
              }}
            >
              <Text
                style={{
                  fontSize: 12,
                  color: theme.colors.textSecondary,
                  lineHeight: 16,
                }}
              >
                🔐 Privacy: In "full" mode, we only send time ranges (start/end times) to our servers, never event titles or descriptions. You can change this anytime in settings.
              </Text>
            </View>

            {busy && (
              <Text
                style={{
                  textAlign: 'center',
                  color: theme.colors.textSecondary,
                  marginTop: theme.spacing.md,
                  fontSize: 14,
                }}
              >
                Setting up...
              </Text>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

