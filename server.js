'use strict';
/**
 * This is an example Quty server working in cluster mode with
 * other quty servers.
 * */

/* TEMPORARY OVERRIDES */
//process.env.CLUSTER_DISCOVERY_NODES = "127.0.0.1:23032,127.0.0.1:23033";
process.env.CLUSTER_DISCOVERY_SERVICE = 'localhost';
const config = require('./config/app');
const quty = require('./index.js'); // change this with require('quty');
if (config.debug) quty.log.setLevel(config.debug);


(async () => {
  const channelHub = new quty.ChannelHub();
  const cluster = new quty.Cluster(config.cluster, channelHub);

  /* Start the internal cluster server */
  try {
    await cluster.listen();
  } catch (e) {
    console.error(e);
    return process.exit(1);
  }
  /* Initiate the discovery process for the cluster */
  cluster.startDiscovery();
  const log = quty.log;
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
    .on('client.leave', (c, cid) => {
      log.info(`Client ${cid} left: ${c}`);
    });
  setTimeout(() => {
    console.log("===========================");

    channelHub.subscribeNode(cluster.id, 'channel1');

    let i = 0;
    setInterval(() => {
      channelHub.sendMessage('channel1', 'Hello world' + i, cluster.id);
      i++;
      if (i === 5) {
        console.log("UNSUBSCRIBE");
        channelHub.unsubscribeNode(cluster.id, 'channel1');
      }
    }, 1000);

    console.log("===========================");
  }, 2000);
})();
