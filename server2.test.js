'use strict';
/**
 * This is an example Quty server working in cluster mode with
 * other quty servers.
 * */
//process.env.CLUSTER_DISCOVERY_NODES = "127.0.0.1:23032,127.0.0.1:23033";
const config = require('./config/app');
const quty = require('./index.js'); // change this with require('quty');
if (config.debug) quty.log.setLevel(config.debug);
const cluster = new quty.Cluster(config.cluster);
config.cluster.port = 23033;
(async () => {
  /* Start the internal cluster server */
  try {
    await cluster.listen();
  } catch (e) {
    console.error(e);
    return process.exit(1);
  }
  /* Initiate the discovery process for the cluster */
  cluster.startDiscovery();
  console.log("===========================");
  const log = quty.log;
  cluster.hub
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
  console.log("Subscribing node");
  cluster.hub.subscribeNode(cluster.id, 'channel1');
  return;
  setTimeout(() => {

  }, 2000);

  setTimeout(() => {
    console.log("Unsubscribing node");
    cluster.hub.unsubscribeNode(cluster.id, 'channel1');
  }, 10000);
})();
