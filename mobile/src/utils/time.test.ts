import { formatTimestamp, formatLastSeen } from './time';

describe('time utils', () => {
  const realNow = Date.now;
  beforeAll(() => {
    Date.now = () => new Date('2025-01-01T00:00:00.000Z').getTime();
  });
  afterAll(() => {
    Date.now = realNow;
  });

  test('formatTimestamp: just now', () => {
    const ts = new Date('2025-01-01T00:00:30.000Z').toISOString();
    expect(formatTimestamp(ts)).toBe('just now');
  });

  test('formatTimestamp: minutes and hours', () => {
    const m = new Date('2025-01-01T00:10:00.000Z').toISOString();
    const h = new Date('2025-01-01T10:00:00.000Z').toISOString();
    expect(formatTimestamp(m)).toBe('10m ago');
    expect(formatTimestamp(h)).toBe('14h ago');
  });

  test('formatLastSeen', () => {
    const m = new Date('2025-01-01T00:10:00.000Z').toISOString();
    expect(formatLastSeen(m)).toBe('last seen 10m ago');
    expect(formatLastSeen(undefined)).toBeUndefined();
  });
});
