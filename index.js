/***/
// [node-grunt-q] index.js
var Emitter = require('events').EventEmitter, inherits = require('util').inherits;
var SimpleQ = require('./lib/SimpleQ'), Task = require('./lib/Task'), WorkerGroup = require('./lib/WorkerGroup');

// depended utilities
var gr = require('grunt-runner'), _ = gr._, eventDrive = _.eventDrive;
module.exports = gruntQ;
gruntQ.SimpleQ = SimpleQ, gruntQ.Task = Task;

function gruntQ(options) {

  if(!(this instanceof gruntQ))
    return new gruntQ(options);

  Emitter.call(this);

  // queue and finished task map
  _init(this), this.create(options);

}
inherits(gruntQ, Emitter);

var QProtos = {
  create: create,
  enqueue: enqueue,
  confirm: confirm,
  dequeue: dequeue,
  destroy: destroy
};
for( var i in QProtos)
  gruntQ.prototype[i] = QProtos[i];

function create(options) {

  var self = this, Q = self._q;

  // fix argument
  if(Array.isArray(options))
    options = {
      q: options
    };
  else if(typeof options == 'number')
    options = {
      q: new Array(options)
    };

  // mix-in default
  var numCPUs = require('os').cpus().length, opts = _.extend({
    q: [{}],
    maxWorker: numCPUs,
    taskPerWorker: 1
  }, options || {});

  // fix queue status
  if(!Array.isArray(opts.q))
    opts.q = [opts.q];
  opts.q = opts.q.map(function(v, i) {
    if(v)
      return typeof v.rank != 'number' && (v.rank = i), v;
    return {
      rank: i
    };
  });

  opts.q.forEach(function(v) {
    if(Q[v.rank])
      throw new Error('Duplicated rank call: rank=' + v.rank);
    Q[v.rank] = new SimpleQ(v.maxQueue);
  });

  self.once('_ready', function() {
    // execute waiting enqueue tasks
    var waitQueue = self._ready;
    self._ready = true, waitQueue.forEach(function(fn) {
      _.processor(fn);
    });
    // then, emit ready event
    _.processor(function() {
      self.emit('ready');
    });
  });

  self.on('_progress', function(task_id, task) {
    self.emit('progress', task_id, task);
  });

  self._wg = WorkerGroup(Math.min(numCPUs, opts.maxWorker), onlineCallback);

  function onlineCallback(err, workers) {

    workers.forEach(function(worker, i) {

      if(worker.working) // if already set
        return;

      // set worker status
      var tpw = opts.taskPerWorker;
      worker.working = {}, worker.max_working = tpw[i] || tpw;

      // catch worker message
      worker.on('message', function(msg) {

        var worker = this;

        if(msg.type == 'error') {
          return self.emit('error', msg.args[0], msg.args[1]);
        }

        if(msg.type == 'end') {

          var task_id = msg.args[0];
          clearTimeout(worker.working[task_id]);

          var task = Task.getById(task_id);
          if(task) {
            self._q[task.rank()].dequeue(task);
            task.status('finished'), self._fq[task_id] = task;
          }

          // TODO !task
          self.emit('_progress', msg.args[0], msg.args[1]), _nextTask(self);

        }

        return self.emit('data', msg.args);

      });

    });

    self._workers = workers;
    Array.isArray(self._ready) && self.emit('_ready');

  }

}

function _nextTask(self) {

  var task = _seekNextTask(self);
  if(task == null)
    return self.emit('empty');

  var worker = _seekAvailWorker(self, task);
  if(worker == null)
    return self.emit('busy');
  worker.send({
    _id: task._id,
    task: task.read()
  });

}

function enqueue(pkg, commands, opts, callback, _emitter_) {

  var self = this, ee = _emitter_;

  // before queue ready
  if(Array.isArray(self._ready)) {
    ee = new Emitter(), self._ready.push(function() {
      self.enqueue(pkg, commands, opts, callback, ee);
    });
    return ee;
  }

  // [pkg], commands [,opts][,callback]
  if(typeof pkg != 'string') // package name is not specified
    callback = opts, opts = commands, commands = pkg, pkg = 'package.json'

    // argument.length == 2
  if(typeof opts == 'function')
    callback = opts, opts = {};

  if(!opts)
    opts = {};
  else if(typeof opts == 'number')
    opts = {
      rank: [opts, opts]
    };
  else if(Array.isArray(opts))
    opts = {
      rank: opts
    };

  opts = _.extend({
    workdir: process.cwd(),
    rank: [0, self._q.length - 1],
    timeout: 60 * 1000
  }, opts);

  var fn = function() {

    if(opts.rank[0] > opts.rank[1])
      opts.rank = [opts[1], opts[0]];

    var ok = false, ra = opts.rank[1], task = null;
    while(ok === false && ra >= 0) {
      var _q = self._q[ra];
      if(!_q) {
        ra--;
        continue;
      }
      task = new Task(pkg, commands, ra, opts.timeout, opts.workdir);
      if(_q.push(task)) {
        ok = true;
        break;
      }
      task.destroy(), ra--;
    }

    if(ok === false)
      return ee.emit('error', new Error('Failed to enqueueing.'), task);
    return ee.emit('end', task._id, task), _nextTask(self);

  };

  return ee = eventDrive(_emitter_, fn, callback);

}

function confirm(task_id, raw) {
  var task = _seekTaskById(this, task_id);
  return task && (raw ? task: task.status());
}

function dequeue(task_id) {

  var self = this;
  [].concat(task_id).forEach(function(task_id) {

    var task = _seekTaskById(self, task_id);
    if(task == null)
      throw new Error('The task is not found. Task#' + task_id);

    if(task.status() === 'pending')
      return task.destroy(), self._q[task.rank()].dequeue(task);

    if(task.status() === 'finished')
      return task.destroy(), delete self._fq[task_id];

    // processing, or other
    throw new Error('Unable to dequeue status: ' + task.status());

  });
}

function destroy() {

  Task.forEachTask(function(task) {
    task.destroy();
  });

  this._wg.close();
  _init(this);

}

function _seekNextTask(self) {
  var ra = self._q.length - 1;
  while(ra >= 0) {
    var nextTask = self._q[ra].next(function(task) {
      return task.status() == 'pending';
    });
    if(nextTask)
      return nextTask;
    ra--
  }
}

function _seekAvailWorker(self, task) {
  var len = self._workers.length, idx = self._worker_idx, cnt = len;
  var worker = null;
  while(cnt--) {
    worker = self._workers[idx == len ? (idx = 0): idx];
    if(worker.max_working > Object.keys(worker.working).length) {
      // set timer
      worker.working[task._id] = setTimeout(function() {
        self.emit('timeout', task), self.dequeue(task._id);
      }, task.timeout());
      // set begin time and status
      task.timer(new Date()), task.status('processing');
      return worker;
    }
    worker = null, idx++;
  }
  return worker;
}

function _seekTaskById(self, task_id) {
  if(self._fq[task_id])
    return self._fq[task_id];
  return Task.getById(task_id);
}

function _init(self) {
  self._q = [], self._fq = {}, self._workers = [], self._worker_idx = 0;
  self._ready = [], delete self._wg;
}
