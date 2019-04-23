'use strict';
/**
 * This is an example of a Quty server that uses engine.io as the public websocket engine
 * and routes clients/messages through channels
 * Run the example:
 *  node engine-io.server --cluster-port=23000 --engine-port=24000
 *  node engine-io.server --cluster-port=23001 --engine-port=24001 --nodes=127.0.0.1:23000
 * */
const quty = require('../index.js'), // require('quty');
  eio = require('engine.io');

// Parse our argv variables
let arg = {};
(() => {
  process.argv.forEach((k) => {
    if (k.substr(0, 2) !== '--') return;
    let tmp = k.substr(2).split('=');
    arg[tmp[0]] = tmp[1];
  });
})();

const EIO_PORT = arg['engine-port'] || 24000,
  CLUSTER_PORT = arg['cluster-port'] || 23000;
const config = {
  port: CLUSTER_PORT,
  discovery: {
    nodes: [`127.0.0.1:${CLUSTER_PORT}`]  // you can set your own discovery nodes. For more configuration, see config/app.js
  }
};
if (arg.nodes) {
  config.discovery.nodes = config.discovery.nodes.concat(arg.nodes.split(','));
}

(async () => {
  const log = quty.log;
  quty.log.setLevel('TRACE'); // so we can see what's happening
  const cluster = new quty.Cluster(config);
  // Start our cluster
  await cluster.listen();
  cluster.on('ready', async () => {
    // Configure engine.io
    const server = eio.listen(EIO_PORT);
    log.info(`Engine.io listening on: ${EIO_PORT}`);

    // Start listening for messages from the quty internal cluster
    cluster.on('message', (channel, clientId, message) => {
      let client = server.clients[clientId];
      if (!client) return;
      // Check if we have a client subscribed + connected. If so, send it the message
      if (!cluster.isClientSubscribed(clientId, channel)) return; // check if user is in channel.
      log.info(`[engine] Sending message in [${channel}] to: ${clientId}: ${message}`);
      client.send(JSON.stringify({
        event: 'message',
        data: {
          channel,
          message: JSON.parse(message)
        }
      }));
    });

    // Make engine.io listen for connections.
    server.on('connection', (socket) => {
      log.info(`[engine] Client connected: ${socket.id}`);

      // Handle incoming messages from the client.
      // Supported messages: join, message, leave
      socket.on('message', (msg) => {
        let d = JSON.parse(msg);
        // Client joins a channel. We subscribe the socket to the channel and send a welcome message to the channel.
        if (d.event === 'join') {
          log.info(`[engine] Client joins channel: ${d.data.channel}`);
          // If you don't want to send the "welcome" message to the connecting client, just inter-change line 73 with 74
          cluster.subscribeClient(socket.id, d.data.channel);
          return sendJoinMessage(socket, d.data.channel);
        }
        if (d.event === 'message') {
          // Check if the client is previously subscribed to channel. If so, send the message through the cluster
          if (!cluster.isClientSubscribed(socket.id, d.data.channel)) return; // check if user is in channel.
          log.info(`[engine] Client sends to [${d.data.channel}]: ${d.data.message}`);
          return cluster.sendMessage(d.data.channel, {
            message: d.data.message,
            from: socket.id
          });
        }
        if (d.event === 'leave') {
          log.info(`[engine] Client leaves channel: ${d.data.channel}`);
          // Remove the client from the channel and send a "leave" message
          cluster.unsubscribeClient(socket.id, d.data.channel);
          return sendLeaveMessage(socket, d.data.channel);
        }
      });

      socket.on('close', () => {
        log.info(`[engine] Client disconnected: ${socket.id}`);
        // Let's make it interesting and broadcast the leave to our clients.
        let channels = cluster.hub.getClientSubscriptions(socket.id);
        //cluster.unsubscribeClient(socket.id);
        log.info(`[engine] Sending leave event to: ${channels.length} channels for: ${socket.id}`);
        channels.forEach((channel) => {
          sendLeaveMessage(socket, channel);
        });
      });

      // Helper functions.
      function sendLeaveMessage(socket, channel) {
        cluster.sendMessage(channel, {
          message: `${socket.id} has left the channel`,
          from: 'system'
        });
      }

      function sendJoinMessage(socket, channel) {
        cluster.sendMessage(channel, {
          message: `${socket.id} has joined the channel`,
          from: 'system'
        });
      }

    });
  });
})();
