fs = require 'fs'
path = require 'path'
temp = require 'temp'
zlib = require 'zlib'
wrench = require 'wrench'
{spawn} = require 'child_process'
{expect} = require 'chai'
{Blob, Tree, Commit, Tag, Pack} = require 'git-core'
connect = require '../src/js'


createSuite = (transport, remote, emptyRemote, obj, extraTeardown) ->
  suite 'smart protocol ' + transport, ->

    suiteTeardown (done) ->
      if extraTeardown
        extraTeardown ->
          wrench.rmdirSyncRecursive('/' + remote.path, true)
          wrench.rmdirSyncRecursive('/' + emptyRemote.path, true)
          done()
      else
        wrench.rmdirSyncRecursive(remote.path, true)
        wrench.rmdirSyncRecursive(emptyRemote.path, true)
        done()

    test 'fetch reference discovery', (done) ->
      remaining = 1
      fetch = remote.fetch()

      fetch.on 'discover', (refs) =>
        expect(Object.keys(refs).length).to.equal 3
        expect(refs.HEAD).to.equal refs['refs/heads/master']
        expect(refs['refs/heads/master'].sha1).to.equal obj.c3.serialize()
          .getHash()
        expect(refs['refs/tags/v0.0.1'].sha1).to.equal obj.tag.serialize()
          .getHash()
        expect(refs['refs/tags/v0.0.1'].peeled).to.equal obj.c2.serialize()
          .getHash()
        remaining--
        fetch.flush()

      fetch.on 'end', ->
        if remaining
          done(new Error('Missing some verifications'))
        else
          done()

    test 'fetch reference discovery on empty repo', (done) ->
      remaining = 1
      fetch = emptyRemote.fetch()
      fetch.on 'discover', (refs) =>
        expect(Object.keys(refs).length).to.equal 0
        # can't fetch from an empty repo
        expect(fetch._capabilities).to.equal undefined
        remaining--
        fetch.flush()

      fetch.on 'end', ->
        if remaining
          done(new Error('Missing some verifications'))
        else
          done()

    test 'fetch all refs', (done) ->
      remaining = 1
      fetch = remote.fetch()

      fetch.on 'discover', (refs) ->
        refs['refs/heads/master'].want()
        fetch.flush()

      fetch.on 'fetched', (fetched) =>
        remaining--
        expect(typeof fetched['refs/heads/master'].parents[0] == 'object')
        historyShouldEqual(fetched['refs/heads/master'], obj.c3)

      fetch.on 'end', ->
        if remaining
          done(new Error('Missing some verifications'))
        else
          done()


    test 'fetch only the top commit', (done) ->
      remaining = 1
      fetch = remote.fetch()
      fetch.maxDepth = 1

      fetch.on 'discover', (refs) ->
        refs['refs/heads/master'].want()
        fetch.flush()

      fetch.on 'fetched', (fetched) =>
        remaining--
        expect(fetched['refs/heads/master'].serialize().getHash()).to.equal(
          obj.c3.serialize().getHash())
        expect(typeof fetched['refs/heads/master'].parents[0] == 'string')
        treeShouldEqual(fetched['refs/heads/master'].tree, obj.c3.tree)

      fetch.on 'end', ->
        if remaining
          done(new Error('Missing some verifications'))
        else
          done()

    test 'push reference discovery', (done) ->
      remaining = 1
      push = remote.push()

      push.on 'discover', (refs) =>
        expect(Object.keys(refs).length).to.equal 2
        expect(refs['refs/heads/master'].sha1).to.equal obj.c3.serialize()
          .getHash()
        expect(refs['refs/tags/v0.0.1'].sha1).to.equal obj.tag.serialize()
          .getHash()
        remaining--
        push.flush()

      push.on 'end', ->
        if remaining
          done(new Error('Missing some verifications'))
        else
          done()

    test 'push to empty repo', (done) ->
      remaining = 2
      push = emptyRemote.push()
      push.on 'discover', (refs) =>
        expect(Object.keys(refs).length).to.equal 0
        expect(push._capabilities).to.deep.equal [
            'report-status'
          , 'delete-refs'
          , 'side-band-64k'
          , 'quiet'
          , 'ofs-delta'
        ]
        remaining--
        push.create 'refs/heads/master', obj.n2
        push.flush()

      push.on 'pushed', (statusReport) ->
        expect(statusReport).to.deep.equal [
          'unpack ok'
          'ok refs/heads/master'
        ]
        remaining--

      push.on 'end', ->
        if remaining
          done(new Error('Missing some verifications'))
        else
          done()

    test 'push to an existing branch', (done) ->
      remaining = 1
      push = remote.push()

      push.on 'discover', (refs) =>
        refs['refs/heads/master'].update obj.n2
        push.flush()

      push.on 'pushed', (statusReport) ->
        expect(statusReport).to.deep.equal [
          'unpack ok'
          'ok refs/heads/master'
        ]
        remaining--

      push.on 'end', ->
        if remaining
          done(new Error('Missing some verifications'))
        else
          done()

    test 'push to a new branch', (done) ->
      remaining = 1
      push = remote.push()

      push.on 'discover', (refs) =>
        push.create 'refs/heads/topic', obj.n2
        push.flush()

      push.on 'pushed', (statusReport) ->
        expect(statusReport).to.deep.equal [
          'unpack ok'
          'ok refs/heads/topic'
        ]
        remaining--

      push.on 'end', ->
        if remaining
          done(new Error('Missing some verifications'))
        else
          done()

    test 'create new branch from existing commits', (done) ->
      # according to git docs, we need to send an empty packfile
      # in this case, but it seems to work anyway
      remaining = 1
      push = remote.push()

      push.on 'discover', (refs) =>
        push.create 'refs/heads/some-branch', obj.c2
        push.flush()

      push.on 'pushed', (statusReport) ->
        expect(statusReport).to.deep.equal [
          'unpack ok'
          'ok refs/heads/some-branch'
        ]
        remaining--

      push.on 'end', ->
        if remaining
          done(new Error('Missing some verifications'))
        else
          done()

    test 'delete current branch fail', (done) ->
      # Not testing this code but good for documentation anyway
      remaining = 1
      push = remote.push()

      push.on 'discover', (refs) =>
        refs['refs/heads/master'].del()
        push.flush()

      push.on 'pushed', (statusReport) ->
        expect(statusReport).to.deep.equal [
          'unpack ok'
          'ng refs/heads/master deletion of the current branch prohibited'
        ]
        remaining--

      push.on 'end', ->
        if remaining
          done(new Error('Missing some verifications'))
        else
          done()

    test 'delete tag', (done) ->
      remaining = 1
      push = remote.push()

      push.on 'discover', (refs) =>
        refs['refs/tags/v0.0.1'].del()
        push.flush()

      push.on 'pushed', (statusReport) ->
        expect(statusReport).to.deep.equal [
          'unpack ok'
          'ok refs/tags/v0.0.1'
        ]
        remaining--

      push.on 'end', ->
        if remaining
          done(new Error('Missing some verifications'))
        else
          done()

    test 'delete two branches', (done) ->
      remaining = 1
      push = remote.push()

      push.on 'discover', (refs) =>
        refs['refs/heads/some-branch'].del()
        refs['refs/heads/topic'].del()
        push.flush()

      push.on 'pushed', (statusReport) ->
        expect(statusReport).to.deep.equal [
          'unpack ok'
          'ok refs/heads/some-branch'
          'ok refs/heads/topic'
        ]
        remaining--

      push.on 'end', ->
        if remaining
          done(new Error('Missing some verifications'))
        else
          done()

    test 'create two branches and update another', (done) ->
      remaining = 1
      push = remote.push()

      push.on 'discover', (refs) =>
        push.create 'refs/heads/topic1', obj.n1
        push.create 'refs/heads/topic2', obj.n2
        refs['refs/heads/master'].update new Commit {
            tree: new Tree {
              'last-version.txt':
                new Blob 'Single file in tree for new branch'
            }
            author:
              name: 'Git User'
              email: 'user@git.com'
              date: new Date 3
            message: 'New branch second commit'
          }
        push.flush()

      push.on 'pushed', (statusReport) ->
        expect(statusReport).to.deep.equal [
          'unpack ok'
          'ok refs/heads/topic1'
          'ok refs/heads/topic2'
          'ok refs/heads/master'
        ]
        remaining--

      push.on 'end', ->
        if remaining
          done(new Error('Missing some verifications'))
        else
          done()


