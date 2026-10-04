import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DemoIdentity } from '../auth/demo-identity';
import { PrismaService } from '../prisma/prisma.service';
import { UserRole, WorkflowStatus } from '../generated/prisma/enums';
import { CreateWorkflowDto } from './dto/create-workflow.dto';

export function hasSavedKnowledge(definition: unknown) {
  return (
    !!definition &&
    typeof definition === 'object' &&
    !Array.isArray(definition) &&
    Object.keys(definition).length > 0
  );
}

@Injectable()
export class WorkflowsService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateWorkflowDto, user: DemoIdentity) {
    if (user.role !== UserRole.EXPERT)
      throw new ForbiddenException('Only experts can create workflows');
    return this.prisma.workMap.create({
      data: {
        title: dto.title,
        organizationId: user.organizationId,
        createdById: user.id,
        status: WorkflowStatus.DRAFT,
        definition: {},
      },
      include: { createdBy: { select: { id: true, name: true } } },
    });
  }

  async list(user: DemoIdentity) {
    const workflows = await this.prisma.workMap.findMany({
      where: {
        organizationId: user.organizationId,
        ...(user.role === UserRole.EMPLOYEE
          ? { status: WorkflowStatus.READY }
          : {}),
      },
      include: { createdBy: { select: { id: true, name: true } } },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    });
    return user.role === UserRole.EMPLOYEE
      ? workflows.filter((workflow) => hasSavedKnowledge(workflow.definition))
      : workflows;
  }

  async get(id: string, user: DemoIdentity) {
    const workflow = await this.prisma.workMap.findFirst({
      where: { id, organizationId: user.organizationId },
      include: { createdBy: { select: { id: true, name: true } } },
    });
    if (!workflow) throw new NotFoundException('Workflow not found');
    if (
      user.role === UserRole.EMPLOYEE &&
      (workflow.status !== WorkflowStatus.READY ||
        !hasSavedKnowledge(workflow.definition))
    )
      throw new ConflictException('Workflow is not ready with saved knowledge');
    return workflow;
  }
}
