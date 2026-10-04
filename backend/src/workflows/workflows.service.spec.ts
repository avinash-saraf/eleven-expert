import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { WorkflowsService } from './workflows.service';
import { PrismaService } from '../prisma/prisma.service';
import { DemoIdentity } from '../auth/demo-identity';
import { UserRole, WorkflowStatus } from '../generated/prisma/enums';

describe('Organization workflows and readiness', () => {
  const expert: DemoIdentity = {
    id: 'expert-1',
    name: 'Alex',
    role: UserRole.EXPERT,
    organizationId: 'org-1',
    organizationName: 'Sellmate',
  };
  const employee = { ...expert, id: 'employee-1', role: UserRole.EMPLOYEE };
  let prisma: any;
  let service: WorkflowsService;

  beforeEach(() => {
    prisma = {
      workMap: {
        create: jest.fn().mockResolvedValue({ id: 'workflow-1' }),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
      },
    };
    service = new WorkflowsService(prisma as PrismaService);
  });

  it('creates an empty draft owned by the expert organization', async () => {
    await service.create({ title: 'Refund workflow' }, expert);
    expect(prisma.workMap.create.mock.calls[0][0].data).toEqual({
      title: 'Refund workflow',
      organizationId: 'org-1',
      createdById: 'expert-1',
      status: 'DRAFT',
      definition: {},
    });
  });

  it('prevents employees from creating workflows', () => {
    expect(() => service.create({ title: 'Refund' }, employee)).toThrow(
      ForbiddenException,
    );
    expect(prisma.workMap.create).not.toHaveBeenCalled();
  });

  it('lists organization workflows and requires saved knowledge for employees', async () => {
    prisma.workMap.findMany.mockResolvedValue([
      {
        id: 'ready',
        status: 'READY',
        definition: { steps: ['Check fulfillment'] },
      },
      { id: 'empty', status: 'READY', definition: {} },
    ]);
    await expect(service.list(employee)).resolves.toEqual([
      {
        id: 'ready',
        status: 'READY',
        definition: { steps: ['Check fulfillment'] },
      },
    ]);
    expect(prisma.workMap.findMany.mock.calls[0][0].where).toEqual({
      organizationId: 'org-1',
      status: 'READY',
    });
    await service.list(expert);
    expect(prisma.workMap.findMany.mock.calls[1][0].where).toEqual({
      organizationId: 'org-1',
    });
  });

  it.each([
    { status: WorkflowStatus.DRAFT, definition: {} },
    { status: WorkflowStatus.DRAFT, definition: { steps: ['One'] } },
    { status: WorkflowStatus.READY, definition: {} },
    { status: WorkflowStatus.READY, definition: null },
  ])(
    'rejects employee access until both readiness and knowledge are present: %j',
    async (workflow) => {
      prisma.workMap.findFirst.mockResolvedValue(workflow);
      await expect(service.get('workflow-1', employee)).rejects.toThrow(
        ConflictException,
      );
    },
  );

  it('allows an expert to use drafts and an employee to use ready knowledge', async () => {
    prisma.workMap.findFirst.mockResolvedValue({
      status: 'DRAFT',
      definition: {},
    });
    await expect(service.get('workflow-1', expert)).resolves.toMatchObject({
      status: 'DRAFT',
    });
    prisma.workMap.findFirst.mockResolvedValue({
      status: 'READY',
      definition: { steps: ['One'] },
    });
    await expect(service.get('workflow-1', employee)).resolves.toMatchObject({
      status: 'READY',
    });
  });

  it('does not expose workflows belonging to another organization', async () => {
    prisma.workMap.findFirst.mockResolvedValue(null);
    await expect(service.get('foreign-workflow', expert)).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.workMap.findFirst.mock.calls[0][0].where).toEqual({
      id: 'foreign-workflow',
      organizationId: 'org-1',
    });
  });
});
