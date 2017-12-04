/***/
// [node-grunt-q] index.js
var NULL = null, TRUE = true, FALSE = false;
var g = global;
var cluster = require('cluster');
var Emitter = require('events').EventEmitter, inherits = require('util').inherits;
var SimpleQ = require('./lib/SimpleQ'), Task = require('./lib/Task');

var WorkerGroup, eventBinding;
if(cluster.isMaster) {
  WorkerGroup = require('./lib/WorkerGroup');
} else {
  eventBinding = require('./lib/eventBinding');
}

// depended utilities
var gr = require('grunt-runner'), _ = gr._, eventDrive = _.eventDrive;
gruntQ.__dirname = __dirname;
gruntQ._ = _;
gruntQ.SimpleQ = SimpleQ;
gruntQ.Task = Task;
module.exports = gruntQ;

var Event = {
  Interact: 'GQ_interact',
  Message: 'message'
};

function gruntQ(options) {

  var GQ = this;
  if(!(this instanceof gruntQ)) {
    return new gruntQ(options);
  }

  Emitter.call(GQ);

  // Queue and finished task map
  _init(GQ);
  GQ.create(options);

}
inherits(gruntQ, Emitter);

each({

  create: create,
  enqueue: enqueue,
  confirm: confirm,
  progress: progress,
  dequeue: dequeue,
  destroy: destroy,
  message: message,

  workerListener: workerListener,
  workerInteract: workerInteract,

}, function(k, func) {
  gruntQ.prototype[k] = func;
});

/**
 * 
 * @param options
 * @returns
 */
function create(options) {

  var GQ = this, Q = GQ._q;

  // fix argument
  if(isArray(options)) {
    options = {
      q: options
    };
  } else if(is('number', options)) {
    options = {
      q: new Array(options)
    };
  }

  // mix-in default
  var numCPUs = require('os').cpus().length, opts = _.extend({
    q: [{}],
    maxWorker: numCPUs,
    taskPerWorker: 1
  }, options || {});

  // fix queue state
  if(!isArray(opts.q)) {
    opts.q = [opts.q];
  }
  opts.q = opts.q.map(function(v, i) {
    if(v) {
      if(!is('number', v.rank)) v.rank = i;
      return v;
    }
    return {
      rank: i
    };
  });

  opts.q.forEach(function(v) {
    if(Q[v.rank]) {
      throw new Error('Duplicated rank call: rank=' + v.rank);
    }
    Q[v.rank] = new SimpleQ(v.maxQueue);
  });

  GQ.once('_ready', function() {

    // Execute waiting enqueue tasks
    var waitQueue = GQ._ready;
    GQ._ready = TRUE, waitQueue.forEach(function(fn) {
      _.processor(fn);
    });

    // then, emit ready event
    _.processor(function() {
      GQ.emit('ready');
    });

  });

  GQ.on('_progress', function(task_id, task) {
    GQ.emit('progress', task_id, task);
  });

  if(WorkerGroup) {
    GQ._wg = WorkerGroup(Math.min(numCPUs, opts.maxWorker), onlineCallback);
  } else {

    GQ._notMaster = TRUE;
    eventBinding(process, function(func) {
      GQ.workerListener(process, func);
    }, function(obj) {
      GQ.workerInteract(process, obj);
    });
    onlineCallback(NULL, workers = [process]);

  }

  function onlineCallback(er, workers) {
    workers.forEach(function(worker, i) {

      if(worker.working) { // If already set
        return;
      }

      // Set worker status
      var tpw = opts.taskPerWorker;
      worker.working = {}, worker.callback = {};
      worker.max_working = tpw[i] || tpw;

      // Catch worker message
      GQ.workerListener(worker, function(msg) {
        setImmediate(onWorkerMessagePlay(worker, msg)); // It's very important to reset socket buffer.
      });

      // All task condition change
      // when task kills a worker via "grunt.fail.fatal"
      // or uncaughtException
      worker.on('exit', onWorkerExit);

    });
    GQ._workers = workers;
    if(isArray(GQ._ready)) GQ.emit('_ready');
  }

  function onWorkerExit() {

    var code = arguments[0];
    if(is('number', code) && [0, 143].indexOf(code) == -1) {
      return; // It's normal
    }

    var m = 'Uncatchable process exit. (' + code + ')';
    moveAllToErrorState(new Error(m), this);

  }

  function moveAllToErrorState(e, worker) {
    // If a worker come here, the worker will be killed.
    Object.keys(worker.working || {}).forEach(function(task_id) {
      moveToFinishQ(e, worker, task_id);
    });
    if(process !== worker) {
      worker.kill();
    }
  }

  function moveToFinishQ(state, worker, task_id) {
    clearTimeout(worker.working[task_id]), (function(task) {

      if(!task) {
        return;
      }

      // TODO !task
      var _q = GQ._q[task.rank()];
      if(_q) {
        _q.dequeue(task);
      }
      task.state(state);
      GQ._fq[task_id] = task;
      delete worker.working[task_id];

    })(Task.getById(task_id));
  }

  function onWorkerMessagePlay(worker, msg) {
    return function() {

      var callback = worker.callback[msg.type];
      var data = (GQ._notMaster ? msg: msg.data) || '';
      // console.log('Getting for message play:', msg.type, !!callback);
      // console.log(msg);

      // Callback pattern
      if(isFunction(callback)) { 
        delete worker.callback[msg.type];
        return callback(data);
      }

      // uncaughtException
      if(msg.type == 'error' && msg.t_id == NULL) { 
        moveAllToErrorState(new Error(data[0] || 'uncaughtException'), worker);
        GQ.emit('error', data[0]);
        return;
      }

      // Error
      if(msg.type == 'error') {
        moveToFinishQ(new Error(data[0] || 'error'), worker, msg.t_id);
        GQ.emit('error', data[0], msg.t_id);
        return;
      }

      // End
      if(msg.type == 'end') {
        moveToFinishQ('finished', worker, msg.t_id);
        GQ.emit('_progress', msg.t_id, data);
        _nextTask(GQ);
        return;
      }

      // Data
      return GQ.emit('data', msg.t_id, msg.type, data);

    }; // <-- return function() { ... } <--
  }

}

