import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '../../utils/logger';

@WebSocketGateway({
  cors: {
    origin: '*',
    credentials: true,
  },
  namespace: '/pipeline',
})
export class PipelineGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private logger = new Logger('PipelineGateway');

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  emitTopologyChange(model: string, topology: any[]) {
    this.server.emit('pipeline:topology', {
      model,
      nodes: topology,
      count: topology.length,
      timestamp: Date.now(),
    });
    this.logger.log(`Emitted topology change for ${model}: ${topology.length} nodes`);
  }

  emitNodeStatusChange(address: string, model: string, ready: boolean) {
    this.server.emit('pipeline:nodeStatus', {
      address,
      model,
      ready,
      timestamp: Date.now(),
    });
    this.logger.log(`Emitted node status change: ${address} (${model}) - ready: ${ready}`);
  }

  emitNodeJoined(address: string, model: string) {
    this.server.emit('pipeline:nodeJoined', {
      address,
      model,
      timestamp: Date.now(),
    });
    this.logger.log(`Emitted node joined: ${address} (${model})`);
  }

  emitNodeLeft(address: string, model: string) {
    this.server.emit('pipeline:nodeLeft', {
      address,
      model,
      timestamp: Date.now(),
    });
    this.logger.log(`Emitted node left: ${address} (${model})`);
  }
}
