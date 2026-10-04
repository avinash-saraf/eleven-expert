import {
  BadGatewayException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DemoIdentity } from '../auth/demo-identity';
import { PrismaService } from '../prisma/prisma.service';
import {
  SessionMode,
  SessionStatus,
  UserRole,
  WorkflowStatus,
} from '../generated/prisma/enums';
import { MeetingsService } from '../meetings/meetings.service';
import { RecallConfiguration } from '../recall/recall.configuration';
import { RecallMediaService } from '../recall/media/recall-media.service';
import { parseRecallMediaPacket } from '../recall/media/recall-media.packet';
import { SessionsService } from '../sessions/sessions.service';
import { mediaFixture } from '../../test/fixtures/recall-media';
import { WorkflowSessionsService } from './workflow-sessions.service';
import { WorkflowsService } from './workflows.service';

describe('Persisted workflow sessions with realtime media', () => {
  const expert: DemoIdentity = {
    id: 'expert-1',
    name: 'Alex',
    role: UserRole.EXPERT,
    organizationId: 'org-1',
    organizationName: 'Sellmate',
  };
  const employee = { ...expert, id: 'employee-1', role: UserRole.EMPLOYEE };
  const meetingUrl = 'https://meet.google.com/abc-defg-hij';
  let records: Map<string, any>;
  let workflow: any;
  let prisma: any;
  let recall: any;
  let legacy: any;
  let media: RecallMediaService;
  let service: WorkflowSessionsService;

  beforeEach(() => {
    records = new Map();
    workflow = {
      id: 'workflow-1',
      organizationId: 'org-1',
      status: WorkflowStatus.DRAFT,
      definition: {},
    };
    prisma = {
      workMap: {
        findFirst: jest.fn(async ({ where }) =>
          where.id === workflow.id &&
          where.organizationId === workflow.organizationId
            ? workflow
            : null,
        ),
      },
      session: {
        create: jest.fn(async ({ data }) => {
          const session = {
            id: `session-${records.size + 1}`,
            status: SessionStatus.CREATING,
            recallBotId: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            ...data,
          };
          records.set(session.id, session);
          return { ...session };
        }),
        findUnique: jest.fn(
          async ({ where }) =>
            [...records.values()].find(
              (session) => session.requestKey === where.requestKey,
            ) ?? null,
        ),
        findFirst: jest.fn(async ({ where }) => {
          const session = records.get(where.id);
          return session &&
            session.workMapId === where.workMapId &&
            session.userId === where.userId &&
            where.workMap.organizationId === workflow.organizationId
            ? { ...session }
            : null;
        }),
        updateMany: jest.fn(async ({ where, data }) => {
          const session = records.get(where.id);
          if (
            !session ||
            (where.status && session.status !== where.status) ||
            (where.recallBotId === null && session.recallBotId !== null)
          )
            return { count: 0 };
          Object.assign(session, data);
          return { count: 1 };
        }),
      },
    };
    recall = {
      createMediaBot: jest.fn().mockResolvedValue({ id: 'bot-1' }),
      leaveCall: jest.fn(),
    };
    legacy = {
      stop: jest.fn(async (id) => ({
        ...records.get(id),
        status: SessionStatus.STOPPING,
      })),
    };
    media = new RecallMediaService();
    const meetings = new MeetingsService(
      recall,
      new RecallConfiguration(
        new ConfigService({
          RECALL_REGION: 'us-west-2',
          RECALL_API_KEY: 'test-key',
          GOOGLE_LOGIN_GROUP_ID: 'group-1',
          RECALL_PUBLIC_WEBSOCKET_URL:
            'wss://backend.example.com/recall/media/',
        }),
      ),
      media,
    );
    service = new WorkflowSessionsService(
      prisma as PrismaService,
      new WorkflowsService(prisma),
      meetings,
      media,
      recall,
      legacy as SessionsService,
    );
  });

  afterEach(() => media.onModuleDestroy());

  it('persists a Learn session before bot creation and associates media without fabricating knowledge', async () => {
    recall.createMediaBot.mockImplementation(
      async (_url, _stream, _callback, metadata) => {
        expect(records.get(metadata.session_id)).toMatchObject({
          workMapId: 'workflow-1',
          userId: expert.id,
          mode: 'LEARN',
        });
        return { id: 'bot-1' };
      },
    );
    const session = await service.create(
      workflow.id,
      meetingUrl,
      expert,
      'first-session',
    );
    expect(session).toMatchObject({
      workflowId: 'workflow-1',
      userId: expert.id,
      mode: SessionMode.LEARN,
      status: SessionStatus.JOINING,
      botId: 'bot-1',
    });
    expect(session).not.toHaveProperty('requestKey');
    expect(session).not.toHaveProperty('requestFingerprint');
    expect(workflow).toMatchObject({
      status: WorkflowStatus.DRAFT,
      definition: {},
    });
    const [, streamId, callback, metadata] =
      recall.createMediaBot.mock.calls[0];
    expect(metadata).toEqual({
      session_id: session.id,
      workflow_id: workflow.id,
      mode: 'LEARN',
    });
    expect(new URL(callback).searchParams.get('streamId')).toBe(
      session.streamId,
    );
    media.ingest(streamId, parseRecallMediaPacket(mediaFixture('audio')));
    await expect(
      service.mediaStatus(workflow.id, session.id, expert),
    ).resolves.toMatchObject({ botId: 'bot-1', audioPackets: 1 });
  });

  it('derives Teach mode for an employee using ready saved knowledge', async () => {
    workflow.status = WorkflowStatus.READY;
    workflow.definition = { steps: ['Check fulfillment before refunding'] };
    await expect(
      service.create(workflow.id, meetingUrl, employee),
    ).resolves.toMatchObject({ mode: SessionMode.TEACH, userId: employee.id });
  });

  it('never calls Recall for employee draft sessions or foreign workflows', async () => {
    await expect(
      service.create(workflow.id, meetingUrl, employee),
    ).rejects.toThrow(ConflictException);
    await expect(
      service.create('foreign-workflow', meetingUrl, expert),
    ).rejects.toThrow(NotFoundException);
    expect(recall.createMediaBot).not.toHaveBeenCalled();
    expect(prisma.session.create).not.toHaveBeenCalled();
  });

  it('reuses the same request without another bot and rejects a changed meeting', async () => {
    const first = await service.create(
      workflow.id,
      meetingUrl,
      expert,
      'demo-1',
    );
    const repeated = await service.create(
      workflow.id,
      meetingUrl,
      expert,
      'demo-1',
    );
    expect(repeated.id).toBe(first.id);
    expect(recall.createMediaBot).toHaveBeenCalledTimes(1);
    await expect(
      service.create(
        workflow.id,
        'https://meet.google.com/xyz-abcd-efg',
        expert,
        'demo-1',
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('scopes idempotency keys to the logged-in user', async () => {
    workflow.status = WorkflowStatus.READY;
    workflow.definition = { steps: ['One'] };
    const first = await service.create(
      workflow.id,
      meetingUrl,
      expert,
      'demo-1',
    );
    const second = await service.create(
      workflow.id,
      meetingUrl,
      employee,
      'demo-1',
    );
    expect(second.id).not.toBe(first.id);
    expect(recall.createMediaBot).toHaveBeenCalledTimes(2);
  });

  it('preserves an early Recall lifecycle status', async () => {
    recall.createMediaBot.mockImplementation(
      async (_url, _stream, _callback, metadata) => {
        Object.assign(records.get(metadata.session_id), {
          status: SessionStatus.RECORDING,
          recallBotId: 'bot-1',
        });
        return { id: 'bot-1' };
      },
    );
    await expect(
      service.create(workflow.id, meetingUrl, expert),
    ).resolves.toMatchObject({ status: SessionStatus.RECORDING });
  });

  it('persists a failed creation and does not automatically retry', async () => {
    recall.createMediaBot.mockRejectedValue(new Error('private provider body'));
    await expect(
      service.create(workflow.id, meetingUrl, expert),
    ).rejects.toThrow(BadGatewayException);
    expect(records.get('session-1').status).toBe(SessionStatus.FAILED);
    expect(recall.createMediaBot).toHaveBeenCalledTimes(1);
  });

  it('removes a bot if persisting its association fails', async () => {
    prisma.session.updateMany.mockRejectedValueOnce(new Error('DB failed'));
    await expect(
      service.create(workflow.id, meetingUrl, expert),
    ).rejects.toThrow('DB failed');
    expect(recall.leaveCall).toHaveBeenCalledWith('bot-1');
  });

  it('blocks reading, stopping, or inspecting another user session', async () => {
    const session = await service.create(workflow.id, meetingUrl, expert);
    for (const identity of [
      employee,
      { ...expert, organizationId: 'other-org' },
    ]) {
      await expect(
        service.get(workflow.id, session.id, identity),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.stop(workflow.id, session.id, identity),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.mediaStatus(workflow.id, session.id, identity),
      ).rejects.toThrow(NotFoundException);
    }
    expect(legacy.stop).not.toHaveBeenCalled();
    await expect(
      service.stop(workflow.id, session.id, expert),
    ).resolves.toMatchObject({ status: SessionStatus.STOPPING });
  });
});
