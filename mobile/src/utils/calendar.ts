import * as Calendar from 'expo-calendar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

export type CalendarConsent = 'full' | 'local' | 'none';

export interface CalendarEvent {
  startISO: string;
  endISO: string;
}

export interface ConflictInfo {
  eventIndex: number;
  conflicts: Array<{
    startISO: string;
    endISO: string;
    source: 'device' | 'assistant';
  }>;
}

/**
 * Request calendar permissions from the OS
 * @returns true if granted, false otherwise
 */
export async function requestCalendarPermissions(): Promise<boolean> {
  try {
    const { status } = await Calendar.requestCalendarPermissionsAsync();
    return status === 'granted';
  } catch (error) {
    console.warn('[calendar] Permission request failed:', error);
    return false;
  }
}

/**
 * Check if calendar permissions are granted
 */
export async function hasCalendarPermissions(): Promise<boolean> {
  try {
    const { status } = await Calendar.getCalendarPermissionsAsync();
    return status === 'granted';
  } catch (error) {
    console.warn('[calendar] Permission check failed:', error);
    return false;
  }
}

/**
 * Get user's calendar consent choice from storage
 */
export async function getCalendarConsent(): Promise<CalendarConsent> {
  try {
    const consent = await AsyncStorage.getItem('calendar:consent');
    if (consent === 'full' || consent === 'local' || consent === 'none') {
      return consent;
    }
    return 'none'; // Default: no consent
  } catch (error) {
    console.warn('[calendar] Failed to get consent:', error);
    return 'none';
  }
}

/**
 * Save user's calendar consent choice
 */
export async function setCalendarConsent(consent: CalendarConsent): Promise<void> {
  try {
    await AsyncStorage.setItem('calendar:consent', consent);
  } catch (error) {
    console.warn('[calendar] Failed to save consent:', error);
  }
}

/**
 * Fetch all calendar events from ALL device calendars for the next N days
 * Returns only time ranges (no titles) for privacy
 * @param daysAhead Number of days to fetch ahead (default: 14)
 * @returns Array of events with only startISO and endISO
 */
export async function getAllCalendarEvents(daysAhead: number = 14): Promise<CalendarEvent[]> {
  try {
    // Check permissions first
    const hasPermission = await hasCalendarPermissions();
    if (!hasPermission) {
      console.warn('[calendar] No permissions to read calendar');
      return [];
    }

    // Get all calendars (EntityType parameter not needed in modern expo-calendar)
    const calendars = await Calendar.getCalendarsAsync();
    if (!calendars || calendars.length === 0) {
      console.log('[calendar] No calendars found');
      return [];
    }

    // Calculate date range
    const now = new Date();
    const startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const endDate = new Date(startDate);
    endDate.setDate(startDate.getDate() + daysAhead);

    // Fetch events from ALL calendars
    const allEvents: CalendarEvent[] = [];
    
    for (const cal of calendars) {
      try {
        const events = await Calendar.getEventsAsync(
          [cal.id],
          startDate,
          endDate
        );
        
        // Convert to privacy-safe format (no titles)
        for (const event of events) {
          if (event.startDate && event.endDate) {
            allEvents.push({
              startISO: new Date(event.startDate).toISOString(),
              endISO: new Date(event.endDate).toISOString(),
            });
          }
        }
      } catch (calError) {
        console.warn(`[calendar] Failed to fetch from calendar ${cal.id}:`, calError);
        // Continue with other calendars
      }
    }

    console.log(`[calendar] Fetched ${allEvents.length} events from ${calendars.length} calendars`);
    return allEvents;
  } catch (error) {
    console.warn('[calendar] Failed to get calendar events:', error);
    return [];
  }
}

/**
 * Detect conflicts between proposed events and existing calendar events
 * Same logic as Lambda conflict detection
 * @param proposedEvents Events from assistant
 * @param calendarEvents Events from device calendar
 * @returns Array of conflicts
 */
export function detectLocalConflicts(
  proposedEvents: Array<{ title?: string; startISO: string; endISO: string }>,
  calendarEvents: CalendarEvent[]
): ConflictInfo[] {
  try {
    if (!Array.isArray(proposedEvents) || !Array.isArray(calendarEvents)) {
      return [];
    }

    const conflicts: ConflictInfo[] = [];

    for (let i = 0; i < proposedEvents.length; i++) {
      const proposed = proposedEvents[i];
      
      // Parse proposed event times
      const propStart = new Date(proposed.startISO).getTime();
      const propEnd = new Date(proposed.endISO).getTime();
      
      if (!Number.isFinite(propStart) || !Number.isFinite(propEnd)) {
        continue; // Skip invalid times
      }

      const eventConflicts: ConflictInfo['conflicts'] = [];

      // Check against each calendar event
      for (const calEvent of calendarEvents) {
        const calStart = new Date(calEvent.startISO).getTime();
        const calEnd = new Date(calEvent.endISO).getTime();
        
        if (!Number.isFinite(calStart) || !Number.isFinite(calEnd)) {
          continue; // Skip invalid times
        }

        // Check for overlap: proposed starts before calendar ends AND calendar starts before proposed ends
        if (propStart < calEnd && calStart < propEnd) {
          eventConflicts.push({
            startISO: calEvent.startISO,
            endISO: calEvent.endISO,
            source: 'device',
          });

          // Limit to 3 conflicts per event
          if (eventConflicts.length >= 3) {
            break;
          }
        }
      }

      if (eventConflicts.length > 0) {
        conflicts.push({
          eventIndex: i,
          conflicts: eventConflicts,
        });
      }

      // Limit total conflicts reported
      if (conflicts.length >= 10) {
        break;
      }
    }

    return conflicts;
  } catch (error) {
    console.warn('[calendar] Conflict detection failed:', error);
    return [];
  }
}

/**
 * Format conflicts into a user-friendly message
 * Generic format: "Friday: 9am conflict with existing event" (no titles)
 */
export function formatConflictsMessage(
  conflicts: ConflictInfo[],
  proposedEvents: Array<{ title?: string; startISO: string; endISO: string }>
): string {
  try {
    if (!conflicts || conflicts.length === 0) {
      return '';
    }

    const lines: string[] = [];
    
    for (const conflict of conflicts.slice(0, 5)) { // Max 5 conflicts
      const proposedEvent = proposedEvents[conflict.eventIndex];
      if (!proposedEvent) continue;

      const startDate = new Date(proposedEvent.startISO);
      const dayName = startDate.toLocaleDateString('en-US', { weekday: 'long' });
      const timeStr = startDate.toLocaleTimeString('en-US', { 
        hour: 'numeric', 
        minute: '2-digit',
        hour12: true 
      });

      const conflictCount = conflict.conflicts.length;
      const plural = conflictCount > 1 ? 's' : '';
      
      lines.push(`${dayName}: ${timeStr} conflict${plural} with existing event${plural}`);
    }

    if (lines.length === 0) {
      return '';
    }

    return `⚠️ Calendar conflicts detected:\n${lines.join('\n')}`;
  } catch (error) {
    console.warn('[calendar] Failed to format conflicts:', error);
    return '';
  }
}

/**
 * Check if a scheduling keyword is present in the text
 * Used for context-aware consent prompting
 */
export function hasSchedulingKeywords(text: string): boolean {
  if (!text || typeof text !== 'string') {
    return false;
  }
  
  const keywords = /plan|schedule|friday|monday|tuesday|wednesday|thursday|saturday|sunday|calendar|conflict|busy|free time/i;
  return keywords.test(text);
}

