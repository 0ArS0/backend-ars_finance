import { Body, Controller, Post } from '@nestjs/common';
import { Public } from '../auth/auth.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthenticatedUser } from '../auth/auth.types';
import { CreateConnectTokenDto } from './dto/connect-token.dto';
import { ImportItemDto, PreviewItemDto } from './dto/sync-item.dto';
import { PluggyService } from './pluggy.service';

@Controller('api')
export class PluggyController {
  constructor(private readonly pluggyService: PluggyService) {}

  @Post('connect-token')
  createConnectToken(@Body() body: CreateConnectTokenDto, @CurrentUser() user: AuthenticatedUser) {
    return this.pluggyService.createConnectToken(user.id);
  }

  @Post('preview')
  previewItem(@Body() body: PreviewItemDto, @CurrentUser() user: AuthenticatedUser) {
    return this.pluggyService.previewItem(body.itemId, body.legalContext, user.id);
  }

  @Post('import')
  importItem(@Body() body: ImportItemDto, @CurrentUser() user: AuthenticatedUser) {
    return this.pluggyService.importItem(
      body.itemId,
      body.legalContext,
      body.selectedAccountIds,
      body.selectedTransactionIds,
      user.id
    );
  }

  @Post('webhooks/pluggy')
  @Public()
  async handleWebhook(@Body() event: Record<string, unknown>) {
    console.log('Received webhook:', event.event);
    console.log('Event ID:', event.eventId);

    void this.pluggyService
      .handleWebhook({
        event: String(event.event ?? ''),
        eventId: String(event.eventId ?? ''),
        itemId: event.itemId ? String(event.itemId) : undefined,
        error: event.error
      })
      .catch((error) => console.error('Pluggy webhook processing failed:', error));

    return { received: true };
  }
}
