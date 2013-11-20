/***/
module.exports = SimpleQ;

function SimpleQ(max) {
  this._q = new Array();
  this._max = typeof max == 'number' ? max: null;
}

var SQProtos = {
  length: length,
  push: push,
  next: next,
  shift: shift,
  dequeue: dequeue
};
for( var i in SQProtos)
  SimpleQ.prototype[i] = SQProtos[i];

function length() {
  return this._q.length;
}

function push(obj) {
  if(this._max != null && this.length() >= this.max)
    return null;
  return this._q.push(obj);
}

function next(fn) {
  for( var i = 0; i < this.length(); i++)
    if(fn(this._q[i]))
      return this._q[i];
  return null;
}

function shift() {
  return this._q.shift();
}

function dequeue(obj) {
  for( var i = 0; i < this._q.length; i++)
    if(this._q[i] === obj)
      return this._q.splice(i, 1);
}
