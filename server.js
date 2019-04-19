'use strict';
/**
 * This is an example Quty server working in cluster mode with
 * other quty servers.
 * */

/* TEMPORARY OVERRIDES */
process.env.CLUSTER_DISCOVERY_NODES = "127.0.0.1:23032,127.0.0.1:23033";
process.env.CLUSTER_DISCOVERY_SERVICE = 'localhost';
process.env.CLUSTER_DISCOVERY_FETCH = 'http://localhost:8678/quty-discovery?test=1';

const config = require('./config/app');
const quty = require('./index.js'); // change this with require('quty');
if (config.debug) quty.log.setLevel(config.debug);


(async () => {
  const channelHub = new quty.ChannelHub();
  const cluster = new quty.Cluster(config.cluster, channelHub);
  const log = quty.log;

  /** DEBUGGING/TESTING */

  channelHub
    .on('channel.add', (name) => {
      log.info(`Adding channel: ${name}`);
    })
    .on('channel.message', (channel, msg) => {
      log.info(`Message in ${channel}: ${msg}`);
    })
    .on('channel.remove', (name) => {
      log.info(`Removing channel: ${name}`);
    })
    .on('node.join', (c, sid) => {
      log.info(`Node ${sid} joined: ${c}`);
    })
    .on('node.leave', (c, sid) => {
      log.info(`Node ${sid} left: ${c}`);
    })
    .on('client.join', (c, cid) => {
      log.info(`Client ${cid} joined: ${c}`);
    })
    .on('client.message', (channel, clientId, message) => {
      log.info(`=> SEND TO ${channel}.${clientId}: ${message}`);
    })
    .on('client.leave', (c, cid) => {
      log.info(`Client ${cid} left: ${c}`);
    });

  /* Start the internal cluster server */
  try {
    await cluster.listen();
  } catch (e) {
    console.error(e);
    return process.exit(1);
  }
  cluster.on('ready', () => {
    console.log("WE'RE READY NOW");
    return

    setTimeout(() => {
      console.log("===========================");

      channelHub.subscribeClient(cluster.id, 'client1', 'channel1');
      channelHub.sendMessage('channel1', 'message', cluster.id);
      return;

      channelHub.subscribeNode(cluster.id, 'channel1');

      let i = 0;
      setInterval(() => {
        channelHub.sendMessage('channel1', 'Hello world' + i, cluster.id);
        i++;
        if (i === 1000) {
          console.log("UNSUBSCRIBE");
          channelHub.unsubscribeNode(cluster.id, 'channel1');
        }
      }, 100);

      console.log("===========================");
    }, 2000);
  });
})();
