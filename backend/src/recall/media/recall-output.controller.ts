import { Controller, Get, Header, Query } from '@nestjs/common';
import { RecallMediaService } from './recall-media.service';
import { RECALL_OUTPUT_PAGE } from './recall-output.page';

@Controller('recall/output')
export class RecallOutputController {
  constructor(private readonly media: RecallMediaService) {}

  @Get('/')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  page(@Query('streamId') streamId: string, @Query('token') token: string) {
    this.media.authenticate(
      typeof streamId === 'string' ? streamId : '',
      typeof token === 'string' ? token : '',
    );
    return RECALL_OUTPUT_PAGE;
  }
}