prepareTestEnv = (cb) ->
  createGitRepo (repoPath) ->
    # populate the repository with some objects

    d1 = new Date 1000000000
    d2 = new Date 2000000000
    d3 = new Date 3000000000
    d4 = new Date 4000000000
    str = ''
    for i in [0...1000]
      str += 'test content/test content2/test content3\n'
    b1 = new Blob str
    # this encode second blob as a delta of the first in packfiles
    b2 = new Blob str + 'append'
    b3 = new Blob 'subdir test content\n'
    t1 = new Tree {
      'file-under-tree': b3
    }
    t2 = new Tree {
      'some-file.txt': b2
      'some-file2.txt': b1
      'sub-directory.d': t1
    }
    t3 = new Tree {
      'another-file.txt': b1
    }
    c1 = new Commit {
      tree: t1
      author:
        name: 'Git Author'
        email: 'author@git.com'
        date: d1
      message: 'Artificial commit 1'
    }
    c2 = new Commit {
      tree: t2
      author:
        name: 'Git Author'
        email: 'author@git.com'
        date: d2
      message: 'Artificial commit 2'
      parents: [c1]
    }
    c3 = new Commit {
      tree: t3
      author:
        name: 'Git User'
        email: 'user@domain.com'
        date: d3
      committer:
        name: 'Git Commiter'
        email: 'committer@git.com'
        date: d4
      message: 'Artificial commit 3'
      parents: [c2]
    }
    tag = new Tag {
      object: c2
      name: 'v0.0.1'
      tagger:
        name: 'Git Tagger'
        email: 'tagger@git.com'
      date: d2
      message: 'Tag second commit'
    }
    n1 = new Commit {
      tree: new Tree {
        'single-file.txt':
          new Blob 'Single file in tree for new branch'
      }
      author:
        name: 'Git User'
        email: 'user@git.com'
        date: new Date 1
      message: 'New branch start'
    }
    n2 = new Commit {
      tree: new Tree {
        'single-file.txt':
          new Blob 'Single file in tree for new branch'
        'subdir': new Tree {
          'subdir-single-file.txt':
            new Blob 'File in subdirectory'
        }
      }
      author:
        name: 'Git User'
        email: 'user@git.com'
        date: new Date 2
      message: 'New branch second commit'
      parents: [n1]
    }
    ctx =
      b1: b1, b2: b2, b3: b3
      t1: t1, t2: t2, t3: t3
      c1: c1, c2: c2, c3: c3
      tag: tag, n1: n1, n2: n2

    writeGitGraph repoPath, c3, 'master', ->
      writeGitGraph repoPath, tag, tag.name, ->
        createGitRepo (emptyRepoPath) ->
          cb(repoPath, emptyRepoPath, ctx)

