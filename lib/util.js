'use strict';
/**
 * Utility functions.
 * */
const safeJsonStringify = require('safe-json-stringify'),
  crypto = require('crypto');
let ALPHA_NUMERIC_CHARS = "AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRrSsTtUuVvWwXxYyZz1234567890",
  RANDOM_STRING = '';
for (var i = 0; i <= 255; i++) {
  let q = Math.floor(Math.random() * ALPHA_NUMERIC_CHARS.length);
  RANDOM_STRING += ALPHA_NUMERIC_CHARS[q];
}

const util = {};

/**
 * Perform safe JSON Stringify
 * */
util.safeStringify = safeJsonStringify;

util.toBase64 = (data) => {
  return Buffer.from(data).toString('base64');
};

util.randomString = (length) => {
  if (typeof length !== 'number') length = 16; // random 16 by default.
  let gen = Math.abs(parseInt(length));
  let res = '';
  try {
    let buf = crypto.randomBytes(gen);
    for (let i = 0; i < gen; i++) {
      res += RANDOM_STRING[buf.readUInt8(i)];
    }
  } catch (e) {
    console.warn('Quty.randomString: failed to generate crypto random buffer: ', e);
    return null;
  }
  return res;
};

module.exports = util;
