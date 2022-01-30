
'use strict';

/**
 * Module dependencies.
 */

const isGeneratorFunction = require('is-generator-function');
const debug = require('debug')('koa:application');
const onFinished = require('on-finished');
const response = require('./response');
const compose = require('koa-compose');
const isJSON = require('koa-is-json');
const context = require('./context');
const request = require('./request');
const statuses = require('statuses');
const Cookies = require('cookies');
const accepts = require('accepts');
const Emitter = require('events');
const assert = require('assert');
const Stream = require('stream');
const http = require('http');
const only = require('only');
const convert = require('koa-convert');
const deprecate = require('depd')('koa');

/**
 * Expose `Application` class.
 * Inherits from `Emitter.prototype`.
 */

module.exports = class Application extends Emitter {
  /**
   * Initialize a new `Application`.
   *
   * @api public
   */

  constructor() {
    super(); // 继承Emitter,方便错误信息emit

    this.proxy = false; // proxy如果是true，会把 X-Forwarded-Host这个头的值赋值给host request.js:227
    this.middleware = []; //存放中间件，使用时候，next()来跳转这些中间件
    this.subdomainOffset = 2; // 反转子域名时候，slice的参数  request.js:412
    this.env = process.env.NODE_ENV || 'development'; //设置env 在测试文件里使用  test/application/index.js:49
    this.context = Object.create(context); //使this.context.__proto__ === context
    this.request = Object.create(request);//使this.request.__proto__ === context
    this.response = Object.create(response); //同上
  }

  /**
   * Shorthand for:
   *
   *    http.createServer(app.callback()).listen(...)
   *
   * @param {Mixed} ...
   * @return {Server}
   * @api public
   */

  listen() {
    debug('listen');
    const server = http.createServer(this.callback());
    return server.listen.apply(server, arguments);
  }

  /**
   * Return JSON representation.
   * We only bother showing settings.
   *
   * @return {Object}
   * @api public
   */

  toJSON() {
    return only(this, [
      'subdomainOffset',
      'proxy',
      'env'
    ]);
  }

  /**
   * Inspect implementation.
   *
   * @return {Object}
   * @api public
   */

  inspect() {
    return this.toJSON();
  }

  /**
   * Use the given middleware `fn`.
   *
   * Old-style middleware will be converted.
   *
   * @param {Function} fn
   * @return {Application} self
   * @api public
   */

  use(fn) {
    //如果传入进来的不是一个函数，报错
    if (typeof fn !== 'function') throw new TypeError('middleware must be a function!');
    //如果这个函数是用generator的，不是用async的函数，警告，并将该函数转换成async的样子
    if (isGeneratorFunction(fn)) {
      deprecate('Support for generators will be removed in v3. ' +
                'See the documentation for examples of how to convert old middleware ' +
                'https://github.com/koajs/koa/blob/master/docs/migration.md');
      fn = convert(fn);
    }
    // 可以运行package.json里面的命令，运行一下，看看效果
    // "debug_windows": "set DEBUG=koa:application & node ./app.js",
    // "debug_linux": "DEBUG=koa:application node ./app.js"

    debug('use %s', fn._name || fn.name || '-');
    this.middleware.push(fn); //将中间件推入middleware这个数组里
    return this; //返回this，方便链式调用
  }

  /**
   * Return a request handler callback
   * for node's native http server.
   *
   * @return {Function}
   * @api public
   */

  callback() {
    const fn = compose(this.middleware); //使用compose函数对中间件处理，***这个函数是koa的重点之一***

    if (!this.listeners('error').length) this.on('error', this.onerror); //监听错误事件

    const handleRequest = (req, res) => {
      res.statusCode = 404;
      const ctx = this.createContext(req, res); //创造ctx
      const onerror = err => ctx.onerror(err); //未来用来处理错误的函数
      const handleResponse = () => respond(ctx); //未来用来返回结果的函数
      onFinished(res, onerror); //当res结束时候执行回调
      return fn(ctx).then(handleResponse).catch(onerror);
    };

    return handleRequest;
  }

  /**
   * Initialize a new context.
   *
   * @api private
   */

  createContext(req, res) {
    //做一系列属性的挂载，使context拥有requset，以及response上面的属性
    const context = Object.create(this.context); //把this.context赋值给context变量
    //先把this.request赋值给context.request变量,然后单拎出来
    const request = context.request = Object.create(this.request);
    const response = context.response = Object.create(this.response);
    //保存原生的req,res在context里
    context.app = request.app = response.app = this;
    context.req = request.req = response.req = req;
    context.res = request.res = response.res = res;
    request.ctx = response.ctx = context;
    request.response = response;
    response.request = request;

    //另外可能需要的一些属性
    context.originalUrl = request.originalUrl = req.url;
    context.cookies = new Cookies(req, res, {
      keys: this.keys,
      secure: request.secure
    });
    request.ip = request.ips[0] || req.socket.remoteAddress || '';
    context.accept = request.accept = accepts(req);
    context.state = {};
    return context;
  }

  /**
   * Default error handler.
   *
   * @param {Error} err
   * @api private
   */

  onerror(err) {
    assert(err instanceof Error, `non-error thrown: ${err}`);

    if (404 == err.status || err.expose) return;
    if (this.silent) return;

    const msg = err.stack || err.toString();
    console.error();
    console.error(msg.replace(/^/gm, '  '));
    console.error();
  }
};

/**
 * Response helper.
 */

function respond(ctx) {
  // allow bypassing koa
  if (false === ctx.respond) return;

  const res = ctx.res;
  if (!ctx.writable) return;

  let body = ctx.body;
  const code = ctx.status;

  // ignore body
  if (statuses.empty[code]) {
    // strip headers
    ctx.body = null;
    return res.end();
  }

  if ('HEAD' == ctx.method) {
    if (!res.headersSent && isJSON(body)) {
      ctx.length = Buffer.byteLength(JSON.stringify(body));
    }
    return res.end();
  }

  // status body
  if (null == body) {
    body = ctx.message || String(code);
    if (!res.headersSent) {
      ctx.type = 'text';
      ctx.length = Buffer.byteLength(body);
    }
    return res.end(body);
  }

  // responses
  if (Buffer.isBuffer(body)) return res.end(body);
  if ('string' == typeof body) return res.end(body);
  if (body instanceof Stream) return body.pipe(res);

  // body: json
  body = JSON.stringify(body);
  if (!res.headersSent) {
    ctx.length = Buffer.byteLength(body);
  }
  res.end(body);
}
