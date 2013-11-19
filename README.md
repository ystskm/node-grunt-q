# grunt-q
  
Support for queueing grunt task with using cluster.  
Ranked queue is also supported.

## Install

Install with [npm](http://npmjs.org/):

    npm install grunt-q

## Example code
An exsample for creating task run server.
```js
var q = require('grunt-q')(4);
require('http').createServer(function(req, res) {
  switch(req.header('request-type')) {
  case 'queuing':
    q.enqueue(req.header('grunt-task-params')).on('end', function(id, stat) {
      res.send('Task is in-queue as id: ' + id);
    });
    break;
  case 'stat':
    q.confirm(req.header('grunt-task-id')).on('end', function(stat) {
      res.send('Task is: ' + stat.status());
    });
    break;
  case 'cancel':
    q.dequeue(req.header('grunt-task-id')).on('end', function(){
      res.send('Task is canceled');
    });
    break;
  default:
    res.send('No such operation');
  }
});
```

## API - crating queues
```js
q = gruntQ([options][, callback])
```

###Arguments  
**options** ( Number | Array | Object ) `{q:1}` optional  
 Options for creating queues.  
 _If a Number or an Array is given, it treats as value of **q**_  
- __q__ (Number|Object|Array): statuses of queue(s) creating  
    `4`	Create four queues with from rank 0 (lowest) to rank 3 (high)  
    `{ maxQueue: 8 }`	Create a queue  with rank 0, max queue count 8.  
    `[{}, { maxQueue: 4 }]`	A queue with rank 0, unlimited queue count and a queue with rank 1, max queue count 4 will be created.  
  
- __maxWorker__ (Number|Boolean): max worker count for execute tasks. it is limited by the number of cpus.
    `2`	two workers will be created if the number of cpus >= 2.  
    `true`, `null` or `undefined`	`require('os').cpus()` workers will be created.  
    `false`	not using child_process to execute task.  
  
**callback** ( Function ) `function(err){}` optional  
 Callback function when queue(s) are ready.  
 See `Events.ready` for more info.

###Events  
A grunt-q is an instance of EventEmitter.  
  
type `ready`  
  Emits when queue(s) are ready.  
  ```
  q.on('ready', function(){ ... } );
  ```
  _Note that you can `.enqueue()` without waiting event `ready`._  
  _Before ready, tasks are queued internally._  
  
type `progress`  
  Emits when progress to next task.  
  ```
  q.on('progress', function(rank, stat){ ... } );
  ```
  
type `error`  
  Emits when some error occurs.  
  ```
  q.on('error', function(err, [task]){ ... } );
  ```
  
  
  