function _nextTask(GQ) {

  var task = _seekNextTask(GQ);
  if(task == NULL) {
    return GQ.emit('empty');
  }

  var worker = _seekAvailWorker(GQ, task);
  if(worker == NULL) {
    return GQ.emit('busy');
  }

  GQ.workerInteract(worker, {
    task_id: task._id,
    task: task.read()
  });

}

/**
 * 
 * @param pkg
 * @param commands
 * @param opts
 * @param callback
 * @param _emitter_
 * @returns
 */
function enqueue(pkg, commands, opts, callback, _emitter_) {

  var GQ = this, ee = _emitter_;

  // Before queue ready
  if(isArray(GQ._ready)) {
    ee = new Emitter(), GQ._ready.push(function() {
      GQ.enqueue(pkg, commands, opts, callback, ee);
    });
    return ee;
  }

  // [pkg], commands [,opts][,callback]
  if(!is('string', pkg)) { // package name is not specified
    callback = opts, opts = commands, commands = pkg;
    pkg = 'package.json'
  }

  // argument.length == 2
  if(isFunction(opts)) {
    callback = opts, opts = {};
  }

  if(!opts) {
    opts = {};
  } else if(is('number', opts)) {
    opts = {
      rank: [opts, opts]
    };
  } else if(isArray(opts)) {
    opts = {
      rank: opts
    };
  }

  opts = extend({
    workdir: process.cwd(),
    rank: [0, GQ._q.length - 1],
    timeout: 60 * 1000
  }, opts);

  var fn = function() {

    if(opts.rank[0] > opts.rank[1]) opts.rank = [opts[1], opts[0]];

    var ok = FALSE, ra = opts.rank[1], task = NULL, _q = NULL;
    while (ok === FALSE && ra >= 0) {

      _q = GQ._q[ra];
      if(!_q) {
        ra--;
        continue;
      }
      task = new Task(pkg, commands, ra, opts.timeout, opts.workdir);

      if(_q.push(task)) {
        ok = TRUE;
        break;
      }

      task.destroy();
      ra--;

    }

    if(ok === FALSE) {
      return ee.emit('error', new Error('Failed to enqueueing.'), task);
    } else {
      return ee.emit('end', task._id, task), _nextTask(GQ);
    }

  };

  var args = _emitter_ ? [_emitter_, fn, callback]: [fn, callback];
  return ee = eventDrive.apply(NULL, args);

}

/**
 * 
 * @param task_id
 * @param raw
 * @returns
 */
function confirm(task_id, raw) {
  var GQ = this;
  var task = _seekTaskById(GQ, task_id);
  return task && (raw ? task: task.state());
}

