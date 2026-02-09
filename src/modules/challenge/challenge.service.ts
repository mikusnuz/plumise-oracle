import { Injectable, OnModuleInit } from '@nestjs/common';
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
export class ChallengeService implements OnModuleInit {
  private logger = new Logger('ChallengeService');
  private currentChallenge: Challenge | null = null;
  private challengeCreationTimes: Map<number, number> = new Map();

  constructor(
    private chainService: ChainService,
    private scorerService: ScorerService,
  ) {}

  async onModuleInit() {
    try {
      await this.listenForChallengeEvents();
      await this.checkCurrentChallenge();
    } catch (error) {
      this.logger.error('Failed to initialize challenge service', error.stack);
    }
  }

  private async listenForChallengeEvents() {
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
      this.logger.error('Error checking challenge', error.stack);
    }
  }

  private async checkCurrentChallenge() {
    try {
      const challenge = await this.chainService.challengeManager.getCurrentChallenge();

      if (challenge && challenge.id > 0n) {
        this.currentChallenge = challenge;
        this.logger.debug('Current challenge loaded', {
          id: challenge.id.toString(),
          difficulty: challenge.difficulty.toString(),
          solved: challenge.solved,
        });
      } else {
        this.currentChallenge = null;
      }
    } catch (error) {
      this.logger.error('Error checking current challenge', error.stack);
    }
  }

  private async createNewChallenge() {
    try {
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
      this.logger.error('Failed to create challenge', error.stack);
    }
  }

  getCurrentChallenge(): Challenge | null {
    return this.currentChallenge;
  }
}
