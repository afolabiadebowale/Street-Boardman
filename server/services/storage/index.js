const env = require('../../config/env');

// Picks where uploads live (FEAT-042 / B1): local disk by default (one
// server, e.g. the Oracle demo), S3 with UPLOAD_STORAGE=s3 (AWS, where API
// tasks share no disk). Both expose put/get/remove.
function driver() {
  return env.uploads.driver === 's3' ? require('./s3') : require('./localDisk');
}

module.exports = {
  put: (...args) => driver().put(...args),
  get: (...args) => driver().get(...args),
  remove: (...args) => driver().remove(...args),
};
