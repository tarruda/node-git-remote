### node-git-remote

Provides simple API for interacting with git repositories remotely. For now
only a subset of the packfile protocol and file/ssh/git transports are
supported.

#### Installation
```sh
npm install git-remote
```

#### Usage

Consider that we are working from the same context as shown in [git-core usage](https://github.com/tarruda/node-git-core#readme)

```js
connect = require('git-remote');

// first step is to connect to some remote:
remote = connect('/local/repo.git');
// or
remote = connect('git://somehost/remote/repo.git');
// or
remote = connect('user@host:remote/repo.git', {
  key: fs.readFileSync('/path/to/ssh/private/key')
});

// fetch data
fetch = remote.fetch();

fetch.on('discover', function(refs) {
  console.log('Remote refs': refs);
  // retrieve all history of master and topic branch
  refs['heads/master'].want();
  refs['heads/topic'].want();
  fetch.flush();
});

fetch.on('progress', function(progressStatus) {
  console.log(progressStatus);
});

fetch.on('fetched', function(fetched) {
  console.log('Master branch latest commit:', fetched['heads/master']);      
  console.log('Topic branch latest commit:', fetched['heads/topic']);      
});

// It is possible to set the maximum history depth. For example, if all you
// need is the latest tree of a branch:

fetch = remote.fetch();
fetch.maxDepth = 1;

fetch.on('discover', function(refs) {
  refs['heads/master'].want();
  fetch.flush();
});

fetch.on('fetched', function(fetched) {
  console.log(fetched['heads/master'].tree);
  // the 'parents' properties of the commit only contains sha1 strings
};

// modify a remote repo
push = remote.push();

push.on('discover', function(refs) { 
 // update the master branch with the c3 and parents
 refs['heads/master'].update(c3);
 // delete a tag
 refs['tags/v0.0.1'].del();
 // create a new branch referencing 'c2'
 push.create('heads/new-branch', c2);
 // flush the commands
 push.flush();
});

push.on('pushed', function(status) {
  console.log(status);
});
```
