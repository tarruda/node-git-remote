var spawn = require('child_process').spawn
  , packfile = require('./packfile-protocol');

function Remote(opts) {
  if (typeof opts.path !== 'string' || !opts.path.trim())
    throw new Error('File transport requires the repository path');

  this.path = opts.path;
}

Remote.prototype.fetch = function(cb) {
  var gitUpload = spawn('git-upload-pack', [this.path])
    , discoveryParser = new packfile.FetchDiscoveryParser(gitUpload.stdout);

  discoveryParser.once('parsed', function(discovery) {
    cb.call(discovery, null, discovery);
    cb = null;
  });

  discoveryParser.once('error', function(err) {
    cb.call(null, error);
    cb = null;
  });

  gitUpload.once('exit', function(status) {
    if (status !== 0 && cb !== null)
      cb.call(null, err);
  });
};

module.exports = Remote;
