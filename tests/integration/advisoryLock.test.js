const { prisma } = require('../helpers/reset');
const { withAdvisoryLock } = require('../../server/utils/advisoryLock');

afterAll(async () => {
  await prisma.$disconnect();
});

describe('withAdvisoryLock (TASK-022)', () => {
  it('only lets one holder run at a time for the same lock key', async () => {
    const key = 999001;
    let firstStarted = false;
    let secondAttempted = false;

    const first = withAdvisoryLock(key, async () => {
      firstStarted = true;
      await new Promise((resolve) => setTimeout(resolve, 1500));
      return 'first-done';
    });

    // Generous margin (relative to the 1500ms hold above) so this stays
    // reliable when the full suite is running dozens of other DB-backed
    // tests concurrently, not just in isolation.
    await new Promise((resolve) => setTimeout(resolve, 400)); // let `first` acquire it
    const second = await withAdvisoryLock(key, async () => {
      secondAttempted = true;
      return 'second-done';
    });

    expect(firstStarted).toBe(true);
    expect(second.ran).toBe(false);
    expect(secondAttempted).toBe(false);

    const firstResult = await first;
    expect(firstResult.ran).toBe(true);
    expect(firstResult.result).toBe('first-done');
  });

  it('releases the lock afterwards so a later call can acquire it', async () => {
    const key = 999002;
    const first = await withAdvisoryLock(key, async () => 'ok');
    expect(first.ran).toBe(true);

    const second = await withAdvisoryLock(key, async () => 'ok-again');
    expect(second.ran).toBe(true);
  });

  it('releases the lock even if the wrapped function throws', async () => {
    const key = 999003;
    await expect(
      withAdvisoryLock(key, async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');

    const after = await withAdvisoryLock(key, async () => 'recovered');
    expect(after.ran).toBe(true);
  });

  it('different lock keys do not contend with each other', async () => {
    const results = await Promise.all([
      withAdvisoryLock(999004, async () => 'a'),
      withAdvisoryLock(999005, async () => 'b'),
    ]);
    expect(results.every((r) => r.ran)).toBe(true);
  });
});
