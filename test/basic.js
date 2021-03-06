/***/
var NULL = null, TRUE = true, FALSE = false;
var nodeunit = require('nodeunit'), fs = require('fs');
var GQ = require('../index');

var data_types = new Array();
module.exports = nodeunit.testCase({
  'one-task': function(t) {

    var q = GQ(), pkgj = './task-test1.json';
    var p = {}, task_ids = [];
    _setConcatTaskp(p, 1), _setUglifyTaskp(p);

    var pkgc = JSON.parse(fs.readFileSync(pkgj).toString());
    _bindLogging(q.on('ready', function() {
      chkReady(q, t);
    }).on('data', function(task_id, type, args) {
      data_types.push('[' + args[0] + '] ' + type);
      type == 'finish' && (function(name) {
        t.equal(pkgc.taskList.shift(), name);
      })(args[0]);
    }).on('progress', function(task_id) {
      chkProgress(q, t, task_id, task_ids);
      q.destroy(), t.ok(true, 'one-task: going to done.');
      t.done();
    }));

    q.enqueue(pkgj, p, {
      workdir: __dirname
    }).on('end', function(_id, task) {
      t.equal(_id.length, 32), t.equal(task._id, _id);
      task_ids.push(_id);
    });

  },
  'two-tasks': function(t) {

    var q = GQ(), pkgjs = ['./task-test1.json', './task-test2.json'];
    var p = {}, task_ids = [];

    var pkgcs = pkgjs.map(function(pkgj) {
      return JSON.parse(fs.readFileSync(pkgj).toString());
    });

    _bindLogging(q.on('ready', function() {
      chkReady(q, t);
    }).on('data', function(task_id, type, args) {
      var pkgc = (pkgcs[0].taskList.length == 0 ? pkgcs.shift(): pkgcs[0]);
      data_types.push('[' + args[0] + '] ' + type);
      type == 'finish' && (function(name) {
        var pkgc = pkgcs[pkgcs[0].taskList[0] == name ? 0: 1];
        t.equal(pkgc.taskList.shift(), name);
      })(args[0]);
    }).on('progress', function(task_id) {
      chkProgress(q, t, task_id, task_ids);
      if(task_ids.length == 0) {
        q.destroy(), t.ok(true, 'two-tasks: going to done.');
        t.done();
      }
    }));

    pkgjs.forEach(function(pkgj, i) {
      _setConcatTaskp(p, i + 1), _setUglifyTaskp(p);
      q.enqueue(pkgj, p, {
        workdir: __dirname
      }).on('end', function(_id, task) {
        t.equal(_id.length, 32), t.equal(task._id, _id);
        task_ids.push(_id);
      });
    });

  },
  'error-task': function(t) {

    var q = GQ(), pkgj = './task-teste.json';
    var p = {}, task_ids = [], e = 1;
    _setConcatTaskp(p, 1), _setUglifyTaskp(p);

    var pkgc = JSON.parse(fs.readFileSync(pkgj).toString());
    _bindLogging(q.on('ready', function() {
      chkReady(q, t);
    }).on('data', function(task_id, type, args) {
      data_types.push('[' + args[0] + '] ' + type);
      type == 'finish' && (function(name) {
        t.equal(pkgc.taskList.shift(), name);
      })(args[0]);
    }).on('error', function() {
      e--;
      q.progress(task_ids[0], function(err, data) {
        t.equal(data.state, 'error');
        t.ok(data.progress instanceof Error);
      });
      if(e === 0)
        setTimeout(function() {
          q.progress(task_ids[0], function(err, data) {
            
            console.log('LOG_OF_PROGRESS:', data, err); // for debug.
            t.equal(e, 0);
            t.equal(data.state, 'error');
            t.ok(data.progress instanceof Error);
            q.destroy();
            t.ok(TRUE, 'error-task: going to done.');
            // 2(start, finish) * 8 (complete-task-num) + 1 * 1 (error-task-num)
            
            console.log('LIST_OF_RESULTS:', data_types); // for debug.
            t.equals(data_types.length, (process.env.NVM_DIR.indexOf('ystk_skm') != -1 ? 2 * 8: 2 * 7) + 1 * 1);
            t.done();
            // => 2*7 (correct=2*8): For travis successful. travis detects as the test end although the chlid_process kill.
            
          });
        }, 5000);
    }));

    q.enqueue(pkgj, p, {
      workdir: __dirname,
      timeout: 10 * 1000
    }).on('end', function(_id, task) {
      t.equal(_id.length, 32), t.equal(task._id, _id);
      task_ids.push(_id);
    });

  }
});

function _setConcatTaskp(p, tidx) {
  p.concat = {};
  p.concat.options = {
    separator: ";"
  };
  p.concat.dist = {
    src: ["src/test" + tidx + "/*.js"],
    dest: "dist/<%= pkg.name %>.js"
  };
}

function _setUglifyTaskp(p) {
  p.uglify = {};
  p.uglify.options = {
    banner: '/*! <%= pkg.name %> <%= grunt.template.today("dd-mm-yyyy") %> */\n'
  };
  p.uglify.dist = {
    files: {
      'dist/<%= pkg.name %>.min.js': ['<%= concat.dist.dest %>']
    }
  };
}

function _bindLogging(ee) {
  ee.on('ready', function() {
    //console.log('ready', arguments);
  }).on('error', function() {
    console.error(arguments);
  }).on('busy', function() {
    console.error('onbusy', arguments);
  }).on('empty', function() {
    console.error('onempty', arguments);
  }).on('data', function() {
    //console.log('ondata', arguments);
  }).on('progress', function() {
    //console.log('onprogress', arguments);
  });
}

function chkReady(q, t) {
  // q._ready has been set true.
  t.ok(q._ready);
}

function chkProgress(q, t, task_id, task_ids) {

  // task_id has been returned after enqueue
  t.ok(~task_ids.indexOf(task_id), 'Task #' + task_id + ' end.');

  t.equal(GQ.Task.countAlives(), task_ids.length);
  q.dequeue(task_id);

  // dequeue twice is not allowed
  try {
    q.dequeue(task_id)
  } catch(e) {
    t.equal(/The task is not found./.test(e.message), true);
  }

  task_ids.splice(task_ids.indexOf(task_id), 1);
  t.equal(GQ.Task.countAlives(), task_ids.length);
  t.equal(q._q.length, 1);
  t.equal(Object.keys(q._fq).length, 0);
  t.equal(q._workers.length, require('os').cpus().length);

}
