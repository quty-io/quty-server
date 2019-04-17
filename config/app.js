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
    auth: null    // The authorisation secret used by cluster-node communication. This acts as a simple secret.
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

if (env.HUB_PORT) {
  config.hub.port = parseInt(env.HUB_PORT);
}
if (env.HUB_PATH) {
  config.hub.path = env.HUB_PATH;
}


module.exports = config;
