import {
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser, DemoIdentity } from '../auth/demo-identity';
import { DemoAuthGuard } from '../auth/demo-auth.guard';
import { MomentsService } from './moments.service';

@Controller('workflows/:workflowId/moments')
@UseGuards(DemoAuthGuard)
export class MomentsController {
  constructor(private readonly moments: MomentsService) {}

  @Get(':momentId/image')
  @Header('Content-Type', 'image/jpeg')
  @Header('Cache-Control', 'private, max-age=86400, immutable')
  async image(
    @Param('workflowId', ParseUUIDPipe) workflowId: string,
    @Param('momentId', ParseUUIDPipe) momentId: string,
    @CurrentUser() user: DemoIdentity,
  ) {
    return new StreamableFile(
      await this.moments.image(workflowId, momentId, user),
    );
  }
}