/**
 * 
 * @param task_id
 * @param callback
 * @returns
 */
function progress(task_id, callback) {

  var GQ = this, line = [], ee = NULL;
  var task = _seekTaskById(GQ, task_id), state = NULL, worker = NULL;

  line.push(_.caught(function(next) {

    if(!task) {
      return end('not-in-queue');
    }

    state = task.state();
    if(!is('string', state)) return end('error', state);
    if(state == 'pending') return end('pending', 0);
    if(state == 'finished') return end('finished', 100);
    next();

  }, error));

  line.push(_.caught(function(next) {
    _forEachWorker(GQ, function(targ) {
      if(targ.working[task_id]) worker = targ;
    });
    if(!worker) {
      return end('memory-trash');
    }
    next();
  }, error));

  line.push(_.caught(function() {
    var _cid = Task.idGen();
    worker.callback[_cid] = function(data) {
      end(state, data);
    };
    GQ.workerInteract(worker, {
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

/**
 * 
 * @param task_id
 * @returns
 */
function dequeue(task_id) {
  var GQ = this;
  [].concat(task_id).forEach(function(task_id) {

    var task = _seekTaskById(GQ, task_id);
    if(task == NULL) {
      throw new Error('The task is not found. Task#' + task_id);
    }

    var task_s = task.state();
    if(!is('string', task_s)) { // error state
      return task.destroy(), delete GQ._fq[task_id];
    }
    if(task_s === 'pending') {
      var _q = GQ._q[task.rank()];
      return task.destroy(), !_q || _q.dequeue(task);
    }
    if(task_s === 'finished') {
      return task.destroy(), delete GQ._fq[task_id];
    }

    // processing, or other
    throw new Error('Unable to dequeue state: ' + task.state());

  });
}

/**
 * 
 * @returns
 */
function destroy() {

  var GQ = this;
  Task.forEachTask(function(task) {
    task.destroy();
  });

  if(GQ._wg) GQ._wg.close();
  _init(GQ);

}

/**
 * 
 */
function message(m) {
  var GQ = this;
  return GQ.emit(Event.message, m);
}

/**
 * @param worker
 * @param func
 * @returns
 */
function workerListener(worker, func) {
  var GQ = this;
  if(GQ._notMaster) {
    worker.on(Event.Interact, func);
  } else {
    worker.on('message', func);
  }
}

/**
 * @param worker
 * @param obj
 * @returns
 */
function workerInteract(worker, obj) {
  var GQ = this;
  if(GQ._notMaster) {
    worker.emit(Event.Interact, obj);
  } else {
    worker.send(obj);
  }
}

function _seekNextTask(GQ) {
  var ra = GQ._q.length - 1;
  while (ra >= 0) {
    var nextTask = GQ._q[ra].next(function(task) {
      return task.state() == 'pending';
    });
    if(nextTask) {
      return nextTask;
    }
    ra--;
  }
}

function _seekAvailWorker(GQ, task) {
  var len = GQ._workers.length, idx = GQ._worker_idx, cnt = len;
  var worker = NULL;
  while (cnt--) {
    worker = GQ._workers[idx == len ? (idx = 0): idx];
    if(worker.max_working > Object.keys(worker.working).length) {

      // Set timer
      worker.working[task._id] = setTimeout(function() {
        GQ.emit('timeout', task);
        GQ.emit('message', {
          type: 'error',
          args: ['Timeout limit expired.', task._id, task],
        });
      }, task.timeout());

      // Set begin time and state
      task.timer(new Date()), task.state('processing');
      return worker;

    }
    worker = NULL, idx++;
  }
  return worker;
}

function _seekTaskById(GQ, task_id) {
  if(GQ._fq[task_id]) {
    return GQ._fq[task_id];
  }
  return Task.getById(task_id);
}

function _init(GQ) {
  GQ._q = [], GQ._fq = {};
  GQ._workers = [], GQ._worker_idx = 0, GQ._ready = [];
  delete GQ._wg;
}

function _forEachWorker(GQ, fn) {
  GQ._workers.forEach(fn);
}

// --------- //
function each(obj, func) {
  for( var k in obj)
    func(k, obj[k]);
}
function extend() {
  return _.extend.apply(_, arguments);
}
function is(ty, x) {
  return typeof x == ty;
}
function isFunction(x) {
  return is('function', x);
}
function isArray(x) {
  return Array.isArray(x);
}
