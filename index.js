module.exports = {
  Encoder: require('./lib/encoder.js'),
  Decoder: require('./lib/decoder.js'),
  libcelt: require('./build/libcelt7.js').instance
};
