var libceltjs = require('../build/libcelt7.js');
var utils = require('./utils');
var util = require('util');
var extend = require('extend');
var Transform = require('stream').Transform;
var e = function(msg) { return new Error(msg); };

/**
 * Encoder for CELT 0.7.1 streams.
 *
 * @param {object} [opts={}] - Options for the encoder
 * @param {number} [opts.rate=48000] - Sampling rate of input signal (32k to 96k Hz)
 * @param {number} [opts.frameSize=256] - Samples (per channel) per packet (event, 64 - 512)
 * @param {number} [opts.channels=1] - Number of (interleaved?) channels (CELT docs unclear, only tested with 1)
 * @param {boolean} [opts.unsafe=false] - Mark this encoder as unsafe.<br>
 *    Encoders in unsafe mode generally operate faster and use far less memory.<br>
 *    Warning: {@link #destroy()} MUST be called on an unsafe encoder before 
 *    it is garbage collected. Otherwise it will leak memory.
 * @constructor
 */
function Encoder(opts) {
  // Allow use without new
  if (!(this instanceof Encoder)) return new Encoder(opts);

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
  this._application = opts.application;
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
    this._enc_p = this._lib._celt_encoder_create(this._mode, this._channels, p_err)
    if (this._enc_p === 0) {
      this._lib._celt_mode_destroy(this._mode)
      throw this._error(p_err)
    }
  } finally {
    this._lib._free(p_err)
  }
}

/**
 * Destroy this encoder.
 * This method should only be called if this encoder is in unsafe mode.
 * Any subsequent calls to any encode method will result in undefined behavior.
 */
Encoder.prototype.destroy = function() {
  if (this._unsafe) {
    this._lib._celt_encoder_destroy(this._enc_p)
    this._lib._celt_mode_destroy(this._mode)
  }
};

/**
 * Handles an error returned by libcelt.
 *
 * @param {number} p_err - Pointer to the error code
 * @returns {Error} A new Error object ready to be thrown
 */
Encoder.prototype._error = function (p_err) {
  var err = this._lib.HEAPU32[p_err >> 2]
  return new Error(utils.stringifyError(err))
}

/**
 * Encodes an array of (interleaved) pcm samples.
 *
 * @param {Int16Array|Float32Array} pcm - Input samples
 * @param {number} compressedSize - Target size of compressed packet
 * @returns {Buffer} The encoded output
 */
Encoder.prototype.encode = function(pcm) {
  if (pcm.length !== this._frameSize * this._channels) {
    throw e('frames must be exactly of size frameSize * channels');
  }
  var encode;
  var p_pcm;
  try {
    if (pcm instanceof Float32Array) {
      p_pcm = this._lib._malloc(pcm.length * 4);
      this._lib.HEAPF32.set(pcm, p_pcm >> 2);
      encode = this._lib._celt_encode_float.bind(this._lib);
    } else if (pcm instanceof Int16Array) {
      p_pcm = this._lib._malloc(pcm.length * 2);
      this._lib.HEAP16.set(pcm, p_pcm >> 1);
      encode = this._lib._celt_encode.bind(this._lib);
    } else {
      throw new TypeError('pcm must be Int16Array or Float32Array');
    }
    var p_data = this._lib._malloc(compressedSize);
    try {
      var len = encode(this._enc_p, p_pcm, 0, p_data, compressedSize);
      if (len < 0) {
        throw e(utils.stringifyError(len));
      }
      return Buffer.from(this._lib.HEAPU8.subarray(p_data, p_data + len));
    } finally {
      this._lib._free(p_data);
    }
  } finally {
    if (p_pcm) {
      this._lib._free(p_pcm);
    }
  }
};

/**
 * Creates a transform stream from this encoder.
 * Since the stream always receives a Buffer object, the actual sample
 * type has to be specified manually.
 *
 * @param [('Float32'|'Int16')] mode - Type of sample input
 * @param {number} packetSize - Target size of compressed packets
 * @returns {EncoderStream}
 */
Encoder.prototype.stream = function(mode, packetSize) {
  return new EncoderStream(this, mode, packetSize);
};

function EncoderStream(encoder, mode, packetSize) {
  Transform.call(this, {});

  this._encoder = encoder;
  if (mode == 'Float32') {
    this._mode = Float32Array;
  } else if (mode == 'Int16') {
    this._mode = Int16Array;
  } else {
    throw new TypeError('mode cannot be ' + mode);
  }
  this._packetSize = packetSize
}
util.inherits(EncoderStream, Transform);

EncoderStream.prototype._transform = function(chunk, encoding, callback) {
  chunk = new this._mode(chunk.buffer, chunk.byteOffset,
      chunk.byteLength / this._mode.BYTES_PER_ELEMENT);
  var result;
  try {
    result = this._encoder.encode(chunk, this._packetSize);
  } catch (err) {
    return callback(err);
  }
  callback(null, result);
};

module.exports = Encoder;
