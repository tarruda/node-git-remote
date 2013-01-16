fs = require 'fs'
path = require 'path'
temp = require 'temp'
zlib = require 'zlib'
glob = require 'glob'
wrench = require 'wrench'
{spawn} = require 'child_process'
{expect} = require 'chai'
{Blob, Tree, Commit, Tag, Pack} = require 'git-core'
FileRemote = require '../src/js/file-transport'


createGitRepo = (done) ->
  temp.mkdir 'test-repo', (err, path) =>
    @path = path
    git = spawn 'git', ['init', '--bare', path]
    git.on 'exit', ->
      done()

deleteGitRepo = -> wrench.rmdirSyncRecursive(@path, true)

captureOutput = (child, cb) ->
  out = []
  err = []
  child.stdout.setEncoding 'utf8'
  child.stderr.setEncoding 'utf8'
  child.stdout.on 'data', (chunk) ->
    out.push chunk
  child.stderr.on 'data', (chunk) ->
    err.push chunk
  child.stderr.on 'end', ->
    cb(out.join(''), err.join(''))
  
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

testObjects = ->
  d1 = new Date 1000000000
  d2 = new Date 2000000000
  d3 = new Date 3000000000
  d4 = new Date 4000000000
  str = ''
  for i in [0...1000]
    str += 'test content/test content2/test content3\n'
  @b1 = new Blob str
  # this encode second blob as a delta of the first in packfiles
  @b2 = new Blob str + 'append'
  @b3 = new Blob 'subdir test content\n'
  @t1 = new Tree {
    'file-under-tree': @b3
  }
  @t2 = new Tree {
    'some-file.txt': @b2
    'some-file2.txt': @b1
    'sub-directory.d': @t1
  }
  @t3 = new Tree {
    'another-file.txt': @b1
  }
  @c1 = new Commit {
    tree: @t1
    author:
      name: 'Git Author'
      email: 'author@git.com'
      date: d1
    message: 'Artificial commit 1'
  }
  @c2 = new Commit {
    tree: @t2
    author:
      name: 'Git Author'
      email: 'author@git.com'
      date: d2
    message: 'Artificial commit 2'
    parents: [@c1]
  }
  @c3 = new Commit {
    tree: @t3
    author:
      name: 'Git User'
      email: 'user@domain.com'
      date: d3
    committer:
      name: 'Git Commiter'
      email: 'committer@git.com'
      date: d4
    message: 'Artificial commit 3'
    parents: [@c2]
  }
  @tag = new Tag {
    object: @c2
    name: 'v0.0.1'
    tagger:
      name: 'Git Tagger'
      email: 'tagger@git.com'
    date: d2
    message: 'Tag second commit'
  }

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
      throw new Error('err')

historyShouldEqual = (c1, c2) ->
  expect(c1.serialize().getHash()).to.equal c2.serialize().getHash()
  expect(c1.message).to.equal c2.message
  treeShouldEqual(c1.tree, c2.tree)
  for i in [0...c1.parents.length]
    historyShouldEqual(c1.parents[i], c2.parents[i])

suite 'smart protocol', ->

  suiteSetup createGitRepo

  suiteTeardown deleteGitRepo

  setup (done) ->
    testObjects.call @
    # write objects to the repository
    writeGitGraph @path, @c3, 'master', =>
      writeGitGraph @path, @tag, @tag.name, =>
        @remote = new FileRemote path: @path
        @n1 = new Commit {
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
        @n2 = new Commit {
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
          parents: [@n1]
        }
        done()

  test 'fetch reference discovery', (done) ->
    remaining = 1
    fetch = @remote.fetch()

    fetch.on 'discover', (refs) =>
      expect(Object.keys(refs).length).to.equal 3
      expect(refs.HEAD).to.equal refs['heads/master']
      expect(refs['heads/master'].sha1).to.equal @c3.serialize().getHash()
      expect(refs['tags/v0.0.1'].sha1).to.equal @tag.serialize().getHash()
      expect(refs['tags/v0.0.1'].peeled).to.equal @c2.serialize().getHash()
      remaining--
      fetch.flush()

    fetch.on 'end', ->
      if remaining
        done(new Error('Missing some verifications'))
      else
        done()


  test 'fetch all refs', (done) ->
    remaining = 1
    fetch = @remote.fetch()

    fetch.on 'discover', (refs) ->
      refs['heads/master'].want()
      fetch.flush()

    fetch.on 'fetched', (fetched) =>
      remaining--
      historyShouldEqual(fetched['heads/master'], @c3)

    fetch.on 'end', ->
      if remaining
        done(new Error('Missing some verifications'))
      else
        done()


  test 'fetch only the top commit', (done) ->
    remaining = 1
    fetch = @remote.fetch()
    fetch.maxDepth = 1

    fetch.on 'discover', (refs) ->
      refs['heads/master'].want()
      fetch.flush()

    fetch.on 'fetched', (fetched) =>
      remaining--
      expect(fetched['heads/master'].serialize().getHash()).to.equal(
        @c3.serialize().getHash())
      treeShouldEqual(fetched['heads/master'].tree, @c3.tree)

    fetch.on 'end', ->
      if remaining
        done(new Error('Missing some verifications'))
      else
        done()

    fetch._errStream.on 'data', (d) -> console.log(d.toString())

  test 'push reference discovery', (done) ->
    remaining = 1
    push = @remote.push()

    push.on 'discover', (refs) =>
      expect(Object.keys(refs).length).to.equal 2
      expect(refs['heads/master'].sha1).to.equal @c3.serialize().getHash()
      expect(refs['tags/v0.0.1'].sha1).to.equal @tag.serialize().getHash()
      remaining--
      push.flush()

    push.on 'end', ->
      if remaining
        done(new Error('Missing some verifications'))
      else
        done()

  test 'push to an existing branch', (done) ->
    remaining = 1
    push = @remote.push()

    push.on 'discover', (refs) =>
      refs['heads/master'].update @n2
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
