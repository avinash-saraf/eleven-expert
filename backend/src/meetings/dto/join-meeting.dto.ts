import { Matches } from 'class-validator';

export class JoinMeetingDto {
  @Matches(
    /^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}(?:\?[^\s#]*)?$/i,
    {
      message: 'meetingUrl must be a Google Meet meeting URL',
    },
  )
  meetingUrl: string;
}
