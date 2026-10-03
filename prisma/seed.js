require('dotenv').config();
const { createPrismaClient } = require('../server/utils/prismaClient');
const bcrypt = require('bcryptjs');
const walletService = require('../server/services/walletService');

const prisma = createPrismaClient(process.env.DATABASE_URL);

async function upsertUserWithWallet({ role, fullName, phone, pin, walletType, staffRole }) {
  const passwordHash = await bcrypt.hash(pin, 10);
  const user = await prisma.user.upsert({
    where: { phone },
    // Re-running the seed against an already-seeded database (this
    // repo's own dev DB, mid-session) should still grant staffRole to an
    // existing admin row, not just a freshly created one.
    update: staffRole ? { staffRole } : {},
    create: { role, fullName, phone, passwordHash, staffRole: staffRole ?? undefined },
  });
  await prisma.wallet.upsert({
    where: { userId: user.id },
    update: {},
    create: { userId: user.id, walletType, balance: 0, isDemo: true },
  });
  return user;
}

// Refuses to run in production unless explicitly overridden. Without this,
// deploying with NODE_ENV=production and accidentally running `npm run
// seed` (or a platform's auto-run-on-deploy hook) would create a
// predictable admin account with a password taken straight from
// .env.example (TASK-015). ALLOW_PROD_SEED=true is an explicit,
// one-time escape hatch for a deliberate initial production bootstrap —
// not something left on.
function guardAgainstProductionSeed() {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_PROD_SEED !== 'true') {
    console.error(
      'Refusing to run prisma/seed.js with NODE_ENV=production. ' +
        'If this is a deliberate, one-time production bootstrap, re-run with ALLOW_PROD_SEED=true.'
    );
    process.exit(1);
  }
}

async function main() {
  guardAgainstProductionSeed();
  console.log('Seeding StreetBoardman demo data...');

  await prisma.systemSetting.upsert({
    where: { key: 'boardmanCommissionRate' },
    update: {},
    create: { key: 'boardmanCommissionRate', value: process.env.DEFAULT_BOARDMAN_COMMISSION_RATE || '0.05' },
  });
  await prisma.systemSetting.upsert({
    where: { key: 'platformCommissionRate' },
    update: {},
    create: { key: 'platformCommissionRate', value: process.env.DEFAULT_PLATFORM_COMMISSION_RATE || '0.03' },
  });
  await prisma.systemSetting.upsert({
    where: { key: 'resultConfirmationWindowHours' },
    update: {},
    create: { key: 'resultConfirmationWindowHours', value: process.env.DEFAULT_RESULT_CONFIRMATION_WINDOW_HOURS || '2' },
  });

  const admin = await upsertUserWithWallet({
    role: 'ADMIN',
    fullName: 'Platform Admin',
    phone: process.env.SEED_ADMIN_PHONE || '08000000000',
    pin: process.env.SEED_ADMIN_PASSWORD || 'Admin@12345',
    walletType: 'PLATFORM',
    // Full access (TASK-030) — without this the seeded admin could log in
    // but couldn't do anything, since staffRole defaults to null.
    staffRole: 'SUPER_ADMIN',
  });

  const boardmanUser = await upsertUserWithWallet({
    role: 'BOARDMAN',
    fullName: 'Demo Boardman',
    phone: process.env.SEED_BOARDMAN_PHONE || '08011111111',
    pin: process.env.SEED_BOARDMAN_PASSWORD || 'Boardman@123',
    walletType: 'BOARDMAN',
  });
  await prisma.boardmanProfile.upsert({
    where: { userId: boardmanUser.id },
    update: { approvalStatus: 'APPROVED', approvedByAdminId: admin.id, approvedAt: new Date() },
    create: {
      userId: boardmanUser.id,
      businessLocation: 'Lagos, Nigeria',
      approvalStatus: 'APPROVED',
      approvedByAdminId: admin.id,
      approvedAt: new Date(),
    },
  });

  const better = await upsertUserWithWallet({
    role: 'BETTER',
    fullName: 'Demo Better',
    phone: process.env.SEED_BETTER_PHONE || '08022222222',
    pin: process.env.SEED_BETTER_PASSWORD || 'Better@12345',
    walletType: 'BETTER',
  });

  // Give the demo Better some starting demo funds so they can bet right
  // away. Goes through applyWalletTransaction like every other money
  // movement, so the double-entry ledger records it too. Writing the
  // balance directly (as this used to) left every seeded environment
  // failing the nightly wallet-vs-ledger reconciliation from day one.
  const betterWallet = await prisma.wallet.findUnique({ where: { userId: better.id } });
  if (Number(betterWallet.balance) === 0) {
    await prisma.$transaction((tx) =>
      walletService.applyWalletTransaction(tx, {
        walletId: betterWallet.id,
        type: 'DEPOSIT',
        delta: 20000,
        referenceType: 'Seed',
        referenceId: 'seed-script',
        note: 'Starting demo balance',
        counterparty: { type: 'EXTERNAL' },
      })
    );
  }

  const boardmanProfile = await prisma.boardmanProfile.findUnique({ where: { userId: boardmanUser.id } });
  const existingCompetition = await prisma.competition.findFirst({ where: { title: 'Tunde vs Seyi' } });
  if (!existingCompetition) {
    await prisma.competition.create({
      data: {
        boardmanProfileId: boardmanProfile.id,
        title: 'Tunde vs Seyi',
        description: 'Friendly street football match',
        category: 'FOOTBALL',
        status: 'BETTING_OPEN',
        bettingDeadline: new Date(Date.now() + 24 * 60 * 60 * 1000),
        boardmanCommissionRate: 0.05,
        platformCommissionRate: 0.03,
        participants: { create: [{ name: 'Tunde' }, { name: 'Seyi' }] },
        betOptions: { create: [{ label: 'Tunde wins' }, { label: 'Seyi wins' }] },
      },
    });
  }

  console.log('Seed complete. Demo accounts:');
  console.log(`  Admin:    ${admin.phone} / (see SEED_ADMIN_PASSWORD in .env)`);
  console.log(`  Boardman: ${boardmanUser.phone} / (see SEED_BOARDMAN_PASSWORD in .env)`);
  console.log(`  Better:   ${better.phone} / (see SEED_BETTER_PASSWORD in .env)`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
