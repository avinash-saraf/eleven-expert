import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { UserRole } from '../generated/prisma/enums';

export interface DemoIdentity {
  id: string;
  name: string;
  role: UserRole;
  organizationId: string;
  organizationName: string;
}

export interface DemoRequest extends Request {
  identity: DemoIdentity;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): DemoIdentity =>
    context.switchToHttp().getRequest<DemoRequest>().identity,
);

export function publicIdentity(user: DemoIdentity) {
  return {
    id: user.id,
    name: user.name,
    role: user.role.toLowerCase(),
    organization: { id: user.organizationId, name: user.organizationName },
  };
}

export function normalizeName(value: string) {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ');
}
