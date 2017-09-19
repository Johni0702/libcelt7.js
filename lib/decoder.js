var libceltjs = require('../build/libcelt7.js');
var utils = require('./utils');
var util = require('util');
var extend = require('extend');
var Transform = require('stream').Transform;
var e = function(msg) { return new Error(msg); };

/**
 * Decoder for CELT 0.7.1 streams.
 *
 * @param {object} [opts={}] - Options for the decoder
 * @param {number} [opts.rate=48000] - Sampling rate of output signal (32k to 96k Hz)
 * @param {number} [opts.frameSize=256] - Samples (per channel) per packet (event, 64 - 512)
 * @param {number} [opts.channels=1] - Number of (interleaved?) channels (CELT docs unclear, only tested with 1)
 * @param {boolean} [opts.unsafe=false] - Mark this decoder as unsafe.<br>
 *    Decoder in unsafe mode generally operate faster and use far less memory.<br>
 *    Warning: {@link #destroy()} MUST be called on an unsafe decoder before 
 *    it is garbage collected. Otherwise it will leak memory.
 * @constructor
 */
function Decoder(opts) {
  // Allow use without new
  if (!(this instanceof Decoder)) return new Decoder(opts);

  opts = extend({
    rate: 48000,
    frameSize: 256,
    channels: 1,
    unsafe: false
  }, opts);

  if (opts.channels < 1) {
    throw e("channels must be greater than 0");
  }
  if (opts.rate < 32000 || opts.rate > 96000) {
    throw e("rate must be in range 32000 - 96000");
  }
  if (opts.rate % 2 != 0) {
    throw e("rate must be even");
  }

  this._rate = opts.rate;
  this._frameSize = opts.frameSize;
  this._channels = opts.channels;
  this._unsafe = opts.unsafe;

  if (this._unsafe) {
    this._lib = libceltjs.instance // use global instance
  } else {
    this._lib = libceltjs() // create own instance
  }

  var p_err = this._lib._malloc(4)
  try {
    this._mode = this._lib._celt_mode_create(this._rate, this._frameSize, p_err)
    if (this._mode === 0) {
      throw this._error(p_err)
    }
    this._dec_p = this._lib._celt_decoder_create(this._mode, this._channels, p_err)
    if (this._dec_p === 0) {
      this._lib._celt_mode_destroy(this._mode)
      throw this._error(p_err)
    }
  } finally {
    this._lib._free(p_err)
  }
}

/**
 * Destroy this decoder.
 * This method should only be called if this decoder is in unsafe mode.
 * Any subsequent calls to any encode method will result in undefined behavior.
 */
Decoder.prototype.destroy = function() {
  if (this._unsafe) {
    this._lib._celt_decoder_destroy(this._dec_p)
    this._lib._celt_mode_destroy(this._mode)
  }
};

/**
 * Handles an error returned by libcelt.
 *
 * @param {number} p_err - Pointer to the error code
 * @returns {Error} A new Error object ready to be thrown
 */
Decoder.prototype._error = function (p_err) {
  var err = this._lib.HEAPU32[p_err >> 2]
  return new Error(utils.stringifyError(err))
}

/**
 * Decodes a CELT packet and returns it as an Int16Array.
 * Packets have to be decoded in the same order they were encoded in and a lost
 * packet must be indicated by passing null as the data.
 *
 * @param {Buffer|number} data - Encoded input data or number of lost samples
 * @returns {Int16Array} The decoded output
 */
Decoder.prototype.decodeInt16 = function(data) {
  return new Int16Array(this._decode(data, 2, this._lib._celt_decode));
};

/**
 * Decodes CELT packet and returns it as an Float32Array.
 * Packets have to be decoded in the same order they were encoded in and a lost
 * packet must be indicated by passing null as the data.
 *
 * @param {Buffer|number} data - Encoded input data or number of lost samples
 * @returns {Float32Array} The decoded output
 */
Decoder.prototype.decodeFloat32 = function(data) {
  return new Float32Array(this._decode(data, 4, this._lib._celt_decode_float));
};

/**
 * Decode the input data and leave result on HEAP.
 *
 * @param {Buffer|number} data - Encoded input data
 * @param {number} bps - Bytes per sample
 * @param {function} doDecode - CELT decode function
 * @returns ArrayBuffer of decoded data
 */
Decoder.prototype._decode = function(data, bps, doDecode) {
  var pcmSize = this._frameSize * bps * this._channels;
  var p_pcm = this._lib._malloc(pcmSize);
  var p_data, data_len;
  try {
    if (data === null) {
      data_len = 0;
      p_data = 0;
    } else if (data instanceof Buffer) {
      data_len = data.length;
      p_data = this._lib._malloc(data_len);
      this._lib.HEAPU8.set(data, p_data);
    } else {
      throw new TypeError('data must be Buffer or null');
    }

    var ret = doDecode(this._dec_p, p_data, data_len, p_pcm);

    // Handle result
    if (ret < 0) {
      throw e(utils.stringifyError(ret));
    }
    return this._lib.HEAPU8.slice(p_pcm, p_pcm + pcmSize).buffer;
  } finally {
    if (p_data) {
      this._lib._free(p_data)
    }
    this._lib._free(p_pcm)
  }
};

/**
 * Creates a transform stream from this decoder.
 * Lost packets should be indicated by an empty buffer.
 *
 * @param [('Float32'|'Int16')] mode - Type of sample output
 * @returns {DecoderStream}
 */
Decoder.prototype.stream = function(mode) {
  return new DecoderStream(this, mode);
};

function DecoderStream(decoder, mode) {
  Transform.call(this, {});

  if (mode == 'Float32') {
    this._decode = decoder.decodeFloat32.bind(decoder);
  } else if (mode == 'Int16') {
    this._decode = decoder.decodeInt16.bind(decoder);
  } else {
    throw new TypeError('mode cannot be ' + mode);
  }
}
util.inherits(DecoderStream, Transform);

DecoderStream.prototype._transform = function(chunk, encoding, callback) {
  var result;
  try {
    var array = this._decode(chunk);
    result = Buffer.from(array.buffer, array.byteOffset, array.byteLength);
  } catch (err) {
    return callback(err);
  }
  callback(null, result);
};

module.exports = Decoder;
