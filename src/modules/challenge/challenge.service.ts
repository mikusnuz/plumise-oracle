import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { ChainService } from '../chain/chain.service';
import { ScorerService } from '../scorer/scorer.service';
import { Logger } from '../../utils/logger';
import { chainConfig } from '../../config/chain.config';
import { randomBytes } from 'crypto';

interface Challenge {
  id: bigint;
  difficulty: bigint;
  seed: string;
  createdAt: bigint;
  expiresAt: bigint;
  solved: boolean;
  solver: string;
  rewardBonus: bigint;
}

@Injectable()
export class ChallengeService {
  private logger = new Logger('ChallengeService');
  private currentChallenge: Challenge | null = null;
  private challengeCreationTimes: Map<number, number> = new Map();
  private syncService: any;

  constructor(
    private chainService: ChainService,
    private scorerService: ScorerService,
  ) {}

  async initialize() {
    try {
      if (!this.chainService.challengeManager) {
        this.logger.warn('ChallengeManager not configured - challenge features disabled');
        return;
      }
      await this.listenForChallengeEvents();
      await this.checkCurrentChallenge();
    } catch (error) {
      this.logger.error('Failed to initialize challenge service', process.env.NODE_ENV !== 'production' && error instanceof Error ? error.stack : error instanceof Error ? error.message : 'Unknown error');
    }
  }

  private async listenForChallengeEvents() {
    if (!this.chainService.challengeManager) return;

    this.chainService.challengeManager.on(
      'ChallengeCreated',
      (id, difficulty, seed, expiresAt, rewardBonus) => {
        this.logger.log(`Challenge created: #${id}`, {
          difficulty: difficulty.toString(),
          expiresAt: expiresAt.toString(),
        });
        this.challengeCreationTimes.set(Number(id), Date.now());
      },
    );

    this.chainService.challengeManager.on(
      'ChallengeSolved',
      (id, solver, solution, solveTime) => {
        this.logger.log(`Challenge solved: #${id} by ${solver}`, {
          solveTime: solveTime.toString(),
        });

        const creationTime = this.challengeCreationTimes.get(Number(id));
        if (creationTime) {
          const solveTimeSeconds = Math.floor((Date.now() - creationTime) / 1000);
          this.scorerService.recordTask(solver, Number(id), solveTimeSeconds);
        }
      },
    );

    this.logger.log('Challenge event listeners initialized');
  }

  @Interval(chainConfig.intervals.challenge)
  async checkAndCreateChallenge() {
    try {
      if (!this.chainService.challengeManager) {
        return;
      }

      await this.checkCurrentChallenge();

      const now = Math.floor(Date.now() / 1000);

      if (!this.currentChallenge) {
        await this.createNewChallenge();
        return;
      }

      const expiresAt = Number(this.currentChallenge.expiresAt);
      const isSolved = this.currentChallenge.solved;

      if (isSolved || now >= expiresAt) {
        this.logger.log('Current challenge expired or solved, creating new one');
        await this.createNewChallenge();
      }
    } catch (error) {
      this.logger.error('Error checking challenge', process.env.NODE_ENV !== 'production' && error instanceof Error ? error.stack : error instanceof Error ? error.message : 'Unknown error');
    }
  }

  private async checkCurrentChallenge() {
    try {
      if (!this.chainService.challengeManager) return;

      const challenge = await this.chainService.challengeManager.getCurrentChallenge();

      if (challenge && challenge.id > 0n) {
        this.currentChallenge = challenge;
        this.logger.debug('Current challenge loaded', {
          id: challenge.id.toString(),
          difficulty: challenge.difficulty.toString(),
          solved: challenge.solved,
        });

        if (this.syncService) {
          try {
            await this.syncService.syncChallenge(challenge);
          } catch (error) {
            this.logger.error('Failed to sync challenge to DB', error instanceof Error ? error.message : 'Unknown error');
          }
        }
      } else {
        this.currentChallenge = null;
      }
    } catch (error) {
      this.logger.error('Error checking current challenge', process.env.NODE_ENV !== 'production' && error instanceof Error ? error.stack : error instanceof Error ? error.message : 'Unknown error');
    }
  }

  private async createNewChallenge() {
    try {
      if (!this.chainService.challengeManager) return;

      const difficulty = 5;
      const seed = '0x' + randomBytes(32).toString('hex');
      const duration = 3600; // 1 hour

      this.logger.log('Creating new challenge', { difficulty, duration });

      const tx = await this.chainService.challengeManager.createChallenge(
        difficulty,
        seed,
        duration,
      );

      this.logger.log(`Challenge creation tx submitted: ${tx.hash}`);

      await tx.wait();
      this.logger.log('Challenge created successfully');

      await this.checkCurrentChallenge();
    } catch (error) {
      this.logger.error('Failed to create challenge', process.env.NODE_ENV !== 'production' && error instanceof Error ? error.stack : error instanceof Error ? error.message : 'Unknown error');
    }
  }

  getCurrentChallenge(): Challenge | null {
    return this.currentChallenge;
  }

  setSyncService(syncService: any) {
    this.syncService = syncService;
  }
}