createGitRepo = (cb) ->
  temp.mkdir 'test-repo', (err, repoPath) =>
    git = spawn 'git', ['init', '--bare', repoPath]
    git.on 'exit', ->
      cb(repoPath)

writeGitGraph = (repo, root, refName, cb) ->
  count = 0
  writeCb = ->
    count--
    cb() if !count
  head = root.serialize (serialized) ->
    count++
    writeGitObject(repo, serialized, writeCb)
  if refName
    if head.getType() == 'tag'
      refType = 'tags'
    else
      refType = 'heads'
    refPath = path.join(repo, 'refs', refType, refName)
    fs.writeFileSync(refPath, head.getHash(), 'utf8')
      
writeGitObject = (repo, serialized, cb) ->
  hash = serialized.getHash()
  dir = path.join(repo, 'objects', hash.slice(0, 2))
  fs.mkdir dir, ->
    bufferPath = path.join(dir, hash.slice(2))
    bufferFile = fs.createWriteStream(bufferPath, mode: 0o444)
    deflate = zlib.createDeflate()
    deflate.pipe(bufferFile)
    bufferFile.on 'open', ->
      deflate.end(serialized.getData())
      if typeof cb == 'function' then bufferFile.on('close', cb)
    bufferFile.on 'error', (err) ->
      if typeof cb == 'function' then cb()

blobShouldEqual = (b1, b2) ->
  c1 = b1.contents
  c2 = b2.contents
  if typeof c1 == 'string'
    c1 = new Buffer(c1)
  c1 = c1.toString 'base64'
  if typeof c2 == 'string'
    c2 = new Buffer(c2)
  c2 = c2.toString 'base64'
  expect(c1).to.equal c2

treeShouldEqual = (t1, t2) ->
  for k, v of t1.children
    if v instanceof Blob
      blobShouldEqual(v, t2.children[k])
    else if v instanceof Tree
      treeShouldEqual(v, t2.children[k])
    else
      throw new Error 'err'

historyShouldEqual = (c1, c2) ->
  expect(c1.serialize().getHash()).to.equal c2.serialize().getHash()
  expect(c1.message).to.equal c2.message
  treeShouldEqual(c1.tree, c2.tree)
  for i in [0...c1.parents.length]
    historyShouldEqual(c1.parents[i], c2.parents[i])

semaphore = wait()
envsRemaining = 1

# file transport
prepareTestEnv (repoPath, emptyRepoPath, obj) ->
  createSuite 'file', connect(repoPath), connect(emptyRepoPath), obj
  ack()

# # git transport, start a temporary git daemon
daemon = spawn 'git', ['daemon', '--base-path=/', '--export-all',
  '--enable=receive-pack']
prepareTestEnv (repoPath, emptyRepoPath, obj) ->
  repoPath = "git://127.0.0.1#{repoPath}"
  emptyRepoPath = "git://127.0.0.1#{emptyRepoPath}"
  createSuite 'git', connect(repoPath), connect(emptyRepoPath), obj,
    (cb) ->
      daemon.kill 'SIGKILL'
      cb()
  ack()

# ssh transport, need to append 'git-test.pub' contents to
# authorized_keys and have a ssh server running(user also
# needs to be 'tarruda')
prepareTestEnv (repoPath, emptyRepoPath, obj) ->
  repoPath = "tarruda@127.0.0.1:#{repoPath}"
  emptyRepoPath = "tarruda@127.0.0.1:#{emptyRepoPath}"
  opts =
    key: fs.readFileSync path.join __dirname, 'git-test'
  createSuite 'git', connect(repoPath, opts), connect(emptyRepoPath, opts),
    obj
  ack()

ack = ->
  envsRemaining--
  if !envsRemaining
    semaphore.resume()
