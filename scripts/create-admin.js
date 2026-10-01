// Creates the first SUPER_ADMIN in a fresh production database — the
// seed script refuses to run there, and its demo accounts don't belong in
// production anyway. Also creates the platform wallet that payouts and
// commissions need, if none exists yet. See docs/DEPLOYMENT.md.
//
//   ADMIN_PHONE=080... ADMIN_NAME="..." ADMIN_PASSWORD="12+ chars" node scripts/create-admin.js
//
// The new admin still has to turn on MFA at first login; the staff
// security gate sends them straight to the page for it.
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const MIN_LENGTH = 12;

async function createAdmin(prisma, { phone, fullName, password }) {
  if (!phone || !fullName || !password) throw new Error('ADMIN_PHONE, ADMIN_NAME and ADMIN_PASSWORD are all required');
  if (password.length < MIN_LENGTH) throw new Error(`ADMIN_PASSWORD must be at least ${MIN_LENGTH} characters`);
  if (password.includes(phone)) throw new Error('ADMIN_PASSWORD must not contain the phone number');
  if (await prisma.user.findUnique({ where: { phone } })) throw new Error(`An account with phone ${phone} already exists`);

  return prisma.$transaction(async (tx) => {
    const admin = await tx.user.create({
      data: {
        role: 'ADMIN',
        staffRole: 'SUPER_ADMIN',
        fullName,
        phone,
        passwordHash: await bcrypt.hash(password, 10),
        isDemo: false,
        passwordChangedAt: new Date(),
      },
    });
    const platformWallet = await tx.wallet.findFirst({ where: { walletType: 'PLATFORM' } });
    if (!platformWallet) {
      await tx.wallet.create({ data: { userId: admin.id, walletType: 'PLATFORM', balance: 0, isDemo: false } });
    }
    return { adminId: admin.id, createdPlatformWallet: !platformWallet };
  });
}

module.exports = { createAdmin };

if (require.main === module) {
  const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
  createAdmin(prisma, { phone: process.env.ADMIN_PHONE, fullName: process.env.ADMIN_NAME, password: process.env.ADMIN_PASSWORD })
    .then((r) => console.log(`Created SUPER_ADMIN ${r.adminId}${r.createdPlatformWallet ? ' and the platform wallet' : ''}`))
    .catch((err) => {
      console.error(`Could not create admin: ${err.message}`);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
