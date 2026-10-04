import { Injectable, NotFoundException } from '@nestjs/common';
import sharp from 'sharp';
import { DemoIdentity } from '../auth/demo-identity';
import { UserRole, WorkflowStatus } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { SensitiveBox } from '../learn/redact';

export type MomentRef = {
  id: string;
  occurredAt: string;
  offsetSeconds: number;
  caption: string;
};

@Injectable()
export class MomentsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Stores a downscaled frame so Work Map steps can show the moment on the expert's screen. */
  async capture(input: {
    id: string;
    sessionId: string;
    workMapId: string;
    png: Buffer;
    occurredAt: string;
    offsetSeconds: number;
    caption: string;
    /** Personal data on the frame; these regions are blurred before anything is stored. */
    blur?: SensitiveBox[];
  }): Promise<MomentRef> {
    const image = await this.blurred(input.png, input.blur ?? []);
    await this.prisma.screenMoment.create({
      data: {
        id: input.id,
        sessionId: input.sessionId,
        workMapId: input.workMapId,
        occurredAt: new Date(input.occurredAt),
        offsetSeconds: input.offsetSeconds,
        caption: input.caption,
        image: new Uint8Array(image),
      },
    });
    return {
      id: input.id,
      occurredAt: input.occurredAt,
      offsetSeconds: input.offsetSeconds,
      caption: input.caption,
    };
  }

  private async blurred(png: Buffer, boxes: SensitiveBox[]) {
    const base = await sharp(png)
      .resize({ width: 1280, withoutEnlargement: true })
      .toBuffer({ resolveWithObject: true });
    let image = base.data;
    const { width, height } = base.info;
    if (boxes.length) {
      const patches = await Promise.all(
        boxes.map(async (box) => {
          // Pad the region a little so a loose box still covers the text.
          const pad = 6;
          const left = Math.max(0, Math.floor(box.x * width) - pad);
          const top = Math.max(0, Math.floor(box.y * height) - pad);
          const w = Math.max(
            1,
            Math.min(width - left, Math.ceil(box.width * width) + pad * 2),
          );
          const h = Math.max(
            1,
            Math.min(height - top, Math.ceil(box.height * height) + pad * 2),
          );
          const input = await sharp(image)
            .extract({ left, top, width: w, height: h })
            .blur(30)
            .toBuffer();
          return { input, left, top };
        }),
      );
      image = await sharp(image).composite(patches).toBuffer();
    }
    return sharp(image).jpeg({ quality: 70 }).toBuffer();
  }

  /** Server-side read for the live session; callers must already own the moment. */
  async bytes(id: string) {
    const moment = await this.prisma.screenMoment.findUnique({
      where: { id },
      select: { image: true },
    });
    return moment ? Buffer.from(moment.image) : null;
  }

  async image(workflowId: string, momentId: string, user: DemoIdentity) {
    const moment = await this.prisma.screenMoment.findFirst({
      where: {
        id: momentId,
        workMapId: workflowId,
        workMap: {
          organizationId: user.organizationId,
          ...(user.role === UserRole.EMPLOYEE
            ? { status: WorkflowStatus.READY }
            : {}),
        },
      },
      select: { image: true },
    });
    if (!moment) throw new NotFoundException('Screen moment not found');
    return Buffer.from(moment.image);
  }
}
