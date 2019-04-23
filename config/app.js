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
      service: null,  // The Kubernetes (or any, really) hostname of the service (eg: quty.app.svc.cluster.local) we will DNS_resolve and use the IPs to connect to the nodes.
      fetch: null,    // An HTTP(s) API endpoint to call to retrieve the array of nodes to connect to.
      timer: 3000     // The number of milliseconds we try to discover new nodes.
    },
    maxReadyAfter: 4000 // The maximum number of ms the server will emit the 'ready' state. Setting this to 0 will not wait for the cluster state before triggering 'ready'
  },
  hub: {
    port: 8082,    // The HTTP Port to use for publicly-available client connections.
    path: '/quty' // The HTTP Websocket path to listen to
  }
};

/** ENVIRONMENT-loading of configuration */
const env = process.env;
if (env.CLUSTER_DEBUG) {
  config.debug = env.CLUSTER_DEBUG;
}
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
if (env.CLUSTER_DISCOVERY_FETCH) {
  config.cluster.discovery.fetch = env.CLUSTER_DISCOVERY_FETCH;
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
