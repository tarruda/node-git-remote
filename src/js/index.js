var FileRemote = require('./file-transport')
  , GitRemote = require('./git-transport')
  , SSHRemote = require('./ssh-transport')
  , SSH_REL = /^\s*(.+?)@(.+?)\:(.+?)\s*$/i
  , SSH_ABS = /^\s*(?:ssh\:\/\/)(.+)@(.+?)\/(.+?)\s*$/i
  , GIT = /^\s*(?:git\:\/\/)(.+?)\/(.+?)\s*$/i
  , FILE = /^\s*(?:file\:\/\/)?(.+?)\s*$/i;

function connect(url, opts) {
  var match, k
    , remoteOpts = {};

  for (k in opts) {
    remoteOpts[k] = opts[k];
  }

  if (match = SSH_REL.exec(url)) {
    remoteOpts.user = match[1];
    remoteOpts.host = match[2];
    remoteOpts.path = match[3];
    return new SSHRemote(remoteOpts);
  } else if (match = SSH_ABS.exec(url)) {
    remoteOpts.user = match[1];
    remoteOpts.host = match[2];
    remoteOpts.path = '/' + match[3];
    return new SSHRemote(remoteOpts);
  } else if (match = GIT.exec(url)) {
    remoteOpts.host = match[1];
    remoteOpts.path = match[2];
    return new GitRemote(remoteOpts);
  } else if (match = FILE.exec(url)) {
    remoteOpts.path = match[1];
    return new FileRemote(remoteOpts);
  } else {
    throw new Error('Invalid repository URL');
  }

}

module.exports = connect;
