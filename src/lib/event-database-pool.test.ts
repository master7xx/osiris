import { describe, it, expect, vi } from 'vitest';
import { createEventDatabasePool } from './event-database-pool';

describe('event database idle connection failures', () => {
  it.each(['web', 'collector'] as const)('handles %s idle errors without leaking connection details', async role => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const pool = createEventDatabasePool({ max: 1 }, role);
    try {
      const error = new Error('postgres://private-user:private-password@private-host/database');
      expect(() => pool.emit('error', error, { connectionParameters: { password: 'private-password' } })).not.toThrow();
      expect(log).toHaveBeenCalledWith(`[events:${role}] Idle database connection lost; the next operation will reconnect.`);
      expect(JSON.stringify(log.mock.calls)).not.toContain('private-');
      expect(pool.ending).toBe(false);
    } finally { await pool.end(); log.mockRestore(); }
  });
});
