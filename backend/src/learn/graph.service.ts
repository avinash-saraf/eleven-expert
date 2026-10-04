import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ClaudeService } from './claude.service';
import { WorkGraph, sanitizeGraph } from './work-graph';
import { describeError } from './apprentice-error';

function object(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}

export interface GraphDebrief {
  teachBackConfirmed: boolean;
  corrections: string;
}

// Builds the Work Map graph from the saved knowledge. It can run during a session
// (draft), after the debrief (confirmed), or on demand from the Work Map page.
@Injectable()
export class GraphService {
  private readonly logger = new Logger(GraphService.name);
  private readonly queue = new Map<string, Promise<unknown>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly claude: ClaudeService,
  ) {}

  // One build at a time per workflow, so a late draft never overwrites a newer result.
  build(
    workflowId: string,
    options: { status: WorkGraph['status']; debrief?: GraphDebrief },
  ): Promise<WorkGraph | null> {
    const run = (this.queue.get(workflowId) ?? Promise.resolve())
      .catch(() => undefined)
      .then(() => this.run(workflowId, options));
    this.queue.set(workflowId, run);
    void run
      .catch(() => undefined)
      .finally(() => {
        if (this.queue.get(workflowId) === run) this.queue.delete(workflowId);
      });
    return run;
  }

  private async run(
    workflowId: string,
    options: { status: WorkGraph['status']; debrief?: GraphDebrief },
  ) {
    const workflow = await this.prisma.workMap.findUniqueOrThrow({
      where: { id: workflowId },
    });
    const apprentice = object(object(workflow.definition).apprentice);
    const knowledge: any[] = Array.isArray(apprentice.knowledge)
      ? apprentice.knowledge
      : [];
    if (!knowledge.length) return null;
    let raw: { nodes: any[]; edges: any[] };
    try {
      raw = await this.claude.buildGraph(
        {
          title: workflow.title,
          knowledge: knowledge.map((item) => ({
            id: item.id,
            kind: item.kind,
            statement: item.statement,
            quote: item.evidence?.[0]?.text ?? null,
            saidAt: item.evidence?.[0]?.occurredAt ?? item.learnedAt,
          })),
          previousGraph: apprentice.graph ?? null,
          debrief: options.debrief ?? null,
        },
        AbortSignal.timeout(90000),
      );
    } catch (error) {
      this.logger.warn(
        `Work Map graph build failed: workflow=${workflowId}: ${describeError(error)}`,
      );
      throw error;
    }
    const graph = sanitizeGraph(raw, knowledge, options.status);
    if (!graph) {
      this.logger.warn(`Work Map graph was empty: workflow=${workflowId}`);
      return null;
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await this.prisma.$transaction(
          async (tx) => {
            const latest = await tx.workMap.findUniqueOrThrow({
              where: { id: workflowId },
            });
            const definition = object(latest.definition);
            await tx.workMap.update({
              where: { id: workflowId },
              data: {
                definition: {
                  ...definition,
                  apprentice: { ...object(definition.apprentice), graph },
                } as Prisma.InputJsonValue,
              },
            });
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
        this.logger.log(
          `Work Map graph saved: workflow=${workflowId} status=${graph.status} nodes=${graph.nodes.length} edges=${graph.edges.length}`,
        );
        return graph;
      } catch (error) {
        if ((error as any)?.code !== 'P2034' || attempt === 2) throw error;
      }
    }
    return null;
  }
}
