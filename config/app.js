'use strict';
/**
 * The main configuration file of our quty server.
 * Since we are using 2 servers, we require 2 ports to listen to:
 * - the cluster server port (should not be LB-ed outside the cluster)
 * - the client server port (should be LB-ed outside the cluster)
 * */
const config = {
  debug: 'TRACE',
  cluster: {
    namespace: 'quty', // The namespace we use for various actions
    port: 23032,  // The HTTP Port to use for cluster-node communication. This should not be exposed.
    auth: null,    // The authorisation secret used by cluster-node communication. This acts as a simple secret.
    discovery: {
      nodes: [],     // an array of "{ip}:{port}" cluster nodes to connect to
      service: null,  // The Kubernetes hostname of the service (eg: quty.app.svc.cluster.local)
    }
  },
  hub: {
    port: 8082,    // The HTTP Port to use for publicly-available client connections.
    path: '/quty' // The HTTP Websocket path to listen to
  }
};

/** ENVIRONMENT-loading of configuration */
const env = process.env;
if (env.CLUSTER_NAMESPACE) {
  config.cluster.namespace = env.CLUSTER_NAMESPACE;
}
if (env.CLUSTER_PORT) {
  config.cluster.port = parseInt(env.CLUSTER_PORT);
}
if (env.CLUSTER_AUTH) {
  config.cluster.auth = env.CLUSTER_AUTH;
}
if (env.CLUSTER_DISCOVERY_NODES) {
  let nodes = env.CLUSTER_DISCOVERY_NODES.replace(/,/g, ';').replace(/ /g, ';').split(';');
  nodes.forEach((n) => {
    if (n.trim() === '') return;
    config.cluster.discovery.nodes.push(n.trim());
  });
}
if (env.CLUSTER_DISCOVERY_SERVICE) {
  config.cluster.discovery.service = env.CLUSTER_DISCOVERY_SERVICE;
}

if (env.HUB_PORT) {
  config.hub.port = parseInt(env.HUB_PORT);
}
if (env.HUB_PATH) {
  config.hub.path = env.HUB_PATH;
}


module.exports = config;
