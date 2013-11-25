/***/
// [node-grunt-q] index.js
var Emitter = require('events').EventEmitter, inherits = require('util').inherits;
var SimpleQ = require('./lib/SimpleQ'), Task = require('./lib/Task'), WorkerGroup = require('./lib/WorkerGroup');

// depended utilities
var gr = require('grunt-runner'), _ = gr._, eventDrive = _.eventDrive;
module.exports = gruntQ;
gruntQ._ = _, gruntQ.SimpleQ = SimpleQ, gruntQ.Task = Task;

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
  progress: progress,
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

  // fix queue state
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
      worker.working = {}, worker.callback = {};
      worker.max_working = tpw[i] || tpw;

      // catch worker message
      worker.on('message', function(msg) {
        setImmediate(onWorkerMessagePlay(this, msg)); // it's very important to reset socket buffer.
      });

      // all task condition change
      // when task kills a worker via "grunt.fail.fatal"
      // or uncaughtException
      worker.on('exit', onWorkerExit);

    });

    self._workers = workers;
    Array.isArray(self._ready) && self.emit('_ready');
  }

  function onWorkerExit(code) {
    if(typeof code == 'number' && ~[0, 143].indexOf(code))
      return; // It's normal
    moveAllToErrorState(new Error('Uncatchable process exit.'), this);
  }

  function moveAllToErrorState(e, worker) {
    // if a worker come here, the worker will be killed.
    Object.keys(worker.working || {}).forEach(function(task_id) {
      moveToFinishQ(e, worker, task_id);
    }), worker.kill();
  }

  function moveToFinishQ(state, worker, task_id) {
    clearTimeout(worker.working[task_id]), (function(task) {
      if(!task)
        return;
      // TODO !task
      self._q[task.rank()].dequeue(task), task.state(state);
      self._fq[task_id] = task, delete worker.working[task_id];
    })(Task.getById(task_id));
  }

  function onWorkerMessagePlay() {
    return function(worker, msg) {

      var callback = worker.callback[msg.type];

      if(typeof callback == 'function') // callback pattern
        return delete worker.callback[msg.type], callback(msg.data);

      if(msg.type == 'error' && msg.t_id == null) { // uncaughtException
        moveAllToErrorState(new Error(msg.data[0]), worker);
        self.emit('error', msg.data[0]);
        return;
      }

      if(msg.type == 'error') {
        moveToFinishQ(new Error(msg.data[0]), worker, msg.t_id);
        self.emit('error', msg.data[0], msg.t_id);
        return;
      }

      if(msg.type == 'end') {
        moveToFinishQ('finished', worker, msg.t_id);
        self.emit('_progress', msg.t_id, msg.data), _nextTask(self);
        return;
      }

      return self.emit('data', msg.t_id, msg.type, msg.data);

    }.bind(this, arguments[0], arguments[1]);
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
    task_id: task._id,
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
  return task && (raw ? task: task.state());
}

function progress(task_id, callback) {

  var self = this, line = [], ee = null;
  var task = _seekTaskById(this, task_id), state = null, worker = null;

  line.push(_.caught(function(next) {
    if(!task)
      return end('not-in-queue');
    state = task.state();
    if(typeof state != 'string')
      return end('error', state);
    if(state == 'pending')
      return end('pending', 0);
    if(state == 'finished')
      return end('finished', 100);
    next();
  }, error));

  line.push(_.caught(function(next) {
    _forEachWorker(self, function(targ) {
      targ.working[task_id] && (worker = targ);
    });
    if(!worker)
      return end('memory-trash');
    next();
  }, error));

  line.push(_.caught(function() {
    var _cid = Task.idGen();
    worker.callback[_cid] = function(data) {
      end(state, data);
    };
    worker.send({
      cmd: 'taskProgress',
      _id: _cid,
      task_id: task_id
    });
  }, error));

  return ee = _.eventDrive(line, callback);

  function error(e) {
    ee.emit('error', e);
  }
  function end(state, progress, info) {
    ee.emit('end', _.extend({
      state: state,
      progress: progress
    }, info));
  }

}

function dequeue(task_id) {

  var self = this;
  [].concat(task_id).forEach(function(task_id) {

    var task = _seekTaskById(self, task_id);
    if(task == null)
      throw new Error('The task is not found. Task#' + task_id);

    if(typeof task.state() != 'string') // error state
      return task.destroy(), delete self._fq[task_id];

    if(task.state() === 'pending')
      return task.destroy(), self._q[task.rank()].dequeue(task);

    if(task.state() === 'finished')
      return task.destroy(), delete self._fq[task_id];

    // processing, or other
    throw new Error('Unable to dequeue state: ' + task.state());

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
      return task.state() == 'pending';
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
        self.emit('timeout', task), worker.emit('message', {
          type: 'error',
          args: ['Timeout limit expired.', task._id, task],
        });
      }, task.timeout());
      // set begin time and state
      task.timer(new Date()), task.state('processing');
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

function _forEachWorker(self, fn) {
  self._workers.forEach(fn);
}
