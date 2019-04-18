'use strict';
/**
 * These are our small, well-defined events that are sent from
 * server-to-server and from client-to-server
 * Since we want our events to be quite small and not add to the payload,
 * we will use numbers.
 * NOTE:
 * Since we are using raw string when sending data with websockets,
 * we will be using strings as the event representation as well.
 * */
const CLUSTER = {
  NODE_INFO: "I", // Event sent from the cluster server to the cluster node, announcing the server's id, so that the client know who is he connected to
  NODE_STATE: "S",  // Event fired when we want to broadcast the state of our node's peered connection
  CHANNEL_JOIN: "J",
  CHANNEL_MESSAGE: "M",
  CHANNEL_LEAVE: "L"
};

const HUB = {};

module.exports = {
  CLUSTER,
  HUB
};
