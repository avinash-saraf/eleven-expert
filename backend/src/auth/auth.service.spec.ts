import { UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AuthService } from './auth.service';
import { DemoLoginDto } from './dto/demo-login.dto';
import { PrismaService } from '../prisma/prisma.service';
import { UserRole } from '../generated/prisma/enums';

describe('Demo identity and tokens', () => {
  let prisma: any;
  let auth: AuthService;
  const organization = { id: 'org-1', name: 'Sellmate' };
  const user = {
    id: 'user-1',
    name: 'Alex',
    role: UserRole.EXPERT,
    organizationId: 'org-1',
    organization,
  };

  beforeEach(() => {
    prisma = {
      organization: { upsert: jest.fn().mockResolvedValue(organization) },
      user: { upsert: jest.fn().mockResolvedValue(user) },
      demoAccessToken: { create: jest.fn(), findUnique: jest.fn() },
      $transaction: jest.fn(async (fn) => fn(prisma)),
    };
    auth = new AuthService(prisma as PrismaService);
  });

  it('normalizes names, reuses identities, and stores only a hash of the issued token', async () => {
    const result = await auth.login({
      organizationName: '  SELLmate  ',
      name: ' Alex ',
      role: 'expert',
    });
    expect(prisma.organization.upsert.mock.calls[0][0].where).toEqual({
      nameKey: 'sellmate',
    });
    expect(prisma.user.upsert.mock.calls[0][0].where).toEqual({
      organizationId_nameKey_role: {
        organizationId: 'org-1',
        nameKey: 'alex',
        role: 'EXPERT',
      },
    });
    const saved = prisma.demoAccessToken.create.mock.calls[0][0].data;
    expect(saved.tokenHash).toBe(
      createHash('sha256').update(result.accessToken).digest('hex'),
    );
    expect(saved).not.toHaveProperty('accessToken');
    expect(result.user).toEqual({
      id: 'user-1',
      name: 'Alex',
      role: 'expert',
      organization,
    });
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
    const second = await auth.login({
      organizationName: 'Sellmate',
      name: 'Alex',
      role: 'expert',
    });
    expect(second.accessToken).not.toBe(result.accessToken);
    expect(second.user.id).toBe(result.user.id);
  });

  it('gets organization and role from the persisted token identity', async () => {
    prisma.demoAccessToken.findUnique.mockResolvedValue({
      user,
      expiresAt: new Date(Date.now() + 10000),
    });
    await expect(
      auth.authenticate(`Bearer ${'a'.repeat(64)}`),
    ).resolves.toMatchObject({
      id: 'user-1',
      organizationId: 'org-1',
      role: UserRole.EXPERT,
    });
  });

  it.each([undefined, 'Bearer shared-admin-key', 'Bearer short', ''])(
    'rejects malformed tokens: %s',
    async (header) => {
      await expect(auth.authenticate(header)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(prisma.demoAccessToken.findUnique).not.toHaveBeenCalled();
    },
  );

  it('rejects unknown and expired tokens', async () => {
    prisma.demoAccessToken.findUnique.mockResolvedValueOnce(null);
    await expect(auth.authenticate(`Bearer ${'a'.repeat(64)}`)).rejects.toThrow(
      UnauthorizedException,
    );
    prisma.demoAccessToken.findUnique.mockResolvedValueOnce({
      user,
      expiresAt: new Date(Date.now() - 1),
    });
    await expect(auth.authenticate(`Bearer ${'a'.repeat(64)}`)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('validates the login contract and rejects blank names and invented roles', async () => {
    const pipe = new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    const metadata = { type: 'body' as const, metatype: DemoLoginDto };
    const dto = {
      organizationName: ' Sellmate ',
      name: ' Alex ',
      role: 'employee',
    };
    await expect(pipe.transform(dto, metadata)).resolves.toMatchObject({
      organizationName: 'Sellmate',
      name: 'Alex',
    });
    for (const invalid of [
      { ...dto, name: '   ' },
      { ...dto, role: 'admin' },
      { ...dto, organizationId: 'org-2' },
    ])
      await expect(pipe.transform(invalid, metadata)).rejects.toThrow();
  });
});
