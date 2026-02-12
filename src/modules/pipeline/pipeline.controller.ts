import { Controller, Post, Get, Body, Query, HttpException, HttpStatus } from '@nestjs/common';
import { PipelineService } from './pipeline.service';
import { RegisterPipelineNodeDto } from './dto/register-pipeline-node.dto';
import { PipelineReadyDto } from './dto/pipeline-ready.dto';

@Controller('api/v1/pipeline')
export class PipelineController {
  constructor(private readonly pipelineService: PipelineService) {}

  @Post('register')
  async registerNode(@Body() dto: RegisterPipelineNodeDto) {
    const result = await this.pipelineService.registerNode(dto);
    if (!result.success) {
      throw new HttpException(result.message, HttpStatus.BAD_REQUEST);
    }
    return result;
  }

  @Post('ready')
  async markReady(@Body() dto: PipelineReadyDto) {
    const result = await this.pipelineService.markReady(dto);
    if (!result.success) {
      throw new HttpException(result.message, HttpStatus.BAD_REQUEST);
    }
    return result;
  }

  @Get('topology')
  async getTopology(@Query('model') model: string) {
    if (!model) {
      throw new HttpException('Model parameter is required', HttpStatus.BAD_REQUEST);
    }
    const topology = await this.pipelineService.getTopology(model);
    return {
      model,
      nodes: topology,
      count: topology.length,
    };
  }
}
