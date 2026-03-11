import type { Logger } from '@aws-lambda-powertools/logger';

export type HonoEnv = {
  Variables: {
    spotifyId: string;
    logger: Logger;
  };
};
