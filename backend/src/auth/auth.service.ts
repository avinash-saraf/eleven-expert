import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { UserRole } from '../generated/prisma/enums';
import { DemoLoginDto } from './dto/demo-login.dto';
import { DemoIdentity, normalizeName, publicIdentity } from './demo-identity';

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async login(dto: DemoLoginDto) {
    const organizationName = normalizeName(dto.organizationName);
    const name = normalizeName(dto.name);
    const role = dto.role === 'expert' ? UserRole.EXPERT : UserRole.EMPLOYEE;
    const accessToken = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const identity = await this.prisma.$transaction(async (tx) => {
      const organization = await tx.organization.upsert({
        where: { nameKey: organizationName.toLowerCase() },
        create: {
          name: organizationName,
          nameKey: organizationName.toLowerCase(),
        },
        update: {},
      });
      const user = await tx.user.upsert({
        where: {
          organizationId_nameKey_role: {
            organizationId: organization.id,
            nameKey: name.toLowerCase(),
            role,
          },
        },
        create: {
          organizationId: organization.id,
          name,
          nameKey: name.toLowerCase(),
          role,
        },
        update: {},
      });
      await tx.demoAccessToken.create({
        data: { tokenHash: this.hash(accessToken), userId: user.id, expiresAt },
      });
      return {
        id: user.id,
        name: user.name,
        role: user.role,
        organizationId: organization.id,
        organizationName: organization.name,
      };
    });
    return {
      accessToken,
      tokenType: 'Bearer',
      expiresAt,
      user: publicIdentity(identity),
    };
  }

  async authenticate(authorization?: string): Promise<DemoIdentity> {
    if (!authorization || !/^Bearer [a-f0-9]{64}$/.test(authorization))
      throw new UnauthorizedException('Invalid demo login token');
    const token = await this.prisma.demoAccessToken.findUnique({
      where: { tokenHash: this.hash(authorization.slice(7)) },
      include: { user: { include: { organization: true } } },
    });
    if (!token || token.expiresAt <= new Date())
      throw new UnauthorizedException('Invalid or expired demo login token');
    return {
      id: token.user.id,
      name: token.user.name,
      role: token.user.role,
      organizationId: token.user.organizationId,
      organizationName: token.user.organization.name,
    };
  }

  private hash(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }
}
