import { prisma } from './src/lib/prisma';
import bcrypt from 'bcryptjs';
import { seedDefaultPermissions } from './src/services/permissions';

async function main() {
  console.log('Connecting to database...');
  let workspace = await prisma.workspace.findFirst();

  if (!workspace) {
    workspace = await prisma.workspace.create({
      data: {
        name: 'ABC Insurance',
        domain: 'abcinsurance.com',
        planType: 'enterprise',
        apiKey: `ws_key_${Date.now()}`,
        apiSecret: `ws_sec_${Date.now()}`,
        status: 'active',
      },
    });
    console.log('Created workspace:', workspace.name, workspace.workspaceId);
  } else {
    console.log('Using existing workspace:', workspace.name, workspace.workspaceId);
  }

  // Seed default permissions for this workspace
  await seedDefaultPermissions(workspace.workspaceId);
  console.log('Default permissions and claim actions seeded for workspace.');

  const email = 'admin@abcinsurance.com';
  const password = 'Anil@7799';
  const passwordHash = await bcrypt.hash(password, 10);

  const existingUser = await prisma.user.findFirst({
    where: { email },
  });

  if (existingUser) {
    const updated = await prisma.user.update({
      where: { userId: existingUser.userId },
      data: {
        passwordHash,
        role: 'SUPER_ADMIN',
        isActive: true,
      },
    });
    console.log('Successfully updated existing user:', updated.email, updated.userId, updated.role);
  } else {
    const newUser = await prisma.user.create({
      data: {
        email,
        passwordHash,
        firstName: 'Anil',
        lastName: 'Admin',
        role: 'SUPER_ADMIN',
        isActive: true,
        workspaceId: workspace.workspaceId,
      },
    });
    console.log('Successfully created new admin user:', newUser.email, newUser.userId, newUser.role);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Failed to create/update admin user:', err);
  process.exit(1);
});
