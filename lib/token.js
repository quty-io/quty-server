'use strict';
/**
 * This handles token creation and verification.
 * Tokens are the way client-servers and server-server communicate
 * The actual token representation is divided into 2:
 *    {base64String}-{base64Signature}
 * where
 *    - base64String is the token data
 *    - base64Signature is the HMAC-sha256 signature of the data.
 * */
const crypto = require('crypto'),
  util = require('./util');
const TOKEN_HASH_ALG = 'sha256',
  TOKEN_VERSION = 1;
const token = {};

/**
 * Create a new authorisation token used by clients to connect
 * to a specific type of server.
 * @Arguments
 *  - data{} -> an object containing various attributes
 *  - opt.expire -> the date / timestamp the token expires
 *      OR
 *  - opt.ttl -> the number of milliseconds a token is valid
 *  - opt.secret -> the secret token to use to sign the data
 *  - opt.type - the type of token to create (CLUSTER or HUB). Defaults to HUB
 *  - opt.id - the server id to use
 *
 *  Result data:
 *    - data._e = the expiration timestamp
 *    - data._v = the token version
 *    - data._t = the token type
 *    - data._i = the server id
 * */
token.create = (data = {}, opt = {}) => {
  if (typeof data !== 'object' || !data) data = {};
  if (typeof opt.expire === 'object' && opt.expire instanceof Date) {
    opt.expire = opt.expire.getTime();
  }
  if (typeof opt.expire === 'number') {
    data._e = opt.expire;
  } else if (typeof opt.ttl === 'number') {
    data._e = Date.now() + opt.ttl;
  }
  data._v = TOKEN_VERSION;
  data._t = typeof opt.type === 'undefined' ? token.TYPE.HUB : opt.type;
  if (opt.id) data._i = opt.id;
  let jsonData = util.safeStringify(data);
  let b64Data = util.toBase64(jsonData);
  let result = [b64Data];
  if (opt.secret) {
    let b64Sign = crypto.createHmac(TOKEN_HASH_ALG, opt.secret).update(b64Data).digest('base64');
    result.push(b64Sign);
  }
  return result.join('-');
};

/**
 * Verifies if the provided token is valid.
 * A token is valid if:
 *  - has the _e set and it is in the future
 *  - has the _v set and it is the current version
 *  - has the _t type
 *  - if the server has auth enabled, check the auth signature
 * @Arguments
 *  - token - the string token previously created by this lib
 *  - opt.type - the type
 *  - opt.secret - the secret to use
 * */
token.verify = (token, opt = {}) => {
  try {
    if (typeof token !== 'string' || !token) return false;
    let tmp = token.split('-');
    if (tmp.length > 2) return false;
    let base64Data = tmp[0],
      base64Sign = tmp[1],
      jsonData = Buffer.from(base64Data, 'base64').toString('utf8');
    jsonData = JSON.parse(jsonData);
    if (typeof jsonData !== 'object' || !jsonData) return false;
    if (jsonData._v !== TOKEN_VERSION) return false;
    delete jsonData._v;
    if (typeof opt.type !== 'undefined') {
      if (jsonData._t !== opt.type) return false;
      delete jsonData._t;
    }
    if (jsonData._e) {
      let now = Date.now();
      if (jsonData._e < now) return false;
      delete jsonData._e;
    }
    if (!opt.secret) return jsonData;
    // Check the sign now
    let currentSign = crypto.createHmac(TOKEN_HASH_ALG, opt.secret).update(base64Data).digest('base64');
    if (base64Sign !== currentSign) return false;
    return jsonData;
  } catch (e) {
    return false;
  }
};

token.TYPE = {
  CLUSTER: 1,
  HUB: 2
};


module.exports = token;
