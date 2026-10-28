import type { Server, IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import { pluginWebSocketRegistry } from '../websocket.ts';
import { pageSessions } from '../../../workbench/page-sessions.ts';
import { workbenchEvents, type WorkbenchEvent } from '../../../workbench/events.ts';
import { coreBootId } from '../../../workbench/storage.ts';
import { getWorkbench } from '../../../workbench/runtime.ts';
import { plugins } from '../../../plugin/load.ts';

function reject(socket: Duplex) {
  socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
}
export function attachUpgradeDispatcher(server: Server) {
  const ws = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
  const sockets = new Set<WebSocket>();
  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    let url: URL;
    try {
      url = new URL(req.url ?? '', 'http://localhost');
    } catch {
      return reject(socket);
    }
    if (url.pathname.startsWith('/web/websocket/plugin/')) {
      void pluginWebSocketRegistry.handleUpgrade(req, socket, head);
      return;
    }
    if (url.pathname !== '/web/websocket/workbench') {
      return reject(socket);
    }
    try {
      const origin = req.headers.origin ?? '';
      const ticket = pageSessions.consume(url.searchParams.get('ticket') ?? '', origin);
      if (sockets.size >= 2000) {
        return reject(socket);
      }
      if (
        ticket.page &&
        !plugins.some(
          (p) => p.pluginId === ticket.page?.pluginId && p.safeId === ticket.page?.safeId,
        )
      ) {
        return reject(socket);
      }
      const visible = (event: WorkbenchEvent) => {
        if (ticket.page) {
          if (event.type === 'job.changed') {
            const value = event.payload as {
              owner?: { source: string; pluginId: string; tabId: string; ownerId: string };
            };
            return (
              value.owner?.source === 'page' &&
              value.owner.pluginId === ticket.page.pluginId &&
              value.owner.tabId === ticket.page.tabId &&
              value.owner.ownerId === ticket.page.frameEpoch
            );
          }
          if (event.type === 'notification.action') {
            const value = event.payload as {
              source: string;
              pluginId: string;
              tabId: string;
              ownerId: string;
            };
            return (
              value.source === 'page' &&
              value.pluginId === ticket.page.pluginId &&
              value.tabId === ticket.page.tabId &&
              value.ownerId === ticket.page.frameEpoch
            );
          }
          return event.type === 'config.changed' && event.entityId === ticket.page.pluginId;
        }
        if (event.type.startsWith('input.') || event.type.startsWith('execution.')) {
          const p = event.payload as {
            workspaceId?: string;
            executionId?: string;
            id?: string;
            terminalId?: string;
          };
          if (p.workspaceId) {
            return p.workspaceId === ticket.workspaceId;
          }
          const id = p.executionId ?? p.id;
          if (id) {
            try {
              return getWorkbench().commands.execution(id).workspaceId === ticket.workspaceId;
            } catch {
              return false;
            }
          }
        }
        if (event.type === 'workspace.changed') {
          return event.entityId === ticket.workspaceId;
        }
        if (event.stream.startsWith('output:') && event.entityId !== 'public') {
          if (!ticket.workspaceId) {
            return false;
          }
          try {
            getWorkbench().commands.terminal(event.entityId ?? '', ticket.workspaceId);
            return true;
          } catch {
            return false;
          }
        }
        return true;
      };
      ws.handleUpgrade(req, socket, head, (client) => {
        sockets.add(client);
        let initialized = false;
        const disconnected =
          !ticket.page && ticket.workspaceId
            ? getWorkbench().commands.connected(ticket.workspaceId)
            : () => {
                /* No input session for standalone pages. */
              };
        const send = (event: unknown) => {
          if (client.readyState !== client.OPEN) {
            return;
          }
          const bytes = JSON.stringify(event);
          if (client.bufferedAmount + Buffer.byteLength(bytes) > 2 * 1024 * 1024) {
            client.close(1013, 'resync-required');
            return;
          }
          client.send(bytes);
        };
        const listener = (event: WorkbenchEvent) => {
          if (ticket.page) {
            try {
              pageSessions.get(ticket.page.grant, origin);
              if (
                !plugins.some(
                  (p) => p.pluginId === ticket.page?.pluginId && p.safeId === ticket.page?.safeId,
                )
              ) {
                throw new Error('stale');
              }
            } catch {
              client.close(1008, 'page grant expired');
              return;
            }
          }
          if (initialized && visible(event)) {
            send(event);
          }
        };
        workbenchEvents.on('event', listener);
        const timer = setTimeout(() => client.close(1008, 'resume required'), 5000);
        const expiry = ticket.page
          ? setTimeout(
              () => client.close(1008, 'page grant expired'),
              Math.max(0, ticket.page.expiresAt - Date.now()),
            )
          : undefined;
        expiry?.unref();
        timer.unref();
        client.on('message', (data) => {
          try {
            if (initialized) {
              return;
            }
            const hello = JSON.parse(data.toString());
            if (
              hello.type !== 'resume' ||
              !hello.positions ||
              typeof hello.positions !== 'object' ||
              Array.isArray(hello.positions)
            ) {
              throw new Error('resume');
            }
            const replay = workbenchEvents.replay(hello.positions, hello.coreBootId);
            initialized = true;
            clearTimeout(timer);
            if (replay.gap) {
              send({
                version: 1,
                type: 'connection.resync-required',
                coreBootId,
                payload: { gap: true },
              });
            } else {
              for (const event of replay.events) {
                if (visible(event)) {
                  send(event);
                }
              }
            }
            send({ version: 1, type: 'connection.ready', coreBootId });
          } catch {
            client.close(1008, 'invalid resume');
          }
        });
        client.once('close', () => {
          clearTimeout(timer);
          clearTimeout(expiry);
          sockets.delete(client);
          workbenchEvents.off('event', listener);
          disconnected();
        });
        client.on('error', () => {
          /* close owns listener cleanup. */
        });
      });
    } catch {
      return reject(socket);
    }
  });
  server.once('close', () => {
    for (const client of sockets) {
      client.terminate();
    }
    ws.close();
  });
}
