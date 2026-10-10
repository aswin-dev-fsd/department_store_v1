import { describe, expect, it } from 'vitest';
import { connectionConfig, createDb, describeConnection } from './client.js';

const URL_WITH_SECRET =
  'postgresql://neondb_owner:sup3r-s3cret@ep-example-123.ap-southeast-1.aws.neon.tech/neondb?sslmode=require';

describe('describeConnection', () => {
  it('shows host and database', () => {
    expect(describeConnection(URL_WITH_SECRET)).toBe(
      'ep-example-123.ap-southeast-1.aws.neon.tech/neondb',
    );
  });

  it('never includes the user, password or query string', () => {
    const text = describeConnection(URL_WITH_SECRET);
    expect(text).not.toContain('sup3r-s3cret');
    expect(text).not.toContain('neondb_owner');
    expect(text).not.toContain('sslmode');
  });
});

describe('connectionConfig', () => {
  const sslmodeOf = (url: string) =>
    new URL(connectionConfig(url).connectionString).searchParams.get('sslmode');

  it.each(['require', 'prefer', 'verify-ca'])(
    'upgrades sslmode=%s to verify-full (full certificate check, same as pg 8 today)',
    (mode) => {
      expect(sslmodeOf(`postgresql://u:p@host/db?sslmode=${mode}`)).toBe('verify-full');
    },
  );

  it('keeps sslmode=verify-full and leaves URLs without sslmode alone', () => {
    expect(sslmodeOf('postgresql://u:p@host/db?sslmode=verify-full')).toBe('verify-full');
    expect(connectionConfig('postgresql://u:p@localhost/db').connectionString).toBe(
      'postgresql://u:p@localhost/db',
    );
  });

  it('turns channel binding on only when the URL requires it', () => {
    expect(
      connectionConfig(URL_WITH_SECRET + '&channel_binding=require').enableChannelBinding,
    ).toBe(true);
    expect(connectionConfig(URL_WITH_SECRET).enableChannelBinding).toBe(false);
  });
});

describe('createDb', () => {
  it('creates a pool and drizzle instance without connecting', async () => {
    const { db, pool } = createDb(URL_WITH_SECRET, { max: 3 });
    expect(db).toBeDefined();
    expect(pool.options.max).toBe(3);
    expect(pool.totalCount).toBe(0); // lazy: no connection opened yet
    await pool.end();
  });
});
