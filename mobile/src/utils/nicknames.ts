import AsyncStorage from '@react-native-async-storage/async-storage';

const NICKNAMES_KEY = 'nicknames';

// In-memory cache for fast lookups
let nicknameCache: Record<string, string> = {};
let cacheLoaded = false;

/**
 * Load nicknames from AsyncStorage into memory cache
 */
async function loadCache(): Promise<void> {
  if (cacheLoaded) return;
  try {
    const raw = await AsyncStorage.getItem(NICKNAMES_KEY);
    if (raw) {
      nicknameCache = JSON.parse(raw);
    }
    cacheLoaded = true;
  } catch (e) {
    console.warn('[nicknames] Failed to load cache:', e);
    nicknameCache = {};
    cacheLoaded = true;
  }
}

/**
 * Save nicknames from memory cache to AsyncStorage
 */
async function saveCache(): Promise<void> {
  try {
    await AsyncStorage.setItem(NICKNAMES_KEY, JSON.stringify(nicknameCache));
  } catch (e) {
    console.warn('[nicknames] Failed to save cache:', e);
  }
}

/**
 * Get nickname for a user ID
 * @param userId - The user ID to look up
 * @returns The nickname if set, undefined otherwise
 */
export async function getNickname(userId: string): Promise<string | undefined> {
  await loadCache();
  return nicknameCache[userId];
}

/**
 * Get nickname synchronously (assumes cache is loaded)
 * Use this in render methods after calling loadCache() once
 * @param userId - The user ID to look up
 * @returns The nickname if set, undefined otherwise
 */
export function getNicknameSync(userId: string): string | undefined {
  return nicknameCache[userId];
}

/**
 * Set nickname for a user ID
 * @param userId - The user ID to nickname
 * @param nickname - The nickname to set (empty string or undefined to clear)
 */
export async function setNickname(userId: string, nickname: string | undefined): Promise<void> {
  await loadCache();
  
  if (!nickname || nickname.trim() === '') {
    // Clear nickname
    delete nicknameCache[userId];
  } else {
    // Set nickname
    nicknameCache[userId] = nickname.trim();
  }
  
  await saveCache();
}

/**
 * Get all nicknames
 * @returns Record of userId -> nickname
 */
export async function getAllNicknames(): Promise<Record<string, string>> {
  await loadCache();
  return { ...nicknameCache };
}

/**
 * Clear all nicknames
 */
export async function clearAllNicknames(): Promise<void> {
  nicknameCache = {};
  cacheLoaded = true;
  await saveCache();
}

/**
 * Preload nicknames cache on app start
 * Call this early in app lifecycle
 */
export async function preloadNicknames(): Promise<void> {
  await loadCache();
}

/**
 * Get display name for a user ID
 * Priority: nickname → userId
 * @param userId - The user ID
 * @returns Display name
 */
export function getDisplayName(userId: string): string {
  const nickname = getNicknameSync(userId);
  return nickname || userId;
}

