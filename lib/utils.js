var libcelt = require('../build/libcelt7.js').instance;

function stringifyError(errorId) {
  return libcelt.Pointer_stringify(libcelt._celt_strerror(errorId));
}

module.exports = {
  stringifyError: stringifyError,
};
