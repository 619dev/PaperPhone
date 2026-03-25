"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
var crypto = _interopRequireWildcard(require("crypto"), true);
var fs = _interopRequireWildcard(require("fs"), true);
var http = _interopRequireWildcard(require("http"), true);
var https = _interopRequireWildcard(require("https"), true);
var path = _interopRequireWildcard(require("path"), true);
var stream = _interopRequireWildcard(require("stream"), true);
var async = _interopRequireWildcard(require("async"), true);
var _blockStream = require("block-stream2");
var _browserOrNode = require("browser-or-node");
var _lodash = require("lodash");
var qs = _interopRequireWildcard(require("query-string"), true);
var _xml2js = require("xml2js");
var _CredentialProvider = require("../CredentialProvider.js");
var errors = _interopRequireWildcard(require("../errors.js"), true);
var _helpers = require("../helpers.js");
var _notification = require("../notification.js");
var _signing = require("../signing.js");
var _async2 = require("./async.js");
var _copyConditions = require("./copy-conditions.js");
var _extensions = require("./extensions.js");
var _helper = require("./helper.js");
var _joinHostPort = require("./join-host-port.js");
var _postPolicy = require("./post-policy.js");
var _request = require("./request.js");
var _response = require("./response.js");
var _s3Endpoints = require("./s3-endpoints.js");
var xmlParsers = _interopRequireWildcard(require("./xml-parser.js"), true);
function _interopRequireWildcard(e, t) { if ("function" == typeof WeakMap) var r = new WeakMap(), n = new WeakMap(); return (_interopRequireWildcard = function (e, t) { if (!t && e && e.__esModule) return e; var o, i, f = { __proto__: null, default: e }; if (null === e || "object" != typeof e && "function" != typeof e) return f; if (o = t ? n : r) { if (o.has(e)) return o.get(e); o.set(e, f); } for (const t in e) "default" !== t && {}.hasOwnProperty.call(e, t) && ((i = (o = Object.defineProperty) && Object.getOwnPropertyDescriptor(e, t)) && (i.get || i.set) ? o(f, t, i) : f[t] = e[t]); return f; })(e, t); }
const xml = new _xml2js.Builder({
  renderOpts: {
    pretty: false
  },
  headless: true
});

// will be replaced by bundler.
const Package = {
  version: "8.0.7" || 'development'
};
const requestOptionProperties = ['agent', 'ca', 'cert', 'ciphers', 'clientCertEngine', 'crl', 'dhparam', 'ecdhCurve', 'family', 'honorCipherOrder', 'key', 'passphrase', 'pfx', 'rejectUnauthorized', 'secureOptions', 'secureProtocol', 'servername', 'sessionIdContext'];
class TypedClient {
  partSize = 64 * 1024 * 1024;
  maximumPartSize = 5 * 1024 * 1024 * 1024;
  maxObjectSize = 5 * 1024 * 1024 * 1024 * 1024;
  constructor(params) {
    // @ts-expect-error deprecated property
    if (params.secure !== undefined) {
      throw new Error('"secure" option deprecated, "useSSL" should be used instead');
    }
    // Default values if not specified.
    if (params.useSSL === undefined) {
      params.useSSL = true;
    }
    if (!params.port) {
      params.port = 0;
    }
    // Validate input params.
    if (!(0, _helper.isValidEndpoint)(params.endPoint)) {
      throw new errors.InvalidEndpointError(`Invalid endPoint : ${params.endPoint}`);
    }
    if (!(0, _helper.isValidPort)(params.port)) {
      throw new errors.InvalidArgumentError(`Invalid port : ${params.port}`);
    }
    if (!(0, _helper.isBoolean)(params.useSSL)) {
      throw new errors.InvalidArgumentError(`Invalid useSSL flag type : ${params.useSSL}, expected to be of type "boolean"`);
    }

    // Validate region only if its set.
    if (params.region) {
      if (!(0, _helper.isString)(params.region)) {
        throw new errors.InvalidArgumentError(`Invalid region : ${params.region}`);
      }
    }
    const host = params.endPoint.toLowerCase();
    let port = params.port;
    let protocol;
    let transport;
    let transportAgent;
    // Validate if configuration is not using SSL
    // for constructing relevant endpoints.
    if (params.useSSL) {
      // Defaults to secure.
      transport = https;
      protocol = 'https:';
      port = port || 443;
      transportAgent = https.globalAgent;
    } else {
      transport = http;
      protocol = 'http:';
      port = port || 80;
      transportAgent = http.globalAgent;
    }

    // if custom transport is set, use it.
    if (params.transport) {
      if (!(0, _helper.isObject)(params.transport)) {
        throw new errors.InvalidArgumentError(`Invalid transport type : ${params.transport}, expected to be type "object"`);
      }
      transport = params.transport;
    }

    // if custom transport agent is set, use it.
    if (params.transportAgent) {
      if (!(0, _helper.isObject)(params.transportAgent)) {
        throw new errors.InvalidArgumentError(`Invalid transportAgent type: ${params.transportAgent}, expected to be type "object"`);
      }
      transportAgent = params.transportAgent;
    }

    // User Agent should always following the below style.
    // Please open an issue to discuss any new changes here.
    //
    //       MinIO (OS; ARCH) LIB/VER APP/VER
    //
    const libraryComments = `(${process.platform}; ${process.arch})`;
    const libraryAgent = `MinIO ${libraryComments} minio-js/${Package.version}`;
    // User agent block ends.

    this.transport = transport;
    this.transportAgent = transportAgent;
    this.host = host;
    this.port = port;
    this.protocol = protocol;
    this.userAgent = `${libraryAgent}`;

    // Default path style is true
    if (params.pathStyle === undefined) {
      this.pathStyle = true;
    } else {
      this.pathStyle = params.pathStyle;
    }
    this.accessKey = params.accessKey ?? '';
    this.secretKey = params.secretKey ?? '';
    this.sessionToken = params.sessionToken;
    this.anonymous = !this.accessKey || !this.secretKey;
    if (params.credentialsProvider) {
      this.anonymous = false;
      this.credentialsProvider = params.credentialsProvider;
    }
    this.regionMap = {};
    if (params.region) {
      this.region = params.region;
    }
    if (params.partSize) {
      this.partSize = params.partSize;
      this.overRidePartSize = true;
    }
    if (this.partSize < 5 * 1024 * 1024) {
      throw new errors.InvalidArgumentError(`Part size should be greater than 5MB`);
    }
    if (this.partSize > 5 * 1024 * 1024 * 1024) {
      throw new errors.InvalidArgumentError(`Part size should be less than 5GB`);
    }

    // SHA256 is enabled only for authenticated http requests. If the request is authenticated
    // and the connection is https we use x-amz-content-sha256=UNSIGNED-PAYLOAD
    // header for signature calculation.
    this.enableSHA256 = !this.anonymous && !params.useSSL;
    this.s3AccelerateEndpoint = params.s3AccelerateEndpoint || undefined;
    this.reqOptions = {};
    this.clientExtensions = new _extensions.Extensions(this);
    if (params.retryOptions) {
      if (!(0, _helper.isObject)(params.retryOptions)) {
        throw new errors.InvalidArgumentError(`Invalid retryOptions type: ${params.retryOptions}, expected to be type "object"`);
      }
      this.retryOptions = params.retryOptions;
    } else {
      this.retryOptions = {
        disableRetry: false
      };
    }
  }
  /**
   * Minio extensions that aren't necessary present for Amazon S3 compatible storage servers
   */
  get extensions() {
    return this.clientExtensions;
  }

  /**
   * @param endPoint - valid S3 acceleration end point
   */
  setS3TransferAccelerate(endPoint) {
    this.s3AccelerateEndpoint = endPoint;
  }

  /**
   * Sets the supported request options.
   */
  setRequestOptions(options) {
    if (!(0, _helper.isObject)(options)) {
      throw new TypeError('request options should be of type "object"');
    }
    this.reqOptions = _lodash.pick(options, requestOptionProperties);
  }

  /**
   *  This is s3 Specific and does not hold validity in any other Object storage.
   */
  getAccelerateEndPointIfSet(bucketName, objectName) {
    if (!(0, _helper.isEmpty)(this.s3AccelerateEndpoint) && !(0, _helper.isEmpty)(bucketName) && !(0, _helper.isEmpty)(objectName)) {
      // http://docs.aws.amazon.com/AmazonS3/latest/dev/transfer-acceleration.html
      // Disable transfer acceleration for non-compliant bucket names.
      if (bucketName.includes('.')) {
        throw new Error(`Transfer Acceleration is not supported for non compliant bucket:${bucketName}`);
      }
      // If transfer acceleration is requested set new host.
      // For more details about enabling transfer acceleration read here.
      // http://docs.aws.amazon.com/AmazonS3/latest/dev/transfer-acceleration.html
      return this.s3AccelerateEndpoint;
    }
    return false;
  }

  /**
   *   Set application specific information.
   *   Generates User-Agent in the following style.
   *   MinIO (OS; ARCH) LIB/VER APP/VER
   */
  setAppInfo(appName, appVersion) {
    if (!(0, _helper.isString)(appName)) {
      throw new TypeError(`Invalid appName: ${appName}`);
    }
    if (appName.trim() === '') {
      throw new errors.InvalidArgumentError('Input appName cannot be empty.');
    }
    if (!(0, _helper.isString)(appVersion)) {
      throw new TypeError(`Invalid appVersion: ${appVersion}`);
    }
    if (appVersion.trim() === '') {
      throw new errors.InvalidArgumentError('Input appVersion cannot be empty.');
    }
    this.userAgent = `${this.userAgent} ${appName}/${appVersion}`;
  }

  /**
   * returns options object that can be used with http.request()
   * Takes care of constructing virtual-host-style or path-style hostname
   */
  getRequestOptions(opts) {
    const method = opts.method;
    const region = opts.region;
    const bucketName = opts.bucketName;
    let objectName = opts.objectName;
    const headers = opts.headers;
    const query = opts.query;
    let reqOptions = {
      method,
      headers: {},
      protocol: this.protocol,
      // If custom transportAgent was supplied earlier, we'll inject it here
      agent: this.transportAgent
    };

    // Verify if virtual host supported.
    let virtualHostStyle;
    if (bucketName) {
      virtualHostStyle = (0, _helper.isVirtualHostStyle)(this.host, this.protocol, bucketName, this.pathStyle);
    }
    let path = '/';
    let host = this.host;
    let port;
    if (this.port) {
      port = this.port;
    }
    if (objectName) {
      objectName = (0, _helper.uriResourceEscape)(objectName);
    }

    // For Amazon S3 endpoint, get endpoint based on region.
    if ((0, _helper.isAmazonEndpoint)(host)) {
      const accelerateEndPoint = this.getAccelerateEndPointIfSet(bucketName, objectName);
      if (accelerateEndPoint) {
        host = `${accelerateEndPoint}`;
      } else {
        host = (0, _s3Endpoints.getS3Endpoint)(region);
      }
    }
    if (virtualHostStyle && !opts.pathStyle) {
      // For all hosts which support virtual host style, `bucketName`
      // is part of the hostname in the following format:
      //
      //  var host = 'bucketName.example.com'
      //
      if (bucketName) {
        host = `${bucketName}.${host}`;
      }
      if (objectName) {
        path = `/${objectName}`;
      }
    } else {
      // For all S3 compatible storage services we will fallback to
      // path style requests, where `bucketName` is part of the URI
      // path.
      if (bucketName) {
        path = `/${bucketName}`;
      }
      if (objectName) {
        path = `/${bucketName}/${objectName}`;
      }
    }
    if (query) {
      path += `?${query}`;
    }
    reqOptions.headers.host = host;
    if (reqOptions.protocol === 'http:' && port !== 80 || reqOptions.protocol === 'https:' && port !== 443) {
      reqOptions.headers.host = (0, _joinHostPort.joinHostPort)(host, port);
    }
    reqOptions.headers['user-agent'] = this.userAgent;
    if (headers) {
      // have all header keys in lower case - to make signing easy
      for (const [k, v] of Object.entries(headers)) {
        reqOptions.headers[k.toLowerCase()] = v;
      }
    }

    // Use any request option specified in minioClient.setRequestOptions()
    reqOptions = Object.assign({}, this.reqOptions, reqOptions);
    return {
      ...reqOptions,
      headers: _lodash.mapValues(_lodash.pickBy(reqOptions.headers, _helper.isDefined), v => v.toString()),
      host,
      port,
      path
    };
  }
  async setCredentialsProvider(credentialsProvider) {
    if (!(credentialsProvider instanceof _CredentialProvider.CredentialProvider)) {
      throw new Error('Unable to get credentials. Expected instance of CredentialProvider');
    }
    this.credentialsProvider = credentialsProvider;
    await this.checkAndRefreshCreds();
  }
  async checkAndRefreshCreds() {
    if (this.credentialsProvider) {
      try {
        const credentialsConf = await this.credentialsProvider.getCredentials();
        this.accessKey = credentialsConf.getAccessKey();
        this.secretKey = credentialsConf.getSecretKey();
        this.sessionToken = credentialsConf.getSessionToken();
      } catch (e) {
        throw new Error(`Unable to get credentials: ${e}`, {
          cause: e
        });
      }
    }
  }
  /**
   * log the request, response, error
   */
  logHTTP(reqOptions, response, err) {
    // if no logStream available return.
    if (!this.logStream) {
      return;
    }
    if (!(0, _helper.isObject)(reqOptions)) {
      throw new TypeError('reqOptions should be of type "object"');
    }
    if (response && !(0, _helper.isReadableStream)(response)) {
      throw new TypeError('response should be of type "Stream"');
    }
    if (err && !(err instanceof Error)) {
      throw new TypeError('err should be of type "Error"');
    }
    const logStream = this.logStream;
    const logHeaders = headers => {
      Object.entries(headers).forEach(([k, v]) => {
        if (k == 'authorization') {
          if ((0, _helper.isString)(v)) {
            const redactor = new RegExp('Signature=([0-9a-f]+)');
            v = v.replace(redactor, 'Signature=**REDACTED**');
          }
        }
        logStream.write(`${k}: ${v}\n`);
      });
      logStream.write('\n');
    };
    logStream.write(`REQUEST: ${reqOptions.method} ${reqOptions.path}\n`);
    logHeaders(reqOptions.headers);
    if (response) {
      this.logStream.write(`RESPONSE: ${response.statusCode}\n`);
      logHeaders(response.headers);
    }
    if (err) {
      logStream.write('ERROR BODY:\n');
      const errJSON = JSON.stringify(err, null, '\t');
      logStream.write(`${errJSON}\n`);
    }
  }

  /**
   * Enable tracing
   */
  traceOn(stream) {
    if (!stream) {
      stream = process.stdout;
    }
    this.logStream = stream;
  }

  /**
   * Disable tracing
   */
  traceOff() {
    this.logStream = undefined;
  }

  /**
   * makeRequest is the primitive used by the apis for making S3 requests.
   * payload can be empty string in case of no payload.
   * statusCode is the expected statusCode. If response.statusCode does not match
   * we parse the XML error and call the callback with the error message.
   *
   * A valid region is passed by the calls - listBuckets, makeBucket and getBucketRegion.
   *
   * @internal
   */
  async makeRequestAsync(options, payload = '', expectedCodes = [200], region = '') {
    if (!(0, _helper.isObject)(options)) {
      throw new TypeError('options should be of type "object"');
    }
    if (!(0, _helper.isString)(payload) && !(0, _helper.isObject)(payload)) {
      // Buffer is of type 'object'
      throw new TypeError('payload should be of type "string" or "Buffer"');
    }
    expectedCodes.forEach(statusCode => {
      if (!(0, _helper.isNumber)(statusCode)) {
        throw new TypeError('statusCode should be of type "number"');
      }
    });
    if (!(0, _helper.isString)(region)) {
      throw new TypeError('region should be of type "string"');
    }
    if (!options.headers) {
      options.headers = {};
    }
    if (options.method === 'POST' || options.method === 'PUT' || options.method === 'DELETE') {
      options.headers['content-length'] = payload.length.toString();
    }
    const sha256sum = this.enableSHA256 ? (0, _helper.toSha256)(payload) : '';
    return this.makeRequestStreamAsync(options, payload, sha256sum, expectedCodes, region);
  }

  /**
   * new request with promise
   *
   * No need to drain response, response body is not valid
   */
  async makeRequestAsyncOmit(options, payload = '', statusCodes = [200], region = '') {
    const res = await this.makeRequestAsync(options, payload, statusCodes, region);
    await (0, _response.drainResponse)(res);
    return res;
  }

  /**
   * makeRequestStream will be used directly instead of makeRequest in case the payload
   * is available as a stream. for ex. putObject
   *
   * @internal
   */
  async makeRequestStreamAsync(options, body, sha256sum, statusCodes, region) {
    if (!(0, _helper.isObject)(options)) {
      throw new TypeError('options should be of type "object"');
    }
    if (!(Buffer.isBuffer(body) || typeof body === 'string' || (0, _helper.isReadableStream)(body))) {
      throw new errors.InvalidArgumentError(`stream should be a Buffer, string or readable Stream, got ${typeof body} instead`);
    }
    if (!(0, _helper.isString)(sha256sum)) {
      throw new TypeError('sha256sum should be of type "string"');
    }
    statusCodes.forEach(statusCode => {
      if (!(0, _helper.isNumber)(statusCode)) {
        throw new TypeError('statusCode should be of type "number"');
      }
    });
    if (!(0, _helper.isString)(region)) {
      throw new TypeError('region should be of type "string"');
    }
    // sha256sum will be empty for anonymous or https requests
    if (!this.enableSHA256 && sha256sum.length !== 0) {
      throw new errors.InvalidArgumentError(`sha256sum expected to be empty for anonymous or https requests`);
    }
    // sha256sum should be valid for non-anonymous http requests.
    if (this.enableSHA256 && sha256sum.length !== 64) {
      throw new errors.InvalidArgumentError(`Invalid sha256sum : ${sha256sum}`);
    }
    await this.checkAndRefreshCreds();

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    region = region || (await this.getBucketRegionAsync(options.bucketName));
    const reqOptions = this.getRequestOptions({
      ...options,
      region
    });
    if (!this.anonymous) {
      // For non-anonymous https requests sha256sum is 'UNSIGNED-PAYLOAD' for signature calculation.
      if (!this.enableSHA256) {
        sha256sum = 'UNSIGNED-PAYLOAD';
      }
      const date = new Date();
      reqOptions.headers['x-amz-date'] = (0, _helper.makeDateLong)(date);
      reqOptions.headers['x-amz-content-sha256'] = sha256sum;
      if (this.sessionToken) {
        reqOptions.headers['x-amz-security-token'] = this.sessionToken;
      }
      reqOptions.headers.authorization = (0, _signing.signV4)(reqOptions, this.accessKey, this.secretKey, region, date, sha256sum);
    }
    const response = await (0, _request.requestWithRetry)(this.transport, reqOptions, body, this.retryOptions.disableRetry === true ? 0 : this.retryOptions.maximumRetryCount, this.retryOptions.baseDelayMs, this.retryOptions.maximumDelayMs);
    if (!response.statusCode) {
      throw new Error("BUG: response doesn't have a statusCode");
    }
    if (!statusCodes.includes(response.statusCode)) {
      // For an incorrect region, S3 server always sends back 400.
      // But we will do cache invalidation for all errors so that,
      // in future, if AWS S3 decides to send a different status code or
      // XML error code we will still work fine.
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      delete this.regionMap[options.bucketName];
      const err = await xmlParsers.parseResponseError(response);
      this.logHTTP(reqOptions, response, err);
      throw err;
    }
    this.logHTTP(reqOptions, response);
    return response;
  }

  /**
   * gets the region of the bucket
   *
   * @param bucketName
   *
   */
  async getBucketRegionAsync(bucketName) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name : ${bucketName}`);
    }

    // Region is set with constructor, return the region right here.
    if (this.region) {
      return this.region;
    }
    const cached = this.regionMap[bucketName];
    if (cached) {
      return cached;
    }
    const extractRegionAsync = async response => {
      const body = await (0, _response.readAsString)(response);
      const region = xmlParsers.parseBucketRegion(body) || _helpers.DEFAULT_REGION;
      this.regionMap[bucketName] = region;
      return region;
    };
    const method = 'GET';
    const query = 'location';
    // `getBucketLocation` behaves differently in following ways for
    // different environments.
    //
    // - For nodejs env we default to path style requests.
    // - For browser env path style requests on buckets yields CORS
    //   error. To circumvent this problem we make a virtual host
    //   style request signed with 'us-east-1'. This request fails
    //   with an error 'AuthorizationHeaderMalformed', additionally
    //   the error XML also provides Region of the bucket. To validate
    //   this region is proper we retry the same request with the newly
    //   obtained region.
    const pathStyle = this.pathStyle && !_browserOrNode.isBrowser;
    let region;
    try {
      const res = await this.makeRequestAsync({
        method,
        bucketName,
        query,
        pathStyle
      }, '', [200], _helpers.DEFAULT_REGION);
      return extractRegionAsync(res);
    } catch (e) {
      // make alignment with mc cli
      if (e instanceof errors.S3Error) {
        const errCode = e.code;
        const errRegion = e.region;
        if (errCode === 'AccessDenied' && !errRegion) {
          return _helpers.DEFAULT_REGION;
        }
      }
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      if (!(e.name === 'AuthorizationHeaderMalformed')) {
        throw e;
      }
      // @ts-expect-error we set extra properties on error object
      region = e.Region;
      if (!region) {
        throw e;
      }
    }
    const res = await this.makeRequestAsync({
      method,
      bucketName,
      query,
      pathStyle
    }, '', [200], region);
    return await extractRegionAsync(res);
  }

  /**
   * makeRequest is the primitive used by the apis for making S3 requests.
   * payload can be empty string in case of no payload.
   * statusCode is the expected statusCode. If response.statusCode does not match
   * we parse the XML error and call the callback with the error message.
   * A valid region is passed by the calls - listBuckets, makeBucket and
   * getBucketRegion.
   *
   * @deprecated use `makeRequestAsync` instead
   */
  makeRequest(options, payload = '', expectedCodes = [200], region = '', returnResponse, cb) {
    let prom;
    if (returnResponse) {
      prom = this.makeRequestAsync(options, payload, expectedCodes, region);
    } else {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-expect-error compatible for old behaviour
      prom = this.makeRequestAsyncOmit(options, payload, expectedCodes, region);
    }
    prom.then(result => cb(null, result), err => {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      cb(err);
    });
  }

  /**
   * makeRequestStream will be used directly instead of makeRequest in case the payload
   * is available as a stream. for ex. putObject
   *
   * @deprecated use `makeRequestStreamAsync` instead
   */
  makeRequestStream(options, stream, sha256sum, statusCodes, region, returnResponse, cb) {
    const executor = async () => {
      const res = await this.makeRequestStreamAsync(options, stream, sha256sum, statusCodes, region);
      if (!returnResponse) {
        await (0, _response.drainResponse)(res);
      }
      return res;
    };
    executor().then(result => cb(null, result),
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    err => cb(err));
  }

  /**
   * @deprecated use `getBucketRegionAsync` instead
   */
  getBucketRegion(bucketName, cb) {
    return this.getBucketRegionAsync(bucketName).then(result => cb(null, result),
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    err => cb(err));
  }

  // Bucket operations

  /**
   * Creates the bucket `bucketName`.
   *
   */
  async makeBucket(bucketName, region = '', makeOpts) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    // Backward Compatibility
    if ((0, _helper.isObject)(region)) {
      makeOpts = region;
      region = '';
    }
    if (!(0, _helper.isString)(region)) {
      throw new TypeError('region should be of type "string"');
    }
    if (makeOpts && !(0, _helper.isObject)(makeOpts)) {
      throw new TypeError('makeOpts should be of type "object"');
    }
    let payload = '';

    // Region already set in constructor, validate if
    // caller requested bucket location is same.
    if (region && this.region) {
      if (region !== this.region) {
        throw new errors.InvalidArgumentError(`Configured region ${this.region}, requested ${region}`);
      }
    }
    // sending makeBucket request with XML containing 'us-east-1' fails. For
    // default region server expects the request without body
    if (region && region !== _helpers.DEFAULT_REGION) {
      payload = xml.buildObject({
        CreateBucketConfiguration: {
          $: {
            xmlns: 'http://s3.amazonaws.com/doc/2006-03-01/'
          },
          LocationConstraint: region
        }
      });
    }
    const method = 'PUT';
    const headers = {};
    if (makeOpts && makeOpts.ObjectLocking) {
      headers['x-amz-bucket-object-lock-enabled'] = true;
    }

    // For custom region clients  default to custom region specified in client constructor
    const finalRegion = this.region || region || _helpers.DEFAULT_REGION;
    const requestOpt = {
      method,
      bucketName,
      headers
    };
    try {
      await this.makeRequestAsyncOmit(requestOpt, payload, [200], finalRegion);
    } catch (err) {
      if (region === '' || region === _helpers.DEFAULT_REGION) {
        if (err instanceof errors.S3Error) {
          const errCode = err.code;
          const errRegion = err.region;
          if (errCode === 'AuthorizationHeaderMalformed' && errRegion !== '') {
            // Retry with region returned as part of error
            await this.makeRequestAsyncOmit(requestOpt, payload, [200], errCode);
          }
        }
      }
      throw err;
    }
  }

  /**
   * To check if a bucket already exists.
   */
  async bucketExists(bucketName) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    const method = 'HEAD';
    try {
      await this.makeRequestAsyncOmit({
        method,
        bucketName
      });
    } catch (err) {
      // @ts-ignore
      if (err.code === 'NoSuchBucket' || err.code === 'NotFound') {
        return false;
      }
      throw err;
    }
    return true;
  }

  /**
   * @deprecated use promise style API
   */

  async removeBucket(bucketName) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    const method = 'DELETE';
    await this.makeRequestAsyncOmit({
      method,
      bucketName
    }, '', [204]);
    delete this.regionMap[bucketName];
  }

  /**
   * Callback is called with readable stream of the object content.
   */
  async getObject(bucketName, objectName, getOpts) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    return this.getPartialObject(bucketName, objectName, 0, 0, getOpts);
  }

  /**
   * Callback is called with readable stream of the partial object content.
   * @param bucketName
   * @param objectName
   * @param offset
   * @param length - length of the object that will be read in the stream (optional, if not specified we read the rest of the file from the offset)
   * @param getOpts
   */
  async getPartialObject(bucketName, objectName, offset, length = 0, getOpts) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!(0, _helper.isNumber)(offset)) {
      throw new TypeError('offset should be of type "number"');
    }
    if (!(0, _helper.isNumber)(length)) {
      throw new TypeError('length should be of type "number"');
    }
    let range = '';
    if (offset || length) {
      if (offset) {
        range = `bytes=${+offset}-`;
      } else {
        range = 'bytes=0-';
        offset = 0;
      }
      if (length) {
        range += `${+length + offset - 1}`;
      }
    }
    let query = '';
    let headers = {
      ...(range !== '' && {
        range
      })
    };
    if (getOpts) {
      const sseHeaders = {
        ...(getOpts.SSECustomerAlgorithm && {
          'X-Amz-Server-Side-Encryption-Customer-Algorithm': getOpts.SSECustomerAlgorithm
        }),
        ...(getOpts.SSECustomerKey && {
          'X-Amz-Server-Side-Encryption-Customer-Key': getOpts.SSECustomerKey
        }),
        ...(getOpts.SSECustomerKeyMD5 && {
          'X-Amz-Server-Side-Encryption-Customer-Key-MD5': getOpts.SSECustomerKeyMD5
        })
      };
      query = qs.stringify(getOpts);
      headers = {
        ...(0, _helper.prependXAMZMeta)(sseHeaders),
        ...headers
      };
    }
    const expectedStatusCodes = [200];
    if (range) {
      expectedStatusCodes.push(206);
    }
    const method = 'GET';
    return await this.makeRequestAsync({
      method,
      bucketName,
      objectName,
      headers,
      query
    }, '', expectedStatusCodes);
  }

  /**
   * download object content to a file.
   * This method will create a temp file named `${filename}.${base64(etag)}.part.minio` when downloading.
   *
   * @param bucketName - name of the bucket
   * @param objectName - name of the object
   * @param filePath - path to which the object data will be written to
   * @param getOpts - Optional object get option
   */
  async fGetObject(bucketName, objectName, filePath, getOpts) {
    // Input validation.
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!(0, _helper.isString)(filePath)) {
      throw new TypeError('filePath should be of type "string"');
    }
    const downloadToTmpFile = async () => {
      let partFileStream;
      const objStat = await this.statObject(bucketName, objectName, getOpts);
      const encodedEtag = Buffer.from(objStat.etag).toString('base64');
      const partFile = `${filePath}.${encodedEtag}.part.minio`;
      await _async2.fsp.mkdir(path.dirname(filePath), {
        recursive: true
      });
      let offset = 0;
      try {
        const stats = await _async2.fsp.stat(partFile);
        if (objStat.size === stats.size) {
          return partFile;
        }
        offset = stats.size;
        partFileStream = fs.createWriteStream(partFile, {
          flags: 'a'
        });
      } catch (e) {
        if (e instanceof Error && e.code === 'ENOENT') {
          // file not exist
          partFileStream = fs.createWriteStream(partFile, {
            flags: 'w'
          });
        } else {
          // other error, maybe access deny
          throw e;
        }
      }
      const downloadStream = await this.getPartialObject(bucketName, objectName, offset, 0, getOpts);
      await _async2.streamPromise.pipeline(downloadStream, partFileStream);
      const stats = await _async2.fsp.stat(partFile);
      if (stats.size === objStat.size) {
        return partFile;
      }
      throw new Error('Size mismatch between downloaded file and the object');
    };
    const partFile = await downloadToTmpFile();
    await _async2.fsp.rename(partFile, filePath);
  }

  /**
   * Stat information of the object.
   */
  async statObject(bucketName, objectName, statOpts) {
    const statOptDef = statOpts || {};
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!(0, _helper.isObject)(statOptDef)) {
      throw new errors.InvalidArgumentError('statOpts should be of type "object"');
    }
    const query = qs.stringify(statOptDef);
    const method = 'HEAD';
    const res = await this.makeRequestAsyncOmit({
      method,
      bucketName,
      objectName,
      query
    });
    return {
      size: parseInt(res.headers['content-length']),
      metaData: (0, _helper.extractMetadata)(res.headers),
      lastModified: new Date(res.headers['last-modified']),
      versionId: (0, _helper.getVersionId)(res.headers),
      etag: (0, _helper.sanitizeETag)(res.headers.etag)
    };
  }
  async removeObject(bucketName, objectName, removeOpts) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name: ${bucketName}`);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (removeOpts && !(0, _helper.isObject)(removeOpts)) {
      throw new errors.InvalidArgumentError('removeOpts should be of type "object"');
    }
    const method = 'DELETE';
    const headers = {};
    if (removeOpts !== null && removeOpts !== void 0 && removeOpts.governanceBypass) {
      headers['X-Amz-Bypass-Governance-Retention'] = true;
    }
    if (removeOpts !== null && removeOpts !== void 0 && removeOpts.forceDelete) {
      headers['x-minio-force-delete'] = true;
    }
    const queryParams = {};
    if (removeOpts !== null && removeOpts !== void 0 && removeOpts.versionId) {
      queryParams.versionId = `${removeOpts.versionId}`;
    }
    const query = qs.stringify(queryParams);
    await this.makeRequestAsyncOmit({
      method,
      bucketName,
      objectName,
      headers,
      query
    }, '', [200, 204]);
  }

  // Calls implemented below are related to multipart.

  listIncompleteUploads(bucket, prefix, recursive) {
    if (prefix === undefined) {
      prefix = '';
    }
    if (recursive === undefined) {
      recursive = false;
    }
    if (!(0, _helper.isValidBucketName)(bucket)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucket);
    }
    if (!(0, _helper.isValidPrefix)(prefix)) {
      throw new errors.InvalidPrefixError(`Invalid prefix : ${prefix}`);
    }
    if (!(0, _helper.isBoolean)(recursive)) {
      throw new TypeError('recursive should be of type "boolean"');
    }
    const delimiter = recursive ? '' : '/';
    let keyMarker = '';
    let uploadIdMarker = '';
    const uploads = [];
    let ended = false;

    // TODO: refactor this with async/await and `stream.Readable.from`
    const readStream = new stream.Readable({
      objectMode: true
    });
    readStream._read = () => {
      // push one upload info per _read()
      if (uploads.length) {
        return readStream.push(uploads.shift());
      }
      if (ended) {
        return readStream.push(null);
      }
      this.listIncompleteUploadsQuery(bucket, prefix, keyMarker, uploadIdMarker, delimiter).then(result => {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        result.prefixes.forEach(prefix => uploads.push(prefix));
        async.eachSeries(result.uploads, (upload, cb) => {
          // for each incomplete upload add the sizes of its uploaded parts
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore
          this.listParts(bucket, upload.key, upload.uploadId).then(parts => {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            upload.size = parts.reduce((acc, item) => acc + item.size, 0);
            uploads.push(upload);
            cb();
          }, err => cb(err));
        }, err => {
          if (err) {
            readStream.emit('error', err);
            return;
          }
          if (result.isTruncated) {
            keyMarker = result.nextKeyMarker;
            uploadIdMarker = result.nextUploadIdMarker;
          } else {
            ended = true;
          }

          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore
          readStream._read();
        });
      }, e => {
        readStream.emit('error', e);
      });
    };
    return readStream;
  }

  /**
   * Called by listIncompleteUploads to fetch a batch of incomplete uploads.
   */
  async listIncompleteUploadsQuery(bucketName, prefix, keyMarker, uploadIdMarker, delimiter) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isString)(prefix)) {
      throw new TypeError('prefix should be of type "string"');
    }
    if (!(0, _helper.isString)(keyMarker)) {
      throw new TypeError('keyMarker should be of type "string"');
    }
    if (!(0, _helper.isString)(uploadIdMarker)) {
      throw new TypeError('uploadIdMarker should be of type "string"');
    }
    if (!(0, _helper.isString)(delimiter)) {
      throw new TypeError('delimiter should be of type "string"');
    }
    const queries = [];
    queries.push(`prefix=${(0, _helper.uriEscape)(prefix)}`);
    queries.push(`delimiter=${(0, _helper.uriEscape)(delimiter)}`);
    if (keyMarker) {
      queries.push(`key-marker=${(0, _helper.uriEscape)(keyMarker)}`);
    }
    if (uploadIdMarker) {
      queries.push(`upload-id-marker=${uploadIdMarker}`);
    }
    const maxUploads = 1000;
    queries.push(`max-uploads=${maxUploads}`);
    queries.sort();
    queries.unshift('uploads');
    let query = '';
    if (queries.length > 0) {
      query = `${queries.join('&')}`;
    }
    const method = 'GET';
    const res = await this.makeRequestAsync({
      method,
      bucketName,
      query
    });
    const body = await (0, _response.readAsString)(res);
    return xmlParsers.parseListMultipart(body);
  }

  /**
   * Initiate a new multipart upload.
   * @internal
   */
  async initiateNewMultipartUpload(bucketName, objectName, headers) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!(0, _helper.isObject)(headers)) {
      throw new errors.InvalidObjectNameError('contentType should be of type "object"');
    }
    const method = 'POST';
    const query = 'uploads';
    const res = await this.makeRequestAsync({
      method,
      bucketName,
      objectName,
      query,
      headers
    });
    const body = await (0, _response.readAsBuffer)(res);
    return (0, xmlParsers.parseInitiateMultipart)(body.toString());
  }

  /**
   * Internal Method to abort a multipart upload request in case of any errors.
   *
   * @param bucketName - Bucket Name
   * @param objectName - Object Name
   * @param uploadId - id of a multipart upload to cancel during compose object sequence.
   */
  async abortMultipartUpload(bucketName, objectName, uploadId) {
    const method = 'DELETE';
    const query = `uploadId=${uploadId}`;
    const requestOptions = {
      method,
      bucketName,
      objectName: objectName,
      query
    };
    await this.makeRequestAsyncOmit(requestOptions, '', [204]);
  }
  async findUploadId(bucketName, objectName) {
    var _latestUpload;
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    let latestUpload;
    let keyMarker = '';
    let uploadIdMarker = '';
    for (;;) {
      const result = await this.listIncompleteUploadsQuery(bucketName, objectName, keyMarker, uploadIdMarker, '');
      for (const upload of result.uploads) {
        if (upload.key === objectName) {
          if (!latestUpload || upload.initiated.getTime() > latestUpload.initiated.getTime()) {
            latestUpload = upload;
          }
        }
      }
      if (result.isTruncated) {
        keyMarker = result.nextKeyMarker;
        uploadIdMarker = result.nextUploadIdMarker;
        continue;
      }
      break;
    }
    return (_latestUpload = latestUpload) === null || _latestUpload === void 0 ? void 0 : _latestUpload.uploadId;
  }

  /**
   * this call will aggregate the parts on the server into a single object.
   */
  async completeMultipartUpload(bucketName, objectName, uploadId, etags) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!(0, _helper.isString)(uploadId)) {
      throw new TypeError('uploadId should be of type "string"');
    }
    if (!(0, _helper.isObject)(etags)) {
      throw new TypeError('etags should be of type "Array"');
    }
    if (!uploadId) {
      throw new errors.InvalidArgumentError('uploadId cannot be empty');
    }
    const method = 'POST';
    const query = `uploadId=${(0, _helper.uriEscape)(uploadId)}`;
    const builder = new _xml2js.Builder();
    const payload = builder.buildObject({
      CompleteMultipartUpload: {
        $: {
          xmlns: 'http://s3.amazonaws.com/doc/2006-03-01/'
        },
        Part: etags.map(etag => {
          return {
            PartNumber: etag.part,
            ETag: etag.etag
          };
        })
      }
    });
    const res = await this.makeRequestAsync({
      method,
      bucketName,
      objectName,
      query
    }, payload);
    const body = await (0, _response.readAsBuffer)(res);
    const result = (0, xmlParsers.parseCompleteMultipart)(body.toString());
    if (!result) {
      throw new Error('BUG: failed to parse server response');
    }
    if (result.errCode) {
      // Multipart Complete API returns an error XML after a 200 http status
      throw new errors.S3Error(result.errMessage);
    }
    return {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      etag: result.etag,
      versionId: (0, _helper.getVersionId)(res.headers)
    };
  }

  /**
   * Get part-info of all parts of an incomplete upload specified by uploadId.
   */
  async listParts(bucketName, objectName, uploadId) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!(0, _helper.isString)(uploadId)) {
      throw new TypeError('uploadId should be of type "string"');
    }
    if (!uploadId) {
      throw new errors.InvalidArgumentError('uploadId cannot be empty');
    }
    const parts = [];
    let marker = 0;
    let result;
    do {
      result = await this.listPartsQuery(bucketName, objectName, uploadId, marker);
      marker = result.marker;
      parts.push(...result.parts);
    } while (result.isTruncated);
    return parts;
  }

  /**
   * Called by listParts to fetch a batch of part-info
   */
  async listPartsQuery(bucketName, objectName, uploadId, marker) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!(0, _helper.isString)(uploadId)) {
      throw new TypeError('uploadId should be of type "string"');
    }
    if (!(0, _helper.isNumber)(marker)) {
      throw new TypeError('marker should be of type "number"');
    }
    if (!uploadId) {
      throw new errors.InvalidArgumentError('uploadId cannot be empty');
    }
    let query = `uploadId=${(0, _helper.uriEscape)(uploadId)}`;
    if (marker) {
      query += `&part-number-marker=${marker}`;
    }
    const method = 'GET';
    const res = await this.makeRequestAsync({
      method,
      bucketName,
      objectName,
      query
    });
    return xmlParsers.parseListParts(await (0, _response.readAsString)(res));
  }
  async listBuckets() {
    const method = 'GET';
    const regionConf = this.region || _helpers.DEFAULT_REGION;
    const httpRes = await this.makeRequestAsync({
      method
    }, '', [200], regionConf);
    const xmlResult = await (0, _response.readAsString)(httpRes);
    return xmlParsers.parseListBucket(xmlResult);
  }

  /**
   * Calculate part size given the object size. Part size will be atleast this.partSize
   */
  calculatePartSize(size) {
    if (!(0, _helper.isNumber)(size)) {
      throw new TypeError('size should be of type "number"');
    }
    if (size > this.maxObjectSize) {
      throw new TypeError(`size should not be more than ${this.maxObjectSize}`);
    }
    if (this.overRidePartSize) {
      return this.partSize;
    }
    let partSize = this.partSize;
    for (;;) {
      // while(true) {...} throws linting error.
      // If partSize is big enough to accomodate the object size, then use it.
      if (partSize * 10000 > size) {
        return partSize;
      }
      // Try part sizes as 64MB, 80MB, 96MB etc.
      partSize += 16 * 1024 * 1024;
    }
  }

  /**
   * Uploads the object using contents from a file
   */
  async fPutObject(bucketName, objectName, filePath, metaData) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!(0, _helper.isString)(filePath)) {
      throw new TypeError('filePath should be of type "string"');
    }
    if (metaData && !(0, _helper.isObject)(metaData)) {
      throw new TypeError('metaData should be of type "object"');
    }

    // Inserts correct `content-type` attribute based on metaData and filePath
    metaData = (0, _helper.insertContentType)(metaData || {}, filePath);
    const stat = await _async2.fsp.stat(filePath);
    return await this.putObject(bucketName, objectName, fs.createReadStream(filePath), stat.size, metaData);
  }

  /**
   *  Uploading a stream, "Buffer" or "string".
   *  It's recommended to pass `size` argument with stream.
   */
  async putObject(bucketName, objectName, stream, size, metaData) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name: ${bucketName}`);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }

    // We'll need to shift arguments to the left because of metaData
    // and size being optional.
    if ((0, _helper.isObject)(size)) {
      metaData = size;
    }
    // Ensures Metadata has appropriate prefix for A3 API
    const headers = (0, _helper.prependXAMZMeta)(metaData);
    if (typeof stream === 'string' || stream instanceof Buffer) {
      // Adapts the non-stream interface into a stream.
      size = stream.length;
      stream = (0, _helper.readableStream)(stream);
    } else if (!(0, _helper.isReadableStream)(stream)) {
      throw new TypeError('third argument should be of type "stream.Readable" or "Buffer" or "string"');
    }
    if ((0, _helper.isNumber)(size) && size < 0) {
      throw new errors.InvalidArgumentError(`size cannot be negative, given size: ${size}`);
    }

    // Get the part size and forward that to the BlockStream. Default to the
    // largest block size possible if necessary.
    if (!(0, _helper.isNumber)(size)) {
      size = this.maxObjectSize;
    }

    // Get the part size and forward that to the BlockStream. Default to the
    // largest block size possible if necessary.
    if (size === undefined) {
      const statSize = await (0, _helper.getContentLength)(stream);
      if (statSize !== null) {
        size = statSize;
      }
    }
    if (!(0, _helper.isNumber)(size)) {
      // Backward compatibility
      size = this.maxObjectSize;
    }
    if (size === 0) {
      return this.uploadBuffer(bucketName, objectName, headers, Buffer.from(''));
    }
    const partSize = this.calculatePartSize(size);
    if (typeof stream === 'string' || Buffer.isBuffer(stream) || size <= partSize) {
      const buf = (0, _helper.isReadableStream)(stream) ? await (0, _response.readAsBuffer)(stream) : Buffer.from(stream);
      return this.uploadBuffer(bucketName, objectName, headers, buf);
    }
    return this.uploadStream(bucketName, objectName, headers, stream, partSize);
  }

  /**
   * method to upload buffer in one call
   * @private
   */
  async uploadBuffer(bucketName, objectName, headers, buf) {
    const {
      md5sum,
      sha256sum
    } = (0, _helper.hashBinary)(buf, this.enableSHA256);
    headers['Content-Length'] = buf.length;
    if (!this.enableSHA256) {
      headers['Content-MD5'] = md5sum;
    }
    const res = await this.makeRequestStreamAsync({
      method: 'PUT',
      bucketName,
      objectName,
      headers
    }, buf, sha256sum, [200], '');
    await (0, _response.drainResponse)(res);
    return {
      etag: (0, _helper.sanitizeETag)(res.headers.etag),
      versionId: (0, _helper.getVersionId)(res.headers)
    };
  }

  /**
   * upload stream with MultipartUpload
   * @private
   */
  async uploadStream(bucketName, objectName, headers, body, partSize) {
    // A map of the previously uploaded chunks, for resuming a file upload. This
    // will be null if we aren't resuming an upload.
    const oldParts = {};

    // Keep track of the etags for aggregating the chunks together later. Each
    // etag represents a single chunk of the file.
    const eTags = [];
    const previousUploadId = await this.findUploadId(bucketName, objectName);
    let uploadId;
    if (!previousUploadId) {
      uploadId = await this.initiateNewMultipartUpload(bucketName, objectName, headers);
    } else {
      uploadId = previousUploadId;
      const oldTags = await this.listParts(bucketName, objectName, previousUploadId);
      oldTags.forEach(e => {
        oldParts[e.part] = e;
      });
    }
    const chunkier = new _blockStream({
      size: partSize,
      zeroPadding: false
    });

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [_, o] = await Promise.all([new Promise((resolve, reject) => {
      body.pipe(chunkier).on('error', reject);
      chunkier.on('end', resolve).on('error', reject);
    }), (async () => {
      let partNumber = 1;
      for await (const chunk of chunkier) {
        const md5 = crypto.createHash('md5').update(chunk).digest();
        const oldPart = oldParts[partNumber];
        if (oldPart) {
          if (oldPart.etag === md5.toString('hex')) {
            eTags.push({
              part: partNumber,
              etag: oldPart.etag
            });
            partNumber++;
            continue;
          }
        }
        partNumber++;

        // now start to upload missing part
        const options = {
          method: 'PUT',
          query: qs.stringify({
            partNumber,
            uploadId
          }),
          headers: {
            'Content-Length': chunk.length,
            'Content-MD5': md5.toString('base64')
          },
          bucketName,
          objectName
        };
        const response = await this.makeRequestAsyncOmit(options, chunk);
        let etag = response.headers.etag;
        if (etag) {
          etag = etag.replace(/^"/, '').replace(/"$/, '');
        } else {
          etag = '';
        }
        eTags.push({
          part: partNumber,
          etag
        });
      }
      return await this.completeMultipartUpload(bucketName, objectName, uploadId, eTags);
    })()]);
    return o;
  }
  async removeBucketReplication(bucketName) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    const method = 'DELETE';
    const query = 'replication';
    await this.makeRequestAsyncOmit({
      method,
      bucketName,
      query
    }, '', [200, 204], '');
  }
  async setBucketReplication(bucketName, replicationConfig) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isObject)(replicationConfig)) {
      throw new errors.InvalidArgumentError('replicationConfig should be of type "object"');
    } else {
      if (_lodash.isEmpty(replicationConfig.role)) {
        throw new errors.InvalidArgumentError('Role cannot be empty');
      } else if (replicationConfig.role && !(0, _helper.isString)(replicationConfig.role)) {
        throw new errors.InvalidArgumentError('Invalid value for role', replicationConfig.role);
      }
      if (_lodash.isEmpty(replicationConfig.rules)) {
        throw new errors.InvalidArgumentError('Minimum one replication rule must be specified');
      }
    }
    const method = 'PUT';
    const query = 'replication';
    const headers = {};
    const replicationParamsConfig = {
      ReplicationConfiguration: {
        Role: replicationConfig.role,
        Rule: replicationConfig.rules
      }
    };
    const builder = new _xml2js.Builder({
      renderOpts: {
        pretty: false
      },
      headless: true
    });
    const payload = builder.buildObject(replicationParamsConfig);
    headers['Content-MD5'] = (0, _helper.toMd5)(payload);
    await this.makeRequestAsyncOmit({
      method,
      bucketName,
      query,
      headers
    }, payload);
  }
  async getBucketReplication(bucketName) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    const method = 'GET';
    const query = 'replication';
    const httpRes = await this.makeRequestAsync({
      method,
      bucketName,
      query
    }, '', [200, 204]);
    const xmlResult = await (0, _response.readAsString)(httpRes);
    return xmlParsers.parseReplicationConfig(xmlResult);
  }
  async getObjectLegalHold(bucketName, objectName, getOpts) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (getOpts) {
      if (!(0, _helper.isObject)(getOpts)) {
        throw new TypeError('getOpts should be of type "Object"');
      } else if (Object.keys(getOpts).length > 0 && getOpts.versionId && !(0, _helper.isString)(getOpts.versionId)) {
        throw new TypeError('versionId should be of type string.:', getOpts.versionId);
      }
    }
    const method = 'GET';
    let query = 'legal-hold';
    if (getOpts !== null && getOpts !== void 0 && getOpts.versionId) {
      query += `&versionId=${getOpts.versionId}`;
    }
    const httpRes = await this.makeRequestAsync({
      method,
      bucketName,
      objectName,
      query
    }, '', [200]);
    const strRes = await (0, _response.readAsString)(httpRes);
    return (0, xmlParsers.parseObjectLegalHoldConfig)(strRes);
  }
  async setObjectLegalHold(bucketName, objectName, setOpts = {
    status: _helpers.LEGAL_HOLD_STATUS.ENABLED
  }) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!(0, _helper.isObject)(setOpts)) {
      throw new TypeError('setOpts should be of type "Object"');
    } else {
      if (![_helpers.LEGAL_HOLD_STATUS.ENABLED, _helpers.LEGAL_HOLD_STATUS.DISABLED].includes(setOpts === null || setOpts === void 0 ? void 0 : setOpts.status)) {
        throw new TypeError('Invalid status: ' + setOpts.status);
      }
      if (setOpts.versionId && !setOpts.versionId.length) {
        throw new TypeError('versionId should be of type string.:' + setOpts.versionId);
      }
    }
    const method = 'PUT';
    let query = 'legal-hold';
    if (setOpts.versionId) {
      query += `&versionId=${setOpts.versionId}`;
    }
    const config = {
      Status: setOpts.status
    };
    const builder = new _xml2js.Builder({
      rootName: 'LegalHold',
      renderOpts: {
        pretty: false
      },
      headless: true
    });
    const payload = builder.buildObject(config);
    const headers = {};
    headers['Content-MD5'] = (0, _helper.toMd5)(payload);
    await this.makeRequestAsyncOmit({
      method,
      bucketName,
      objectName,
      query,
      headers
    }, payload);
  }

  /**
   * Get Tags associated with a Bucket
   */
  async getBucketTagging(bucketName) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name: ${bucketName}`);
    }
    const method = 'GET';
    const query = 'tagging';
    const requestOptions = {
      method,
      bucketName,
      query
    };
    const response = await this.makeRequestAsync(requestOptions);
    const body = await (0, _response.readAsString)(response);
    return xmlParsers.parseTagging(body);
  }

  /**
   *  Get the tags associated with a bucket OR an object
   */
  async getObjectTagging(bucketName, objectName, getOpts) {
    const method = 'GET';
    let query = 'tagging';
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidBucketNameError('Invalid object name: ' + objectName);
    }
    if (getOpts && !(0, _helper.isObject)(getOpts)) {
      throw new errors.InvalidArgumentError('getOpts should be of type "object"');
    }
    if (getOpts && getOpts.versionId) {
      query = `${query}&versionId=${getOpts.versionId}`;
    }
    const requestOptions = {
      method,
      bucketName,
      query
    };
    if (objectName) {
      requestOptions['objectName'] = objectName;
    }
    const response = await this.makeRequestAsync(requestOptions);
    const body = await (0, _response.readAsString)(response);
    return xmlParsers.parseTagging(body);
  }

  /**
   *  Set the policy on a bucket or an object prefix.
   */
  async setBucketPolicy(bucketName, policy) {
    // Validate arguments.
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name: ${bucketName}`);
    }
    if (!(0, _helper.isString)(policy)) {
      throw new errors.InvalidBucketPolicyError(`Invalid bucket policy: ${policy} - must be "string"`);
    }
    const query = 'policy';
    let method = 'DELETE';
    if (policy) {
      method = 'PUT';
    }
    await this.makeRequestAsyncOmit({
      method,
      bucketName,
      query
    }, policy, [204], '');
  }

  /**
   * Get the policy on a bucket or an object prefix.
   */
  async getBucketPolicy(bucketName) {
    // Validate arguments.
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name: ${bucketName}`);
    }
    const method = 'GET';
    const query = 'policy';
    const res = await this.makeRequestAsync({
      method,
      bucketName,
      query
    });
    return await (0, _response.readAsString)(res);
  }
  async putObjectRetention(bucketName, objectName, retentionOpts = {}) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name: ${bucketName}`);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!(0, _helper.isObject)(retentionOpts)) {
      throw new errors.InvalidArgumentError('retentionOpts should be of type "object"');
    } else {
      if (retentionOpts.governanceBypass && !(0, _helper.isBoolean)(retentionOpts.governanceBypass)) {
        throw new errors.InvalidArgumentError(`Invalid value for governanceBypass: ${retentionOpts.governanceBypass}`);
      }
      if (retentionOpts.mode && ![_helpers.RETENTION_MODES.COMPLIANCE, _helpers.RETENTION_MODES.GOVERNANCE].includes(retentionOpts.mode)) {
        throw new errors.InvalidArgumentError(`Invalid object retention mode: ${retentionOpts.mode}`);
      }
      if (retentionOpts.retainUntilDate && !(0, _helper.isString)(retentionOpts.retainUntilDate)) {
        throw new errors.InvalidArgumentError(`Invalid value for retainUntilDate: ${retentionOpts.retainUntilDate}`);
      }
      if (retentionOpts.versionId && !(0, _helper.isString)(retentionOpts.versionId)) {
        throw new errors.InvalidArgumentError(`Invalid value for versionId: ${retentionOpts.versionId}`);
      }
    }
    const method = 'PUT';
    let query = 'retention';
    const headers = {};
    if (retentionOpts.governanceBypass) {
      headers['X-Amz-Bypass-Governance-Retention'] = true;
    }
    const builder = new _xml2js.Builder({
      rootName: 'Retention',
      renderOpts: {
        pretty: false
      },
      headless: true
    });
    const params = {};
    if (retentionOpts.mode) {
      params.Mode = retentionOpts.mode;
    }
    if (retentionOpts.retainUntilDate) {
      params.RetainUntilDate = retentionOpts.retainUntilDate;
    }
    if (retentionOpts.versionId) {
      query += `&versionId=${retentionOpts.versionId}`;
    }
    const payload = builder.buildObject(params);
    headers['Content-MD5'] = (0, _helper.toMd5)(payload);
    await this.makeRequestAsyncOmit({
      method,
      bucketName,
      objectName,
      query,
      headers
    }, payload, [200, 204]);
  }
  async getObjectLockConfig(bucketName) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    const method = 'GET';
    const query = 'object-lock';
    const httpRes = await this.makeRequestAsync({
      method,
      bucketName,
      query
    });
    const xmlResult = await (0, _response.readAsString)(httpRes);
    return xmlParsers.parseObjectLockConfig(xmlResult);
  }
  async setObjectLockConfig(bucketName, lockConfigOpts) {
    const retentionModes = [_helpers.RETENTION_MODES.COMPLIANCE, _helpers.RETENTION_MODES.GOVERNANCE];
    const validUnits = [_helpers.RETENTION_VALIDITY_UNITS.DAYS, _helpers.RETENTION_VALIDITY_UNITS.YEARS];
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (lockConfigOpts.mode && !retentionModes.includes(lockConfigOpts.mode)) {
      throw new TypeError(`lockConfigOpts.mode should be one of ${retentionModes}`);
    }
    if (lockConfigOpts.unit && !validUnits.includes(lockConfigOpts.unit)) {
      throw new TypeError(`lockConfigOpts.unit should be one of ${validUnits}`);
    }
    if (lockConfigOpts.validity && !(0, _helper.isNumber)(lockConfigOpts.validity)) {
      throw new TypeError(`lockConfigOpts.validity should be a number`);
    }
    const method = 'PUT';
    const query = 'object-lock';
    const config = {
      ObjectLockEnabled: 'Enabled'
    };
    const configKeys = Object.keys(lockConfigOpts);
    const isAllKeysSet = ['unit', 'mode', 'validity'].every(lck => configKeys.includes(lck));
    // Check if keys are present and all keys are present.
    if (configKeys.length > 0) {
      if (!isAllKeysSet) {
        throw new TypeError(`lockConfigOpts.mode,lockConfigOpts.unit,lockConfigOpts.validity all the properties should be specified.`);
      } else {
        config.Rule = {
          DefaultRetention: {}
        };
        if (lockConfigOpts.mode) {
          config.Rule.DefaultRetention.Mode = lockConfigOpts.mode;
        }
        if (lockConfigOpts.unit === _helpers.RETENTION_VALIDITY_UNITS.DAYS) {
          config.Rule.DefaultRetention.Days = lockConfigOpts.validity;
        } else if (lockConfigOpts.unit === _helpers.RETENTION_VALIDITY_UNITS.YEARS) {
          config.Rule.DefaultRetention.Years = lockConfigOpts.validity;
        }
      }
    }
    const builder = new _xml2js.Builder({
      rootName: 'ObjectLockConfiguration',
      renderOpts: {
        pretty: false
      },
      headless: true
    });
    const payload = builder.buildObject(config);
    const headers = {};
    headers['Content-MD5'] = (0, _helper.toMd5)(payload);
    await this.makeRequestAsyncOmit({
      method,
      bucketName,
      query,
      headers
    }, payload);
  }
  async getBucketVersioning(bucketName) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    const method = 'GET';
    const query = 'versioning';
    const httpRes = await this.makeRequestAsync({
      method,
      bucketName,
      query
    });
    const xmlResult = await (0, _response.readAsString)(httpRes);
    return await xmlParsers.parseBucketVersioningConfig(xmlResult);
  }
  async setBucketVersioning(bucketName, versionConfig) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!Object.keys(versionConfig).length) {
      throw new errors.InvalidArgumentError('versionConfig should be of type "object"');
    }
    const method = 'PUT';
    const query = 'versioning';
    const builder = new _xml2js.Builder({
      rootName: 'VersioningConfiguration',
      renderOpts: {
        pretty: false
      },
      headless: true
    });
    const payload = builder.buildObject(versionConfig);
    await this.makeRequestAsyncOmit({
      method,
      bucketName,
      query
    }, payload);
  }
  async setTagging(taggingParams) {
    const {
      bucketName,
      objectName,
      tags,
      putOpts
    } = taggingParams;
    const method = 'PUT';
    let query = 'tagging';
    if (putOpts && putOpts !== null && putOpts !== void 0 && putOpts.versionId) {
      query = `${query}&versionId=${putOpts.versionId}`;
    }
    const tagsList = [];
    for (const [key, value] of Object.entries(tags)) {
      tagsList.push({
        Key: key,
        Value: value
      });
    }
    const taggingConfig = {
      Tagging: {
        TagSet: {
          Tag: tagsList
        }
      }
    };
    const headers = {};
    const builder = new _xml2js.Builder({
      headless: true,
      renderOpts: {
        pretty: false
      }
    });
    const payloadBuf = Buffer.from(builder.buildObject(taggingConfig));
    const requestOptions = {
      method,
      bucketName,
      query,
      headers,
      ...(objectName && {
        objectName: objectName
      })
    };
    headers['Content-MD5'] = (0, _helper.toMd5)(payloadBuf);
    await this.makeRequestAsyncOmit(requestOptions, payloadBuf);
  }
  async removeTagging({
    bucketName,
    objectName,
    removeOpts
  }) {
    const method = 'DELETE';
    let query = 'tagging';
    if (removeOpts && Object.keys(removeOpts).length && removeOpts.versionId) {
      query = `${query}&versionId=${removeOpts.versionId}`;
    }
    const requestOptions = {
      method,
      bucketName,
      objectName,
      query
    };
    if (objectName) {
      requestOptions['objectName'] = objectName;
    }
    await this.makeRequestAsync(requestOptions, '', [200, 204]);
  }
  async setBucketTagging(bucketName, tags) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isPlainObject)(tags)) {
      throw new errors.InvalidArgumentError('tags should be of type "object"');
    }
    if (Object.keys(tags).length > 10) {
      throw new errors.InvalidArgumentError('maximum tags allowed is 10"');
    }
    await this.setTagging({
      bucketName,
      tags
    });
  }
  async removeBucketTagging(bucketName) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    await this.removeTagging({
      bucketName
    });
  }
  async setObjectTagging(bucketName, objectName, tags, putOpts) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidBucketNameError('Invalid object name: ' + objectName);
    }
    if (!(0, _helper.isPlainObject)(tags)) {
      throw new errors.InvalidArgumentError('tags should be of type "object"');
    }
    if (Object.keys(tags).length > 10) {
      throw new errors.InvalidArgumentError('Maximum tags allowed is 10"');
    }
    await this.setTagging({
      bucketName,
      objectName,
      tags,
      putOpts
    });
  }
  async removeObjectTagging(bucketName, objectName, removeOpts) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidBucketNameError('Invalid object name: ' + objectName);
    }
    if (removeOpts && Object.keys(removeOpts).length && !(0, _helper.isObject)(removeOpts)) {
      throw new errors.InvalidArgumentError('removeOpts should be of type "object"');
    }
    await this.removeTagging({
      bucketName,
      objectName,
      removeOpts
    });
  }
  async selectObjectContent(bucketName, objectName, selectOpts) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name: ${bucketName}`);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!_lodash.isEmpty(selectOpts)) {
      if (!(0, _helper.isString)(selectOpts.expression)) {
        throw new TypeError('sqlExpression should be of type "string"');
      }
      if (!_lodash.isEmpty(selectOpts.inputSerialization)) {
        if (!(0, _helper.isObject)(selectOpts.inputSerialization)) {
          throw new TypeError('inputSerialization should be of type "object"');
        }
      } else {
        throw new TypeError('inputSerialization is required');
      }
      if (!_lodash.isEmpty(selectOpts.outputSerialization)) {
        if (!(0, _helper.isObject)(selectOpts.outputSerialization)) {
          throw new TypeError('outputSerialization should be of type "object"');
        }
      } else {
        throw new TypeError('outputSerialization is required');
      }
    } else {
      throw new TypeError('valid select configuration is required');
    }
    const method = 'POST';
    const query = `select&select-type=2`;
    const config = [{
      Expression: selectOpts.expression
    }, {
      ExpressionType: selectOpts.expressionType || 'SQL'
    }, {
      InputSerialization: [selectOpts.inputSerialization]
    }, {
      OutputSerialization: [selectOpts.outputSerialization]
    }];

    // Optional
    if (selectOpts.requestProgress) {
      config.push({
        RequestProgress: selectOpts === null || selectOpts === void 0 ? void 0 : selectOpts.requestProgress
      });
    }
    // Optional
    if (selectOpts.scanRange) {
      config.push({
        ScanRange: selectOpts.scanRange
      });
    }
    const builder = new _xml2js.Builder({
      rootName: 'SelectObjectContentRequest',
      renderOpts: {
        pretty: false
      },
      headless: true
    });
    const payload = builder.buildObject(config);
    const res = await this.makeRequestAsync({
      method,
      bucketName,
      objectName,
      query
    }, payload);
    const body = await (0, _response.readAsBuffer)(res);
    return (0, xmlParsers.parseSelectObjectContentResponse)(body);
  }
  async applyBucketLifecycle(bucketName, policyConfig) {
    const method = 'PUT';
    const query = 'lifecycle';
    const headers = {};
    const builder = new _xml2js.Builder({
      rootName: 'LifecycleConfiguration',
      headless: true,
      renderOpts: {
        pretty: false
      }
    });
    const payload = builder.buildObject(policyConfig);
    headers['Content-MD5'] = (0, _helper.toMd5)(payload);
    await this.makeRequestAsyncOmit({
      method,
      bucketName,
      query,
      headers
    }, payload);
  }
  async removeBucketLifecycle(bucketName) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    const method = 'DELETE';
    const query = 'lifecycle';
    await this.makeRequestAsyncOmit({
      method,
      bucketName,
      query
    }, '', [204]);
  }
  async setBucketLifecycle(bucketName, lifeCycleConfig) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (_lodash.isEmpty(lifeCycleConfig)) {
      await this.removeBucketLifecycle(bucketName);
    } else {
      await this.applyBucketLifecycle(bucketName, lifeCycleConfig);
    }
  }
  async getBucketLifecycle(bucketName) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    const method = 'GET';
    const query = 'lifecycle';
    const res = await this.makeRequestAsync({
      method,
      bucketName,
      query
    });
    const body = await (0, _response.readAsString)(res);
    return xmlParsers.parseLifecycleConfig(body);
  }
  async setBucketEncryption(bucketName, encryptionConfig) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!_lodash.isEmpty(encryptionConfig) && encryptionConfig.Rule.length > 1) {
      throw new errors.InvalidArgumentError('Invalid Rule length. Only one rule is allowed.: ' + encryptionConfig.Rule);
    }
    let encryptionObj = encryptionConfig;
    if (_lodash.isEmpty(encryptionConfig)) {
      encryptionObj = {
        // Default MinIO Server Supported Rule
        Rule: [{
          ApplyServerSideEncryptionByDefault: {
            SSEAlgorithm: 'AES256'
          }
        }]
      };
    }
    const method = 'PUT';
    const query = 'encryption';
    const builder = new _xml2js.Builder({
      rootName: 'ServerSideEncryptionConfiguration',
      renderOpts: {
        pretty: false
      },
      headless: true
    });
    const payload = builder.buildObject(encryptionObj);
    const headers = {};
    headers['Content-MD5'] = (0, _helper.toMd5)(payload);
    await this.makeRequestAsyncOmit({
      method,
      bucketName,
      query,
      headers
    }, payload);
  }
  async getBucketEncryption(bucketName) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    const method = 'GET';
    const query = 'encryption';
    const res = await this.makeRequestAsync({
      method,
      bucketName,
      query
    });
    const body = await (0, _response.readAsString)(res);
    return xmlParsers.parseBucketEncryptionConfig(body);
  }
  async removeBucketEncryption(bucketName) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    const method = 'DELETE';
    const query = 'encryption';
    await this.makeRequestAsyncOmit({
      method,
      bucketName,
      query
    }, '', [204]);
  }
  async getObjectRetention(bucketName, objectName, getOpts) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (getOpts && !(0, _helper.isObject)(getOpts)) {
      throw new errors.InvalidArgumentError('getOpts should be of type "object"');
    } else if (getOpts !== null && getOpts !== void 0 && getOpts.versionId && !(0, _helper.isString)(getOpts.versionId)) {
      throw new errors.InvalidArgumentError('versionId should be of type "string"');
    }
    const method = 'GET';
    let query = 'retention';
    if (getOpts !== null && getOpts !== void 0 && getOpts.versionId) {
      query += `&versionId=${getOpts.versionId}`;
    }
    const res = await this.makeRequestAsync({
      method,
      bucketName,
      objectName,
      query
    });
    const body = await (0, _response.readAsString)(res);
    return xmlParsers.parseObjectRetentionConfig(body);
  }
  async removeObjects(bucketName, objectsList) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!Array.isArray(objectsList)) {
      throw new errors.InvalidArgumentError('objectsList should be a list');
    }
    const runDeleteObjects = async batch => {
      const delObjects = batch.map(value => {
        return (0, _helper.isObject)(value) ? {
          Key: value.name,
          VersionId: value.versionId
        } : {
          Key: value
        };
      });
      const remObjects = {
        Delete: {
          Quiet: true,
          Object: delObjects
        }
      };
      const payload = Buffer.from(new _xml2js.Builder({
        headless: true
      }).buildObject(remObjects));
      const headers = {
        'Content-MD5': (0, _helper.toMd5)(payload)
      };
      const res = await this.makeRequestAsync({
        method: 'POST',
        bucketName,
        query: 'delete',
        headers
      }, payload);
      const body = await (0, _response.readAsString)(res);
      return xmlParsers.removeObjectsParser(body);
    };
    const maxEntries = 1000; // max entries accepted in server for DeleteMultipleObjects API.
    // Client side batching
    const batches = [];
    for (let i = 0; i < objectsList.length; i += maxEntries) {
      batches.push(objectsList.slice(i, i + maxEntries));
    }
    const batchResults = await Promise.all(batches.map(runDeleteObjects));
    return batchResults.flat();
  }
  async removeIncompleteUpload(bucketName, objectName) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.IsValidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    const removeUploadId = await this.findUploadId(bucketName, objectName);
    const method = 'DELETE';
    const query = `uploadId=${removeUploadId}`;
    await this.makeRequestAsyncOmit({
      method,
      bucketName,
      objectName,
      query
    }, '', [204]);
  }
  async copyObjectV1(targetBucketName, targetObjectName, sourceBucketNameAndObjectName, conditions) {
    if (typeof conditions == 'function') {
      conditions = null;
    }
    if (!(0, _helper.isValidBucketName)(targetBucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + targetBucketName);
    }
    if (!(0, _helper.isValidObjectName)(targetObjectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${targetObjectName}`);
    }
    if (!(0, _helper.isString)(sourceBucketNameAndObjectName)) {
      throw new TypeError('sourceBucketNameAndObjectName should be of type "string"');
    }
    if (sourceBucketNameAndObjectName === '') {
      throw new errors.InvalidPrefixError(`Empty source prefix`);
    }
    if (conditions != null && !(conditions instanceof _copyConditions.CopyConditions)) {
      throw new TypeError('conditions should be of type "CopyConditions"');
    }
    const headers = {};
    headers['x-amz-copy-source'] = (0, _helper.uriResourceEscape)(sourceBucketNameAndObjectName);
    if (conditions) {
      if (conditions.modified !== '') {
        headers['x-amz-copy-source-if-modified-since'] = conditions.modified;
      }
      if (conditions.unmodified !== '') {
        headers['x-amz-copy-source-if-unmodified-since'] = conditions.unmodified;
      }
      if (conditions.matchETag !== '') {
        headers['x-amz-copy-source-if-match'] = conditions.matchETag;
      }
      if (conditions.matchETagExcept !== '') {
        headers['x-amz-copy-source-if-none-match'] = conditions.matchETagExcept;
      }
    }
    const method = 'PUT';
    const res = await this.makeRequestAsync({
      method,
      bucketName: targetBucketName,
      objectName: targetObjectName,
      headers
    });
    const body = await (0, _response.readAsString)(res);
    return xmlParsers.parseCopyObject(body);
  }
  async copyObjectV2(sourceConfig, destConfig) {
    if (!(sourceConfig instanceof _helpers.CopySourceOptions)) {
      throw new errors.InvalidArgumentError('sourceConfig should of type CopySourceOptions ');
    }
    if (!(destConfig instanceof _helpers.CopyDestinationOptions)) {
      throw new errors.InvalidArgumentError('destConfig should of type CopyDestinationOptions ');
    }
    if (!destConfig.validate()) {
      return Promise.reject();
    }
    if (!destConfig.validate()) {
      return Promise.reject();
    }
    const headers = Object.assign({}, sourceConfig.getHeaders(), destConfig.getHeaders());
    const bucketName = destConfig.Bucket;
    const objectName = destConfig.Object;
    const method = 'PUT';
    const res = await this.makeRequestAsync({
      method,
      bucketName,
      objectName,
      headers
    });
    const body = await (0, _response.readAsString)(res);
    const copyRes = xmlParsers.parseCopyObject(body);
    const resHeaders = res.headers;
    const sizeHeaderValue = resHeaders && resHeaders['content-length'];
    const size = typeof sizeHeaderValue === 'number' ? sizeHeaderValue : undefined;
    return {
      Bucket: destConfig.Bucket,
      Key: destConfig.Object,
      LastModified: copyRes.lastModified,
      MetaData: (0, _helper.extractMetadata)(resHeaders),
      VersionId: (0, _helper.getVersionId)(resHeaders),
      SourceVersionId: (0, _helper.getSourceVersionId)(resHeaders),
      Etag: (0, _helper.sanitizeETag)(resHeaders.etag),
      Size: size
    };
  }
  async copyObject(...allArgs) {
    if (typeof allArgs[0] === 'string') {
      const [targetBucketName, targetObjectName, sourceBucketNameAndObjectName, conditions] = allArgs;
      return await this.copyObjectV1(targetBucketName, targetObjectName, sourceBucketNameAndObjectName, conditions);
    }
    const [source, dest] = allArgs;
    return await this.copyObjectV2(source, dest);
  }
  async uploadPart(partConfig, payload) {
    const {
      bucketName,
      objectName,
      uploadID,
      partNumber,
      headers
    } = partConfig;
    const method = 'PUT';
    const query = `uploadId=${uploadID}&partNumber=${partNumber}`;
    const requestOptions = {
      method,
      bucketName,
      objectName: objectName,
      query,
      headers
    };
    const res = await this.makeRequestAsync(requestOptions, payload);
    const body = await (0, _response.readAsString)(res);
    const partRes = (0, xmlParsers.uploadPartParser)(body);
    const partEtagVal = (0, _helper.sanitizeETag)(res.headers.etag) || (0, _helper.sanitizeETag)(partRes.ETag);
    return {
      etag: partEtagVal,
      key: objectName,
      part: partNumber
    };
  }
  async composeObject(destObjConfig, sourceObjList, {
    maxConcurrency = 10
  } = {}) {
    const sourceFilesLength = sourceObjList.length;
    if (!Array.isArray(sourceObjList)) {
      throw new errors.InvalidArgumentError('sourceConfig should an array of CopySourceOptions ');
    }
    if (!(destObjConfig instanceof _helpers.CopyDestinationOptions)) {
      throw new errors.InvalidArgumentError('destConfig should of type CopyDestinationOptions ');
    }
    if (sourceFilesLength < 1 || sourceFilesLength > _helper.PART_CONSTRAINTS.MAX_PARTS_COUNT) {
      throw new errors.InvalidArgumentError(`"There must be as least one and up to ${_helper.PART_CONSTRAINTS.MAX_PARTS_COUNT} source objects.`);
    }
    for (let i = 0; i < sourceFilesLength; i++) {
      const sObj = sourceObjList[i];
      if (!sObj.validate()) {
        return false;
      }
    }
    if (!destObjConfig.validate()) {
      return false;
    }
    const getStatOptions = srcConfig => {
      let statOpts = {};
      if (!_lodash.isEmpty(srcConfig.VersionID)) {
        statOpts = {
          versionId: srcConfig.VersionID
        };
      }
      return statOpts;
    };
    const srcObjectSizes = [];
    let totalSize = 0;
    let totalParts = 0;
    const sourceObjStats = sourceObjList.map(srcItem => this.statObject(srcItem.Bucket, srcItem.Object, getStatOptions(srcItem)));
    const srcObjectInfos = await Promise.all(sourceObjStats);
    const validatedStats = srcObjectInfos.map((resItemStat, index) => {
      const srcConfig = sourceObjList[index];
      let srcCopySize = resItemStat.size;
      // Check if a segment is specified, and if so, is the
      // segment within object bounds?
      if (srcConfig && srcConfig.MatchRange) {
        // Since range is specified,
        //    0 <= src.srcStart <= src.srcEnd
        // so only invalid case to check is:
        const srcStart = srcConfig.Start;
        const srcEnd = srcConfig.End;
        if (srcEnd >= srcCopySize || srcStart < 0) {
          throw new errors.InvalidArgumentError(`CopySrcOptions ${index} has invalid segment-to-copy [${srcStart}, ${srcEnd}] (size is ${srcCopySize})`);
        }
        srcCopySize = srcEnd - srcStart + 1;
      }

      // Only the last source may be less than `absMinPartSize`
      if (srcCopySize < _helper.PART_CONSTRAINTS.ABS_MIN_PART_SIZE && index < sourceFilesLength - 1) {
        throw new errors.InvalidArgumentError(`CopySrcOptions ${index} is too small (${srcCopySize}) and it is not the last part.`);
      }

      // Is data to copy too large?
      totalSize += srcCopySize;
      if (totalSize > _helper.PART_CONSTRAINTS.MAX_MULTIPART_PUT_OBJECT_SIZE) {
        throw new errors.InvalidArgumentError(`Cannot compose an object of size ${totalSize} (> 5TiB)`);
      }

      // record source size
      srcObjectSizes[index] = srcCopySize;

      // calculate parts needed for current source
      totalParts += (0, _helper.partsRequired)(srcCopySize);
      // Do we need more parts than we are allowed?
      if (totalParts > _helper.PART_CONSTRAINTS.MAX_PARTS_COUNT) {
        throw new errors.InvalidArgumentError(`Your proposed compose object requires more than ${_helper.PART_CONSTRAINTS.MAX_PARTS_COUNT} parts`);
      }
      return resItemStat;
    });
    if (totalParts === 1 && totalSize <= _helper.PART_CONSTRAINTS.MAX_PART_SIZE || totalSize === 0) {
      return await this.copyObject(sourceObjList[0], destObjConfig); // use copyObjectV2
    }

    // preserve etag to avoid modification of object while copying.
    for (let i = 0; i < sourceFilesLength; i++) {
      ;
      sourceObjList[i].MatchETag = validatedStats[i].etag;
    }
    const splitPartSizeList = validatedStats.map((resItemStat, idx) => {
      return (0, _helper.calculateEvenSplits)(srcObjectSizes[idx], sourceObjList[idx]);
    });
    const getUploadPartConfigList = uploadId => {
      const uploadPartConfigList = [];
      splitPartSizeList.forEach((splitSize, splitIndex) => {
        if (splitSize) {
          const {
            startIndex: startIdx,
            endIndex: endIdx,
            objInfo: objConfig
          } = splitSize;
          const partIndex = splitIndex + 1; // part index starts from 1.
          const totalUploads = Array.from(startIdx);
          const headers = sourceObjList[splitIndex].getHeaders();
          totalUploads.forEach((splitStart, upldCtrIdx) => {
            const splitEnd = endIdx[upldCtrIdx];
            const sourceObj = `${objConfig.Bucket}/${objConfig.Object}`;
            headers['x-amz-copy-source'] = `${sourceObj}`;
            headers['x-amz-copy-source-range'] = `bytes=${splitStart}-${splitEnd}`;
            const uploadPartConfig = {
              bucketName: destObjConfig.Bucket,
              objectName: destObjConfig.Object,
              uploadID: uploadId,
              partNumber: partIndex,
              headers: headers,
              sourceObj: sourceObj
            };
            uploadPartConfigList.push(uploadPartConfig);
          });
        }
      });
      return uploadPartConfigList;
    };
    const uploadAllParts = async uploadList => {
      const partUploads = [];

      // Process upload parts in batches to avoid too many concurrent requests
      for (const batch of _lodash.chunk(uploadList, maxConcurrency)) {
        const batchResults = await Promise.all(batch.map(item => this.uploadPart(item)));
        partUploads.push(...batchResults);
      }

      // Process results here if needed
      return partUploads;
    };
    const performUploadParts = async uploadId => {
      const uploadList = getUploadPartConfigList(uploadId);
      const partsRes = await uploadAllParts(uploadList);
      return partsRes.map(partCopy => ({
        etag: partCopy.etag,
        part: partCopy.part
      }));
    };
    const newUploadHeaders = destObjConfig.getHeaders();
    const uploadId = await this.initiateNewMultipartUpload(destObjConfig.Bucket, destObjConfig.Object, newUploadHeaders);
    try {
      const partsDone = await performUploadParts(uploadId);
      return await this.completeMultipartUpload(destObjConfig.Bucket, destObjConfig.Object, uploadId, partsDone);
    } catch (err) {
      return await this.abortMultipartUpload(destObjConfig.Bucket, destObjConfig.Object, uploadId);
    }
  }
  async presignedUrl(method, bucketName, objectName, expires, reqParams, requestDate) {
    var _requestDate;
    if (this.anonymous) {
      throw new errors.AnonymousRequestError(`Presigned ${method} url cannot be generated for anonymous requests`);
    }
    if (!expires) {
      expires = _helpers.PRESIGN_EXPIRY_DAYS_MAX;
    }
    if (!reqParams) {
      reqParams = {};
    }
    if (!requestDate) {
      requestDate = new Date();
    }

    // Type assertions
    if (expires && typeof expires !== 'number') {
      throw new TypeError('expires should be of type "number"');
    }
    if (reqParams && typeof reqParams !== 'object') {
      throw new TypeError('reqParams should be of type "object"');
    }
    if (requestDate && !(requestDate instanceof Date) || requestDate && isNaN((_requestDate = requestDate) === null || _requestDate === void 0 ? void 0 : _requestDate.getTime())) {
      throw new TypeError('requestDate should be of type "Date" and valid');
    }
    const query = reqParams ? qs.stringify(reqParams) : undefined;
    try {
      const region = await this.getBucketRegionAsync(bucketName);
      await this.checkAndRefreshCreds();
      const reqOptions = this.getRequestOptions({
        method,
        region,
        bucketName,
        objectName,
        query
      });
      return (0, _signing.presignSignatureV4)(reqOptions, this.accessKey, this.secretKey, this.sessionToken, region, requestDate, expires);
    } catch (err) {
      if (err instanceof errors.InvalidBucketNameError) {
        throw new errors.InvalidArgumentError(`Unable to get bucket region for ${bucketName}.`);
      }
      throw err;
    }
  }
  async presignedGetObject(bucketName, objectName, expires, respHeaders, requestDate) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    const validRespHeaders = ['response-content-type', 'response-content-language', 'response-expires', 'response-cache-control', 'response-content-disposition', 'response-content-encoding'];
    validRespHeaders.forEach(header => {
      // @ts-ignore
      if (respHeaders !== undefined && respHeaders[header] !== undefined && !(0, _helper.isString)(respHeaders[header])) {
        throw new TypeError(`response header ${header} should be of type "string"`);
      }
    });
    return this.presignedUrl('GET', bucketName, objectName, expires, respHeaders, requestDate);
  }
  async presignedPutObject(bucketName, objectName, expires) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name: ${bucketName}`);
    }
    if (!(0, _helper.isValidObjectName)(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    return this.presignedUrl('PUT', bucketName, objectName, expires);
  }
  newPostPolicy() {
    return new _postPolicy.PostPolicy();
  }
  async presignedPostPolicy(postPolicy) {
    if (this.anonymous) {
      throw new errors.AnonymousRequestError('Presigned POST policy cannot be generated for anonymous requests');
    }
    if (!(0, _helper.isObject)(postPolicy)) {
      throw new TypeError('postPolicy should be of type "object"');
    }
    const bucketName = postPolicy.formData.bucket;
    try {
      const region = await this.getBucketRegionAsync(bucketName);
      const date = new Date();
      const dateStr = (0, _helper.makeDateLong)(date);
      await this.checkAndRefreshCreds();
      if (!postPolicy.policy.expiration) {
        // 'expiration' is mandatory field for S3.
        // Set default expiration date of 7 days.
        const expires = new Date();
        expires.setSeconds(_helpers.PRESIGN_EXPIRY_DAYS_MAX);
        postPolicy.setExpires(expires);
      }
      postPolicy.policy.conditions.push(['eq', '$x-amz-date', dateStr]);
      postPolicy.formData['x-amz-date'] = dateStr;
      postPolicy.policy.conditions.push(['eq', '$x-amz-algorithm', 'AWS4-HMAC-SHA256']);
      postPolicy.formData['x-amz-algorithm'] = 'AWS4-HMAC-SHA256';
      postPolicy.policy.conditions.push(['eq', '$x-amz-credential', this.accessKey + '/' + (0, _helper.getScope)(region, date)]);
      postPolicy.formData['x-amz-credential'] = this.accessKey + '/' + (0, _helper.getScope)(region, date);
      if (this.sessionToken) {
        postPolicy.policy.conditions.push(['eq', '$x-amz-security-token', this.sessionToken]);
        postPolicy.formData['x-amz-security-token'] = this.sessionToken;
      }
      const policyBase64 = Buffer.from(JSON.stringify(postPolicy.policy)).toString('base64');
      postPolicy.formData.policy = policyBase64;
      postPolicy.formData['x-amz-signature'] = (0, _signing.postPresignSignatureV4)(region, date, this.secretKey, policyBase64);
      const opts = {
        region: region,
        bucketName: bucketName,
        method: 'POST'
      };
      const reqOptions = this.getRequestOptions(opts);
      const portStr = this.port == 80 || this.port === 443 ? '' : `:${this.port.toString()}`;
      const urlStr = `${reqOptions.protocol}//${reqOptions.host}${portStr}${reqOptions.path}`;
      return {
        postURL: urlStr,
        formData: postPolicy.formData
      };
    } catch (err) {
      if (err instanceof errors.InvalidBucketNameError) {
        throw new errors.InvalidArgumentError(`Unable to get bucket region for ${bucketName}.`);
      }
      throw err;
    }
  }
  // list a batch of objects
  async listObjectsQuery(bucketName, prefix, marker, listQueryOpts) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isString)(prefix)) {
      throw new TypeError('prefix should be of type "string"');
    }
    if (marker && !(0, _helper.isString)(marker)) {
      throw new TypeError('marker should be of type "string"');
    }
    if (listQueryOpts && !(0, _helper.isObject)(listQueryOpts)) {
      throw new TypeError('listQueryOpts should be of type "object"');
    }
    let {
      Delimiter,
      MaxKeys,
      IncludeVersion,
      versionIdMarker,
      keyMarker
    } = listQueryOpts;
    if (!(0, _helper.isString)(Delimiter)) {
      throw new TypeError('Delimiter should be of type "string"');
    }
    if (!(0, _helper.isNumber)(MaxKeys)) {
      throw new TypeError('MaxKeys should be of type "number"');
    }
    const queries = [];
    // escape every value in query string, except maxKeys
    queries.push(`prefix=${(0, _helper.uriEscape)(prefix)}`);
    queries.push(`delimiter=${(0, _helper.uriEscape)(Delimiter)}`);
    queries.push(`encoding-type=url`);
    if (IncludeVersion) {
      queries.push(`versions`);
    }
    if (IncludeVersion) {
      // v1 version listing..
      if (keyMarker) {
        queries.push(`key-marker=${keyMarker}`);
      }
      if (versionIdMarker) {
        queries.push(`version-id-marker=${versionIdMarker}`);
      }
    } else if (marker) {
      marker = (0, _helper.uriEscape)(marker);
      queries.push(`marker=${marker}`);
    }

    // no need to escape maxKeys
    if (MaxKeys) {
      if (MaxKeys >= 1000) {
        MaxKeys = 1000;
      }
      queries.push(`max-keys=${MaxKeys}`);
    }
    queries.sort();
    let query = '';
    if (queries.length > 0) {
      query = `${queries.join('&')}`;
    }
    const method = 'GET';
    const res = await this.makeRequestAsync({
      method,
      bucketName,
      query
    });
    const body = await (0, _response.readAsString)(res);
    const listQryList = (0, xmlParsers.parseListObjects)(body);
    return listQryList;
  }
  listObjects(bucketName, prefix, recursive, listOpts) {
    if (prefix === undefined) {
      prefix = '';
    }
    if (recursive === undefined) {
      recursive = false;
    }
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidPrefix)(prefix)) {
      throw new errors.InvalidPrefixError(`Invalid prefix : ${prefix}`);
    }
    if (!(0, _helper.isString)(prefix)) {
      throw new TypeError('prefix should be of type "string"');
    }
    if (!(0, _helper.isBoolean)(recursive)) {
      throw new TypeError('recursive should be of type "boolean"');
    }
    if (listOpts && !(0, _helper.isObject)(listOpts)) {
      throw new TypeError('listOpts should be of type "object"');
    }
    let marker = '';
    let keyMarker = '';
    let versionIdMarker = '';
    let objects = [];
    let ended = false;
    const readStream = new stream.Readable({
      objectMode: true
    });
    readStream._read = async () => {
      // push one object per _read()
      if (objects.length) {
        readStream.push(objects.shift());
        return;
      }
      if (ended) {
        return readStream.push(null);
      }
      try {
        const listQueryOpts = {
          Delimiter: recursive ? '' : '/',
          // if recursive is false set delimiter to '/'
          MaxKeys: 1000,
          IncludeVersion: listOpts === null || listOpts === void 0 ? void 0 : listOpts.IncludeVersion,
          // version listing specific options
          keyMarker: keyMarker,
          versionIdMarker: versionIdMarker
        };
        const result = await this.listObjectsQuery(bucketName, prefix, marker, listQueryOpts);
        if (result.isTruncated) {
          marker = result.nextMarker || undefined;
          if (result.keyMarker) {
            keyMarker = result.keyMarker;
          }
          if (result.versionIdMarker) {
            versionIdMarker = result.versionIdMarker;
          }
        } else {
          ended = true;
        }
        if (result.objects) {
          objects = result.objects;
        }
        // @ts-ignore
        readStream._read();
      } catch (err) {
        readStream.emit('error', err);
      }
    };
    return readStream;
  }
  async listObjectsV2Query(bucketName, prefix, continuationToken, delimiter, maxKeys, startAfter) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isString)(prefix)) {
      throw new TypeError('prefix should be of type "string"');
    }
    if (!(0, _helper.isString)(continuationToken)) {
      throw new TypeError('continuationToken should be of type "string"');
    }
    if (!(0, _helper.isString)(delimiter)) {
      throw new TypeError('delimiter should be of type "string"');
    }
    if (!(0, _helper.isNumber)(maxKeys)) {
      throw new TypeError('maxKeys should be of type "number"');
    }
    if (!(0, _helper.isString)(startAfter)) {
      throw new TypeError('startAfter should be of type "string"');
    }
    const queries = [];
    queries.push(`list-type=2`);
    queries.push(`encoding-type=url`);
    queries.push(`prefix=${(0, _helper.uriEscape)(prefix)}`);
    queries.push(`delimiter=${(0, _helper.uriEscape)(delimiter)}`);
    if (continuationToken) {
      queries.push(`continuation-token=${(0, _helper.uriEscape)(continuationToken)}`);
    }
    if (startAfter) {
      queries.push(`start-after=${(0, _helper.uriEscape)(startAfter)}`);
    }
    if (maxKeys) {
      if (maxKeys >= 1000) {
        maxKeys = 1000;
      }
      queries.push(`max-keys=${maxKeys}`);
    }
    queries.sort();
    let query = '';
    if (queries.length > 0) {
      query = `${queries.join('&')}`;
    }
    const method = 'GET';
    const res = await this.makeRequestAsync({
      method,
      bucketName,
      query
    });
    const body = await (0, _response.readAsString)(res);
    return (0, xmlParsers.parseListObjectsV2)(body);
  }
  listObjectsV2(bucketName, prefix, recursive, startAfter) {
    if (prefix === undefined) {
      prefix = '';
    }
    if (recursive === undefined) {
      recursive = false;
    }
    if (startAfter === undefined) {
      startAfter = '';
    }
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isValidPrefix)(prefix)) {
      throw new errors.InvalidPrefixError(`Invalid prefix : ${prefix}`);
    }
    if (!(0, _helper.isString)(prefix)) {
      throw new TypeError('prefix should be of type "string"');
    }
    if (!(0, _helper.isBoolean)(recursive)) {
      throw new TypeError('recursive should be of type "boolean"');
    }
    if (!(0, _helper.isString)(startAfter)) {
      throw new TypeError('startAfter should be of type "string"');
    }
    const delimiter = recursive ? '' : '/';
    const prefixStr = prefix;
    const startAfterStr = startAfter;
    let continuationToken = '';
    let objects = [];
    let ended = false;
    const readStream = new stream.Readable({
      objectMode: true
    });
    readStream._read = async () => {
      if (objects.length) {
        readStream.push(objects.shift());
        return;
      }
      if (ended) {
        return readStream.push(null);
      }
      try {
        const result = await this.listObjectsV2Query(bucketName, prefixStr, continuationToken, delimiter, 1000, startAfterStr);
        if (result.isTruncated) {
          continuationToken = result.nextContinuationToken;
        } else {
          ended = true;
        }
        objects = result.objects;
        // @ts-ignore
        readStream._read();
      } catch (err) {
        readStream.emit('error', err);
      }
    };
    return readStream;
  }
  async setBucketNotification(bucketName, config) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!(0, _helper.isObject)(config)) {
      throw new TypeError('notification config should be of type "Object"');
    }
    const method = 'PUT';
    const query = 'notification';
    const builder = new _xml2js.Builder({
      rootName: 'NotificationConfiguration',
      renderOpts: {
        pretty: false
      },
      headless: true
    });
    const payload = builder.buildObject(config);
    await this.makeRequestAsyncOmit({
      method,
      bucketName,
      query
    }, payload);
  }
  async removeAllBucketNotification(bucketName) {
    await this.setBucketNotification(bucketName, new _notification.NotificationConfig());
  }
  async getBucketNotification(bucketName) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    const method = 'GET';
    const query = 'notification';
    const res = await this.makeRequestAsync({
      method,
      bucketName,
      query
    });
    const body = await (0, _response.readAsString)(res);
    return (0, xmlParsers.parseBucketNotification)(body);
  }
  listenBucketNotification(bucketName, prefix, suffix, events) {
    if (!(0, _helper.isValidBucketName)(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name: ${bucketName}`);
    }
    if (!(0, _helper.isString)(prefix)) {
      throw new TypeError('prefix must be of type string');
    }
    if (!(0, _helper.isString)(suffix)) {
      throw new TypeError('suffix must be of type string');
    }
    if (!Array.isArray(events)) {
      throw new TypeError('events must be of type Array');
    }
    const listener = new _notification.NotificationPoller(this, bucketName, prefix, suffix, events);
    listener.start();
    return listener;
  }
}
exports.TypedClient = TypedClient;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJjcnlwdG8iLCJfaW50ZXJvcFJlcXVpcmVXaWxkY2FyZCIsInJlcXVpcmUiLCJmcyIsImh0dHAiLCJodHRwcyIsInBhdGgiLCJzdHJlYW0iLCJhc3luYyIsIl9ibG9ja1N0cmVhbSIsIl9icm93c2VyT3JOb2RlIiwiX2xvZGFzaCIsInFzIiwiX3htbDJqcyIsIl9DcmVkZW50aWFsUHJvdmlkZXIiLCJlcnJvcnMiLCJfaGVscGVycyIsIl9ub3RpZmljYXRpb24iLCJfc2lnbmluZyIsIl9hc3luYzIiLCJfY29weUNvbmRpdGlvbnMiLCJfZXh0ZW5zaW9ucyIsIl9oZWxwZXIiLCJfam9pbkhvc3RQb3J0IiwiX3Bvc3RQb2xpY3kiLCJfcmVxdWVzdCIsIl9yZXNwb25zZSIsIl9zM0VuZHBvaW50cyIsInhtbFBhcnNlcnMiLCJlIiwidCIsIldlYWtNYXAiLCJyIiwibiIsIl9fZXNNb2R1bGUiLCJvIiwiaSIsImYiLCJfX3Byb3RvX18iLCJkZWZhdWx0IiwiaGFzIiwiZ2V0Iiwic2V0IiwiaGFzT3duUHJvcGVydHkiLCJjYWxsIiwiT2JqZWN0IiwiZGVmaW5lUHJvcGVydHkiLCJnZXRPd25Qcm9wZXJ0eURlc2NyaXB0b3IiLCJ4bWwiLCJ4bWwyanMiLCJCdWlsZGVyIiwicmVuZGVyT3B0cyIsInByZXR0eSIsImhlYWRsZXNzIiwiUGFja2FnZSIsInZlcnNpb24iLCJyZXF1ZXN0T3B0aW9uUHJvcGVydGllcyIsIlR5cGVkQ2xpZW50IiwicGFydFNpemUiLCJtYXhpbXVtUGFydFNpemUiLCJtYXhPYmplY3RTaXplIiwiY29uc3RydWN0b3IiLCJwYXJhbXMiLCJzZWN1cmUiLCJ1bmRlZmluZWQiLCJFcnJvciIsInVzZVNTTCIsInBvcnQiLCJpc1ZhbGlkRW5kcG9pbnQiLCJlbmRQb2ludCIsIkludmFsaWRFbmRwb2ludEVycm9yIiwiaXNWYWxpZFBvcnQiLCJJbnZhbGlkQXJndW1lbnRFcnJvciIsImlzQm9vbGVhbiIsInJlZ2lvbiIsImlzU3RyaW5nIiwiaG9zdCIsInRvTG93ZXJDYXNlIiwicHJvdG9jb2wiLCJ0cmFuc3BvcnQiLCJ0cmFuc3BvcnRBZ2VudCIsImdsb2JhbEFnZW50IiwiaXNPYmplY3QiLCJsaWJyYXJ5Q29tbWVudHMiLCJwcm9jZXNzIiwicGxhdGZvcm0iLCJhcmNoIiwibGlicmFyeUFnZW50IiwidXNlckFnZW50IiwicGF0aFN0eWxlIiwiYWNjZXNzS2V5Iiwic2VjcmV0S2V5Iiwic2Vzc2lvblRva2VuIiwiYW5vbnltb3VzIiwiY3JlZGVudGlhbHNQcm92aWRlciIsInJlZ2lvbk1hcCIsIm92ZXJSaWRlUGFydFNpemUiLCJlbmFibGVTSEEyNTYiLCJzM0FjY2VsZXJhdGVFbmRwb2ludCIsInJlcU9wdGlvbnMiLCJjbGllbnRFeHRlbnNpb25zIiwiRXh0ZW5zaW9ucyIsInJldHJ5T3B0aW9ucyIsImRpc2FibGVSZXRyeSIsImV4dGVuc2lvbnMiLCJzZXRTM1RyYW5zZmVyQWNjZWxlcmF0ZSIsInNldFJlcXVlc3RPcHRpb25zIiwib3B0aW9ucyIsIlR5cGVFcnJvciIsIl8iLCJwaWNrIiwiZ2V0QWNjZWxlcmF0ZUVuZFBvaW50SWZTZXQiLCJidWNrZXROYW1lIiwib2JqZWN0TmFtZSIsImlzRW1wdHkiLCJpbmNsdWRlcyIsInNldEFwcEluZm8iLCJhcHBOYW1lIiwiYXBwVmVyc2lvbiIsInRyaW0iLCJnZXRSZXF1ZXN0T3B0aW9ucyIsIm9wdHMiLCJtZXRob2QiLCJoZWFkZXJzIiwicXVlcnkiLCJhZ2VudCIsInZpcnR1YWxIb3N0U3R5bGUiLCJpc1ZpcnR1YWxIb3N0U3R5bGUiLCJ1cmlSZXNvdXJjZUVzY2FwZSIsImlzQW1hem9uRW5kcG9pbnQiLCJhY2NlbGVyYXRlRW5kUG9pbnQiLCJnZXRTM0VuZHBvaW50Iiwiam9pbkhvc3RQb3J0IiwiayIsInYiLCJlbnRyaWVzIiwiYXNzaWduIiwibWFwVmFsdWVzIiwicGlja0J5IiwiaXNEZWZpbmVkIiwidG9TdHJpbmciLCJzZXRDcmVkZW50aWFsc1Byb3ZpZGVyIiwiQ3JlZGVudGlhbFByb3ZpZGVyIiwiY2hlY2tBbmRSZWZyZXNoQ3JlZHMiLCJjcmVkZW50aWFsc0NvbmYiLCJnZXRDcmVkZW50aWFscyIsImdldEFjY2Vzc0tleSIsImdldFNlY3JldEtleSIsImdldFNlc3Npb25Ub2tlbiIsImNhdXNlIiwibG9nSFRUUCIsInJlc3BvbnNlIiwiZXJyIiwibG9nU3RyZWFtIiwiaXNSZWFkYWJsZVN0cmVhbSIsImxvZ0hlYWRlcnMiLCJmb3JFYWNoIiwicmVkYWN0b3IiLCJSZWdFeHAiLCJyZXBsYWNlIiwid3JpdGUiLCJzdGF0dXNDb2RlIiwiZXJySlNPTiIsIkpTT04iLCJzdHJpbmdpZnkiLCJ0cmFjZU9uIiwic3Rkb3V0IiwidHJhY2VPZmYiLCJtYWtlUmVxdWVzdEFzeW5jIiwicGF5bG9hZCIsImV4cGVjdGVkQ29kZXMiLCJpc051bWJlciIsImxlbmd0aCIsInNoYTI1NnN1bSIsInRvU2hhMjU2IiwibWFrZVJlcXVlc3RTdHJlYW1Bc3luYyIsIm1ha2VSZXF1ZXN0QXN5bmNPbWl0Iiwic3RhdHVzQ29kZXMiLCJyZXMiLCJkcmFpblJlc3BvbnNlIiwiYm9keSIsIkJ1ZmZlciIsImlzQnVmZmVyIiwiZ2V0QnVja2V0UmVnaW9uQXN5bmMiLCJkYXRlIiwiRGF0ZSIsIm1ha2VEYXRlTG9uZyIsImF1dGhvcml6YXRpb24iLCJzaWduVjQiLCJyZXF1ZXN0V2l0aFJldHJ5IiwibWF4aW11bVJldHJ5Q291bnQiLCJiYXNlRGVsYXlNcyIsIm1heGltdW1EZWxheU1zIiwicGFyc2VSZXNwb25zZUVycm9yIiwiaXNWYWxpZEJ1Y2tldE5hbWUiLCJJbnZhbGlkQnVja2V0TmFtZUVycm9yIiwiY2FjaGVkIiwiZXh0cmFjdFJlZ2lvbkFzeW5jIiwicmVhZEFzU3RyaW5nIiwicGFyc2VCdWNrZXRSZWdpb24iLCJERUZBVUxUX1JFR0lPTiIsImlzQnJvd3NlciIsIlMzRXJyb3IiLCJlcnJDb2RlIiwiY29kZSIsImVyclJlZ2lvbiIsIm5hbWUiLCJSZWdpb24iLCJtYWtlUmVxdWVzdCIsInJldHVyblJlc3BvbnNlIiwiY2IiLCJwcm9tIiwidGhlbiIsInJlc3VsdCIsIm1ha2VSZXF1ZXN0U3RyZWFtIiwiZXhlY3V0b3IiLCJnZXRCdWNrZXRSZWdpb24iLCJtYWtlQnVja2V0IiwibWFrZU9wdHMiLCJidWlsZE9iamVjdCIsIkNyZWF0ZUJ1Y2tldENvbmZpZ3VyYXRpb24iLCIkIiwieG1sbnMiLCJMb2NhdGlvbkNvbnN0cmFpbnQiLCJPYmplY3RMb2NraW5nIiwiZmluYWxSZWdpb24iLCJyZXF1ZXN0T3B0IiwiYnVja2V0RXhpc3RzIiwicmVtb3ZlQnVja2V0IiwiZ2V0T2JqZWN0IiwiZ2V0T3B0cyIsImlzVmFsaWRPYmplY3ROYW1lIiwiSW52YWxpZE9iamVjdE5hbWVFcnJvciIsImdldFBhcnRpYWxPYmplY3QiLCJvZmZzZXQiLCJyYW5nZSIsInNzZUhlYWRlcnMiLCJTU0VDdXN0b21lckFsZ29yaXRobSIsIlNTRUN1c3RvbWVyS2V5IiwiU1NFQ3VzdG9tZXJLZXlNRDUiLCJwcmVwZW5kWEFNWk1ldGEiLCJleHBlY3RlZFN0YXR1c0NvZGVzIiwicHVzaCIsImZHZXRPYmplY3QiLCJmaWxlUGF0aCIsImRvd25sb2FkVG9UbXBGaWxlIiwicGFydEZpbGVTdHJlYW0iLCJvYmpTdGF0Iiwic3RhdE9iamVjdCIsImVuY29kZWRFdGFnIiwiZnJvbSIsImV0YWciLCJwYXJ0RmlsZSIsImZzcCIsIm1rZGlyIiwiZGlybmFtZSIsInJlY3Vyc2l2ZSIsInN0YXRzIiwic3RhdCIsInNpemUiLCJjcmVhdGVXcml0ZVN0cmVhbSIsImZsYWdzIiwiZG93bmxvYWRTdHJlYW0iLCJzdHJlYW1Qcm9taXNlIiwicGlwZWxpbmUiLCJyZW5hbWUiLCJzdGF0T3B0cyIsInN0YXRPcHREZWYiLCJwYXJzZUludCIsIm1ldGFEYXRhIiwiZXh0cmFjdE1ldGFkYXRhIiwibGFzdE1vZGlmaWVkIiwidmVyc2lvbklkIiwiZ2V0VmVyc2lvbklkIiwic2FuaXRpemVFVGFnIiwicmVtb3ZlT2JqZWN0IiwicmVtb3ZlT3B0cyIsImdvdmVybmFuY2VCeXBhc3MiLCJmb3JjZURlbGV0ZSIsInF1ZXJ5UGFyYW1zIiwibGlzdEluY29tcGxldGVVcGxvYWRzIiwiYnVja2V0IiwicHJlZml4IiwiaXNWYWxpZFByZWZpeCIsIkludmFsaWRQcmVmaXhFcnJvciIsImRlbGltaXRlciIsImtleU1hcmtlciIsInVwbG9hZElkTWFya2VyIiwidXBsb2FkcyIsImVuZGVkIiwicmVhZFN0cmVhbSIsIlJlYWRhYmxlIiwib2JqZWN0TW9kZSIsIl9yZWFkIiwic2hpZnQiLCJsaXN0SW5jb21wbGV0ZVVwbG9hZHNRdWVyeSIsInByZWZpeGVzIiwiZWFjaFNlcmllcyIsInVwbG9hZCIsImxpc3RQYXJ0cyIsImtleSIsInVwbG9hZElkIiwicGFydHMiLCJyZWR1Y2UiLCJhY2MiLCJpdGVtIiwiZW1pdCIsImlzVHJ1bmNhdGVkIiwibmV4dEtleU1hcmtlciIsIm5leHRVcGxvYWRJZE1hcmtlciIsInF1ZXJpZXMiLCJ1cmlFc2NhcGUiLCJtYXhVcGxvYWRzIiwic29ydCIsInVuc2hpZnQiLCJqb2luIiwicGFyc2VMaXN0TXVsdGlwYXJ0IiwiaW5pdGlhdGVOZXdNdWx0aXBhcnRVcGxvYWQiLCJyZWFkQXNCdWZmZXIiLCJwYXJzZUluaXRpYXRlTXVsdGlwYXJ0IiwiYWJvcnRNdWx0aXBhcnRVcGxvYWQiLCJyZXF1ZXN0T3B0aW9ucyIsImZpbmRVcGxvYWRJZCIsIl9sYXRlc3RVcGxvYWQiLCJsYXRlc3RVcGxvYWQiLCJpbml0aWF0ZWQiLCJnZXRUaW1lIiwiY29tcGxldGVNdWx0aXBhcnRVcGxvYWQiLCJldGFncyIsImJ1aWxkZXIiLCJDb21wbGV0ZU11bHRpcGFydFVwbG9hZCIsIlBhcnQiLCJtYXAiLCJQYXJ0TnVtYmVyIiwicGFydCIsIkVUYWciLCJwYXJzZUNvbXBsZXRlTXVsdGlwYXJ0IiwiZXJyTWVzc2FnZSIsIm1hcmtlciIsImxpc3RQYXJ0c1F1ZXJ5IiwicGFyc2VMaXN0UGFydHMiLCJsaXN0QnVja2V0cyIsInJlZ2lvbkNvbmYiLCJodHRwUmVzIiwieG1sUmVzdWx0IiwicGFyc2VMaXN0QnVja2V0IiwiY2FsY3VsYXRlUGFydFNpemUiLCJmUHV0T2JqZWN0IiwiaW5zZXJ0Q29udGVudFR5cGUiLCJwdXRPYmplY3QiLCJjcmVhdGVSZWFkU3RyZWFtIiwicmVhZGFibGVTdHJlYW0iLCJzdGF0U2l6ZSIsImdldENvbnRlbnRMZW5ndGgiLCJ1cGxvYWRCdWZmZXIiLCJidWYiLCJ1cGxvYWRTdHJlYW0iLCJtZDVzdW0iLCJoYXNoQmluYXJ5Iiwib2xkUGFydHMiLCJlVGFncyIsInByZXZpb3VzVXBsb2FkSWQiLCJvbGRUYWdzIiwiY2h1bmtpZXIiLCJCbG9ja1N0cmVhbTIiLCJ6ZXJvUGFkZGluZyIsIlByb21pc2UiLCJhbGwiLCJyZXNvbHZlIiwicmVqZWN0IiwicGlwZSIsIm9uIiwicGFydE51bWJlciIsImNodW5rIiwibWQ1IiwiY3JlYXRlSGFzaCIsInVwZGF0ZSIsImRpZ2VzdCIsIm9sZFBhcnQiLCJyZW1vdmVCdWNrZXRSZXBsaWNhdGlvbiIsInNldEJ1Y2tldFJlcGxpY2F0aW9uIiwicmVwbGljYXRpb25Db25maWciLCJyb2xlIiwicnVsZXMiLCJyZXBsaWNhdGlvblBhcmFtc0NvbmZpZyIsIlJlcGxpY2F0aW9uQ29uZmlndXJhdGlvbiIsIlJvbGUiLCJSdWxlIiwidG9NZDUiLCJnZXRCdWNrZXRSZXBsaWNhdGlvbiIsInBhcnNlUmVwbGljYXRpb25Db25maWciLCJnZXRPYmplY3RMZWdhbEhvbGQiLCJrZXlzIiwic3RyUmVzIiwicGFyc2VPYmplY3RMZWdhbEhvbGRDb25maWciLCJzZXRPYmplY3RMZWdhbEhvbGQiLCJzZXRPcHRzIiwic3RhdHVzIiwiTEVHQUxfSE9MRF9TVEFUVVMiLCJFTkFCTEVEIiwiRElTQUJMRUQiLCJjb25maWciLCJTdGF0dXMiLCJyb290TmFtZSIsImdldEJ1Y2tldFRhZ2dpbmciLCJwYXJzZVRhZ2dpbmciLCJnZXRPYmplY3RUYWdnaW5nIiwic2V0QnVja2V0UG9saWN5IiwicG9saWN5IiwiSW52YWxpZEJ1Y2tldFBvbGljeUVycm9yIiwiZ2V0QnVja2V0UG9saWN5IiwicHV0T2JqZWN0UmV0ZW50aW9uIiwicmV0ZW50aW9uT3B0cyIsIm1vZGUiLCJSRVRFTlRJT05fTU9ERVMiLCJDT01QTElBTkNFIiwiR09WRVJOQU5DRSIsInJldGFpblVudGlsRGF0ZSIsIk1vZGUiLCJSZXRhaW5VbnRpbERhdGUiLCJnZXRPYmplY3RMb2NrQ29uZmlnIiwicGFyc2VPYmplY3RMb2NrQ29uZmlnIiwic2V0T2JqZWN0TG9ja0NvbmZpZyIsImxvY2tDb25maWdPcHRzIiwicmV0ZW50aW9uTW9kZXMiLCJ2YWxpZFVuaXRzIiwiUkVURU5USU9OX1ZBTElESVRZX1VOSVRTIiwiREFZUyIsIllFQVJTIiwidW5pdCIsInZhbGlkaXR5IiwiT2JqZWN0TG9ja0VuYWJsZWQiLCJjb25maWdLZXlzIiwiaXNBbGxLZXlzU2V0IiwiZXZlcnkiLCJsY2siLCJEZWZhdWx0UmV0ZW50aW9uIiwiRGF5cyIsIlllYXJzIiwiZ2V0QnVja2V0VmVyc2lvbmluZyIsInBhcnNlQnVja2V0VmVyc2lvbmluZ0NvbmZpZyIsInNldEJ1Y2tldFZlcnNpb25pbmciLCJ2ZXJzaW9uQ29uZmlnIiwic2V0VGFnZ2luZyIsInRhZ2dpbmdQYXJhbXMiLCJ0YWdzIiwicHV0T3B0cyIsInRhZ3NMaXN0IiwidmFsdWUiLCJLZXkiLCJWYWx1ZSIsInRhZ2dpbmdDb25maWciLCJUYWdnaW5nIiwiVGFnU2V0IiwiVGFnIiwicGF5bG9hZEJ1ZiIsInJlbW92ZVRhZ2dpbmciLCJzZXRCdWNrZXRUYWdnaW5nIiwiaXNQbGFpbk9iamVjdCIsInJlbW92ZUJ1Y2tldFRhZ2dpbmciLCJzZXRPYmplY3RUYWdnaW5nIiwicmVtb3ZlT2JqZWN0VGFnZ2luZyIsInNlbGVjdE9iamVjdENvbnRlbnQiLCJzZWxlY3RPcHRzIiwiZXhwcmVzc2lvbiIsImlucHV0U2VyaWFsaXphdGlvbiIsIm91dHB1dFNlcmlhbGl6YXRpb24iLCJFeHByZXNzaW9uIiwiRXhwcmVzc2lvblR5cGUiLCJleHByZXNzaW9uVHlwZSIsIklucHV0U2VyaWFsaXphdGlvbiIsIk91dHB1dFNlcmlhbGl6YXRpb24iLCJyZXF1ZXN0UHJvZ3Jlc3MiLCJSZXF1ZXN0UHJvZ3Jlc3MiLCJzY2FuUmFuZ2UiLCJTY2FuUmFuZ2UiLCJwYXJzZVNlbGVjdE9iamVjdENvbnRlbnRSZXNwb25zZSIsImFwcGx5QnVja2V0TGlmZWN5Y2xlIiwicG9saWN5Q29uZmlnIiwicmVtb3ZlQnVja2V0TGlmZWN5Y2xlIiwic2V0QnVja2V0TGlmZWN5Y2xlIiwibGlmZUN5Y2xlQ29uZmlnIiwiZ2V0QnVja2V0TGlmZWN5Y2xlIiwicGFyc2VMaWZlY3ljbGVDb25maWciLCJzZXRCdWNrZXRFbmNyeXB0aW9uIiwiZW5jcnlwdGlvbkNvbmZpZyIsImVuY3J5cHRpb25PYmoiLCJBcHBseVNlcnZlclNpZGVFbmNyeXB0aW9uQnlEZWZhdWx0IiwiU1NFQWxnb3JpdGhtIiwiZ2V0QnVja2V0RW5jcnlwdGlvbiIsInBhcnNlQnVja2V0RW5jcnlwdGlvbkNvbmZpZyIsInJlbW92ZUJ1Y2tldEVuY3J5cHRpb24iLCJnZXRPYmplY3RSZXRlbnRpb24iLCJwYXJzZU9iamVjdFJldGVudGlvbkNvbmZpZyIsInJlbW92ZU9iamVjdHMiLCJvYmplY3RzTGlzdCIsIkFycmF5IiwiaXNBcnJheSIsInJ1bkRlbGV0ZU9iamVjdHMiLCJiYXRjaCIsImRlbE9iamVjdHMiLCJWZXJzaW9uSWQiLCJyZW1PYmplY3RzIiwiRGVsZXRlIiwiUXVpZXQiLCJyZW1vdmVPYmplY3RzUGFyc2VyIiwibWF4RW50cmllcyIsImJhdGNoZXMiLCJzbGljZSIsImJhdGNoUmVzdWx0cyIsImZsYXQiLCJyZW1vdmVJbmNvbXBsZXRlVXBsb2FkIiwiSXNWYWxpZEJ1Y2tldE5hbWVFcnJvciIsInJlbW92ZVVwbG9hZElkIiwiY29weU9iamVjdFYxIiwidGFyZ2V0QnVja2V0TmFtZSIsInRhcmdldE9iamVjdE5hbWUiLCJzb3VyY2VCdWNrZXROYW1lQW5kT2JqZWN0TmFtZSIsImNvbmRpdGlvbnMiLCJDb3B5Q29uZGl0aW9ucyIsIm1vZGlmaWVkIiwidW5tb2RpZmllZCIsIm1hdGNoRVRhZyIsIm1hdGNoRVRhZ0V4Y2VwdCIsInBhcnNlQ29weU9iamVjdCIsImNvcHlPYmplY3RWMiIsInNvdXJjZUNvbmZpZyIsImRlc3RDb25maWciLCJDb3B5U291cmNlT3B0aW9ucyIsIkNvcHlEZXN0aW5hdGlvbk9wdGlvbnMiLCJ2YWxpZGF0ZSIsImdldEhlYWRlcnMiLCJCdWNrZXQiLCJjb3B5UmVzIiwicmVzSGVhZGVycyIsInNpemVIZWFkZXJWYWx1ZSIsIkxhc3RNb2RpZmllZCIsIk1ldGFEYXRhIiwiU291cmNlVmVyc2lvbklkIiwiZ2V0U291cmNlVmVyc2lvbklkIiwiRXRhZyIsIlNpemUiLCJjb3B5T2JqZWN0IiwiYWxsQXJncyIsInNvdXJjZSIsImRlc3QiLCJ1cGxvYWRQYXJ0IiwicGFydENvbmZpZyIsInVwbG9hZElEIiwicGFydFJlcyIsInVwbG9hZFBhcnRQYXJzZXIiLCJwYXJ0RXRhZ1ZhbCIsImNvbXBvc2VPYmplY3QiLCJkZXN0T2JqQ29uZmlnIiwic291cmNlT2JqTGlzdCIsIm1heENvbmN1cnJlbmN5Iiwic291cmNlRmlsZXNMZW5ndGgiLCJQQVJUX0NPTlNUUkFJTlRTIiwiTUFYX1BBUlRTX0NPVU5UIiwic09iaiIsImdldFN0YXRPcHRpb25zIiwic3JjQ29uZmlnIiwiVmVyc2lvbklEIiwic3JjT2JqZWN0U2l6ZXMiLCJ0b3RhbFNpemUiLCJ0b3RhbFBhcnRzIiwic291cmNlT2JqU3RhdHMiLCJzcmNJdGVtIiwic3JjT2JqZWN0SW5mb3MiLCJ2YWxpZGF0ZWRTdGF0cyIsInJlc0l0ZW1TdGF0IiwiaW5kZXgiLCJzcmNDb3B5U2l6ZSIsIk1hdGNoUmFuZ2UiLCJzcmNTdGFydCIsIlN0YXJ0Iiwic3JjRW5kIiwiRW5kIiwiQUJTX01JTl9QQVJUX1NJWkUiLCJNQVhfTVVMVElQQVJUX1BVVF9PQkpFQ1RfU0laRSIsInBhcnRzUmVxdWlyZWQiLCJNQVhfUEFSVF9TSVpFIiwiTWF0Y2hFVGFnIiwic3BsaXRQYXJ0U2l6ZUxpc3QiLCJpZHgiLCJjYWxjdWxhdGVFdmVuU3BsaXRzIiwiZ2V0VXBsb2FkUGFydENvbmZpZ0xpc3QiLCJ1cGxvYWRQYXJ0Q29uZmlnTGlzdCIsInNwbGl0U2l6ZSIsInNwbGl0SW5kZXgiLCJzdGFydEluZGV4Iiwic3RhcnRJZHgiLCJlbmRJbmRleCIsImVuZElkeCIsIm9iakluZm8iLCJvYmpDb25maWciLCJwYXJ0SW5kZXgiLCJ0b3RhbFVwbG9hZHMiLCJzcGxpdFN0YXJ0IiwidXBsZEN0cklkeCIsInNwbGl0RW5kIiwic291cmNlT2JqIiwidXBsb2FkUGFydENvbmZpZyIsInVwbG9hZEFsbFBhcnRzIiwidXBsb2FkTGlzdCIsInBhcnRVcGxvYWRzIiwicGVyZm9ybVVwbG9hZFBhcnRzIiwicGFydHNSZXMiLCJwYXJ0Q29weSIsIm5ld1VwbG9hZEhlYWRlcnMiLCJwYXJ0c0RvbmUiLCJwcmVzaWduZWRVcmwiLCJleHBpcmVzIiwicmVxUGFyYW1zIiwicmVxdWVzdERhdGUiLCJfcmVxdWVzdERhdGUiLCJBbm9ueW1vdXNSZXF1ZXN0RXJyb3IiLCJQUkVTSUdOX0VYUElSWV9EQVlTX01BWCIsImlzTmFOIiwicHJlc2lnblNpZ25hdHVyZVY0IiwicHJlc2lnbmVkR2V0T2JqZWN0IiwicmVzcEhlYWRlcnMiLCJ2YWxpZFJlc3BIZWFkZXJzIiwiaGVhZGVyIiwicHJlc2lnbmVkUHV0T2JqZWN0IiwibmV3UG9zdFBvbGljeSIsIlBvc3RQb2xpY3kiLCJwcmVzaWduZWRQb3N0UG9saWN5IiwicG9zdFBvbGljeSIsImZvcm1EYXRhIiwiZGF0ZVN0ciIsImV4cGlyYXRpb24iLCJzZXRTZWNvbmRzIiwic2V0RXhwaXJlcyIsImdldFNjb3BlIiwicG9saWN5QmFzZTY0IiwicG9zdFByZXNpZ25TaWduYXR1cmVWNCIsInBvcnRTdHIiLCJ1cmxTdHIiLCJwb3N0VVJMIiwibGlzdE9iamVjdHNRdWVyeSIsImxpc3RRdWVyeU9wdHMiLCJEZWxpbWl0ZXIiLCJNYXhLZXlzIiwiSW5jbHVkZVZlcnNpb24iLCJ2ZXJzaW9uSWRNYXJrZXIiLCJsaXN0UXJ5TGlzdCIsInBhcnNlTGlzdE9iamVjdHMiLCJsaXN0T2JqZWN0cyIsImxpc3RPcHRzIiwib2JqZWN0cyIsIm5leHRNYXJrZXIiLCJsaXN0T2JqZWN0c1YyUXVlcnkiLCJjb250aW51YXRpb25Ub2tlbiIsIm1heEtleXMiLCJzdGFydEFmdGVyIiwicGFyc2VMaXN0T2JqZWN0c1YyIiwibGlzdE9iamVjdHNWMiIsInByZWZpeFN0ciIsInN0YXJ0QWZ0ZXJTdHIiLCJuZXh0Q29udGludWF0aW9uVG9rZW4iLCJzZXRCdWNrZXROb3RpZmljYXRpb24iLCJyZW1vdmVBbGxCdWNrZXROb3RpZmljYXRpb24iLCJOb3RpZmljYXRpb25Db25maWciLCJnZXRCdWNrZXROb3RpZmljYXRpb24iLCJwYXJzZUJ1Y2tldE5vdGlmaWNhdGlvbiIsImxpc3RlbkJ1Y2tldE5vdGlmaWNhdGlvbiIsInN1ZmZpeCIsImV2ZW50cyIsImxpc3RlbmVyIiwiTm90aWZpY2F0aW9uUG9sbGVyIiwic3RhcnQiLCJleHBvcnRzIl0sInNvdXJjZXMiOlsiY2xpZW50LnRzIl0sInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGNyeXB0byBmcm9tICdub2RlOmNyeXB0bydcbmltcG9ydCAqIGFzIGZzIGZyb20gJ25vZGU6ZnMnXG5pbXBvcnQgdHlwZSB7IEluY29taW5nSHR0cEhlYWRlcnMgfSBmcm9tICdub2RlOmh0dHAnXG5pbXBvcnQgKiBhcyBodHRwIGZyb20gJ25vZGU6aHR0cCdcbmltcG9ydCAqIGFzIGh0dHBzIGZyb20gJ25vZGU6aHR0cHMnXG5pbXBvcnQgKiBhcyBwYXRoIGZyb20gJ25vZGU6cGF0aCdcbmltcG9ydCAqIGFzIHN0cmVhbSBmcm9tICdub2RlOnN0cmVhbSdcblxuaW1wb3J0ICogYXMgYXN5bmMgZnJvbSAnYXN5bmMnXG5pbXBvcnQgQmxvY2tTdHJlYW0yIGZyb20gJ2Jsb2NrLXN0cmVhbTInXG5pbXBvcnQgeyBpc0Jyb3dzZXIgfSBmcm9tICdicm93c2VyLW9yLW5vZGUnXG5pbXBvcnQgXyBmcm9tICdsb2Rhc2gnXG5pbXBvcnQgKiBhcyBxcyBmcm9tICdxdWVyeS1zdHJpbmcnXG5pbXBvcnQgeG1sMmpzIGZyb20gJ3htbDJqcydcblxuaW1wb3J0IHsgQ3JlZGVudGlhbFByb3ZpZGVyIH0gZnJvbSAnLi4vQ3JlZGVudGlhbFByb3ZpZGVyLnRzJ1xuaW1wb3J0ICogYXMgZXJyb3JzIGZyb20gJy4uL2Vycm9ycy50cydcbmltcG9ydCB0eXBlIHsgU2VsZWN0UmVzdWx0cyB9IGZyb20gJy4uL2hlbHBlcnMudHMnXG5pbXBvcnQge1xuICBDb3B5RGVzdGluYXRpb25PcHRpb25zLFxuICBDb3B5U291cmNlT3B0aW9ucyxcbiAgREVGQVVMVF9SRUdJT04sXG4gIExFR0FMX0hPTERfU1RBVFVTLFxuICBQUkVTSUdOX0VYUElSWV9EQVlTX01BWCxcbiAgUkVURU5USU9OX01PREVTLFxuICBSRVRFTlRJT05fVkFMSURJVFlfVU5JVFMsXG59IGZyb20gJy4uL2hlbHBlcnMudHMnXG5pbXBvcnQgdHlwZSB7IE5vdGlmaWNhdGlvbkV2ZW50IH0gZnJvbSAnLi4vbm90aWZpY2F0aW9uLnRzJ1xuaW1wb3J0IHsgTm90aWZpY2F0aW9uQ29uZmlnLCBOb3RpZmljYXRpb25Qb2xsZXIgfSBmcm9tICcuLi9ub3RpZmljYXRpb24udHMnXG5pbXBvcnQgeyBwb3N0UHJlc2lnblNpZ25hdHVyZVY0LCBwcmVzaWduU2lnbmF0dXJlVjQsIHNpZ25WNCB9IGZyb20gJy4uL3NpZ25pbmcudHMnXG5pbXBvcnQgeyBmc3AsIHN0cmVhbVByb21pc2UgfSBmcm9tICcuL2FzeW5jLnRzJ1xuaW1wb3J0IHsgQ29weUNvbmRpdGlvbnMgfSBmcm9tICcuL2NvcHktY29uZGl0aW9ucy50cydcbmltcG9ydCB7IEV4dGVuc2lvbnMgfSBmcm9tICcuL2V4dGVuc2lvbnMudHMnXG5pbXBvcnQge1xuICBjYWxjdWxhdGVFdmVuU3BsaXRzLFxuICBleHRyYWN0TWV0YWRhdGEsXG4gIGdldENvbnRlbnRMZW5ndGgsXG4gIGdldFNjb3BlLFxuICBnZXRTb3VyY2VWZXJzaW9uSWQsXG4gIGdldFZlcnNpb25JZCxcbiAgaGFzaEJpbmFyeSxcbiAgaW5zZXJ0Q29udGVudFR5cGUsXG4gIGlzQW1hem9uRW5kcG9pbnQsXG4gIGlzQm9vbGVhbixcbiAgaXNEZWZpbmVkLFxuICBpc0VtcHR5LFxuICBpc051bWJlcixcbiAgaXNPYmplY3QsXG4gIGlzUGxhaW5PYmplY3QsXG4gIGlzUmVhZGFibGVTdHJlYW0sXG4gIGlzU3RyaW5nLFxuICBpc1ZhbGlkQnVja2V0TmFtZSxcbiAgaXNWYWxpZEVuZHBvaW50LFxuICBpc1ZhbGlkT2JqZWN0TmFtZSxcbiAgaXNWYWxpZFBvcnQsXG4gIGlzVmFsaWRQcmVmaXgsXG4gIGlzVmlydHVhbEhvc3RTdHlsZSxcbiAgbWFrZURhdGVMb25nLFxuICBQQVJUX0NPTlNUUkFJTlRTLFxuICBwYXJ0c1JlcXVpcmVkLFxuICBwcmVwZW5kWEFNWk1ldGEsXG4gIHJlYWRhYmxlU3RyZWFtLFxuICBzYW5pdGl6ZUVUYWcsXG4gIHRvTWQ1LFxuICB0b1NoYTI1NixcbiAgdXJpRXNjYXBlLFxuICB1cmlSZXNvdXJjZUVzY2FwZSxcbn0gZnJvbSAnLi9oZWxwZXIudHMnXG5pbXBvcnQgeyBqb2luSG9zdFBvcnQgfSBmcm9tICcuL2pvaW4taG9zdC1wb3J0LnRzJ1xuaW1wb3J0IHsgUG9zdFBvbGljeSB9IGZyb20gJy4vcG9zdC1wb2xpY3kudHMnXG5pbXBvcnQgeyByZXF1ZXN0V2l0aFJldHJ5IH0gZnJvbSAnLi9yZXF1ZXN0LnRzJ1xuaW1wb3J0IHsgZHJhaW5SZXNwb25zZSwgcmVhZEFzQnVmZmVyLCByZWFkQXNTdHJpbmcgfSBmcm9tICcuL3Jlc3BvbnNlLnRzJ1xuaW1wb3J0IHR5cGUgeyBSZWdpb24gfSBmcm9tICcuL3MzLWVuZHBvaW50cy50cydcbmltcG9ydCB7IGdldFMzRW5kcG9pbnQgfSBmcm9tICcuL3MzLWVuZHBvaW50cy50cydcbmltcG9ydCB0eXBlIHtcbiAgQmluYXJ5LFxuICBCdWNrZXRJdGVtLFxuICBCdWNrZXRJdGVtRnJvbUxpc3QsXG4gIEJ1Y2tldEl0ZW1TdGF0LFxuICBCdWNrZXRTdHJlYW0sXG4gIEJ1Y2tldFZlcnNpb25pbmdDb25maWd1cmF0aW9uLFxuICBDb3B5T2JqZWN0UGFyYW1zLFxuICBDb3B5T2JqZWN0UmVzdWx0LFxuICBDb3B5T2JqZWN0UmVzdWx0VjIsXG4gIEVuY3J5cHRpb25Db25maWcsXG4gIEdldE9iamVjdExlZ2FsSG9sZE9wdGlvbnMsXG4gIEdldE9iamVjdE9wdHMsXG4gIEdldE9iamVjdFJldGVudGlvbk9wdHMsXG4gIEluY29tcGxldGVVcGxvYWRlZEJ1Y2tldEl0ZW0sXG4gIElSZXF1ZXN0LFxuICBJdGVtQnVja2V0TWV0YWRhdGEsXG4gIExpZmVjeWNsZUNvbmZpZyxcbiAgTGlmZUN5Y2xlQ29uZmlnUGFyYW0sXG4gIExpc3RPYmplY3RRdWVyeU9wdHMsXG4gIExpc3RPYmplY3RRdWVyeVJlcyxcbiAgTGlzdE9iamVjdFYyUmVzLFxuICBOb3RpZmljYXRpb25Db25maWdSZXN1bHQsXG4gIE9iamVjdEluZm8sXG4gIE9iamVjdExvY2tDb25maWdQYXJhbSxcbiAgT2JqZWN0TG9ja0luZm8sXG4gIE9iamVjdE1ldGFEYXRhLFxuICBPYmplY3RSZXRlbnRpb25JbmZvLFxuICBQb3N0UG9saWN5UmVzdWx0LFxuICBQcmVTaWduUmVxdWVzdFBhcmFtcyxcbiAgUHV0T2JqZWN0TGVnYWxIb2xkT3B0aW9ucyxcbiAgUHV0VGFnZ2luZ1BhcmFtcyxcbiAgUmVtb3ZlT2JqZWN0c1BhcmFtLFxuICBSZW1vdmVPYmplY3RzUmVxdWVzdEVudHJ5LFxuICBSZW1vdmVPYmplY3RzUmVzcG9uc2UsXG4gIFJlbW92ZVRhZ2dpbmdQYXJhbXMsXG4gIFJlcGxpY2F0aW9uQ29uZmlnLFxuICBSZXBsaWNhdGlvbkNvbmZpZ09wdHMsXG4gIFJlcXVlc3RIZWFkZXJzLFxuICBSZXNwb25zZUhlYWRlcixcbiAgUmVzdWx0Q2FsbGJhY2ssXG4gIFJldGVudGlvbixcbiAgU2VsZWN0T3B0aW9ucyxcbiAgU3RhdE9iamVjdE9wdHMsXG4gIFRhZyxcbiAgVGFnZ2luZ09wdHMsXG4gIFRhZ3MsXG4gIFRyYW5zcG9ydCxcbiAgVXBsb2FkZWRPYmplY3RJbmZvLFxuICBVcGxvYWRQYXJ0Q29uZmlnLFxufSBmcm9tICcuL3R5cGUudHMnXG5pbXBvcnQgdHlwZSB7IExpc3RNdWx0aXBhcnRSZXN1bHQsIFVwbG9hZGVkUGFydCB9IGZyb20gJy4veG1sLXBhcnNlci50cydcbmltcG9ydCB7XG4gIHBhcnNlQnVja2V0Tm90aWZpY2F0aW9uLFxuICBwYXJzZUNvbXBsZXRlTXVsdGlwYXJ0LFxuICBwYXJzZUluaXRpYXRlTXVsdGlwYXJ0LFxuICBwYXJzZUxpc3RPYmplY3RzLFxuICBwYXJzZUxpc3RPYmplY3RzVjIsXG4gIHBhcnNlT2JqZWN0TGVnYWxIb2xkQ29uZmlnLFxuICBwYXJzZVNlbGVjdE9iamVjdENvbnRlbnRSZXNwb25zZSxcbiAgdXBsb2FkUGFydFBhcnNlcixcbn0gZnJvbSAnLi94bWwtcGFyc2VyLnRzJ1xuaW1wb3J0ICogYXMgeG1sUGFyc2VycyBmcm9tICcuL3htbC1wYXJzZXIudHMnXG5cbmNvbnN0IHhtbCA9IG5ldyB4bWwyanMuQnVpbGRlcih7IHJlbmRlck9wdHM6IHsgcHJldHR5OiBmYWxzZSB9LCBoZWFkbGVzczogdHJ1ZSB9KVxuXG4vLyB3aWxsIGJlIHJlcGxhY2VkIGJ5IGJ1bmRsZXIuXG5jb25zdCBQYWNrYWdlID0geyB2ZXJzaW9uOiBwcm9jZXNzLmVudi5NSU5JT19KU19QQUNLQUdFX1ZFUlNJT04gfHwgJ2RldmVsb3BtZW50JyB9XG5cbmNvbnN0IHJlcXVlc3RPcHRpb25Qcm9wZXJ0aWVzID0gW1xuICAnYWdlbnQnLFxuICAnY2EnLFxuICAnY2VydCcsXG4gICdjaXBoZXJzJyxcbiAgJ2NsaWVudENlcnRFbmdpbmUnLFxuICAnY3JsJyxcbiAgJ2RocGFyYW0nLFxuICAnZWNkaEN1cnZlJyxcbiAgJ2ZhbWlseScsXG4gICdob25vckNpcGhlck9yZGVyJyxcbiAgJ2tleScsXG4gICdwYXNzcGhyYXNlJyxcbiAgJ3BmeCcsXG4gICdyZWplY3RVbmF1dGhvcml6ZWQnLFxuICAnc2VjdXJlT3B0aW9ucycsXG4gICdzZWN1cmVQcm90b2NvbCcsXG4gICdzZXJ2ZXJuYW1lJyxcbiAgJ3Nlc3Npb25JZENvbnRleHQnLFxuXSBhcyBjb25zdFxuXG5leHBvcnQgaW50ZXJmYWNlIFJldHJ5T3B0aW9ucyB7XG4gIC8qKlxuICAgKiBJZiB0aGlzIHNldCB0byB0cnVlLCBpdCB3aWxsIHRha2UgcHJlY2VkZW5jZSBvdmVyIGFsbCBvdGhlciByZXRyeSBvcHRpb25zLlxuICAgKiBAZGVmYXVsdCBmYWxzZVxuICAgKi9cbiAgZGlzYWJsZVJldHJ5PzogYm9vbGVhblxuICAvKipcbiAgICogVGhlIG1heGltdW0gYW1vdW50IG9mIHJldHJpZXMgZm9yIGEgcmVxdWVzdC5cbiAgICogQGRlZmF1bHQgMVxuICAgKi9cbiAgbWF4aW11bVJldHJ5Q291bnQ/OiBudW1iZXJcbiAgLyoqXG4gICAqIFRoZSBtaW5pbXVtIGR1cmF0aW9uIChpbiBtaWxsaXNlY29uZHMpIGZvciB0aGUgZXhwb25lbnRpYWwgYmFja29mZiBhbGdvcml0aG0uXG4gICAqIEBkZWZhdWx0IDEwMFxuICAgKi9cbiAgYmFzZURlbGF5TXM/OiBudW1iZXJcbiAgLyoqXG4gICAqIFRoZSBtYXhpbXVtIGR1cmF0aW9uIChpbiBtaWxsaXNlY29uZHMpIGZvciB0aGUgZXhwb25lbnRpYWwgYmFja29mZiBhbGdvcml0aG0uXG4gICAqIEBkZWZhdWx0IDYwMDAwXG4gICAqL1xuICBtYXhpbXVtRGVsYXlNcz86IG51bWJlclxufVxuXG5leHBvcnQgaW50ZXJmYWNlIENsaWVudE9wdGlvbnMge1xuICBlbmRQb2ludDogc3RyaW5nXG4gIGFjY2Vzc0tleT86IHN0cmluZ1xuICBzZWNyZXRLZXk/OiBzdHJpbmdcbiAgdXNlU1NMPzogYm9vbGVhblxuICBwb3J0PzogbnVtYmVyXG4gIHJlZ2lvbj86IFJlZ2lvblxuICB0cmFuc3BvcnQ/OiBUcmFuc3BvcnRcbiAgc2Vzc2lvblRva2VuPzogc3RyaW5nXG4gIHBhcnRTaXplPzogbnVtYmVyXG4gIHBhdGhTdHlsZT86IGJvb2xlYW5cbiAgY3JlZGVudGlhbHNQcm92aWRlcj86IENyZWRlbnRpYWxQcm92aWRlclxuICBzM0FjY2VsZXJhdGVFbmRwb2ludD86IHN0cmluZ1xuICB0cmFuc3BvcnRBZ2VudD86IGh0dHAuQWdlbnRcbiAgcmV0cnlPcHRpb25zPzogUmV0cnlPcHRpb25zXG59XG5cbmV4cG9ydCB0eXBlIFJlcXVlc3RPcHRpb24gPSBQYXJ0aWFsPElSZXF1ZXN0PiAmIHtcbiAgbWV0aG9kOiBzdHJpbmdcbiAgYnVja2V0TmFtZT86IHN0cmluZ1xuICBvYmplY3ROYW1lPzogc3RyaW5nXG4gIHF1ZXJ5Pzogc3RyaW5nXG4gIHBhdGhTdHlsZT86IGJvb2xlYW5cbn1cblxuZXhwb3J0IHR5cGUgTm9SZXN1bHRDYWxsYmFjayA9IChlcnJvcjogdW5rbm93bikgPT4gdm9pZFxuXG5leHBvcnQgaW50ZXJmYWNlIE1ha2VCdWNrZXRPcHQge1xuICBPYmplY3RMb2NraW5nPzogYm9vbGVhblxufVxuXG5leHBvcnQgaW50ZXJmYWNlIFJlbW92ZU9wdGlvbnMge1xuICB2ZXJzaW9uSWQ/OiBzdHJpbmdcbiAgZ292ZXJuYW5jZUJ5cGFzcz86IGJvb2xlYW5cbiAgZm9yY2VEZWxldGU/OiBib29sZWFuXG59XG5cbnR5cGUgUGFydCA9IHtcbiAgcGFydDogbnVtYmVyXG4gIGV0YWc6IHN0cmluZ1xufVxuXG5leHBvcnQgY2xhc3MgVHlwZWRDbGllbnQge1xuICBwcm90ZWN0ZWQgdHJhbnNwb3J0OiBUcmFuc3BvcnRcbiAgcHJvdGVjdGVkIGhvc3Q6IHN0cmluZ1xuICBwcm90ZWN0ZWQgcG9ydDogbnVtYmVyXG4gIHByb3RlY3RlZCBwcm90b2NvbDogc3RyaW5nXG4gIHByb3RlY3RlZCBhY2Nlc3NLZXk6IHN0cmluZ1xuICBwcm90ZWN0ZWQgc2VjcmV0S2V5OiBzdHJpbmdcbiAgcHJvdGVjdGVkIHNlc3Npb25Ub2tlbj86IHN0cmluZ1xuICBwcm90ZWN0ZWQgdXNlckFnZW50OiBzdHJpbmdcbiAgcHJvdGVjdGVkIGFub255bW91czogYm9vbGVhblxuICBwcm90ZWN0ZWQgcGF0aFN0eWxlOiBib29sZWFuXG4gIHByb3RlY3RlZCByZWdpb25NYXA6IFJlY29yZDxzdHJpbmcsIHN0cmluZz5cbiAgcHVibGljIHJlZ2lvbj86IHN0cmluZ1xuICBwcm90ZWN0ZWQgY3JlZGVudGlhbHNQcm92aWRlcj86IENyZWRlbnRpYWxQcm92aWRlclxuICBwYXJ0U2l6ZTogbnVtYmVyID0gNjQgKiAxMDI0ICogMTAyNFxuICBwcm90ZWN0ZWQgb3ZlclJpZGVQYXJ0U2l6ZT86IGJvb2xlYW5cbiAgcHJvdGVjdGVkIHJldHJ5T3B0aW9uczogUmV0cnlPcHRpb25zXG5cbiAgcHJvdGVjdGVkIG1heGltdW1QYXJ0U2l6ZSA9IDUgKiAxMDI0ICogMTAyNCAqIDEwMjRcbiAgcHJvdGVjdGVkIG1heE9iamVjdFNpemUgPSA1ICogMTAyNCAqIDEwMjQgKiAxMDI0ICogMTAyNFxuICBwdWJsaWMgZW5hYmxlU0hBMjU2OiBib29sZWFuXG4gIHByb3RlY3RlZCBzM0FjY2VsZXJhdGVFbmRwb2ludD86IHN0cmluZ1xuICBwcm90ZWN0ZWQgcmVxT3B0aW9uczogUmVjb3JkPHN0cmluZywgdW5rbm93bj5cblxuICBwcm90ZWN0ZWQgdHJhbnNwb3J0QWdlbnQ6IGh0dHAuQWdlbnRcbiAgcHJpdmF0ZSByZWFkb25seSBjbGllbnRFeHRlbnNpb25zOiBFeHRlbnNpb25zXG5cbiAgY29uc3RydWN0b3IocGFyYW1zOiBDbGllbnRPcHRpb25zKSB7XG4gICAgLy8gQHRzLWV4cGVjdC1lcnJvciBkZXByZWNhdGVkIHByb3BlcnR5XG4gICAgaWYgKHBhcmFtcy5zZWN1cmUgIT09IHVuZGVmaW5lZCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdcInNlY3VyZVwiIG9wdGlvbiBkZXByZWNhdGVkLCBcInVzZVNTTFwiIHNob3VsZCBiZSB1c2VkIGluc3RlYWQnKVxuICAgIH1cbiAgICAvLyBEZWZhdWx0IHZhbHVlcyBpZiBub3Qgc3BlY2lmaWVkLlxuICAgIGlmIChwYXJhbXMudXNlU1NMID09PSB1bmRlZmluZWQpIHtcbiAgICAgIHBhcmFtcy51c2VTU0wgPSB0cnVlXG4gICAgfVxuICAgIGlmICghcGFyYW1zLnBvcnQpIHtcbiAgICAgIHBhcmFtcy5wb3J0ID0gMFxuICAgIH1cbiAgICAvLyBWYWxpZGF0ZSBpbnB1dCBwYXJhbXMuXG4gICAgaWYgKCFpc1ZhbGlkRW5kcG9pbnQocGFyYW1zLmVuZFBvaW50KSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkRW5kcG9pbnRFcnJvcihgSW52YWxpZCBlbmRQb2ludCA6ICR7cGFyYW1zLmVuZFBvaW50fWApXG4gICAgfVxuICAgIGlmICghaXNWYWxpZFBvcnQocGFyYW1zLnBvcnQpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKGBJbnZhbGlkIHBvcnQgOiAke3BhcmFtcy5wb3J0fWApXG4gICAgfVxuICAgIGlmICghaXNCb29sZWFuKHBhcmFtcy51c2VTU0wpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKFxuICAgICAgICBgSW52YWxpZCB1c2VTU0wgZmxhZyB0eXBlIDogJHtwYXJhbXMudXNlU1NMfSwgZXhwZWN0ZWQgdG8gYmUgb2YgdHlwZSBcImJvb2xlYW5cImAsXG4gICAgICApXG4gICAgfVxuXG4gICAgLy8gVmFsaWRhdGUgcmVnaW9uIG9ubHkgaWYgaXRzIHNldC5cbiAgICBpZiAocGFyYW1zLnJlZ2lvbikge1xuICAgICAgaWYgKCFpc1N0cmluZyhwYXJhbXMucmVnaW9uKSkge1xuICAgICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKGBJbnZhbGlkIHJlZ2lvbiA6ICR7cGFyYW1zLnJlZ2lvbn1gKVxuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IGhvc3QgPSBwYXJhbXMuZW5kUG9pbnQudG9Mb3dlckNhc2UoKVxuICAgIGxldCBwb3J0ID0gcGFyYW1zLnBvcnRcbiAgICBsZXQgcHJvdG9jb2w6IHN0cmluZ1xuICAgIGxldCB0cmFuc3BvcnRcbiAgICBsZXQgdHJhbnNwb3J0QWdlbnQ6IGh0dHAuQWdlbnRcbiAgICAvLyBWYWxpZGF0ZSBpZiBjb25maWd1cmF0aW9uIGlzIG5vdCB1c2luZyBTU0xcbiAgICAvLyBmb3IgY29uc3RydWN0aW5nIHJlbGV2YW50IGVuZHBvaW50cy5cbiAgICBpZiAocGFyYW1zLnVzZVNTTCkge1xuICAgICAgLy8gRGVmYXVsdHMgdG8gc2VjdXJlLlxuICAgICAgdHJhbnNwb3J0ID0gaHR0cHNcbiAgICAgIHByb3RvY29sID0gJ2h0dHBzOidcbiAgICAgIHBvcnQgPSBwb3J0IHx8IDQ0M1xuICAgICAgdHJhbnNwb3J0QWdlbnQgPSBodHRwcy5nbG9iYWxBZ2VudFxuICAgIH0gZWxzZSB7XG4gICAgICB0cmFuc3BvcnQgPSBodHRwXG4gICAgICBwcm90b2NvbCA9ICdodHRwOidcbiAgICAgIHBvcnQgPSBwb3J0IHx8IDgwXG4gICAgICB0cmFuc3BvcnRBZ2VudCA9IGh0dHAuZ2xvYmFsQWdlbnRcbiAgICB9XG5cbiAgICAvLyBpZiBjdXN0b20gdHJhbnNwb3J0IGlzIHNldCwgdXNlIGl0LlxuICAgIGlmIChwYXJhbXMudHJhbnNwb3J0KSB7XG4gICAgICBpZiAoIWlzT2JqZWN0KHBhcmFtcy50cmFuc3BvcnQpKSB7XG4gICAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoXG4gICAgICAgICAgYEludmFsaWQgdHJhbnNwb3J0IHR5cGUgOiAke3BhcmFtcy50cmFuc3BvcnR9LCBleHBlY3RlZCB0byBiZSB0eXBlIFwib2JqZWN0XCJgLFxuICAgICAgICApXG4gICAgICB9XG4gICAgICB0cmFuc3BvcnQgPSBwYXJhbXMudHJhbnNwb3J0XG4gICAgfVxuXG4gICAgLy8gaWYgY3VzdG9tIHRyYW5zcG9ydCBhZ2VudCBpcyBzZXQsIHVzZSBpdC5cbiAgICBpZiAocGFyYW1zLnRyYW5zcG9ydEFnZW50KSB7XG4gICAgICBpZiAoIWlzT2JqZWN0KHBhcmFtcy50cmFuc3BvcnRBZ2VudCkpIHtcbiAgICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcihcbiAgICAgICAgICBgSW52YWxpZCB0cmFuc3BvcnRBZ2VudCB0eXBlOiAke3BhcmFtcy50cmFuc3BvcnRBZ2VudH0sIGV4cGVjdGVkIHRvIGJlIHR5cGUgXCJvYmplY3RcImAsXG4gICAgICAgIClcbiAgICAgIH1cblxuICAgICAgdHJhbnNwb3J0QWdlbnQgPSBwYXJhbXMudHJhbnNwb3J0QWdlbnRcbiAgICB9XG5cbiAgICAvLyBVc2VyIEFnZW50IHNob3VsZCBhbHdheXMgZm9sbG93aW5nIHRoZSBiZWxvdyBzdHlsZS5cbiAgICAvLyBQbGVhc2Ugb3BlbiBhbiBpc3N1ZSB0byBkaXNjdXNzIGFueSBuZXcgY2hhbmdlcyBoZXJlLlxuICAgIC8vXG4gICAgLy8gICAgICAgTWluSU8gKE9TOyBBUkNIKSBMSUIvVkVSIEFQUC9WRVJcbiAgICAvL1xuICAgIGNvbnN0IGxpYnJhcnlDb21tZW50cyA9IGAoJHtwcm9jZXNzLnBsYXRmb3JtfTsgJHtwcm9jZXNzLmFyY2h9KWBcbiAgICBjb25zdCBsaWJyYXJ5QWdlbnQgPSBgTWluSU8gJHtsaWJyYXJ5Q29tbWVudHN9IG1pbmlvLWpzLyR7UGFja2FnZS52ZXJzaW9ufWBcbiAgICAvLyBVc2VyIGFnZW50IGJsb2NrIGVuZHMuXG5cbiAgICB0aGlzLnRyYW5zcG9ydCA9IHRyYW5zcG9ydFxuICAgIHRoaXMudHJhbnNwb3J0QWdlbnQgPSB0cmFuc3BvcnRBZ2VudFxuICAgIHRoaXMuaG9zdCA9IGhvc3RcbiAgICB0aGlzLnBvcnQgPSBwb3J0XG4gICAgdGhpcy5wcm90b2NvbCA9IHByb3RvY29sXG4gICAgdGhpcy51c2VyQWdlbnQgPSBgJHtsaWJyYXJ5QWdlbnR9YFxuXG4gICAgLy8gRGVmYXVsdCBwYXRoIHN0eWxlIGlzIHRydWVcbiAgICBpZiAocGFyYW1zLnBhdGhTdHlsZSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICB0aGlzLnBhdGhTdHlsZSA9IHRydWVcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5wYXRoU3R5bGUgPSBwYXJhbXMucGF0aFN0eWxlXG4gICAgfVxuXG4gICAgdGhpcy5hY2Nlc3NLZXkgPSBwYXJhbXMuYWNjZXNzS2V5ID8/ICcnXG4gICAgdGhpcy5zZWNyZXRLZXkgPSBwYXJhbXMuc2VjcmV0S2V5ID8/ICcnXG4gICAgdGhpcy5zZXNzaW9uVG9rZW4gPSBwYXJhbXMuc2Vzc2lvblRva2VuXG4gICAgdGhpcy5hbm9ueW1vdXMgPSAhdGhpcy5hY2Nlc3NLZXkgfHwgIXRoaXMuc2VjcmV0S2V5XG5cbiAgICBpZiAocGFyYW1zLmNyZWRlbnRpYWxzUHJvdmlkZXIpIHtcbiAgICAgIHRoaXMuYW5vbnltb3VzID0gZmFsc2VcbiAgICAgIHRoaXMuY3JlZGVudGlhbHNQcm92aWRlciA9IHBhcmFtcy5jcmVkZW50aWFsc1Byb3ZpZGVyXG4gICAgfVxuXG4gICAgdGhpcy5yZWdpb25NYXAgPSB7fVxuICAgIGlmIChwYXJhbXMucmVnaW9uKSB7XG4gICAgICB0aGlzLnJlZ2lvbiA9IHBhcmFtcy5yZWdpb25cbiAgICB9XG5cbiAgICBpZiAocGFyYW1zLnBhcnRTaXplKSB7XG4gICAgICB0aGlzLnBhcnRTaXplID0gcGFyYW1zLnBhcnRTaXplXG4gICAgICB0aGlzLm92ZXJSaWRlUGFydFNpemUgPSB0cnVlXG4gICAgfVxuICAgIGlmICh0aGlzLnBhcnRTaXplIDwgNSAqIDEwMjQgKiAxMDI0KSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKGBQYXJ0IHNpemUgc2hvdWxkIGJlIGdyZWF0ZXIgdGhhbiA1TUJgKVxuICAgIH1cbiAgICBpZiAodGhpcy5wYXJ0U2l6ZSA+IDUgKiAxMDI0ICogMTAyNCAqIDEwMjQpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoYFBhcnQgc2l6ZSBzaG91bGQgYmUgbGVzcyB0aGFuIDVHQmApXG4gICAgfVxuXG4gICAgLy8gU0hBMjU2IGlzIGVuYWJsZWQgb25seSBmb3IgYXV0aGVudGljYXRlZCBodHRwIHJlcXVlc3RzLiBJZiB0aGUgcmVxdWVzdCBpcyBhdXRoZW50aWNhdGVkXG4gICAgLy8gYW5kIHRoZSBjb25uZWN0aW9uIGlzIGh0dHBzIHdlIHVzZSB4LWFtei1jb250ZW50LXNoYTI1Nj1VTlNJR05FRC1QQVlMT0FEXG4gICAgLy8gaGVhZGVyIGZvciBzaWduYXR1cmUgY2FsY3VsYXRpb24uXG4gICAgdGhpcy5lbmFibGVTSEEyNTYgPSAhdGhpcy5hbm9ueW1vdXMgJiYgIXBhcmFtcy51c2VTU0xcblxuICAgIHRoaXMuczNBY2NlbGVyYXRlRW5kcG9pbnQgPSBwYXJhbXMuczNBY2NlbGVyYXRlRW5kcG9pbnQgfHwgdW5kZWZpbmVkXG4gICAgdGhpcy5yZXFPcHRpb25zID0ge31cbiAgICB0aGlzLmNsaWVudEV4dGVuc2lvbnMgPSBuZXcgRXh0ZW5zaW9ucyh0aGlzKVxuXG4gICAgaWYgKHBhcmFtcy5yZXRyeU9wdGlvbnMpIHtcbiAgICAgIGlmICghaXNPYmplY3QocGFyYW1zLnJldHJ5T3B0aW9ucykpIHtcbiAgICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcihcbiAgICAgICAgICBgSW52YWxpZCByZXRyeU9wdGlvbnMgdHlwZTogJHtwYXJhbXMucmV0cnlPcHRpb25zfSwgZXhwZWN0ZWQgdG8gYmUgdHlwZSBcIm9iamVjdFwiYCxcbiAgICAgICAgKVxuICAgICAgfVxuXG4gICAgICB0aGlzLnJldHJ5T3B0aW9ucyA9IHBhcmFtcy5yZXRyeU9wdGlvbnNcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5yZXRyeU9wdGlvbnMgPSB7XG4gICAgICAgIGRpc2FibGVSZXRyeTogZmFsc2UsXG4gICAgICB9XG4gICAgfVxuICB9XG4gIC8qKlxuICAgKiBNaW5pbyBleHRlbnNpb25zIHRoYXQgYXJlbid0IG5lY2Vzc2FyeSBwcmVzZW50IGZvciBBbWF6b24gUzMgY29tcGF0aWJsZSBzdG9yYWdlIHNlcnZlcnNcbiAgICovXG4gIGdldCBleHRlbnNpb25zKCkge1xuICAgIHJldHVybiB0aGlzLmNsaWVudEV4dGVuc2lvbnNcbiAgfVxuXG4gIC8qKlxuICAgKiBAcGFyYW0gZW5kUG9pbnQgLSB2YWxpZCBTMyBhY2NlbGVyYXRpb24gZW5kIHBvaW50XG4gICAqL1xuICBzZXRTM1RyYW5zZmVyQWNjZWxlcmF0ZShlbmRQb2ludDogc3RyaW5nKSB7XG4gICAgdGhpcy5zM0FjY2VsZXJhdGVFbmRwb2ludCA9IGVuZFBvaW50XG4gIH1cblxuICAvKipcbiAgICogU2V0cyB0aGUgc3VwcG9ydGVkIHJlcXVlc3Qgb3B0aW9ucy5cbiAgICovXG4gIHB1YmxpYyBzZXRSZXF1ZXN0T3B0aW9ucyhvcHRpb25zOiBQaWNrPGh0dHBzLlJlcXVlc3RPcHRpb25zLCAodHlwZW9mIHJlcXVlc3RPcHRpb25Qcm9wZXJ0aWVzKVtudW1iZXJdPikge1xuICAgIGlmICghaXNPYmplY3Qob3B0aW9ucykpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3JlcXVlc3Qgb3B0aW9ucyBzaG91bGQgYmUgb2YgdHlwZSBcIm9iamVjdFwiJylcbiAgICB9XG4gICAgdGhpcy5yZXFPcHRpb25zID0gXy5waWNrKG9wdGlvbnMsIHJlcXVlc3RPcHRpb25Qcm9wZXJ0aWVzKVxuICB9XG5cbiAgLyoqXG4gICAqICBUaGlzIGlzIHMzIFNwZWNpZmljIGFuZCBkb2VzIG5vdCBob2xkIHZhbGlkaXR5IGluIGFueSBvdGhlciBPYmplY3Qgc3RvcmFnZS5cbiAgICovXG4gIHByaXZhdGUgZ2V0QWNjZWxlcmF0ZUVuZFBvaW50SWZTZXQoYnVja2V0TmFtZT86IHN0cmluZywgb2JqZWN0TmFtZT86IHN0cmluZykge1xuICAgIGlmICghaXNFbXB0eSh0aGlzLnMzQWNjZWxlcmF0ZUVuZHBvaW50KSAmJiAhaXNFbXB0eShidWNrZXROYW1lKSAmJiAhaXNFbXB0eShvYmplY3ROYW1lKSkge1xuICAgICAgLy8gaHR0cDovL2RvY3MuYXdzLmFtYXpvbi5jb20vQW1hem9uUzMvbGF0ZXN0L2Rldi90cmFuc2Zlci1hY2NlbGVyYXRpb24uaHRtbFxuICAgICAgLy8gRGlzYWJsZSB0cmFuc2ZlciBhY2NlbGVyYXRpb24gZm9yIG5vbi1jb21wbGlhbnQgYnVja2V0IG5hbWVzLlxuICAgICAgaWYgKGJ1Y2tldE5hbWUuaW5jbHVkZXMoJy4nKSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFRyYW5zZmVyIEFjY2VsZXJhdGlvbiBpcyBub3Qgc3VwcG9ydGVkIGZvciBub24gY29tcGxpYW50IGJ1Y2tldDoke2J1Y2tldE5hbWV9YClcbiAgICAgIH1cbiAgICAgIC8vIElmIHRyYW5zZmVyIGFjY2VsZXJhdGlvbiBpcyByZXF1ZXN0ZWQgc2V0IG5ldyBob3N0LlxuICAgICAgLy8gRm9yIG1vcmUgZGV0YWlscyBhYm91dCBlbmFibGluZyB0cmFuc2ZlciBhY2NlbGVyYXRpb24gcmVhZCBoZXJlLlxuICAgICAgLy8gaHR0cDovL2RvY3MuYXdzLmFtYXpvbi5jb20vQW1hem9uUzMvbGF0ZXN0L2Rldi90cmFuc2Zlci1hY2NlbGVyYXRpb24uaHRtbFxuICAgICAgcmV0dXJuIHRoaXMuczNBY2NlbGVyYXRlRW5kcG9pbnRcbiAgICB9XG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cblxuICAvKipcbiAgICogICBTZXQgYXBwbGljYXRpb24gc3BlY2lmaWMgaW5mb3JtYXRpb24uXG4gICAqICAgR2VuZXJhdGVzIFVzZXItQWdlbnQgaW4gdGhlIGZvbGxvd2luZyBzdHlsZS5cbiAgICogICBNaW5JTyAoT1M7IEFSQ0gpIExJQi9WRVIgQVBQL1ZFUlxuICAgKi9cbiAgc2V0QXBwSW5mbyhhcHBOYW1lOiBzdHJpbmcsIGFwcFZlcnNpb246IHN0cmluZykge1xuICAgIGlmICghaXNTdHJpbmcoYXBwTmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoYEludmFsaWQgYXBwTmFtZTogJHthcHBOYW1lfWApXG4gICAgfVxuICAgIGlmIChhcHBOYW1lLnRyaW0oKSA9PT0gJycpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ0lucHV0IGFwcE5hbWUgY2Fubm90IGJlIGVtcHR5LicpXG4gICAgfVxuICAgIGlmICghaXNTdHJpbmcoYXBwVmVyc2lvbikpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoYEludmFsaWQgYXBwVmVyc2lvbjogJHthcHBWZXJzaW9ufWApXG4gICAgfVxuICAgIGlmIChhcHBWZXJzaW9uLnRyaW0oKSA9PT0gJycpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ0lucHV0IGFwcFZlcnNpb24gY2Fubm90IGJlIGVtcHR5LicpXG4gICAgfVxuICAgIHRoaXMudXNlckFnZW50ID0gYCR7dGhpcy51c2VyQWdlbnR9ICR7YXBwTmFtZX0vJHthcHBWZXJzaW9ufWBcbiAgfVxuXG4gIC8qKlxuICAgKiByZXR1cm5zIG9wdGlvbnMgb2JqZWN0IHRoYXQgY2FuIGJlIHVzZWQgd2l0aCBodHRwLnJlcXVlc3QoKVxuICAgKiBUYWtlcyBjYXJlIG9mIGNvbnN0cnVjdGluZyB2aXJ0dWFsLWhvc3Qtc3R5bGUgb3IgcGF0aC1zdHlsZSBob3N0bmFtZVxuICAgKi9cbiAgcHJvdGVjdGVkIGdldFJlcXVlc3RPcHRpb25zKFxuICAgIG9wdHM6IFJlcXVlc3RPcHRpb24gJiB7XG4gICAgICByZWdpb246IHN0cmluZ1xuICAgIH0sXG4gICk6IElSZXF1ZXN0ICYge1xuICAgIGhvc3Q6IHN0cmluZ1xuICAgIGhlYWRlcnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz5cbiAgfSB7XG4gICAgY29uc3QgbWV0aG9kID0gb3B0cy5tZXRob2RcbiAgICBjb25zdCByZWdpb24gPSBvcHRzLnJlZ2lvblxuICAgIGNvbnN0IGJ1Y2tldE5hbWUgPSBvcHRzLmJ1Y2tldE5hbWVcbiAgICBsZXQgb2JqZWN0TmFtZSA9IG9wdHMub2JqZWN0TmFtZVxuICAgIGNvbnN0IGhlYWRlcnMgPSBvcHRzLmhlYWRlcnNcbiAgICBjb25zdCBxdWVyeSA9IG9wdHMucXVlcnlcblxuICAgIGxldCByZXFPcHRpb25zID0ge1xuICAgICAgbWV0aG9kLFxuICAgICAgaGVhZGVyczoge30gYXMgUmVxdWVzdEhlYWRlcnMsXG4gICAgICBwcm90b2NvbDogdGhpcy5wcm90b2NvbCxcbiAgICAgIC8vIElmIGN1c3RvbSB0cmFuc3BvcnRBZ2VudCB3YXMgc3VwcGxpZWQgZWFybGllciwgd2UnbGwgaW5qZWN0IGl0IGhlcmVcbiAgICAgIGFnZW50OiB0aGlzLnRyYW5zcG9ydEFnZW50LFxuICAgIH1cblxuICAgIC8vIFZlcmlmeSBpZiB2aXJ0dWFsIGhvc3Qgc3VwcG9ydGVkLlxuICAgIGxldCB2aXJ0dWFsSG9zdFN0eWxlXG4gICAgaWYgKGJ1Y2tldE5hbWUpIHtcbiAgICAgIHZpcnR1YWxIb3N0U3R5bGUgPSBpc1ZpcnR1YWxIb3N0U3R5bGUodGhpcy5ob3N0LCB0aGlzLnByb3RvY29sLCBidWNrZXROYW1lLCB0aGlzLnBhdGhTdHlsZSlcbiAgICB9XG5cbiAgICBsZXQgcGF0aCA9ICcvJ1xuICAgIGxldCBob3N0ID0gdGhpcy5ob3N0XG5cbiAgICBsZXQgcG9ydDogdW5kZWZpbmVkIHwgbnVtYmVyXG4gICAgaWYgKHRoaXMucG9ydCkge1xuICAgICAgcG9ydCA9IHRoaXMucG9ydFxuICAgIH1cblxuICAgIGlmIChvYmplY3ROYW1lKSB7XG4gICAgICBvYmplY3ROYW1lID0gdXJpUmVzb3VyY2VFc2NhcGUob2JqZWN0TmFtZSlcbiAgICB9XG5cbiAgICAvLyBGb3IgQW1hem9uIFMzIGVuZHBvaW50LCBnZXQgZW5kcG9pbnQgYmFzZWQgb24gcmVnaW9uLlxuICAgIGlmIChpc0FtYXpvbkVuZHBvaW50KGhvc3QpKSB7XG4gICAgICBjb25zdCBhY2NlbGVyYXRlRW5kUG9pbnQgPSB0aGlzLmdldEFjY2VsZXJhdGVFbmRQb2ludElmU2V0KGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUpXG4gICAgICBpZiAoYWNjZWxlcmF0ZUVuZFBvaW50KSB7XG4gICAgICAgIGhvc3QgPSBgJHthY2NlbGVyYXRlRW5kUG9pbnR9YFxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgaG9zdCA9IGdldFMzRW5kcG9pbnQocmVnaW9uKVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmICh2aXJ0dWFsSG9zdFN0eWxlICYmICFvcHRzLnBhdGhTdHlsZSkge1xuICAgICAgLy8gRm9yIGFsbCBob3N0cyB3aGljaCBzdXBwb3J0IHZpcnR1YWwgaG9zdCBzdHlsZSwgYGJ1Y2tldE5hbWVgXG4gICAgICAvLyBpcyBwYXJ0IG9mIHRoZSBob3N0bmFtZSBpbiB0aGUgZm9sbG93aW5nIGZvcm1hdDpcbiAgICAgIC8vXG4gICAgICAvLyAgdmFyIGhvc3QgPSAnYnVja2V0TmFtZS5leGFtcGxlLmNvbSdcbiAgICAgIC8vXG4gICAgICBpZiAoYnVja2V0TmFtZSkge1xuICAgICAgICBob3N0ID0gYCR7YnVja2V0TmFtZX0uJHtob3N0fWBcbiAgICAgIH1cbiAgICAgIGlmIChvYmplY3ROYW1lKSB7XG4gICAgICAgIHBhdGggPSBgLyR7b2JqZWN0TmFtZX1gXG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIEZvciBhbGwgUzMgY29tcGF0aWJsZSBzdG9yYWdlIHNlcnZpY2VzIHdlIHdpbGwgZmFsbGJhY2sgdG9cbiAgICAgIC8vIHBhdGggc3R5bGUgcmVxdWVzdHMsIHdoZXJlIGBidWNrZXROYW1lYCBpcyBwYXJ0IG9mIHRoZSBVUklcbiAgICAgIC8vIHBhdGguXG4gICAgICBpZiAoYnVja2V0TmFtZSkge1xuICAgICAgICBwYXRoID0gYC8ke2J1Y2tldE5hbWV9YFxuICAgICAgfVxuICAgICAgaWYgKG9iamVjdE5hbWUpIHtcbiAgICAgICAgcGF0aCA9IGAvJHtidWNrZXROYW1lfS8ke29iamVjdE5hbWV9YFxuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChxdWVyeSkge1xuICAgICAgcGF0aCArPSBgPyR7cXVlcnl9YFxuICAgIH1cbiAgICByZXFPcHRpb25zLmhlYWRlcnMuaG9zdCA9IGhvc3RcbiAgICBpZiAoKHJlcU9wdGlvbnMucHJvdG9jb2wgPT09ICdodHRwOicgJiYgcG9ydCAhPT0gODApIHx8IChyZXFPcHRpb25zLnByb3RvY29sID09PSAnaHR0cHM6JyAmJiBwb3J0ICE9PSA0NDMpKSB7XG4gICAgICByZXFPcHRpb25zLmhlYWRlcnMuaG9zdCA9IGpvaW5Ib3N0UG9ydChob3N0LCBwb3J0KVxuICAgIH1cblxuICAgIHJlcU9wdGlvbnMuaGVhZGVyc1sndXNlci1hZ2VudCddID0gdGhpcy51c2VyQWdlbnRcbiAgICBpZiAoaGVhZGVycykge1xuICAgICAgLy8gaGF2ZSBhbGwgaGVhZGVyIGtleXMgaW4gbG93ZXIgY2FzZSAtIHRvIG1ha2Ugc2lnbmluZyBlYXN5XG4gICAgICBmb3IgKGNvbnN0IFtrLCB2XSBvZiBPYmplY3QuZW50cmllcyhoZWFkZXJzKSkge1xuICAgICAgICByZXFPcHRpb25zLmhlYWRlcnNbay50b0xvd2VyQ2FzZSgpXSA9IHZcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBVc2UgYW55IHJlcXVlc3Qgb3B0aW9uIHNwZWNpZmllZCBpbiBtaW5pb0NsaWVudC5zZXRSZXF1ZXN0T3B0aW9ucygpXG4gICAgcmVxT3B0aW9ucyA9IE9iamVjdC5hc3NpZ24oe30sIHRoaXMucmVxT3B0aW9ucywgcmVxT3B0aW9ucylcblxuICAgIHJldHVybiB7XG4gICAgICAuLi5yZXFPcHRpb25zLFxuICAgICAgaGVhZGVyczogXy5tYXBWYWx1ZXMoXy5waWNrQnkocmVxT3B0aW9ucy5oZWFkZXJzLCBpc0RlZmluZWQpLCAodikgPT4gdi50b1N0cmluZygpKSxcbiAgICAgIGhvc3QsXG4gICAgICBwb3J0LFxuICAgICAgcGF0aCxcbiAgICB9IHNhdGlzZmllcyBodHRwcy5SZXF1ZXN0T3B0aW9uc1xuICB9XG5cbiAgcHVibGljIGFzeW5jIHNldENyZWRlbnRpYWxzUHJvdmlkZXIoY3JlZGVudGlhbHNQcm92aWRlcjogQ3JlZGVudGlhbFByb3ZpZGVyKSB7XG4gICAgaWYgKCEoY3JlZGVudGlhbHNQcm92aWRlciBpbnN0YW5jZW9mIENyZWRlbnRpYWxQcm92aWRlcikpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignVW5hYmxlIHRvIGdldCBjcmVkZW50aWFscy4gRXhwZWN0ZWQgaW5zdGFuY2Ugb2YgQ3JlZGVudGlhbFByb3ZpZGVyJylcbiAgICB9XG4gICAgdGhpcy5jcmVkZW50aWFsc1Byb3ZpZGVyID0gY3JlZGVudGlhbHNQcm92aWRlclxuICAgIGF3YWl0IHRoaXMuY2hlY2tBbmRSZWZyZXNoQ3JlZHMoKVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBjaGVja0FuZFJlZnJlc2hDcmVkcygpIHtcbiAgICBpZiAodGhpcy5jcmVkZW50aWFsc1Byb3ZpZGVyKSB7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCBjcmVkZW50aWFsc0NvbmYgPSBhd2FpdCB0aGlzLmNyZWRlbnRpYWxzUHJvdmlkZXIuZ2V0Q3JlZGVudGlhbHMoKVxuICAgICAgICB0aGlzLmFjY2Vzc0tleSA9IGNyZWRlbnRpYWxzQ29uZi5nZXRBY2Nlc3NLZXkoKVxuICAgICAgICB0aGlzLnNlY3JldEtleSA9IGNyZWRlbnRpYWxzQ29uZi5nZXRTZWNyZXRLZXkoKVxuICAgICAgICB0aGlzLnNlc3Npb25Ub2tlbiA9IGNyZWRlbnRpYWxzQ29uZi5nZXRTZXNzaW9uVG9rZW4oKVxuICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFVuYWJsZSB0byBnZXQgY3JlZGVudGlhbHM6ICR7ZX1gLCB7IGNhdXNlOiBlIH0pXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBsb2dTdHJlYW0/OiBzdHJlYW0uV3JpdGFibGVcblxuICAvKipcbiAgICogbG9nIHRoZSByZXF1ZXN0LCByZXNwb25zZSwgZXJyb3JcbiAgICovXG4gIHByaXZhdGUgbG9nSFRUUChyZXFPcHRpb25zOiBJUmVxdWVzdCwgcmVzcG9uc2U6IGh0dHAuSW5jb21pbmdNZXNzYWdlIHwgbnVsbCwgZXJyPzogdW5rbm93bikge1xuICAgIC8vIGlmIG5vIGxvZ1N0cmVhbSBhdmFpbGFibGUgcmV0dXJuLlxuICAgIGlmICghdGhpcy5sb2dTdHJlYW0pIHtcbiAgICAgIHJldHVyblxuICAgIH1cbiAgICBpZiAoIWlzT2JqZWN0KHJlcU9wdGlvbnMpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdyZXFPcHRpb25zIHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxuICAgIH1cbiAgICBpZiAocmVzcG9uc2UgJiYgIWlzUmVhZGFibGVTdHJlYW0ocmVzcG9uc2UpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdyZXNwb25zZSBzaG91bGQgYmUgb2YgdHlwZSBcIlN0cmVhbVwiJylcbiAgICB9XG4gICAgaWYgKGVyciAmJiAhKGVyciBpbnN0YW5jZW9mIEVycm9yKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignZXJyIHNob3VsZCBiZSBvZiB0eXBlIFwiRXJyb3JcIicpXG4gICAgfVxuICAgIGNvbnN0IGxvZ1N0cmVhbSA9IHRoaXMubG9nU3RyZWFtXG4gICAgY29uc3QgbG9nSGVhZGVycyA9IChoZWFkZXJzOiBSZXF1ZXN0SGVhZGVycykgPT4ge1xuICAgICAgT2JqZWN0LmVudHJpZXMoaGVhZGVycykuZm9yRWFjaCgoW2ssIHZdKSA9PiB7XG4gICAgICAgIGlmIChrID09ICdhdXRob3JpemF0aW9uJykge1xuICAgICAgICAgIGlmIChpc1N0cmluZyh2KSkge1xuICAgICAgICAgICAgY29uc3QgcmVkYWN0b3IgPSBuZXcgUmVnRXhwKCdTaWduYXR1cmU9KFswLTlhLWZdKyknKVxuICAgICAgICAgICAgdiA9IHYucmVwbGFjZShyZWRhY3RvciwgJ1NpZ25hdHVyZT0qKlJFREFDVEVEKionKVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBsb2dTdHJlYW0ud3JpdGUoYCR7a306ICR7dn1cXG5gKVxuICAgICAgfSlcbiAgICAgIGxvZ1N0cmVhbS53cml0ZSgnXFxuJylcbiAgICB9XG4gICAgbG9nU3RyZWFtLndyaXRlKGBSRVFVRVNUOiAke3JlcU9wdGlvbnMubWV0aG9kfSAke3JlcU9wdGlvbnMucGF0aH1cXG5gKVxuICAgIGxvZ0hlYWRlcnMocmVxT3B0aW9ucy5oZWFkZXJzKVxuICAgIGlmIChyZXNwb25zZSkge1xuICAgICAgdGhpcy5sb2dTdHJlYW0ud3JpdGUoYFJFU1BPTlNFOiAke3Jlc3BvbnNlLnN0YXR1c0NvZGV9XFxuYClcbiAgICAgIGxvZ0hlYWRlcnMocmVzcG9uc2UuaGVhZGVycyBhcyBSZXF1ZXN0SGVhZGVycylcbiAgICB9XG4gICAgaWYgKGVycikge1xuICAgICAgbG9nU3RyZWFtLndyaXRlKCdFUlJPUiBCT0RZOlxcbicpXG4gICAgICBjb25zdCBlcnJKU09OID0gSlNPTi5zdHJpbmdpZnkoZXJyLCBudWxsLCAnXFx0JylcbiAgICAgIGxvZ1N0cmVhbS53cml0ZShgJHtlcnJKU09OfVxcbmApXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEVuYWJsZSB0cmFjaW5nXG4gICAqL1xuICBwdWJsaWMgdHJhY2VPbihzdHJlYW0/OiBzdHJlYW0uV3JpdGFibGUpIHtcbiAgICBpZiAoIXN0cmVhbSkge1xuICAgICAgc3RyZWFtID0gcHJvY2Vzcy5zdGRvdXRcbiAgICB9XG4gICAgdGhpcy5sb2dTdHJlYW0gPSBzdHJlYW1cbiAgfVxuXG4gIC8qKlxuICAgKiBEaXNhYmxlIHRyYWNpbmdcbiAgICovXG4gIHB1YmxpYyB0cmFjZU9mZigpIHtcbiAgICB0aGlzLmxvZ1N0cmVhbSA9IHVuZGVmaW5lZFxuICB9XG5cbiAgLyoqXG4gICAqIG1ha2VSZXF1ZXN0IGlzIHRoZSBwcmltaXRpdmUgdXNlZCBieSB0aGUgYXBpcyBmb3IgbWFraW5nIFMzIHJlcXVlc3RzLlxuICAgKiBwYXlsb2FkIGNhbiBiZSBlbXB0eSBzdHJpbmcgaW4gY2FzZSBvZiBubyBwYXlsb2FkLlxuICAgKiBzdGF0dXNDb2RlIGlzIHRoZSBleHBlY3RlZCBzdGF0dXNDb2RlLiBJZiByZXNwb25zZS5zdGF0dXNDb2RlIGRvZXMgbm90IG1hdGNoXG4gICAqIHdlIHBhcnNlIHRoZSBYTUwgZXJyb3IgYW5kIGNhbGwgdGhlIGNhbGxiYWNrIHdpdGggdGhlIGVycm9yIG1lc3NhZ2UuXG4gICAqXG4gICAqIEEgdmFsaWQgcmVnaW9uIGlzIHBhc3NlZCBieSB0aGUgY2FsbHMgLSBsaXN0QnVja2V0cywgbWFrZUJ1Y2tldCBhbmQgZ2V0QnVja2V0UmVnaW9uLlxuICAgKlxuICAgKiBAaW50ZXJuYWxcbiAgICovXG4gIGFzeW5jIG1ha2VSZXF1ZXN0QXN5bmMoXG4gICAgb3B0aW9uczogUmVxdWVzdE9wdGlvbixcbiAgICBwYXlsb2FkOiBCaW5hcnkgPSAnJyxcbiAgICBleHBlY3RlZENvZGVzOiBudW1iZXJbXSA9IFsyMDBdLFxuICAgIHJlZ2lvbiA9ICcnLFxuICApOiBQcm9taXNlPGh0dHAuSW5jb21pbmdNZXNzYWdlPiB7XG4gICAgaWYgKCFpc09iamVjdChvcHRpb25zKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignb3B0aW9ucyBzaG91bGQgYmUgb2YgdHlwZSBcIm9iamVjdFwiJylcbiAgICB9XG4gICAgaWYgKCFpc1N0cmluZyhwYXlsb2FkKSAmJiAhaXNPYmplY3QocGF5bG9hZCkpIHtcbiAgICAgIC8vIEJ1ZmZlciBpcyBvZiB0eXBlICdvYmplY3QnXG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdwYXlsb2FkIHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCIgb3IgXCJCdWZmZXJcIicpXG4gICAgfVxuICAgIGV4cGVjdGVkQ29kZXMuZm9yRWFjaCgoc3RhdHVzQ29kZSkgPT4ge1xuICAgICAgaWYgKCFpc051bWJlcihzdGF0dXNDb2RlKSkge1xuICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdzdGF0dXNDb2RlIHNob3VsZCBiZSBvZiB0eXBlIFwibnVtYmVyXCInKVxuICAgICAgfVxuICAgIH0pXG4gICAgaWYgKCFpc1N0cmluZyhyZWdpb24pKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdyZWdpb24gc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXG4gICAgfVxuICAgIGlmICghb3B0aW9ucy5oZWFkZXJzKSB7XG4gICAgICBvcHRpb25zLmhlYWRlcnMgPSB7fVxuICAgIH1cbiAgICBpZiAob3B0aW9ucy5tZXRob2QgPT09ICdQT1NUJyB8fCBvcHRpb25zLm1ldGhvZCA9PT0gJ1BVVCcgfHwgb3B0aW9ucy5tZXRob2QgPT09ICdERUxFVEUnKSB7XG4gICAgICBvcHRpb25zLmhlYWRlcnNbJ2NvbnRlbnQtbGVuZ3RoJ10gPSBwYXlsb2FkLmxlbmd0aC50b1N0cmluZygpXG4gICAgfVxuICAgIGNvbnN0IHNoYTI1NnN1bSA9IHRoaXMuZW5hYmxlU0hBMjU2ID8gdG9TaGEyNTYocGF5bG9hZCkgOiAnJ1xuICAgIHJldHVybiB0aGlzLm1ha2VSZXF1ZXN0U3RyZWFtQXN5bmMob3B0aW9ucywgcGF5bG9hZCwgc2hhMjU2c3VtLCBleHBlY3RlZENvZGVzLCByZWdpb24pXG4gIH1cblxuICAvKipcbiAgICogbmV3IHJlcXVlc3Qgd2l0aCBwcm9taXNlXG4gICAqXG4gICAqIE5vIG5lZWQgdG8gZHJhaW4gcmVzcG9uc2UsIHJlc3BvbnNlIGJvZHkgaXMgbm90IHZhbGlkXG4gICAqL1xuICBhc3luYyBtYWtlUmVxdWVzdEFzeW5jT21pdChcbiAgICBvcHRpb25zOiBSZXF1ZXN0T3B0aW9uLFxuICAgIHBheWxvYWQ6IEJpbmFyeSA9ICcnLFxuICAgIHN0YXR1c0NvZGVzOiBudW1iZXJbXSA9IFsyMDBdLFxuICAgIHJlZ2lvbiA9ICcnLFxuICApOiBQcm9taXNlPE9taXQ8aHR0cC5JbmNvbWluZ01lc3NhZ2UsICdvbic+PiB7XG4gICAgY29uc3QgcmVzID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jKG9wdGlvbnMsIHBheWxvYWQsIHN0YXR1c0NvZGVzLCByZWdpb24pXG4gICAgYXdhaXQgZHJhaW5SZXNwb25zZShyZXMpXG4gICAgcmV0dXJuIHJlc1xuICB9XG5cbiAgLyoqXG4gICAqIG1ha2VSZXF1ZXN0U3RyZWFtIHdpbGwgYmUgdXNlZCBkaXJlY3RseSBpbnN0ZWFkIG9mIG1ha2VSZXF1ZXN0IGluIGNhc2UgdGhlIHBheWxvYWRcbiAgICogaXMgYXZhaWxhYmxlIGFzIGEgc3RyZWFtLiBmb3IgZXguIHB1dE9iamVjdFxuICAgKlxuICAgKiBAaW50ZXJuYWxcbiAgICovXG4gIGFzeW5jIG1ha2VSZXF1ZXN0U3RyZWFtQXN5bmMoXG4gICAgb3B0aW9uczogUmVxdWVzdE9wdGlvbixcbiAgICBib2R5OiBzdHJlYW0uUmVhZGFibGUgfCBCaW5hcnksXG4gICAgc2hhMjU2c3VtOiBzdHJpbmcsXG4gICAgc3RhdHVzQ29kZXM6IG51bWJlcltdLFxuICAgIHJlZ2lvbjogc3RyaW5nLFxuICApOiBQcm9taXNlPGh0dHAuSW5jb21pbmdNZXNzYWdlPiB7XG4gICAgaWYgKCFpc09iamVjdChvcHRpb25zKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignb3B0aW9ucyBzaG91bGQgYmUgb2YgdHlwZSBcIm9iamVjdFwiJylcbiAgICB9XG4gICAgaWYgKCEoQnVmZmVyLmlzQnVmZmVyKGJvZHkpIHx8IHR5cGVvZiBib2R5ID09PSAnc3RyaW5nJyB8fCBpc1JlYWRhYmxlU3RyZWFtKGJvZHkpKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcihcbiAgICAgICAgYHN0cmVhbSBzaG91bGQgYmUgYSBCdWZmZXIsIHN0cmluZyBvciByZWFkYWJsZSBTdHJlYW0sIGdvdCAke3R5cGVvZiBib2R5fSBpbnN0ZWFkYCxcbiAgICAgIClcbiAgICB9XG4gICAgaWYgKCFpc1N0cmluZyhzaGEyNTZzdW0pKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdzaGEyNTZzdW0gc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXG4gICAgfVxuICAgIHN0YXR1c0NvZGVzLmZvckVhY2goKHN0YXR1c0NvZGUpID0+IHtcbiAgICAgIGlmICghaXNOdW1iZXIoc3RhdHVzQ29kZSkpIHtcbiAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignc3RhdHVzQ29kZSBzaG91bGQgYmUgb2YgdHlwZSBcIm51bWJlclwiJylcbiAgICAgIH1cbiAgICB9KVxuICAgIGlmICghaXNTdHJpbmcocmVnaW9uKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigncmVnaW9uIHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCInKVxuICAgIH1cbiAgICAvLyBzaGEyNTZzdW0gd2lsbCBiZSBlbXB0eSBmb3IgYW5vbnltb3VzIG9yIGh0dHBzIHJlcXVlc3RzXG4gICAgaWYgKCF0aGlzLmVuYWJsZVNIQTI1NiAmJiBzaGEyNTZzdW0ubGVuZ3RoICE9PSAwKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKGBzaGEyNTZzdW0gZXhwZWN0ZWQgdG8gYmUgZW1wdHkgZm9yIGFub255bW91cyBvciBodHRwcyByZXF1ZXN0c2ApXG4gICAgfVxuICAgIC8vIHNoYTI1NnN1bSBzaG91bGQgYmUgdmFsaWQgZm9yIG5vbi1hbm9ueW1vdXMgaHR0cCByZXF1ZXN0cy5cbiAgICBpZiAodGhpcy5lbmFibGVTSEEyNTYgJiYgc2hhMjU2c3VtLmxlbmd0aCAhPT0gNjQpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoYEludmFsaWQgc2hhMjU2c3VtIDogJHtzaGEyNTZzdW19YClcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLmNoZWNrQW5kUmVmcmVzaENyZWRzKClcblxuICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBAdHlwZXNjcmlwdC1lc2xpbnQvbm8tbm9uLW51bGwtYXNzZXJ0aW9uXG4gICAgcmVnaW9uID0gcmVnaW9uIHx8IChhd2FpdCB0aGlzLmdldEJ1Y2tldFJlZ2lvbkFzeW5jKG9wdGlvbnMuYnVja2V0TmFtZSEpKVxuXG4gICAgY29uc3QgcmVxT3B0aW9ucyA9IHRoaXMuZ2V0UmVxdWVzdE9wdGlvbnMoeyAuLi5vcHRpb25zLCByZWdpb24gfSlcbiAgICBpZiAoIXRoaXMuYW5vbnltb3VzKSB7XG4gICAgICAvLyBGb3Igbm9uLWFub255bW91cyBodHRwcyByZXF1ZXN0cyBzaGEyNTZzdW0gaXMgJ1VOU0lHTkVELVBBWUxPQUQnIGZvciBzaWduYXR1cmUgY2FsY3VsYXRpb24uXG4gICAgICBpZiAoIXRoaXMuZW5hYmxlU0hBMjU2KSB7XG4gICAgICAgIHNoYTI1NnN1bSA9ICdVTlNJR05FRC1QQVlMT0FEJ1xuICAgICAgfVxuICAgICAgY29uc3QgZGF0ZSA9IG5ldyBEYXRlKClcbiAgICAgIHJlcU9wdGlvbnMuaGVhZGVyc1sneC1hbXotZGF0ZSddID0gbWFrZURhdGVMb25nKGRhdGUpXG4gICAgICByZXFPcHRpb25zLmhlYWRlcnNbJ3gtYW16LWNvbnRlbnQtc2hhMjU2J10gPSBzaGEyNTZzdW1cbiAgICAgIGlmICh0aGlzLnNlc3Npb25Ub2tlbikge1xuICAgICAgICByZXFPcHRpb25zLmhlYWRlcnNbJ3gtYW16LXNlY3VyaXR5LXRva2VuJ10gPSB0aGlzLnNlc3Npb25Ub2tlblxuICAgICAgfVxuICAgICAgcmVxT3B0aW9ucy5oZWFkZXJzLmF1dGhvcml6YXRpb24gPSBzaWduVjQocmVxT3B0aW9ucywgdGhpcy5hY2Nlc3NLZXksIHRoaXMuc2VjcmV0S2V5LCByZWdpb24sIGRhdGUsIHNoYTI1NnN1bSlcbiAgICB9XG5cbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHJlcXVlc3RXaXRoUmV0cnkoXG4gICAgICB0aGlzLnRyYW5zcG9ydCxcbiAgICAgIHJlcU9wdGlvbnMsXG4gICAgICBib2R5LFxuICAgICAgdGhpcy5yZXRyeU9wdGlvbnMuZGlzYWJsZVJldHJ5ID09PSB0cnVlID8gMCA6IHRoaXMucmV0cnlPcHRpb25zLm1heGltdW1SZXRyeUNvdW50LFxuICAgICAgdGhpcy5yZXRyeU9wdGlvbnMuYmFzZURlbGF5TXMsXG4gICAgICB0aGlzLnJldHJ5T3B0aW9ucy5tYXhpbXVtRGVsYXlNcyxcbiAgICApXG4gICAgaWYgKCFyZXNwb25zZS5zdGF0dXNDb2RlKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJCVUc6IHJlc3BvbnNlIGRvZXNuJ3QgaGF2ZSBhIHN0YXR1c0NvZGVcIilcbiAgICB9XG5cbiAgICBpZiAoIXN0YXR1c0NvZGVzLmluY2x1ZGVzKHJlc3BvbnNlLnN0YXR1c0NvZGUpKSB7XG4gICAgICAvLyBGb3IgYW4gaW5jb3JyZWN0IHJlZ2lvbiwgUzMgc2VydmVyIGFsd2F5cyBzZW5kcyBiYWNrIDQwMC5cbiAgICAgIC8vIEJ1dCB3ZSB3aWxsIGRvIGNhY2hlIGludmFsaWRhdGlvbiBmb3IgYWxsIGVycm9ycyBzbyB0aGF0LFxuICAgICAgLy8gaW4gZnV0dXJlLCBpZiBBV1MgUzMgZGVjaWRlcyB0byBzZW5kIGEgZGlmZmVyZW50IHN0YXR1cyBjb2RlIG9yXG4gICAgICAvLyBYTUwgZXJyb3IgY29kZSB3ZSB3aWxsIHN0aWxsIHdvcmsgZmluZS5cbiAgICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBAdHlwZXNjcmlwdC1lc2xpbnQvbm8tbm9uLW51bGwtYXNzZXJ0aW9uXG4gICAgICBkZWxldGUgdGhpcy5yZWdpb25NYXBbb3B0aW9ucy5idWNrZXROYW1lIV1cblxuICAgICAgY29uc3QgZXJyID0gYXdhaXQgeG1sUGFyc2Vycy5wYXJzZVJlc3BvbnNlRXJyb3IocmVzcG9uc2UpXG4gICAgICB0aGlzLmxvZ0hUVFAocmVxT3B0aW9ucywgcmVzcG9uc2UsIGVycilcbiAgICAgIHRocm93IGVyclxuICAgIH1cblxuICAgIHRoaXMubG9nSFRUUChyZXFPcHRpb25zLCByZXNwb25zZSlcblxuICAgIHJldHVybiByZXNwb25zZVxuICB9XG5cbiAgLyoqXG4gICAqIGdldHMgdGhlIHJlZ2lvbiBvZiB0aGUgYnVja2V0XG4gICAqXG4gICAqIEBwYXJhbSBidWNrZXROYW1lXG4gICAqXG4gICAqL1xuICBhc3luYyBnZXRCdWNrZXRSZWdpb25Bc3luYyhidWNrZXROYW1lOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZz4ge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcihgSW52YWxpZCBidWNrZXQgbmFtZSA6ICR7YnVja2V0TmFtZX1gKVxuICAgIH1cblxuICAgIC8vIFJlZ2lvbiBpcyBzZXQgd2l0aCBjb25zdHJ1Y3RvciwgcmV0dXJuIHRoZSByZWdpb24gcmlnaHQgaGVyZS5cbiAgICBpZiAodGhpcy5yZWdpb24pIHtcbiAgICAgIHJldHVybiB0aGlzLnJlZ2lvblxuICAgIH1cblxuICAgIGNvbnN0IGNhY2hlZCA9IHRoaXMucmVnaW9uTWFwW2J1Y2tldE5hbWVdXG4gICAgaWYgKGNhY2hlZCkge1xuICAgICAgcmV0dXJuIGNhY2hlZFxuICAgIH1cblxuICAgIGNvbnN0IGV4dHJhY3RSZWdpb25Bc3luYyA9IGFzeW5jIChyZXNwb25zZTogaHR0cC5JbmNvbWluZ01lc3NhZ2UpID0+IHtcbiAgICAgIGNvbnN0IGJvZHkgPSBhd2FpdCByZWFkQXNTdHJpbmcocmVzcG9uc2UpXG4gICAgICBjb25zdCByZWdpb24gPSB4bWxQYXJzZXJzLnBhcnNlQnVja2V0UmVnaW9uKGJvZHkpIHx8IERFRkFVTFRfUkVHSU9OXG4gICAgICB0aGlzLnJlZ2lvbk1hcFtidWNrZXROYW1lXSA9IHJlZ2lvblxuICAgICAgcmV0dXJuIHJlZ2lvblxuICAgIH1cblxuICAgIGNvbnN0IG1ldGhvZCA9ICdHRVQnXG4gICAgY29uc3QgcXVlcnkgPSAnbG9jYXRpb24nXG4gICAgLy8gYGdldEJ1Y2tldExvY2F0aW9uYCBiZWhhdmVzIGRpZmZlcmVudGx5IGluIGZvbGxvd2luZyB3YXlzIGZvclxuICAgIC8vIGRpZmZlcmVudCBlbnZpcm9ubWVudHMuXG4gICAgLy9cbiAgICAvLyAtIEZvciBub2RlanMgZW52IHdlIGRlZmF1bHQgdG8gcGF0aCBzdHlsZSByZXF1ZXN0cy5cbiAgICAvLyAtIEZvciBicm93c2VyIGVudiBwYXRoIHN0eWxlIHJlcXVlc3RzIG9uIGJ1Y2tldHMgeWllbGRzIENPUlNcbiAgICAvLyAgIGVycm9yLiBUbyBjaXJjdW12ZW50IHRoaXMgcHJvYmxlbSB3ZSBtYWtlIGEgdmlydHVhbCBob3N0XG4gICAgLy8gICBzdHlsZSByZXF1ZXN0IHNpZ25lZCB3aXRoICd1cy1lYXN0LTEnLiBUaGlzIHJlcXVlc3QgZmFpbHNcbiAgICAvLyAgIHdpdGggYW4gZXJyb3IgJ0F1dGhvcml6YXRpb25IZWFkZXJNYWxmb3JtZWQnLCBhZGRpdGlvbmFsbHlcbiAgICAvLyAgIHRoZSBlcnJvciBYTUwgYWxzbyBwcm92aWRlcyBSZWdpb24gb2YgdGhlIGJ1Y2tldC4gVG8gdmFsaWRhdGVcbiAgICAvLyAgIHRoaXMgcmVnaW9uIGlzIHByb3BlciB3ZSByZXRyeSB0aGUgc2FtZSByZXF1ZXN0IHdpdGggdGhlIG5ld2x5XG4gICAgLy8gICBvYnRhaW5lZCByZWdpb24uXG4gICAgY29uc3QgcGF0aFN0eWxlID0gdGhpcy5wYXRoU3R5bGUgJiYgIWlzQnJvd3NlclxuICAgIGxldCByZWdpb246IHN0cmluZ1xuICAgIHRyeSB7XG4gICAgICBjb25zdCByZXMgPSBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmMoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIHF1ZXJ5LCBwYXRoU3R5bGUgfSwgJycsIFsyMDBdLCBERUZBVUxUX1JFR0lPTilcbiAgICAgIHJldHVybiBleHRyYWN0UmVnaW9uQXN5bmMocmVzKVxuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIC8vIG1ha2UgYWxpZ25tZW50IHdpdGggbWMgY2xpXG4gICAgICBpZiAoZSBpbnN0YW5jZW9mIGVycm9ycy5TM0Vycm9yKSB7XG4gICAgICAgIGNvbnN0IGVyckNvZGUgPSBlLmNvZGVcbiAgICAgICAgY29uc3QgZXJyUmVnaW9uID0gZS5yZWdpb25cbiAgICAgICAgaWYgKGVyckNvZGUgPT09ICdBY2Nlc3NEZW5pZWQnICYmICFlcnJSZWdpb24pIHtcbiAgICAgICAgICByZXR1cm4gREVGQVVMVF9SRUdJT05cbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIEB0eXBlc2NyaXB0LWVzbGludC9iYW4tdHMtY29tbWVudFxuICAgICAgLy8gQHRzLWlnbm9yZVxuICAgICAgaWYgKCEoZS5uYW1lID09PSAnQXV0aG9yaXphdGlvbkhlYWRlck1hbGZvcm1lZCcpKSB7XG4gICAgICAgIHRocm93IGVcbiAgICAgIH1cbiAgICAgIC8vIEB0cy1leHBlY3QtZXJyb3Igd2Ugc2V0IGV4dHJhIHByb3BlcnRpZXMgb24gZXJyb3Igb2JqZWN0XG4gICAgICByZWdpb24gPSBlLlJlZ2lvbiBhcyBzdHJpbmdcbiAgICAgIGlmICghcmVnaW9uKSB7XG4gICAgICAgIHRocm93IGVcbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCByZXMgPSBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmMoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIHF1ZXJ5LCBwYXRoU3R5bGUgfSwgJycsIFsyMDBdLCByZWdpb24pXG4gICAgcmV0dXJuIGF3YWl0IGV4dHJhY3RSZWdpb25Bc3luYyhyZXMpXG4gIH1cblxuICAvKipcbiAgICogbWFrZVJlcXVlc3QgaXMgdGhlIHByaW1pdGl2ZSB1c2VkIGJ5IHRoZSBhcGlzIGZvciBtYWtpbmcgUzMgcmVxdWVzdHMuXG4gICAqIHBheWxvYWQgY2FuIGJlIGVtcHR5IHN0cmluZyBpbiBjYXNlIG9mIG5vIHBheWxvYWQuXG4gICAqIHN0YXR1c0NvZGUgaXMgdGhlIGV4cGVjdGVkIHN0YXR1c0NvZGUuIElmIHJlc3BvbnNlLnN0YXR1c0NvZGUgZG9lcyBub3QgbWF0Y2hcbiAgICogd2UgcGFyc2UgdGhlIFhNTCBlcnJvciBhbmQgY2FsbCB0aGUgY2FsbGJhY2sgd2l0aCB0aGUgZXJyb3IgbWVzc2FnZS5cbiAgICogQSB2YWxpZCByZWdpb24gaXMgcGFzc2VkIGJ5IHRoZSBjYWxscyAtIGxpc3RCdWNrZXRzLCBtYWtlQnVja2V0IGFuZFxuICAgKiBnZXRCdWNrZXRSZWdpb24uXG4gICAqXG4gICAqIEBkZXByZWNhdGVkIHVzZSBgbWFrZVJlcXVlc3RBc3luY2AgaW5zdGVhZFxuICAgKi9cbiAgbWFrZVJlcXVlc3QoXG4gICAgb3B0aW9uczogUmVxdWVzdE9wdGlvbixcbiAgICBwYXlsb2FkOiBCaW5hcnkgPSAnJyxcbiAgICBleHBlY3RlZENvZGVzOiBudW1iZXJbXSA9IFsyMDBdLFxuICAgIHJlZ2lvbiA9ICcnLFxuICAgIHJldHVyblJlc3BvbnNlOiBib29sZWFuLFxuICAgIGNiOiAoY2I6IHVua25vd24sIHJlc3VsdDogaHR0cC5JbmNvbWluZ01lc3NhZ2UpID0+IHZvaWQsXG4gICkge1xuICAgIGxldCBwcm9tOiBQcm9taXNlPGh0dHAuSW5jb21pbmdNZXNzYWdlPlxuICAgIGlmIChyZXR1cm5SZXNwb25zZSkge1xuICAgICAgcHJvbSA9IHRoaXMubWFrZVJlcXVlc3RBc3luYyhvcHRpb25zLCBwYXlsb2FkLCBleHBlY3RlZENvZGVzLCByZWdpb24pXG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBAdHlwZXNjcmlwdC1lc2xpbnQvYmFuLXRzLWNvbW1lbnRcbiAgICAgIC8vIEB0cy1leHBlY3QtZXJyb3IgY29tcGF0aWJsZSBmb3Igb2xkIGJlaGF2aW91clxuICAgICAgcHJvbSA9IHRoaXMubWFrZVJlcXVlc3RBc3luY09taXQob3B0aW9ucywgcGF5bG9hZCwgZXhwZWN0ZWRDb2RlcywgcmVnaW9uKVxuICAgIH1cblxuICAgIHByb20udGhlbihcbiAgICAgIChyZXN1bHQpID0+IGNiKG51bGwsIHJlc3VsdCksXG4gICAgICAoZXJyKSA9PiB7XG4gICAgICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBAdHlwZXNjcmlwdC1lc2xpbnQvYmFuLXRzLWNvbW1lbnRcbiAgICAgICAgLy8gQHRzLWlnbm9yZVxuICAgICAgICBjYihlcnIpXG4gICAgICB9LFxuICAgIClcbiAgfVxuXG4gIC8qKlxuICAgKiBtYWtlUmVxdWVzdFN0cmVhbSB3aWxsIGJlIHVzZWQgZGlyZWN0bHkgaW5zdGVhZCBvZiBtYWtlUmVxdWVzdCBpbiBjYXNlIHRoZSBwYXlsb2FkXG4gICAqIGlzIGF2YWlsYWJsZSBhcyBhIHN0cmVhbS4gZm9yIGV4LiBwdXRPYmplY3RcbiAgICpcbiAgICogQGRlcHJlY2F0ZWQgdXNlIGBtYWtlUmVxdWVzdFN0cmVhbUFzeW5jYCBpbnN0ZWFkXG4gICAqL1xuICBtYWtlUmVxdWVzdFN0cmVhbShcbiAgICBvcHRpb25zOiBSZXF1ZXN0T3B0aW9uLFxuICAgIHN0cmVhbTogc3RyZWFtLlJlYWRhYmxlIHwgQnVmZmVyLFxuICAgIHNoYTI1NnN1bTogc3RyaW5nLFxuICAgIHN0YXR1c0NvZGVzOiBudW1iZXJbXSxcbiAgICByZWdpb246IHN0cmluZyxcbiAgICByZXR1cm5SZXNwb25zZTogYm9vbGVhbixcbiAgICBjYjogKGNiOiB1bmtub3duLCByZXN1bHQ6IGh0dHAuSW5jb21pbmdNZXNzYWdlKSA9PiB2b2lkLFxuICApIHtcbiAgICBjb25zdCBleGVjdXRvciA9IGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHJlcyA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RTdHJlYW1Bc3luYyhvcHRpb25zLCBzdHJlYW0sIHNoYTI1NnN1bSwgc3RhdHVzQ29kZXMsIHJlZ2lvbilcbiAgICAgIGlmICghcmV0dXJuUmVzcG9uc2UpIHtcbiAgICAgICAgYXdhaXQgZHJhaW5SZXNwb25zZShyZXMpXG4gICAgICB9XG5cbiAgICAgIHJldHVybiByZXNcbiAgICB9XG5cbiAgICBleGVjdXRvcigpLnRoZW4oXG4gICAgICAocmVzdWx0KSA9PiBjYihudWxsLCByZXN1bHQpLFxuICAgICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIEB0eXBlc2NyaXB0LWVzbGludC9iYW4tdHMtY29tbWVudFxuICAgICAgLy8gQHRzLWlnbm9yZVxuICAgICAgKGVycikgPT4gY2IoZXJyKSxcbiAgICApXG4gIH1cblxuICAvKipcbiAgICogQGRlcHJlY2F0ZWQgdXNlIGBnZXRCdWNrZXRSZWdpb25Bc3luY2AgaW5zdGVhZFxuICAgKi9cbiAgZ2V0QnVja2V0UmVnaW9uKGJ1Y2tldE5hbWU6IHN0cmluZywgY2I6IChlcnI6IHVua25vd24sIHJlZ2lvbjogc3RyaW5nKSA9PiB2b2lkKSB7XG4gICAgcmV0dXJuIHRoaXMuZ2V0QnVja2V0UmVnaW9uQXN5bmMoYnVja2V0TmFtZSkudGhlbihcbiAgICAgIChyZXN1bHQpID0+IGNiKG51bGwsIHJlc3VsdCksXG4gICAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgQHR5cGVzY3JpcHQtZXNsaW50L2Jhbi10cy1jb21tZW50XG4gICAgICAvLyBAdHMtaWdub3JlXG4gICAgICAoZXJyKSA9PiBjYihlcnIpLFxuICAgIClcbiAgfVxuXG4gIC8vIEJ1Y2tldCBvcGVyYXRpb25zXG5cbiAgLyoqXG4gICAqIENyZWF0ZXMgdGhlIGJ1Y2tldCBgYnVja2V0TmFtZWAuXG4gICAqXG4gICAqL1xuICBhc3luYyBtYWtlQnVja2V0KGJ1Y2tldE5hbWU6IHN0cmluZywgcmVnaW9uOiBSZWdpb24gPSAnJywgbWFrZU9wdHM/OiBNYWtlQnVja2V0T3B0KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgLy8gQmFja3dhcmQgQ29tcGF0aWJpbGl0eVxuICAgIGlmIChpc09iamVjdChyZWdpb24pKSB7XG4gICAgICBtYWtlT3B0cyA9IHJlZ2lvblxuICAgICAgcmVnaW9uID0gJydcbiAgICB9XG5cbiAgICBpZiAoIWlzU3RyaW5nKHJlZ2lvbikpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3JlZ2lvbiBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmluZ1wiJylcbiAgICB9XG4gICAgaWYgKG1ha2VPcHRzICYmICFpc09iamVjdChtYWtlT3B0cykpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ21ha2VPcHRzIHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxuICAgIH1cblxuICAgIGxldCBwYXlsb2FkID0gJydcblxuICAgIC8vIFJlZ2lvbiBhbHJlYWR5IHNldCBpbiBjb25zdHJ1Y3RvciwgdmFsaWRhdGUgaWZcbiAgICAvLyBjYWxsZXIgcmVxdWVzdGVkIGJ1Y2tldCBsb2NhdGlvbiBpcyBzYW1lLlxuICAgIGlmIChyZWdpb24gJiYgdGhpcy5yZWdpb24pIHtcbiAgICAgIGlmIChyZWdpb24gIT09IHRoaXMucmVnaW9uKSB7XG4gICAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoYENvbmZpZ3VyZWQgcmVnaW9uICR7dGhpcy5yZWdpb259LCByZXF1ZXN0ZWQgJHtyZWdpb259YClcbiAgICAgIH1cbiAgICB9XG4gICAgLy8gc2VuZGluZyBtYWtlQnVja2V0IHJlcXVlc3Qgd2l0aCBYTUwgY29udGFpbmluZyAndXMtZWFzdC0xJyBmYWlscy4gRm9yXG4gICAgLy8gZGVmYXVsdCByZWdpb24gc2VydmVyIGV4cGVjdHMgdGhlIHJlcXVlc3Qgd2l0aG91dCBib2R5XG4gICAgaWYgKHJlZ2lvbiAmJiByZWdpb24gIT09IERFRkFVTFRfUkVHSU9OKSB7XG4gICAgICBwYXlsb2FkID0geG1sLmJ1aWxkT2JqZWN0KHtcbiAgICAgICAgQ3JlYXRlQnVja2V0Q29uZmlndXJhdGlvbjoge1xuICAgICAgICAgICQ6IHsgeG1sbnM6ICdodHRwOi8vczMuYW1hem9uYXdzLmNvbS9kb2MvMjAwNi0wMy0wMS8nIH0sXG4gICAgICAgICAgTG9jYXRpb25Db25zdHJhaW50OiByZWdpb24sXG4gICAgICAgIH0sXG4gICAgICB9KVxuICAgIH1cbiAgICBjb25zdCBtZXRob2QgPSAnUFVUJ1xuICAgIGNvbnN0IGhlYWRlcnM6IFJlcXVlc3RIZWFkZXJzID0ge31cblxuICAgIGlmIChtYWtlT3B0cyAmJiBtYWtlT3B0cy5PYmplY3RMb2NraW5nKSB7XG4gICAgICBoZWFkZXJzWyd4LWFtei1idWNrZXQtb2JqZWN0LWxvY2stZW5hYmxlZCddID0gdHJ1ZVxuICAgIH1cblxuICAgIC8vIEZvciBjdXN0b20gcmVnaW9uIGNsaWVudHMgIGRlZmF1bHQgdG8gY3VzdG9tIHJlZ2lvbiBzcGVjaWZpZWQgaW4gY2xpZW50IGNvbnN0cnVjdG9yXG4gICAgY29uc3QgZmluYWxSZWdpb24gPSB0aGlzLnJlZ2lvbiB8fCByZWdpb24gfHwgREVGQVVMVF9SRUdJT05cblxuICAgIGNvbnN0IHJlcXVlc3RPcHQ6IFJlcXVlc3RPcHRpb24gPSB7IG1ldGhvZCwgYnVja2V0TmFtZSwgaGVhZGVycyB9XG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jT21pdChyZXF1ZXN0T3B0LCBwYXlsb2FkLCBbMjAwXSwgZmluYWxSZWdpb24pXG4gICAgfSBjYXRjaCAoZXJyOiB1bmtub3duKSB7XG4gICAgICBpZiAocmVnaW9uID09PSAnJyB8fCByZWdpb24gPT09IERFRkFVTFRfUkVHSU9OKSB7XG4gICAgICAgIGlmIChlcnIgaW5zdGFuY2VvZiBlcnJvcnMuUzNFcnJvcikge1xuICAgICAgICAgIGNvbnN0IGVyckNvZGUgPSBlcnIuY29kZVxuICAgICAgICAgIGNvbnN0IGVyclJlZ2lvbiA9IGVyci5yZWdpb25cbiAgICAgICAgICBpZiAoZXJyQ29kZSA9PT0gJ0F1dGhvcml6YXRpb25IZWFkZXJNYWxmb3JtZWQnICYmIGVyclJlZ2lvbiAhPT0gJycpIHtcbiAgICAgICAgICAgIC8vIFJldHJ5IHdpdGggcmVnaW9uIHJldHVybmVkIGFzIHBhcnQgb2YgZXJyb3JcbiAgICAgICAgICAgIGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luY09taXQocmVxdWVzdE9wdCwgcGF5bG9hZCwgWzIwMF0sIGVyckNvZGUpXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgICB0aHJvdyBlcnJcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogVG8gY2hlY2sgaWYgYSBidWNrZXQgYWxyZWFkeSBleGlzdHMuXG4gICAqL1xuICBhc3luYyBidWNrZXRFeGlzdHMoYnVja2V0TmFtZTogc3RyaW5nKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgY29uc3QgbWV0aG9kID0gJ0hFQUQnXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luY09taXQoeyBtZXRob2QsIGJ1Y2tldE5hbWUgfSlcbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIC8vIEB0cy1pZ25vcmVcbiAgICAgIGlmIChlcnIuY29kZSA9PT0gJ05vU3VjaEJ1Y2tldCcgfHwgZXJyLmNvZGUgPT09ICdOb3RGb3VuZCcpIHtcbiAgICAgICAgcmV0dXJuIGZhbHNlXG4gICAgICB9XG4gICAgICB0aHJvdyBlcnJcbiAgICB9XG5cbiAgICByZXR1cm4gdHJ1ZVxuICB9XG5cbiAgYXN5bmMgcmVtb3ZlQnVja2V0KGJ1Y2tldE5hbWU6IHN0cmluZyk6IFByb21pc2U8dm9pZD5cblxuICAvKipcbiAgICogQGRlcHJlY2F0ZWQgdXNlIHByb21pc2Ugc3R5bGUgQVBJXG4gICAqL1xuICByZW1vdmVCdWNrZXQoYnVja2V0TmFtZTogc3RyaW5nLCBjYWxsYmFjazogTm9SZXN1bHRDYWxsYmFjayk6IHZvaWRcblxuICBhc3luYyByZW1vdmVCdWNrZXQoYnVja2V0TmFtZTogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgY29uc3QgbWV0aG9kID0gJ0RFTEVURSdcbiAgICBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmNPbWl0KHsgbWV0aG9kLCBidWNrZXROYW1lIH0sICcnLCBbMjA0XSlcbiAgICBkZWxldGUgdGhpcy5yZWdpb25NYXBbYnVja2V0TmFtZV1cbiAgfVxuXG4gIC8qKlxuICAgKiBDYWxsYmFjayBpcyBjYWxsZWQgd2l0aCByZWFkYWJsZSBzdHJlYW0gb2YgdGhlIG9iamVjdCBjb250ZW50LlxuICAgKi9cbiAgYXN5bmMgZ2V0T2JqZWN0KGJ1Y2tldE5hbWU6IHN0cmluZywgb2JqZWN0TmFtZTogc3RyaW5nLCBnZXRPcHRzPzogR2V0T2JqZWN0T3B0cyk6IFByb21pc2U8c3RyZWFtLlJlYWRhYmxlPiB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkT2JqZWN0TmFtZUVycm9yKGBJbnZhbGlkIG9iamVjdCBuYW1lOiAke29iamVjdE5hbWV9YClcbiAgICB9XG4gICAgcmV0dXJuIHRoaXMuZ2V0UGFydGlhbE9iamVjdChidWNrZXROYW1lLCBvYmplY3ROYW1lLCAwLCAwLCBnZXRPcHRzKVxuICB9XG5cbiAgLyoqXG4gICAqIENhbGxiYWNrIGlzIGNhbGxlZCB3aXRoIHJlYWRhYmxlIHN0cmVhbSBvZiB0aGUgcGFydGlhbCBvYmplY3QgY29udGVudC5cbiAgICogQHBhcmFtIGJ1Y2tldE5hbWVcbiAgICogQHBhcmFtIG9iamVjdE5hbWVcbiAgICogQHBhcmFtIG9mZnNldFxuICAgKiBAcGFyYW0gbGVuZ3RoIC0gbGVuZ3RoIG9mIHRoZSBvYmplY3QgdGhhdCB3aWxsIGJlIHJlYWQgaW4gdGhlIHN0cmVhbSAob3B0aW9uYWwsIGlmIG5vdCBzcGVjaWZpZWQgd2UgcmVhZCB0aGUgcmVzdCBvZiB0aGUgZmlsZSBmcm9tIHRoZSBvZmZzZXQpXG4gICAqIEBwYXJhbSBnZXRPcHRzXG4gICAqL1xuICBhc3luYyBnZXRQYXJ0aWFsT2JqZWN0KFxuICAgIGJ1Y2tldE5hbWU6IHN0cmluZyxcbiAgICBvYmplY3ROYW1lOiBzdHJpbmcsXG4gICAgb2Zmc2V0OiBudW1iZXIsXG4gICAgbGVuZ3RoID0gMCxcbiAgICBnZXRPcHRzPzogR2V0T2JqZWN0T3B0cyxcbiAgKTogUHJvbWlzZTxzdHJlYW0uUmVhZGFibGU+IHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRPYmplY3ROYW1lRXJyb3IoYEludmFsaWQgb2JqZWN0IG5hbWU6ICR7b2JqZWN0TmFtZX1gKVxuICAgIH1cbiAgICBpZiAoIWlzTnVtYmVyKG9mZnNldCkpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ29mZnNldCBzaG91bGQgYmUgb2YgdHlwZSBcIm51bWJlclwiJylcbiAgICB9XG4gICAgaWYgKCFpc051bWJlcihsZW5ndGgpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdsZW5ndGggc2hvdWxkIGJlIG9mIHR5cGUgXCJudW1iZXJcIicpXG4gICAgfVxuXG4gICAgbGV0IHJhbmdlID0gJydcbiAgICBpZiAob2Zmc2V0IHx8IGxlbmd0aCkge1xuICAgICAgaWYgKG9mZnNldCkge1xuICAgICAgICByYW5nZSA9IGBieXRlcz0keytvZmZzZXR9LWBcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHJhbmdlID0gJ2J5dGVzPTAtJ1xuICAgICAgICBvZmZzZXQgPSAwXG4gICAgICB9XG4gICAgICBpZiAobGVuZ3RoKSB7XG4gICAgICAgIHJhbmdlICs9IGAkeytsZW5ndGggKyBvZmZzZXQgLSAxfWBcbiAgICAgIH1cbiAgICB9XG5cbiAgICBsZXQgcXVlcnkgPSAnJ1xuICAgIGxldCBoZWFkZXJzOiBSZXF1ZXN0SGVhZGVycyA9IHtcbiAgICAgIC4uLihyYW5nZSAhPT0gJycgJiYgeyByYW5nZSB9KSxcbiAgICB9XG5cbiAgICBpZiAoZ2V0T3B0cykge1xuICAgICAgY29uc3Qgc3NlSGVhZGVyczogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHtcbiAgICAgICAgLi4uKGdldE9wdHMuU1NFQ3VzdG9tZXJBbGdvcml0aG0gJiYge1xuICAgICAgICAgICdYLUFtei1TZXJ2ZXItU2lkZS1FbmNyeXB0aW9uLUN1c3RvbWVyLUFsZ29yaXRobSc6IGdldE9wdHMuU1NFQ3VzdG9tZXJBbGdvcml0aG0sXG4gICAgICAgIH0pLFxuICAgICAgICAuLi4oZ2V0T3B0cy5TU0VDdXN0b21lcktleSAmJiB7ICdYLUFtei1TZXJ2ZXItU2lkZS1FbmNyeXB0aW9uLUN1c3RvbWVyLUtleSc6IGdldE9wdHMuU1NFQ3VzdG9tZXJLZXkgfSksXG4gICAgICAgIC4uLihnZXRPcHRzLlNTRUN1c3RvbWVyS2V5TUQ1ICYmIHtcbiAgICAgICAgICAnWC1BbXotU2VydmVyLVNpZGUtRW5jcnlwdGlvbi1DdXN0b21lci1LZXktTUQ1JzogZ2V0T3B0cy5TU0VDdXN0b21lcktleU1ENSxcbiAgICAgICAgfSksXG4gICAgICB9XG4gICAgICBxdWVyeSA9IHFzLnN0cmluZ2lmeShnZXRPcHRzKVxuICAgICAgaGVhZGVycyA9IHtcbiAgICAgICAgLi4ucHJlcGVuZFhBTVpNZXRhKHNzZUhlYWRlcnMpLFxuICAgICAgICAuLi5oZWFkZXJzLFxuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IGV4cGVjdGVkU3RhdHVzQ29kZXMgPSBbMjAwXVxuICAgIGlmIChyYW5nZSkge1xuICAgICAgZXhwZWN0ZWRTdGF0dXNDb2Rlcy5wdXNoKDIwNilcbiAgICB9XG4gICAgY29uc3QgbWV0aG9kID0gJ0dFVCdcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmMoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIGhlYWRlcnMsIHF1ZXJ5IH0sICcnLCBleHBlY3RlZFN0YXR1c0NvZGVzKVxuICB9XG5cbiAgLyoqXG4gICAqIGRvd25sb2FkIG9iamVjdCBjb250ZW50IHRvIGEgZmlsZS5cbiAgICogVGhpcyBtZXRob2Qgd2lsbCBjcmVhdGUgYSB0ZW1wIGZpbGUgbmFtZWQgYCR7ZmlsZW5hbWV9LiR7YmFzZTY0KGV0YWcpfS5wYXJ0Lm1pbmlvYCB3aGVuIGRvd25sb2FkaW5nLlxuICAgKlxuICAgKiBAcGFyYW0gYnVja2V0TmFtZSAtIG5hbWUgb2YgdGhlIGJ1Y2tldFxuICAgKiBAcGFyYW0gb2JqZWN0TmFtZSAtIG5hbWUgb2YgdGhlIG9iamVjdFxuICAgKiBAcGFyYW0gZmlsZVBhdGggLSBwYXRoIHRvIHdoaWNoIHRoZSBvYmplY3QgZGF0YSB3aWxsIGJlIHdyaXR0ZW4gdG9cbiAgICogQHBhcmFtIGdldE9wdHMgLSBPcHRpb25hbCBvYmplY3QgZ2V0IG9wdGlvblxuICAgKi9cbiAgYXN5bmMgZkdldE9iamVjdChidWNrZXROYW1lOiBzdHJpbmcsIG9iamVjdE5hbWU6IHN0cmluZywgZmlsZVBhdGg6IHN0cmluZywgZ2V0T3B0cz86IEdldE9iamVjdE9wdHMpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAvLyBJbnB1dCB2YWxpZGF0aW9uLlxuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmICghaXNWYWxpZE9iamVjdE5hbWUob2JqZWN0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZE9iamVjdE5hbWVFcnJvcihgSW52YWxpZCBvYmplY3QgbmFtZTogJHtvYmplY3ROYW1lfWApXG4gICAgfVxuICAgIGlmICghaXNTdHJpbmcoZmlsZVBhdGgpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdmaWxlUGF0aCBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmluZ1wiJylcbiAgICB9XG5cbiAgICBjb25zdCBkb3dubG9hZFRvVG1wRmlsZSA9IGFzeW5jICgpOiBQcm9taXNlPHN0cmluZz4gPT4ge1xuICAgICAgbGV0IHBhcnRGaWxlU3RyZWFtOiBzdHJlYW0uV3JpdGFibGVcbiAgICAgIGNvbnN0IG9ialN0YXQgPSBhd2FpdCB0aGlzLnN0YXRPYmplY3QoYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgZ2V0T3B0cylcbiAgICAgIGNvbnN0IGVuY29kZWRFdGFnID0gQnVmZmVyLmZyb20ob2JqU3RhdC5ldGFnKS50b1N0cmluZygnYmFzZTY0JylcbiAgICAgIGNvbnN0IHBhcnRGaWxlID0gYCR7ZmlsZVBhdGh9LiR7ZW5jb2RlZEV0YWd9LnBhcnQubWluaW9gXG5cbiAgICAgIGF3YWl0IGZzcC5ta2RpcihwYXRoLmRpcm5hbWUoZmlsZVBhdGgpLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KVxuXG4gICAgICBsZXQgb2Zmc2V0ID0gMFxuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3Qgc3RhdHMgPSBhd2FpdCBmc3Auc3RhdChwYXJ0RmlsZSlcbiAgICAgICAgaWYgKG9ialN0YXQuc2l6ZSA9PT0gc3RhdHMuc2l6ZSkge1xuICAgICAgICAgIHJldHVybiBwYXJ0RmlsZVxuICAgICAgICB9XG4gICAgICAgIG9mZnNldCA9IHN0YXRzLnNpemVcbiAgICAgICAgcGFydEZpbGVTdHJlYW0gPSBmcy5jcmVhdGVXcml0ZVN0cmVhbShwYXJ0RmlsZSwgeyBmbGFnczogJ2EnIH0pXG4gICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIGlmIChlIGluc3RhbmNlb2YgRXJyb3IgJiYgKGUgYXMgdW5rbm93biBhcyB7IGNvZGU6IHN0cmluZyB9KS5jb2RlID09PSAnRU5PRU5UJykge1xuICAgICAgICAgIC8vIGZpbGUgbm90IGV4aXN0XG4gICAgICAgICAgcGFydEZpbGVTdHJlYW0gPSBmcy5jcmVhdGVXcml0ZVN0cmVhbShwYXJ0RmlsZSwgeyBmbGFnczogJ3cnIH0pXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgLy8gb3RoZXIgZXJyb3IsIG1heWJlIGFjY2VzcyBkZW55XG4gICAgICAgICAgdGhyb3cgZVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGRvd25sb2FkU3RyZWFtID0gYXdhaXQgdGhpcy5nZXRQYXJ0aWFsT2JqZWN0KGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIG9mZnNldCwgMCwgZ2V0T3B0cylcblxuICAgICAgYXdhaXQgc3RyZWFtUHJvbWlzZS5waXBlbGluZShkb3dubG9hZFN0cmVhbSwgcGFydEZpbGVTdHJlYW0pXG4gICAgICBjb25zdCBzdGF0cyA9IGF3YWl0IGZzcC5zdGF0KHBhcnRGaWxlKVxuICAgICAgaWYgKHN0YXRzLnNpemUgPT09IG9ialN0YXQuc2l6ZSkge1xuICAgICAgICByZXR1cm4gcGFydEZpbGVcbiAgICAgIH1cblxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdTaXplIG1pc21hdGNoIGJldHdlZW4gZG93bmxvYWRlZCBmaWxlIGFuZCB0aGUgb2JqZWN0JylcbiAgICB9XG5cbiAgICBjb25zdCBwYXJ0RmlsZSA9IGF3YWl0IGRvd25sb2FkVG9UbXBGaWxlKClcbiAgICBhd2FpdCBmc3AucmVuYW1lKHBhcnRGaWxlLCBmaWxlUGF0aClcbiAgfVxuXG4gIC8qKlxuICAgKiBTdGF0IGluZm9ybWF0aW9uIG9mIHRoZSBvYmplY3QuXG4gICAqL1xuICBhc3luYyBzdGF0T2JqZWN0KGJ1Y2tldE5hbWU6IHN0cmluZywgb2JqZWN0TmFtZTogc3RyaW5nLCBzdGF0T3B0cz86IFN0YXRPYmplY3RPcHRzKTogUHJvbWlzZTxCdWNrZXRJdGVtU3RhdD4ge1xuICAgIGNvbnN0IHN0YXRPcHREZWYgPSBzdGF0T3B0cyB8fCB7fVxuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmICghaXNWYWxpZE9iamVjdE5hbWUob2JqZWN0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZE9iamVjdE5hbWVFcnJvcihgSW52YWxpZCBvYmplY3QgbmFtZTogJHtvYmplY3ROYW1lfWApXG4gICAgfVxuXG4gICAgaWYgKCFpc09iamVjdChzdGF0T3B0RGVmKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcignc3RhdE9wdHMgc2hvdWxkIGJlIG9mIHR5cGUgXCJvYmplY3RcIicpXG4gICAgfVxuXG4gICAgY29uc3QgcXVlcnkgPSBxcy5zdHJpbmdpZnkoc3RhdE9wdERlZilcbiAgICBjb25zdCBtZXRob2QgPSAnSEVBRCdcbiAgICBjb25zdCByZXMgPSBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmNPbWl0KHsgbWV0aG9kLCBidWNrZXROYW1lLCBvYmplY3ROYW1lLCBxdWVyeSB9KVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIHNpemU6IHBhcnNlSW50KHJlcy5oZWFkZXJzWydjb250ZW50LWxlbmd0aCddIGFzIHN0cmluZyksXG4gICAgICBtZXRhRGF0YTogZXh0cmFjdE1ldGFkYXRhKHJlcy5oZWFkZXJzIGFzIFJlc3BvbnNlSGVhZGVyKSxcbiAgICAgIGxhc3RNb2RpZmllZDogbmV3IERhdGUocmVzLmhlYWRlcnNbJ2xhc3QtbW9kaWZpZWQnXSBhcyBzdHJpbmcpLFxuICAgICAgdmVyc2lvbklkOiBnZXRWZXJzaW9uSWQocmVzLmhlYWRlcnMgYXMgUmVzcG9uc2VIZWFkZXIpLFxuICAgICAgZXRhZzogc2FuaXRpemVFVGFnKHJlcy5oZWFkZXJzLmV0YWcpLFxuICAgIH1cbiAgfVxuXG4gIGFzeW5jIHJlbW92ZU9iamVjdChidWNrZXROYW1lOiBzdHJpbmcsIG9iamVjdE5hbWU6IHN0cmluZywgcmVtb3ZlT3B0cz86IFJlbW92ZU9wdGlvbnMpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoYEludmFsaWQgYnVja2V0IG5hbWU6ICR7YnVja2V0TmFtZX1gKVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRPYmplY3ROYW1lRXJyb3IoYEludmFsaWQgb2JqZWN0IG5hbWU6ICR7b2JqZWN0TmFtZX1gKVxuICAgIH1cblxuICAgIGlmIChyZW1vdmVPcHRzICYmICFpc09iamVjdChyZW1vdmVPcHRzKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcigncmVtb3ZlT3B0cyBzaG91bGQgYmUgb2YgdHlwZSBcIm9iamVjdFwiJylcbiAgICB9XG5cbiAgICBjb25zdCBtZXRob2QgPSAnREVMRVRFJ1xuXG4gICAgY29uc3QgaGVhZGVyczogUmVxdWVzdEhlYWRlcnMgPSB7fVxuICAgIGlmIChyZW1vdmVPcHRzPy5nb3Zlcm5hbmNlQnlwYXNzKSB7XG4gICAgICBoZWFkZXJzWydYLUFtei1CeXBhc3MtR292ZXJuYW5jZS1SZXRlbnRpb24nXSA9IHRydWVcbiAgICB9XG4gICAgaWYgKHJlbW92ZU9wdHM/LmZvcmNlRGVsZXRlKSB7XG4gICAgICBoZWFkZXJzWyd4LW1pbmlvLWZvcmNlLWRlbGV0ZSddID0gdHJ1ZVxuICAgIH1cblxuICAgIGNvbnN0IHF1ZXJ5UGFyYW1zOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge31cbiAgICBpZiAocmVtb3ZlT3B0cz8udmVyc2lvbklkKSB7XG4gICAgICBxdWVyeVBhcmFtcy52ZXJzaW9uSWQgPSBgJHtyZW1vdmVPcHRzLnZlcnNpb25JZH1gXG4gICAgfVxuICAgIGNvbnN0IHF1ZXJ5ID0gcXMuc3RyaW5naWZ5KHF1ZXJ5UGFyYW1zKVxuXG4gICAgYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jT21pdCh7IG1ldGhvZCwgYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgaGVhZGVycywgcXVlcnkgfSwgJycsIFsyMDAsIDIwNF0pXG4gIH1cblxuICAvLyBDYWxscyBpbXBsZW1lbnRlZCBiZWxvdyBhcmUgcmVsYXRlZCB0byBtdWx0aXBhcnQuXG5cbiAgbGlzdEluY29tcGxldGVVcGxvYWRzKFxuICAgIGJ1Y2tldDogc3RyaW5nLFxuICAgIHByZWZpeDogc3RyaW5nLFxuICAgIHJlY3Vyc2l2ZTogYm9vbGVhbixcbiAgKTogQnVja2V0U3RyZWFtPEluY29tcGxldGVVcGxvYWRlZEJ1Y2tldEl0ZW0+IHtcbiAgICBpZiAocHJlZml4ID09PSB1bmRlZmluZWQpIHtcbiAgICAgIHByZWZpeCA9ICcnXG4gICAgfVxuICAgIGlmIChyZWN1cnNpdmUgPT09IHVuZGVmaW5lZCkge1xuICAgICAgcmVjdXJzaXZlID0gZmFsc2VcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXQpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXQpXG4gICAgfVxuICAgIGlmICghaXNWYWxpZFByZWZpeChwcmVmaXgpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRQcmVmaXhFcnJvcihgSW52YWxpZCBwcmVmaXggOiAke3ByZWZpeH1gKVxuICAgIH1cbiAgICBpZiAoIWlzQm9vbGVhbihyZWN1cnNpdmUpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdyZWN1cnNpdmUgc2hvdWxkIGJlIG9mIHR5cGUgXCJib29sZWFuXCInKVxuICAgIH1cbiAgICBjb25zdCBkZWxpbWl0ZXIgPSByZWN1cnNpdmUgPyAnJyA6ICcvJ1xuICAgIGxldCBrZXlNYXJrZXIgPSAnJ1xuICAgIGxldCB1cGxvYWRJZE1hcmtlciA9ICcnXG4gICAgY29uc3QgdXBsb2FkczogdW5rbm93bltdID0gW11cbiAgICBsZXQgZW5kZWQgPSBmYWxzZVxuXG4gICAgLy8gVE9ETzogcmVmYWN0b3IgdGhpcyB3aXRoIGFzeW5jL2F3YWl0IGFuZCBgc3RyZWFtLlJlYWRhYmxlLmZyb21gXG4gICAgY29uc3QgcmVhZFN0cmVhbSA9IG5ldyBzdHJlYW0uUmVhZGFibGUoeyBvYmplY3RNb2RlOiB0cnVlIH0pXG4gICAgcmVhZFN0cmVhbS5fcmVhZCA9ICgpID0+IHtcbiAgICAgIC8vIHB1c2ggb25lIHVwbG9hZCBpbmZvIHBlciBfcmVhZCgpXG4gICAgICBpZiAodXBsb2Fkcy5sZW5ndGgpIHtcbiAgICAgICAgcmV0dXJuIHJlYWRTdHJlYW0ucHVzaCh1cGxvYWRzLnNoaWZ0KCkpXG4gICAgICB9XG4gICAgICBpZiAoZW5kZWQpIHtcbiAgICAgICAgcmV0dXJuIHJlYWRTdHJlYW0ucHVzaChudWxsKVxuICAgICAgfVxuICAgICAgdGhpcy5saXN0SW5jb21wbGV0ZVVwbG9hZHNRdWVyeShidWNrZXQsIHByZWZpeCwga2V5TWFya2VyLCB1cGxvYWRJZE1hcmtlciwgZGVsaW1pdGVyKS50aGVuKFxuICAgICAgICAocmVzdWx0KSA9PiB7XG4gICAgICAgICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIEB0eXBlc2NyaXB0LWVzbGludC9iYW4tdHMtY29tbWVudFxuICAgICAgICAgIC8vIEB0cy1pZ25vcmVcbiAgICAgICAgICByZXN1bHQucHJlZml4ZXMuZm9yRWFjaCgocHJlZml4KSA9PiB1cGxvYWRzLnB1c2gocHJlZml4KSlcbiAgICAgICAgICBhc3luYy5lYWNoU2VyaWVzKFxuICAgICAgICAgICAgcmVzdWx0LnVwbG9hZHMsXG4gICAgICAgICAgICAodXBsb2FkLCBjYikgPT4ge1xuICAgICAgICAgICAgICAvLyBmb3IgZWFjaCBpbmNvbXBsZXRlIHVwbG9hZCBhZGQgdGhlIHNpemVzIG9mIGl0cyB1cGxvYWRlZCBwYXJ0c1xuICAgICAgICAgICAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgQHR5cGVzY3JpcHQtZXNsaW50L2Jhbi10cy1jb21tZW50XG4gICAgICAgICAgICAgIC8vIEB0cy1pZ25vcmVcbiAgICAgICAgICAgICAgdGhpcy5saXN0UGFydHMoYnVja2V0LCB1cGxvYWQua2V5LCB1cGxvYWQudXBsb2FkSWQpLnRoZW4oXG4gICAgICAgICAgICAgICAgKHBhcnRzOiBQYXJ0W10pID0+IHtcbiAgICAgICAgICAgICAgICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBAdHlwZXNjcmlwdC1lc2xpbnQvYmFuLXRzLWNvbW1lbnRcbiAgICAgICAgICAgICAgICAgIC8vIEB0cy1pZ25vcmVcbiAgICAgICAgICAgICAgICAgIHVwbG9hZC5zaXplID0gcGFydHMucmVkdWNlKChhY2MsIGl0ZW0pID0+IGFjYyArIGl0ZW0uc2l6ZSwgMClcbiAgICAgICAgICAgICAgICAgIHVwbG9hZHMucHVzaCh1cGxvYWQpXG4gICAgICAgICAgICAgICAgICBjYigpXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAoZXJyOiBFcnJvcikgPT4gY2IoZXJyKSxcbiAgICAgICAgICAgICAgKVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIChlcnIpID0+IHtcbiAgICAgICAgICAgICAgaWYgKGVycikge1xuICAgICAgICAgICAgICAgIHJlYWRTdHJlYW0uZW1pdCgnZXJyb3InLCBlcnIpXG4gICAgICAgICAgICAgICAgcmV0dXJuXG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgaWYgKHJlc3VsdC5pc1RydW5jYXRlZCkge1xuICAgICAgICAgICAgICAgIGtleU1hcmtlciA9IHJlc3VsdC5uZXh0S2V5TWFya2VyXG4gICAgICAgICAgICAgICAgdXBsb2FkSWRNYXJrZXIgPSByZXN1bHQubmV4dFVwbG9hZElkTWFya2VyXG4gICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgZW5kZWQgPSB0cnVlXG4gICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgQHR5cGVzY3JpcHQtZXNsaW50L2Jhbi10cy1jb21tZW50XG4gICAgICAgICAgICAgIC8vIEB0cy1pZ25vcmVcbiAgICAgICAgICAgICAgcmVhZFN0cmVhbS5fcmVhZCgpXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIClcbiAgICAgICAgfSxcbiAgICAgICAgKGUpID0+IHtcbiAgICAgICAgICByZWFkU3RyZWFtLmVtaXQoJ2Vycm9yJywgZSlcbiAgICAgICAgfSxcbiAgICAgIClcbiAgICB9XG4gICAgcmV0dXJuIHJlYWRTdHJlYW1cbiAgfVxuXG4gIC8qKlxuICAgKiBDYWxsZWQgYnkgbGlzdEluY29tcGxldGVVcGxvYWRzIHRvIGZldGNoIGEgYmF0Y2ggb2YgaW5jb21wbGV0ZSB1cGxvYWRzLlxuICAgKi9cbiAgYXN5bmMgbGlzdEluY29tcGxldGVVcGxvYWRzUXVlcnkoXG4gICAgYnVja2V0TmFtZTogc3RyaW5nLFxuICAgIHByZWZpeDogc3RyaW5nLFxuICAgIGtleU1hcmtlcjogc3RyaW5nLFxuICAgIHVwbG9hZElkTWFya2VyOiBzdHJpbmcsXG4gICAgZGVsaW1pdGVyOiBzdHJpbmcsXG4gICk6IFByb21pc2U8TGlzdE11bHRpcGFydFJlc3VsdD4ge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmICghaXNTdHJpbmcocHJlZml4KSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigncHJlZml4IHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCInKVxuICAgIH1cbiAgICBpZiAoIWlzU3RyaW5nKGtleU1hcmtlcikpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2tleU1hcmtlciBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmluZ1wiJylcbiAgICB9XG4gICAgaWYgKCFpc1N0cmluZyh1cGxvYWRJZE1hcmtlcikpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3VwbG9hZElkTWFya2VyIHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCInKVxuICAgIH1cbiAgICBpZiAoIWlzU3RyaW5nKGRlbGltaXRlcikpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2RlbGltaXRlciBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmluZ1wiJylcbiAgICB9XG4gICAgY29uc3QgcXVlcmllcyA9IFtdXG4gICAgcXVlcmllcy5wdXNoKGBwcmVmaXg9JHt1cmlFc2NhcGUocHJlZml4KX1gKVxuICAgIHF1ZXJpZXMucHVzaChgZGVsaW1pdGVyPSR7dXJpRXNjYXBlKGRlbGltaXRlcil9YClcblxuICAgIGlmIChrZXlNYXJrZXIpIHtcbiAgICAgIHF1ZXJpZXMucHVzaChga2V5LW1hcmtlcj0ke3VyaUVzY2FwZShrZXlNYXJrZXIpfWApXG4gICAgfVxuICAgIGlmICh1cGxvYWRJZE1hcmtlcikge1xuICAgICAgcXVlcmllcy5wdXNoKGB1cGxvYWQtaWQtbWFya2VyPSR7dXBsb2FkSWRNYXJrZXJ9YClcbiAgICB9XG5cbiAgICBjb25zdCBtYXhVcGxvYWRzID0gMTAwMFxuICAgIHF1ZXJpZXMucHVzaChgbWF4LXVwbG9hZHM9JHttYXhVcGxvYWRzfWApXG4gICAgcXVlcmllcy5zb3J0KClcbiAgICBxdWVyaWVzLnVuc2hpZnQoJ3VwbG9hZHMnKVxuICAgIGxldCBxdWVyeSA9ICcnXG4gICAgaWYgKHF1ZXJpZXMubGVuZ3RoID4gMCkge1xuICAgICAgcXVlcnkgPSBgJHtxdWVyaWVzLmpvaW4oJyYnKX1gXG4gICAgfVxuICAgIGNvbnN0IG1ldGhvZCA9ICdHRVQnXG4gICAgY29uc3QgcmVzID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jKHsgbWV0aG9kLCBidWNrZXROYW1lLCBxdWVyeSB9KVxuICAgIGNvbnN0IGJvZHkgPSBhd2FpdCByZWFkQXNTdHJpbmcocmVzKVxuICAgIHJldHVybiB4bWxQYXJzZXJzLnBhcnNlTGlzdE11bHRpcGFydChib2R5KVxuICB9XG5cbiAgLyoqXG4gICAqIEluaXRpYXRlIGEgbmV3IG11bHRpcGFydCB1cGxvYWQuXG4gICAqIEBpbnRlcm5hbFxuICAgKi9cbiAgYXN5bmMgaW5pdGlhdGVOZXdNdWx0aXBhcnRVcGxvYWQoYnVja2V0TmFtZTogc3RyaW5nLCBvYmplY3ROYW1lOiBzdHJpbmcsIGhlYWRlcnM6IFJlcXVlc3RIZWFkZXJzKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRPYmplY3ROYW1lRXJyb3IoYEludmFsaWQgb2JqZWN0IG5hbWU6ICR7b2JqZWN0TmFtZX1gKVxuICAgIH1cbiAgICBpZiAoIWlzT2JqZWN0KGhlYWRlcnMpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRPYmplY3ROYW1lRXJyb3IoJ2NvbnRlbnRUeXBlIHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxuICAgIH1cbiAgICBjb25zdCBtZXRob2QgPSAnUE9TVCdcbiAgICBjb25zdCBxdWVyeSA9ICd1cGxvYWRzJ1xuICAgIGNvbnN0IHJlcyA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luYyh7IG1ldGhvZCwgYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgcXVlcnksIGhlYWRlcnMgfSlcbiAgICBjb25zdCBib2R5ID0gYXdhaXQgcmVhZEFzQnVmZmVyKHJlcylcbiAgICByZXR1cm4gcGFyc2VJbml0aWF0ZU11bHRpcGFydChib2R5LnRvU3RyaW5nKCkpXG4gIH1cblxuICAvKipcbiAgICogSW50ZXJuYWwgTWV0aG9kIHRvIGFib3J0IGEgbXVsdGlwYXJ0IHVwbG9hZCByZXF1ZXN0IGluIGNhc2Ugb2YgYW55IGVycm9ycy5cbiAgICpcbiAgICogQHBhcmFtIGJ1Y2tldE5hbWUgLSBCdWNrZXQgTmFtZVxuICAgKiBAcGFyYW0gb2JqZWN0TmFtZSAtIE9iamVjdCBOYW1lXG4gICAqIEBwYXJhbSB1cGxvYWRJZCAtIGlkIG9mIGEgbXVsdGlwYXJ0IHVwbG9hZCB0byBjYW5jZWwgZHVyaW5nIGNvbXBvc2Ugb2JqZWN0IHNlcXVlbmNlLlxuICAgKi9cbiAgYXN5bmMgYWJvcnRNdWx0aXBhcnRVcGxvYWQoYnVja2V0TmFtZTogc3RyaW5nLCBvYmplY3ROYW1lOiBzdHJpbmcsIHVwbG9hZElkOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBtZXRob2QgPSAnREVMRVRFJ1xuICAgIGNvbnN0IHF1ZXJ5ID0gYHVwbG9hZElkPSR7dXBsb2FkSWR9YFxuXG4gICAgY29uc3QgcmVxdWVzdE9wdGlvbnMgPSB7IG1ldGhvZCwgYnVja2V0TmFtZSwgb2JqZWN0TmFtZTogb2JqZWN0TmFtZSwgcXVlcnkgfVxuICAgIGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luY09taXQocmVxdWVzdE9wdGlvbnMsICcnLCBbMjA0XSlcbiAgfVxuXG4gIGFzeW5jIGZpbmRVcGxvYWRJZChidWNrZXROYW1lOiBzdHJpbmcsIG9iamVjdE5hbWU6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nIHwgdW5kZWZpbmVkPiB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkT2JqZWN0TmFtZUVycm9yKGBJbnZhbGlkIG9iamVjdCBuYW1lOiAke29iamVjdE5hbWV9YClcbiAgICB9XG5cbiAgICBsZXQgbGF0ZXN0VXBsb2FkOiBMaXN0TXVsdGlwYXJ0UmVzdWx0Wyd1cGxvYWRzJ11bbnVtYmVyXSB8IHVuZGVmaW5lZFxuICAgIGxldCBrZXlNYXJrZXIgPSAnJ1xuICAgIGxldCB1cGxvYWRJZE1hcmtlciA9ICcnXG4gICAgZm9yICg7Oykge1xuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5saXN0SW5jb21wbGV0ZVVwbG9hZHNRdWVyeShidWNrZXROYW1lLCBvYmplY3ROYW1lLCBrZXlNYXJrZXIsIHVwbG9hZElkTWFya2VyLCAnJylcbiAgICAgIGZvciAoY29uc3QgdXBsb2FkIG9mIHJlc3VsdC51cGxvYWRzKSB7XG4gICAgICAgIGlmICh1cGxvYWQua2V5ID09PSBvYmplY3ROYW1lKSB7XG4gICAgICAgICAgaWYgKCFsYXRlc3RVcGxvYWQgfHwgdXBsb2FkLmluaXRpYXRlZC5nZXRUaW1lKCkgPiBsYXRlc3RVcGxvYWQuaW5pdGlhdGVkLmdldFRpbWUoKSkge1xuICAgICAgICAgICAgbGF0ZXN0VXBsb2FkID0gdXBsb2FkXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgICBpZiAocmVzdWx0LmlzVHJ1bmNhdGVkKSB7XG4gICAgICAgIGtleU1hcmtlciA9IHJlc3VsdC5uZXh0S2V5TWFya2VyXG4gICAgICAgIHVwbG9hZElkTWFya2VyID0gcmVzdWx0Lm5leHRVcGxvYWRJZE1hcmtlclxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBicmVha1xuICAgIH1cbiAgICByZXR1cm4gbGF0ZXN0VXBsb2FkPy51cGxvYWRJZFxuICB9XG5cbiAgLyoqXG4gICAqIHRoaXMgY2FsbCB3aWxsIGFnZ3JlZ2F0ZSB0aGUgcGFydHMgb24gdGhlIHNlcnZlciBpbnRvIGEgc2luZ2xlIG9iamVjdC5cbiAgICovXG4gIGFzeW5jIGNvbXBsZXRlTXVsdGlwYXJ0VXBsb2FkKFxuICAgIGJ1Y2tldE5hbWU6IHN0cmluZyxcbiAgICBvYmplY3ROYW1lOiBzdHJpbmcsXG4gICAgdXBsb2FkSWQ6IHN0cmluZyxcbiAgICBldGFnczoge1xuICAgICAgcGFydDogbnVtYmVyXG4gICAgICBldGFnPzogc3RyaW5nXG4gICAgfVtdLFxuICApOiBQcm9taXNlPHsgZXRhZzogc3RyaW5nOyB2ZXJzaW9uSWQ6IHN0cmluZyB8IG51bGwgfT4ge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmICghaXNWYWxpZE9iamVjdE5hbWUob2JqZWN0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZE9iamVjdE5hbWVFcnJvcihgSW52YWxpZCBvYmplY3QgbmFtZTogJHtvYmplY3ROYW1lfWApXG4gICAgfVxuICAgIGlmICghaXNTdHJpbmcodXBsb2FkSWQpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCd1cGxvYWRJZCBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmluZ1wiJylcbiAgICB9XG4gICAgaWYgKCFpc09iamVjdChldGFncykpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2V0YWdzIHNob3VsZCBiZSBvZiB0eXBlIFwiQXJyYXlcIicpXG4gICAgfVxuXG4gICAgaWYgKCF1cGxvYWRJZCkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcigndXBsb2FkSWQgY2Fubm90IGJlIGVtcHR5JylcbiAgICB9XG5cbiAgICBjb25zdCBtZXRob2QgPSAnUE9TVCdcbiAgICBjb25zdCBxdWVyeSA9IGB1cGxvYWRJZD0ke3VyaUVzY2FwZSh1cGxvYWRJZCl9YFxuXG4gICAgY29uc3QgYnVpbGRlciA9IG5ldyB4bWwyanMuQnVpbGRlcigpXG4gICAgY29uc3QgcGF5bG9hZCA9IGJ1aWxkZXIuYnVpbGRPYmplY3Qoe1xuICAgICAgQ29tcGxldGVNdWx0aXBhcnRVcGxvYWQ6IHtcbiAgICAgICAgJDoge1xuICAgICAgICAgIHhtbG5zOiAnaHR0cDovL3MzLmFtYXpvbmF3cy5jb20vZG9jLzIwMDYtMDMtMDEvJyxcbiAgICAgICAgfSxcbiAgICAgICAgUGFydDogZXRhZ3MubWFwKChldGFnKSA9PiB7XG4gICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIFBhcnROdW1iZXI6IGV0YWcucGFydCxcbiAgICAgICAgICAgIEVUYWc6IGV0YWcuZXRhZyxcbiAgICAgICAgICB9XG4gICAgICAgIH0pLFxuICAgICAgfSxcbiAgICB9KVxuXG4gICAgY29uc3QgcmVzID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jKHsgbWV0aG9kLCBidWNrZXROYW1lLCBvYmplY3ROYW1lLCBxdWVyeSB9LCBwYXlsb2FkKVxuICAgIGNvbnN0IGJvZHkgPSBhd2FpdCByZWFkQXNCdWZmZXIocmVzKVxuICAgIGNvbnN0IHJlc3VsdCA9IHBhcnNlQ29tcGxldGVNdWx0aXBhcnQoYm9keS50b1N0cmluZygpKVxuICAgIGlmICghcmVzdWx0KSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0JVRzogZmFpbGVkIHRvIHBhcnNlIHNlcnZlciByZXNwb25zZScpXG4gICAgfVxuXG4gICAgaWYgKHJlc3VsdC5lcnJDb2RlKSB7XG4gICAgICAvLyBNdWx0aXBhcnQgQ29tcGxldGUgQVBJIHJldHVybnMgYW4gZXJyb3IgWE1MIGFmdGVyIGEgMjAwIGh0dHAgc3RhdHVzXG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLlMzRXJyb3IocmVzdWx0LmVyck1lc3NhZ2UpXG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBAdHlwZXNjcmlwdC1lc2xpbnQvYmFuLXRzLWNvbW1lbnRcbiAgICAgIC8vIEB0cy1pZ25vcmVcbiAgICAgIGV0YWc6IHJlc3VsdC5ldGFnIGFzIHN0cmluZyxcbiAgICAgIHZlcnNpb25JZDogZ2V0VmVyc2lvbklkKHJlcy5oZWFkZXJzIGFzIFJlc3BvbnNlSGVhZGVyKSxcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogR2V0IHBhcnQtaW5mbyBvZiBhbGwgcGFydHMgb2YgYW4gaW5jb21wbGV0ZSB1cGxvYWQgc3BlY2lmaWVkIGJ5IHVwbG9hZElkLlxuICAgKi9cbiAgcHJvdGVjdGVkIGFzeW5jIGxpc3RQYXJ0cyhidWNrZXROYW1lOiBzdHJpbmcsIG9iamVjdE5hbWU6IHN0cmluZywgdXBsb2FkSWQ6IHN0cmluZyk6IFByb21pc2U8VXBsb2FkZWRQYXJ0W10+IHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRPYmplY3ROYW1lRXJyb3IoYEludmFsaWQgb2JqZWN0IG5hbWU6ICR7b2JqZWN0TmFtZX1gKVxuICAgIH1cbiAgICBpZiAoIWlzU3RyaW5nKHVwbG9hZElkKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigndXBsb2FkSWQgc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXG4gICAgfVxuICAgIGlmICghdXBsb2FkSWQpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ3VwbG9hZElkIGNhbm5vdCBiZSBlbXB0eScpXG4gICAgfVxuXG4gICAgY29uc3QgcGFydHM6IFVwbG9hZGVkUGFydFtdID0gW11cbiAgICBsZXQgbWFya2VyID0gMFxuICAgIGxldCByZXN1bHRcbiAgICBkbyB7XG4gICAgICByZXN1bHQgPSBhd2FpdCB0aGlzLmxpc3RQYXJ0c1F1ZXJ5KGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIHVwbG9hZElkLCBtYXJrZXIpXG4gICAgICBtYXJrZXIgPSByZXN1bHQubWFya2VyXG4gICAgICBwYXJ0cy5wdXNoKC4uLnJlc3VsdC5wYXJ0cylcbiAgICB9IHdoaWxlIChyZXN1bHQuaXNUcnVuY2F0ZWQpXG5cbiAgICByZXR1cm4gcGFydHNcbiAgfVxuXG4gIC8qKlxuICAgKiBDYWxsZWQgYnkgbGlzdFBhcnRzIHRvIGZldGNoIGEgYmF0Y2ggb2YgcGFydC1pbmZvXG4gICAqL1xuICBwcml2YXRlIGFzeW5jIGxpc3RQYXJ0c1F1ZXJ5KGJ1Y2tldE5hbWU6IHN0cmluZywgb2JqZWN0TmFtZTogc3RyaW5nLCB1cGxvYWRJZDogc3RyaW5nLCBtYXJrZXI6IG51bWJlcikge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmICghaXNWYWxpZE9iamVjdE5hbWUob2JqZWN0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZE9iamVjdE5hbWVFcnJvcihgSW52YWxpZCBvYmplY3QgbmFtZTogJHtvYmplY3ROYW1lfWApXG4gICAgfVxuICAgIGlmICghaXNTdHJpbmcodXBsb2FkSWQpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCd1cGxvYWRJZCBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmluZ1wiJylcbiAgICB9XG4gICAgaWYgKCFpc051bWJlcihtYXJrZXIpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdtYXJrZXIgc2hvdWxkIGJlIG9mIHR5cGUgXCJudW1iZXJcIicpXG4gICAgfVxuICAgIGlmICghdXBsb2FkSWQpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ3VwbG9hZElkIGNhbm5vdCBiZSBlbXB0eScpXG4gICAgfVxuXG4gICAgbGV0IHF1ZXJ5ID0gYHVwbG9hZElkPSR7dXJpRXNjYXBlKHVwbG9hZElkKX1gXG4gICAgaWYgKG1hcmtlcikge1xuICAgICAgcXVlcnkgKz0gYCZwYXJ0LW51bWJlci1tYXJrZXI9JHttYXJrZXJ9YFxuICAgIH1cblxuICAgIGNvbnN0IG1ldGhvZCA9ICdHRVQnXG4gICAgY29uc3QgcmVzID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jKHsgbWV0aG9kLCBidWNrZXROYW1lLCBvYmplY3ROYW1lLCBxdWVyeSB9KVxuICAgIHJldHVybiB4bWxQYXJzZXJzLnBhcnNlTGlzdFBhcnRzKGF3YWl0IHJlYWRBc1N0cmluZyhyZXMpKVxuICB9XG5cbiAgYXN5bmMgbGlzdEJ1Y2tldHMoKTogUHJvbWlzZTxCdWNrZXRJdGVtRnJvbUxpc3RbXT4ge1xuICAgIGNvbnN0IG1ldGhvZCA9ICdHRVQnXG4gICAgY29uc3QgcmVnaW9uQ29uZiA9IHRoaXMucmVnaW9uIHx8IERFRkFVTFRfUkVHSU9OXG4gICAgY29uc3QgaHR0cFJlcyA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luYyh7IG1ldGhvZCB9LCAnJywgWzIwMF0sIHJlZ2lvbkNvbmYpXG4gICAgY29uc3QgeG1sUmVzdWx0ID0gYXdhaXQgcmVhZEFzU3RyaW5nKGh0dHBSZXMpXG4gICAgcmV0dXJuIHhtbFBhcnNlcnMucGFyc2VMaXN0QnVja2V0KHhtbFJlc3VsdClcbiAgfVxuXG4gIC8qKlxuICAgKiBDYWxjdWxhdGUgcGFydCBzaXplIGdpdmVuIHRoZSBvYmplY3Qgc2l6ZS4gUGFydCBzaXplIHdpbGwgYmUgYXRsZWFzdCB0aGlzLnBhcnRTaXplXG4gICAqL1xuICBjYWxjdWxhdGVQYXJ0U2l6ZShzaXplOiBudW1iZXIpIHtcbiAgICBpZiAoIWlzTnVtYmVyKHNpemUpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdzaXplIHNob3VsZCBiZSBvZiB0eXBlIFwibnVtYmVyXCInKVxuICAgIH1cbiAgICBpZiAoc2l6ZSA+IHRoaXMubWF4T2JqZWN0U2l6ZSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihgc2l6ZSBzaG91bGQgbm90IGJlIG1vcmUgdGhhbiAke3RoaXMubWF4T2JqZWN0U2l6ZX1gKVxuICAgIH1cbiAgICBpZiAodGhpcy5vdmVyUmlkZVBhcnRTaXplKSB7XG4gICAgICByZXR1cm4gdGhpcy5wYXJ0U2l6ZVxuICAgIH1cbiAgICBsZXQgcGFydFNpemUgPSB0aGlzLnBhcnRTaXplXG4gICAgZm9yICg7Oykge1xuICAgICAgLy8gd2hpbGUodHJ1ZSkgey4uLn0gdGhyb3dzIGxpbnRpbmcgZXJyb3IuXG4gICAgICAvLyBJZiBwYXJ0U2l6ZSBpcyBiaWcgZW5vdWdoIHRvIGFjY29tb2RhdGUgdGhlIG9iamVjdCBzaXplLCB0aGVuIHVzZSBpdC5cbiAgICAgIGlmIChwYXJ0U2l6ZSAqIDEwMDAwID4gc2l6ZSkge1xuICAgICAgICByZXR1cm4gcGFydFNpemVcbiAgICAgIH1cbiAgICAgIC8vIFRyeSBwYXJ0IHNpemVzIGFzIDY0TUIsIDgwTUIsIDk2TUIgZXRjLlxuICAgICAgcGFydFNpemUgKz0gMTYgKiAxMDI0ICogMTAyNFxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBVcGxvYWRzIHRoZSBvYmplY3QgdXNpbmcgY29udGVudHMgZnJvbSBhIGZpbGVcbiAgICovXG4gIGFzeW5jIGZQdXRPYmplY3QoYnVja2V0TmFtZTogc3RyaW5nLCBvYmplY3ROYW1lOiBzdHJpbmcsIGZpbGVQYXRoOiBzdHJpbmcsIG1ldGFEYXRhPzogT2JqZWN0TWV0YURhdGEpIHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRPYmplY3ROYW1lRXJyb3IoYEludmFsaWQgb2JqZWN0IG5hbWU6ICR7b2JqZWN0TmFtZX1gKVxuICAgIH1cblxuICAgIGlmICghaXNTdHJpbmcoZmlsZVBhdGgpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdmaWxlUGF0aCBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmluZ1wiJylcbiAgICB9XG4gICAgaWYgKG1ldGFEYXRhICYmICFpc09iamVjdChtZXRhRGF0YSkpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ21ldGFEYXRhIHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxuICAgIH1cblxuICAgIC8vIEluc2VydHMgY29ycmVjdCBgY29udGVudC10eXBlYCBhdHRyaWJ1dGUgYmFzZWQgb24gbWV0YURhdGEgYW5kIGZpbGVQYXRoXG4gICAgbWV0YURhdGEgPSBpbnNlcnRDb250ZW50VHlwZShtZXRhRGF0YSB8fCB7fSwgZmlsZVBhdGgpXG4gICAgY29uc3Qgc3RhdCA9IGF3YWl0IGZzcC5zdGF0KGZpbGVQYXRoKVxuICAgIHJldHVybiBhd2FpdCB0aGlzLnB1dE9iamVjdChidWNrZXROYW1lLCBvYmplY3ROYW1lLCBmcy5jcmVhdGVSZWFkU3RyZWFtKGZpbGVQYXRoKSwgc3RhdC5zaXplLCBtZXRhRGF0YSlcbiAgfVxuXG4gIC8qKlxuICAgKiAgVXBsb2FkaW5nIGEgc3RyZWFtLCBcIkJ1ZmZlclwiIG9yIFwic3RyaW5nXCIuXG4gICAqICBJdCdzIHJlY29tbWVuZGVkIHRvIHBhc3MgYHNpemVgIGFyZ3VtZW50IHdpdGggc3RyZWFtLlxuICAgKi9cbiAgYXN5bmMgcHV0T2JqZWN0KFxuICAgIGJ1Y2tldE5hbWU6IHN0cmluZyxcbiAgICBvYmplY3ROYW1lOiBzdHJpbmcsXG4gICAgc3RyZWFtOiBzdHJlYW0uUmVhZGFibGUgfCBCdWZmZXIgfCBzdHJpbmcsXG4gICAgc2l6ZT86IG51bWJlcixcbiAgICBtZXRhRGF0YT86IEl0ZW1CdWNrZXRNZXRhZGF0YSxcbiAgKTogUHJvbWlzZTxVcGxvYWRlZE9iamVjdEluZm8+IHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoYEludmFsaWQgYnVja2V0IG5hbWU6ICR7YnVja2V0TmFtZX1gKVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRPYmplY3ROYW1lRXJyb3IoYEludmFsaWQgb2JqZWN0IG5hbWU6ICR7b2JqZWN0TmFtZX1gKVxuICAgIH1cblxuICAgIC8vIFdlJ2xsIG5lZWQgdG8gc2hpZnQgYXJndW1lbnRzIHRvIHRoZSBsZWZ0IGJlY2F1c2Ugb2YgbWV0YURhdGFcbiAgICAvLyBhbmQgc2l6ZSBiZWluZyBvcHRpb25hbC5cbiAgICBpZiAoaXNPYmplY3Qoc2l6ZSkpIHtcbiAgICAgIG1ldGFEYXRhID0gc2l6ZVxuICAgIH1cbiAgICAvLyBFbnN1cmVzIE1ldGFkYXRhIGhhcyBhcHByb3ByaWF0ZSBwcmVmaXggZm9yIEEzIEFQSVxuICAgIGNvbnN0IGhlYWRlcnMgPSBwcmVwZW5kWEFNWk1ldGEobWV0YURhdGEpXG4gICAgaWYgKHR5cGVvZiBzdHJlYW0gPT09ICdzdHJpbmcnIHx8IHN0cmVhbSBpbnN0YW5jZW9mIEJ1ZmZlcikge1xuICAgICAgLy8gQWRhcHRzIHRoZSBub24tc3RyZWFtIGludGVyZmFjZSBpbnRvIGEgc3RyZWFtLlxuICAgICAgc2l6ZSA9IHN0cmVhbS5sZW5ndGhcbiAgICAgIHN0cmVhbSA9IHJlYWRhYmxlU3RyZWFtKHN0cmVhbSlcbiAgICB9IGVsc2UgaWYgKCFpc1JlYWRhYmxlU3RyZWFtKHN0cmVhbSkpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3RoaXJkIGFyZ3VtZW50IHNob3VsZCBiZSBvZiB0eXBlIFwic3RyZWFtLlJlYWRhYmxlXCIgb3IgXCJCdWZmZXJcIiBvciBcInN0cmluZ1wiJylcbiAgICB9XG5cbiAgICBpZiAoaXNOdW1iZXIoc2l6ZSkgJiYgc2l6ZSA8IDApIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoYHNpemUgY2Fubm90IGJlIG5lZ2F0aXZlLCBnaXZlbiBzaXplOiAke3NpemV9YClcbiAgICB9XG5cbiAgICAvLyBHZXQgdGhlIHBhcnQgc2l6ZSBhbmQgZm9yd2FyZCB0aGF0IHRvIHRoZSBCbG9ja1N0cmVhbS4gRGVmYXVsdCB0byB0aGVcbiAgICAvLyBsYXJnZXN0IGJsb2NrIHNpemUgcG9zc2libGUgaWYgbmVjZXNzYXJ5LlxuICAgIGlmICghaXNOdW1iZXIoc2l6ZSkpIHtcbiAgICAgIHNpemUgPSB0aGlzLm1heE9iamVjdFNpemVcbiAgICB9XG5cbiAgICAvLyBHZXQgdGhlIHBhcnQgc2l6ZSBhbmQgZm9yd2FyZCB0aGF0IHRvIHRoZSBCbG9ja1N0cmVhbS4gRGVmYXVsdCB0byB0aGVcbiAgICAvLyBsYXJnZXN0IGJsb2NrIHNpemUgcG9zc2libGUgaWYgbmVjZXNzYXJ5LlxuICAgIGlmIChzaXplID09PSB1bmRlZmluZWQpIHtcbiAgICAgIGNvbnN0IHN0YXRTaXplID0gYXdhaXQgZ2V0Q29udGVudExlbmd0aChzdHJlYW0pXG4gICAgICBpZiAoc3RhdFNpemUgIT09IG51bGwpIHtcbiAgICAgICAgc2l6ZSA9IHN0YXRTaXplXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKCFpc051bWJlcihzaXplKSkge1xuICAgICAgLy8gQmFja3dhcmQgY29tcGF0aWJpbGl0eVxuICAgICAgc2l6ZSA9IHRoaXMubWF4T2JqZWN0U2l6ZVxuICAgIH1cbiAgICBpZiAoc2l6ZSA9PT0gMCkge1xuICAgICAgcmV0dXJuIHRoaXMudXBsb2FkQnVmZmVyKGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIGhlYWRlcnMsIEJ1ZmZlci5mcm9tKCcnKSlcbiAgICB9XG5cbiAgICBjb25zdCBwYXJ0U2l6ZSA9IHRoaXMuY2FsY3VsYXRlUGFydFNpemUoc2l6ZSlcbiAgICBpZiAodHlwZW9mIHN0cmVhbSA9PT0gJ3N0cmluZycgfHwgQnVmZmVyLmlzQnVmZmVyKHN0cmVhbSkgfHwgc2l6ZSA8PSBwYXJ0U2l6ZSkge1xuICAgICAgY29uc3QgYnVmID0gaXNSZWFkYWJsZVN0cmVhbShzdHJlYW0pID8gYXdhaXQgcmVhZEFzQnVmZmVyKHN0cmVhbSkgOiBCdWZmZXIuZnJvbShzdHJlYW0pXG4gICAgICByZXR1cm4gdGhpcy51cGxvYWRCdWZmZXIoYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgaGVhZGVycywgYnVmKVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLnVwbG9hZFN0cmVhbShidWNrZXROYW1lLCBvYmplY3ROYW1lLCBoZWFkZXJzLCBzdHJlYW0sIHBhcnRTaXplKVxuICB9XG5cbiAgLyoqXG4gICAqIG1ldGhvZCB0byB1cGxvYWQgYnVmZmVyIGluIG9uZSBjYWxsXG4gICAqIEBwcml2YXRlXG4gICAqL1xuICBwcml2YXRlIGFzeW5jIHVwbG9hZEJ1ZmZlcihcbiAgICBidWNrZXROYW1lOiBzdHJpbmcsXG4gICAgb2JqZWN0TmFtZTogc3RyaW5nLFxuICAgIGhlYWRlcnM6IFJlcXVlc3RIZWFkZXJzLFxuICAgIGJ1ZjogQnVmZmVyLFxuICApOiBQcm9taXNlPFVwbG9hZGVkT2JqZWN0SW5mbz4ge1xuICAgIGNvbnN0IHsgbWQ1c3VtLCBzaGEyNTZzdW0gfSA9IGhhc2hCaW5hcnkoYnVmLCB0aGlzLmVuYWJsZVNIQTI1NilcbiAgICBoZWFkZXJzWydDb250ZW50LUxlbmd0aCddID0gYnVmLmxlbmd0aFxuICAgIGlmICghdGhpcy5lbmFibGVTSEEyNTYpIHtcbiAgICAgIGhlYWRlcnNbJ0NvbnRlbnQtTUQ1J10gPSBtZDVzdW1cbiAgICB9XG4gICAgY29uc3QgcmVzID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdFN0cmVhbUFzeW5jKFxuICAgICAge1xuICAgICAgICBtZXRob2Q6ICdQVVQnLFxuICAgICAgICBidWNrZXROYW1lLFxuICAgICAgICBvYmplY3ROYW1lLFxuICAgICAgICBoZWFkZXJzLFxuICAgICAgfSxcbiAgICAgIGJ1ZixcbiAgICAgIHNoYTI1NnN1bSxcbiAgICAgIFsyMDBdLFxuICAgICAgJycsXG4gICAgKVxuICAgIGF3YWl0IGRyYWluUmVzcG9uc2UocmVzKVxuICAgIHJldHVybiB7XG4gICAgICBldGFnOiBzYW5pdGl6ZUVUYWcocmVzLmhlYWRlcnMuZXRhZyksXG4gICAgICB2ZXJzaW9uSWQ6IGdldFZlcnNpb25JZChyZXMuaGVhZGVycyBhcyBSZXNwb25zZUhlYWRlciksXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIHVwbG9hZCBzdHJlYW0gd2l0aCBNdWx0aXBhcnRVcGxvYWRcbiAgICogQHByaXZhdGVcbiAgICovXG4gIHByaXZhdGUgYXN5bmMgdXBsb2FkU3RyZWFtKFxuICAgIGJ1Y2tldE5hbWU6IHN0cmluZyxcbiAgICBvYmplY3ROYW1lOiBzdHJpbmcsXG4gICAgaGVhZGVyczogUmVxdWVzdEhlYWRlcnMsXG4gICAgYm9keTogc3RyZWFtLlJlYWRhYmxlLFxuICAgIHBhcnRTaXplOiBudW1iZXIsXG4gICk6IFByb21pc2U8VXBsb2FkZWRPYmplY3RJbmZvPiB7XG4gICAgLy8gQSBtYXAgb2YgdGhlIHByZXZpb3VzbHkgdXBsb2FkZWQgY2h1bmtzLCBmb3IgcmVzdW1pbmcgYSBmaWxlIHVwbG9hZC4gVGhpc1xuICAgIC8vIHdpbGwgYmUgbnVsbCBpZiB3ZSBhcmVuJ3QgcmVzdW1pbmcgYW4gdXBsb2FkLlxuICAgIGNvbnN0IG9sZFBhcnRzOiBSZWNvcmQ8bnVtYmVyLCBQYXJ0PiA9IHt9XG5cbiAgICAvLyBLZWVwIHRyYWNrIG9mIHRoZSBldGFncyBmb3IgYWdncmVnYXRpbmcgdGhlIGNodW5rcyB0b2dldGhlciBsYXRlci4gRWFjaFxuICAgIC8vIGV0YWcgcmVwcmVzZW50cyBhIHNpbmdsZSBjaHVuayBvZiB0aGUgZmlsZS5cbiAgICBjb25zdCBlVGFnczogUGFydFtdID0gW11cblxuICAgIGNvbnN0IHByZXZpb3VzVXBsb2FkSWQgPSBhd2FpdCB0aGlzLmZpbmRVcGxvYWRJZChidWNrZXROYW1lLCBvYmplY3ROYW1lKVxuICAgIGxldCB1cGxvYWRJZDogc3RyaW5nXG4gICAgaWYgKCFwcmV2aW91c1VwbG9hZElkKSB7XG4gICAgICB1cGxvYWRJZCA9IGF3YWl0IHRoaXMuaW5pdGlhdGVOZXdNdWx0aXBhcnRVcGxvYWQoYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgaGVhZGVycylcbiAgICB9IGVsc2Uge1xuICAgICAgdXBsb2FkSWQgPSBwcmV2aW91c1VwbG9hZElkXG4gICAgICBjb25zdCBvbGRUYWdzID0gYXdhaXQgdGhpcy5saXN0UGFydHMoYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgcHJldmlvdXNVcGxvYWRJZClcbiAgICAgIG9sZFRhZ3MuZm9yRWFjaCgoZSkgPT4ge1xuICAgICAgICBvbGRQYXJ0c1tlLnBhcnRdID0gZVxuICAgICAgfSlcbiAgICB9XG5cbiAgICBjb25zdCBjaHVua2llciA9IG5ldyBCbG9ja1N0cmVhbTIoeyBzaXplOiBwYXJ0U2l6ZSwgemVyb1BhZGRpbmc6IGZhbHNlIH0pXG5cbiAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgQHR5cGVzY3JpcHQtZXNsaW50L25vLXVudXNlZC12YXJzXG4gICAgY29uc3QgW18sIG9dID0gYXdhaXQgUHJvbWlzZS5hbGwoW1xuICAgICAgbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgICBib2R5LnBpcGUoY2h1bmtpZXIpLm9uKCdlcnJvcicsIHJlamVjdClcbiAgICAgICAgY2h1bmtpZXIub24oJ2VuZCcsIHJlc29sdmUpLm9uKCdlcnJvcicsIHJlamVjdClcbiAgICAgIH0pLFxuICAgICAgKGFzeW5jICgpID0+IHtcbiAgICAgICAgbGV0IHBhcnROdW1iZXIgPSAxXG5cbiAgICAgICAgZm9yIGF3YWl0IChjb25zdCBjaHVuayBvZiBjaHVua2llcikge1xuICAgICAgICAgIGNvbnN0IG1kNSA9IGNyeXB0by5jcmVhdGVIYXNoKCdtZDUnKS51cGRhdGUoY2h1bmspLmRpZ2VzdCgpXG5cbiAgICAgICAgICBjb25zdCBvbGRQYXJ0ID0gb2xkUGFydHNbcGFydE51bWJlcl1cbiAgICAgICAgICBpZiAob2xkUGFydCkge1xuICAgICAgICAgICAgaWYgKG9sZFBhcnQuZXRhZyA9PT0gbWQ1LnRvU3RyaW5nKCdoZXgnKSkge1xuICAgICAgICAgICAgICBlVGFncy5wdXNoKHsgcGFydDogcGFydE51bWJlciwgZXRhZzogb2xkUGFydC5ldGFnIH0pXG4gICAgICAgICAgICAgIHBhcnROdW1iZXIrK1xuICAgICAgICAgICAgICBjb250aW51ZVxuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cblxuICAgICAgICAgIHBhcnROdW1iZXIrK1xuXG4gICAgICAgICAgLy8gbm93IHN0YXJ0IHRvIHVwbG9hZCBtaXNzaW5nIHBhcnRcbiAgICAgICAgICBjb25zdCBvcHRpb25zOiBSZXF1ZXN0T3B0aW9uID0ge1xuICAgICAgICAgICAgbWV0aG9kOiAnUFVUJyxcbiAgICAgICAgICAgIHF1ZXJ5OiBxcy5zdHJpbmdpZnkoeyBwYXJ0TnVtYmVyLCB1cGxvYWRJZCB9KSxcbiAgICAgICAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgICAgICAgJ0NvbnRlbnQtTGVuZ3RoJzogY2h1bmsubGVuZ3RoLFxuICAgICAgICAgICAgICAnQ29udGVudC1NRDUnOiBtZDUudG9TdHJpbmcoJ2Jhc2U2NCcpLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGJ1Y2tldE5hbWUsXG4gICAgICAgICAgICBvYmplY3ROYW1lLFxuICAgICAgICAgIH1cblxuICAgICAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jT21pdChvcHRpb25zLCBjaHVuaylcblxuICAgICAgICAgIGxldCBldGFnID0gcmVzcG9uc2UuaGVhZGVycy5ldGFnXG4gICAgICAgICAgaWYgKGV0YWcpIHtcbiAgICAgICAgICAgIGV0YWcgPSBldGFnLnJlcGxhY2UoL15cIi8sICcnKS5yZXBsYWNlKC9cIiQvLCAnJylcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgZXRhZyA9ICcnXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgZVRhZ3MucHVzaCh7IHBhcnQ6IHBhcnROdW1iZXIsIGV0YWcgfSlcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBhd2FpdCB0aGlzLmNvbXBsZXRlTXVsdGlwYXJ0VXBsb2FkKGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIHVwbG9hZElkLCBlVGFncylcbiAgICAgIH0pKCksXG4gICAgXSlcblxuICAgIHJldHVybiBvXG4gIH1cblxuICBhc3luYyByZW1vdmVCdWNrZXRSZXBsaWNhdGlvbihidWNrZXROYW1lOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+XG4gIHJlbW92ZUJ1Y2tldFJlcGxpY2F0aW9uKGJ1Y2tldE5hbWU6IHN0cmluZywgY2FsbGJhY2s6IE5vUmVzdWx0Q2FsbGJhY2spOiB2b2lkXG4gIGFzeW5jIHJlbW92ZUJ1Y2tldFJlcGxpY2F0aW9uKGJ1Y2tldE5hbWU6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGNvbnN0IG1ldGhvZCA9ICdERUxFVEUnXG4gICAgY29uc3QgcXVlcnkgPSAncmVwbGljYXRpb24nXG4gICAgYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jT21pdCh7IG1ldGhvZCwgYnVja2V0TmFtZSwgcXVlcnkgfSwgJycsIFsyMDAsIDIwNF0sICcnKVxuICB9XG5cbiAgc2V0QnVja2V0UmVwbGljYXRpb24oYnVja2V0TmFtZTogc3RyaW5nLCByZXBsaWNhdGlvbkNvbmZpZzogUmVwbGljYXRpb25Db25maWdPcHRzKTogdm9pZFxuICBhc3luYyBzZXRCdWNrZXRSZXBsaWNhdGlvbihidWNrZXROYW1lOiBzdHJpbmcsIHJlcGxpY2F0aW9uQ29uZmlnOiBSZXBsaWNhdGlvbkNvbmZpZ09wdHMpOiBQcm9taXNlPHZvaWQ+XG4gIGFzeW5jIHNldEJ1Y2tldFJlcGxpY2F0aW9uKGJ1Y2tldE5hbWU6IHN0cmluZywgcmVwbGljYXRpb25Db25maWc6IFJlcGxpY2F0aW9uQ29uZmlnT3B0cykge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmICghaXNPYmplY3QocmVwbGljYXRpb25Db25maWcpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCdyZXBsaWNhdGlvbkNvbmZpZyBzaG91bGQgYmUgb2YgdHlwZSBcIm9iamVjdFwiJylcbiAgICB9IGVsc2Uge1xuICAgICAgaWYgKF8uaXNFbXB0eShyZXBsaWNhdGlvbkNvbmZpZy5yb2xlKSkge1xuICAgICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCdSb2xlIGNhbm5vdCBiZSBlbXB0eScpXG4gICAgICB9IGVsc2UgaWYgKHJlcGxpY2F0aW9uQ29uZmlnLnJvbGUgJiYgIWlzU3RyaW5nKHJlcGxpY2F0aW9uQ29uZmlnLnJvbGUpKSB7XG4gICAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ0ludmFsaWQgdmFsdWUgZm9yIHJvbGUnLCByZXBsaWNhdGlvbkNvbmZpZy5yb2xlKVxuICAgICAgfVxuICAgICAgaWYgKF8uaXNFbXB0eShyZXBsaWNhdGlvbkNvbmZpZy5ydWxlcykpIHtcbiAgICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcignTWluaW11bSBvbmUgcmVwbGljYXRpb24gcnVsZSBtdXN0IGJlIHNwZWNpZmllZCcpXG4gICAgICB9XG4gICAgfVxuICAgIGNvbnN0IG1ldGhvZCA9ICdQVVQnXG4gICAgY29uc3QgcXVlcnkgPSAncmVwbGljYXRpb24nXG4gICAgY29uc3QgaGVhZGVyczogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHt9XG5cbiAgICBjb25zdCByZXBsaWNhdGlvblBhcmFtc0NvbmZpZyA9IHtcbiAgICAgIFJlcGxpY2F0aW9uQ29uZmlndXJhdGlvbjoge1xuICAgICAgICBSb2xlOiByZXBsaWNhdGlvbkNvbmZpZy5yb2xlLFxuICAgICAgICBSdWxlOiByZXBsaWNhdGlvbkNvbmZpZy5ydWxlcyxcbiAgICAgIH0sXG4gICAgfVxuXG4gICAgY29uc3QgYnVpbGRlciA9IG5ldyB4bWwyanMuQnVpbGRlcih7IHJlbmRlck9wdHM6IHsgcHJldHR5OiBmYWxzZSB9LCBoZWFkbGVzczogdHJ1ZSB9KVxuICAgIGNvbnN0IHBheWxvYWQgPSBidWlsZGVyLmJ1aWxkT2JqZWN0KHJlcGxpY2F0aW9uUGFyYW1zQ29uZmlnKVxuICAgIGhlYWRlcnNbJ0NvbnRlbnQtTUQ1J10gPSB0b01kNShwYXlsb2FkKVxuICAgIGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luY09taXQoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIHF1ZXJ5LCBoZWFkZXJzIH0sIHBheWxvYWQpXG4gIH1cblxuICBnZXRCdWNrZXRSZXBsaWNhdGlvbihidWNrZXROYW1lOiBzdHJpbmcpOiB2b2lkXG4gIGFzeW5jIGdldEJ1Y2tldFJlcGxpY2F0aW9uKGJ1Y2tldE5hbWU6IHN0cmluZyk6IFByb21pc2U8UmVwbGljYXRpb25Db25maWc+XG4gIGFzeW5jIGdldEJ1Y2tldFJlcGxpY2F0aW9uKGJ1Y2tldE5hbWU6IHN0cmluZykge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGNvbnN0IG1ldGhvZCA9ICdHRVQnXG4gICAgY29uc3QgcXVlcnkgPSAncmVwbGljYXRpb24nXG5cbiAgICBjb25zdCBodHRwUmVzID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jKHsgbWV0aG9kLCBidWNrZXROYW1lLCBxdWVyeSB9LCAnJywgWzIwMCwgMjA0XSlcbiAgICBjb25zdCB4bWxSZXN1bHQgPSBhd2FpdCByZWFkQXNTdHJpbmcoaHR0cFJlcylcbiAgICByZXR1cm4geG1sUGFyc2Vycy5wYXJzZVJlcGxpY2F0aW9uQ29uZmlnKHhtbFJlc3VsdClcbiAgfVxuXG4gIGdldE9iamVjdExlZ2FsSG9sZChcbiAgICBidWNrZXROYW1lOiBzdHJpbmcsXG4gICAgb2JqZWN0TmFtZTogc3RyaW5nLFxuICAgIGdldE9wdHM/OiBHZXRPYmplY3RMZWdhbEhvbGRPcHRpb25zLFxuICAgIGNhbGxiYWNrPzogUmVzdWx0Q2FsbGJhY2s8TEVHQUxfSE9MRF9TVEFUVVM+LFxuICApOiBQcm9taXNlPExFR0FMX0hPTERfU1RBVFVTPlxuICBhc3luYyBnZXRPYmplY3RMZWdhbEhvbGQoXG4gICAgYnVja2V0TmFtZTogc3RyaW5nLFxuICAgIG9iamVjdE5hbWU6IHN0cmluZyxcbiAgICBnZXRPcHRzPzogR2V0T2JqZWN0TGVnYWxIb2xkT3B0aW9ucyxcbiAgKTogUHJvbWlzZTxMRUdBTF9IT0xEX1NUQVRVUz4ge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmICghaXNWYWxpZE9iamVjdE5hbWUob2JqZWN0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZE9iamVjdE5hbWVFcnJvcihgSW52YWxpZCBvYmplY3QgbmFtZTogJHtvYmplY3ROYW1lfWApXG4gICAgfVxuXG4gICAgaWYgKGdldE9wdHMpIHtcbiAgICAgIGlmICghaXNPYmplY3QoZ2V0T3B0cykpIHtcbiAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignZ2V0T3B0cyBzaG91bGQgYmUgb2YgdHlwZSBcIk9iamVjdFwiJylcbiAgICAgIH0gZWxzZSBpZiAoT2JqZWN0LmtleXMoZ2V0T3B0cykubGVuZ3RoID4gMCAmJiBnZXRPcHRzLnZlcnNpb25JZCAmJiAhaXNTdHJpbmcoZ2V0T3B0cy52ZXJzaW9uSWQpKSB7XG4gICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3ZlcnNpb25JZCBzaG91bGQgYmUgb2YgdHlwZSBzdHJpbmcuOicsIGdldE9wdHMudmVyc2lvbklkKVxuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IG1ldGhvZCA9ICdHRVQnXG4gICAgbGV0IHF1ZXJ5ID0gJ2xlZ2FsLWhvbGQnXG5cbiAgICBpZiAoZ2V0T3B0cz8udmVyc2lvbklkKSB7XG4gICAgICBxdWVyeSArPSBgJnZlcnNpb25JZD0ke2dldE9wdHMudmVyc2lvbklkfWBcbiAgICB9XG5cbiAgICBjb25zdCBodHRwUmVzID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jKHsgbWV0aG9kLCBidWNrZXROYW1lLCBvYmplY3ROYW1lLCBxdWVyeSB9LCAnJywgWzIwMF0pXG4gICAgY29uc3Qgc3RyUmVzID0gYXdhaXQgcmVhZEFzU3RyaW5nKGh0dHBSZXMpXG4gICAgcmV0dXJuIHBhcnNlT2JqZWN0TGVnYWxIb2xkQ29uZmlnKHN0clJlcylcbiAgfVxuXG4gIHNldE9iamVjdExlZ2FsSG9sZChidWNrZXROYW1lOiBzdHJpbmcsIG9iamVjdE5hbWU6IHN0cmluZywgc2V0T3B0cz86IFB1dE9iamVjdExlZ2FsSG9sZE9wdGlvbnMpOiB2b2lkXG4gIGFzeW5jIHNldE9iamVjdExlZ2FsSG9sZChcbiAgICBidWNrZXROYW1lOiBzdHJpbmcsXG4gICAgb2JqZWN0TmFtZTogc3RyaW5nLFxuICAgIHNldE9wdHMgPSB7XG4gICAgICBzdGF0dXM6IExFR0FMX0hPTERfU1RBVFVTLkVOQUJMRUQsXG4gICAgfSBhcyBQdXRPYmplY3RMZWdhbEhvbGRPcHRpb25zLFxuICApOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRPYmplY3ROYW1lRXJyb3IoYEludmFsaWQgb2JqZWN0IG5hbWU6ICR7b2JqZWN0TmFtZX1gKVxuICAgIH1cblxuICAgIGlmICghaXNPYmplY3Qoc2V0T3B0cykpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3NldE9wdHMgc2hvdWxkIGJlIG9mIHR5cGUgXCJPYmplY3RcIicpXG4gICAgfSBlbHNlIHtcbiAgICAgIGlmICghW0xFR0FMX0hPTERfU1RBVFVTLkVOQUJMRUQsIExFR0FMX0hPTERfU1RBVFVTLkRJU0FCTEVEXS5pbmNsdWRlcyhzZXRPcHRzPy5zdGF0dXMpKSB7XG4gICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ0ludmFsaWQgc3RhdHVzOiAnICsgc2V0T3B0cy5zdGF0dXMpXG4gICAgICB9XG4gICAgICBpZiAoc2V0T3B0cy52ZXJzaW9uSWQgJiYgIXNldE9wdHMudmVyc2lvbklkLmxlbmd0aCkge1xuICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCd2ZXJzaW9uSWQgc2hvdWxkIGJlIG9mIHR5cGUgc3RyaW5nLjonICsgc2V0T3B0cy52ZXJzaW9uSWQpXG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3QgbWV0aG9kID0gJ1BVVCdcbiAgICBsZXQgcXVlcnkgPSAnbGVnYWwtaG9sZCdcblxuICAgIGlmIChzZXRPcHRzLnZlcnNpb25JZCkge1xuICAgICAgcXVlcnkgKz0gYCZ2ZXJzaW9uSWQ9JHtzZXRPcHRzLnZlcnNpb25JZH1gXG4gICAgfVxuXG4gICAgY29uc3QgY29uZmlnID0ge1xuICAgICAgU3RhdHVzOiBzZXRPcHRzLnN0YXR1cyxcbiAgICB9XG5cbiAgICBjb25zdCBidWlsZGVyID0gbmV3IHhtbDJqcy5CdWlsZGVyKHsgcm9vdE5hbWU6ICdMZWdhbEhvbGQnLCByZW5kZXJPcHRzOiB7IHByZXR0eTogZmFsc2UgfSwgaGVhZGxlc3M6IHRydWUgfSlcbiAgICBjb25zdCBwYXlsb2FkID0gYnVpbGRlci5idWlsZE9iamVjdChjb25maWcpXG4gICAgY29uc3QgaGVhZGVyczogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHt9XG4gICAgaGVhZGVyc1snQ29udGVudC1NRDUnXSA9IHRvTWQ1KHBheWxvYWQpXG5cbiAgICBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmNPbWl0KHsgbWV0aG9kLCBidWNrZXROYW1lLCBvYmplY3ROYW1lLCBxdWVyeSwgaGVhZGVycyB9LCBwYXlsb2FkKVxuICB9XG5cbiAgLyoqXG4gICAqIEdldCBUYWdzIGFzc29jaWF0ZWQgd2l0aCBhIEJ1Y2tldFxuICAgKi9cbiAgYXN5bmMgZ2V0QnVja2V0VGFnZ2luZyhidWNrZXROYW1lOiBzdHJpbmcpOiBQcm9taXNlPFRhZ1tdPiB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKGBJbnZhbGlkIGJ1Y2tldCBuYW1lOiAke2J1Y2tldE5hbWV9YClcbiAgICB9XG5cbiAgICBjb25zdCBtZXRob2QgPSAnR0VUJ1xuICAgIGNvbnN0IHF1ZXJ5ID0gJ3RhZ2dpbmcnXG4gICAgY29uc3QgcmVxdWVzdE9wdGlvbnMgPSB7IG1ldGhvZCwgYnVja2V0TmFtZSwgcXVlcnkgfVxuXG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmMocmVxdWVzdE9wdGlvbnMpXG4gICAgY29uc3QgYm9keSA9IGF3YWl0IHJlYWRBc1N0cmluZyhyZXNwb25zZSlcbiAgICByZXR1cm4geG1sUGFyc2Vycy5wYXJzZVRhZ2dpbmcoYm9keSlcbiAgfVxuXG4gIC8qKlxuICAgKiAgR2V0IHRoZSB0YWdzIGFzc29jaWF0ZWQgd2l0aCBhIGJ1Y2tldCBPUiBhbiBvYmplY3RcbiAgICovXG4gIGFzeW5jIGdldE9iamVjdFRhZ2dpbmcoYnVja2V0TmFtZTogc3RyaW5nLCBvYmplY3ROYW1lOiBzdHJpbmcsIGdldE9wdHM/OiBHZXRPYmplY3RPcHRzKTogUHJvbWlzZTxUYWdbXT4ge1xuICAgIGNvbnN0IG1ldGhvZCA9ICdHRVQnXG4gICAgbGV0IHF1ZXJ5ID0gJ3RhZ2dpbmcnXG5cbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgb2JqZWN0IG5hbWU6ICcgKyBvYmplY3ROYW1lKVxuICAgIH1cbiAgICBpZiAoZ2V0T3B0cyAmJiAhaXNPYmplY3QoZ2V0T3B0cykpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ2dldE9wdHMgc2hvdWxkIGJlIG9mIHR5cGUgXCJvYmplY3RcIicpXG4gICAgfVxuXG4gICAgaWYgKGdldE9wdHMgJiYgZ2V0T3B0cy52ZXJzaW9uSWQpIHtcbiAgICAgIHF1ZXJ5ID0gYCR7cXVlcnl9JnZlcnNpb25JZD0ke2dldE9wdHMudmVyc2lvbklkfWBcbiAgICB9XG4gICAgY29uc3QgcmVxdWVzdE9wdGlvbnM6IFJlcXVlc3RPcHRpb24gPSB7IG1ldGhvZCwgYnVja2V0TmFtZSwgcXVlcnkgfVxuICAgIGlmIChvYmplY3ROYW1lKSB7XG4gICAgICByZXF1ZXN0T3B0aW9uc1snb2JqZWN0TmFtZSddID0gb2JqZWN0TmFtZVxuICAgIH1cblxuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jKHJlcXVlc3RPcHRpb25zKVxuICAgIGNvbnN0IGJvZHkgPSBhd2FpdCByZWFkQXNTdHJpbmcocmVzcG9uc2UpXG4gICAgcmV0dXJuIHhtbFBhcnNlcnMucGFyc2VUYWdnaW5nKGJvZHkpXG4gIH1cblxuICAvKipcbiAgICogIFNldCB0aGUgcG9saWN5IG9uIGEgYnVja2V0IG9yIGFuIG9iamVjdCBwcmVmaXguXG4gICAqL1xuICBhc3luYyBzZXRCdWNrZXRQb2xpY3koYnVja2V0TmFtZTogc3RyaW5nLCBwb2xpY3k6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIC8vIFZhbGlkYXRlIGFyZ3VtZW50cy5cbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoYEludmFsaWQgYnVja2V0IG5hbWU6ICR7YnVja2V0TmFtZX1gKVxuICAgIH1cbiAgICBpZiAoIWlzU3RyaW5nKHBvbGljeSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldFBvbGljeUVycm9yKGBJbnZhbGlkIGJ1Y2tldCBwb2xpY3k6ICR7cG9saWN5fSAtIG11c3QgYmUgXCJzdHJpbmdcImApXG4gICAgfVxuXG4gICAgY29uc3QgcXVlcnkgPSAncG9saWN5J1xuXG4gICAgbGV0IG1ldGhvZCA9ICdERUxFVEUnXG4gICAgaWYgKHBvbGljeSkge1xuICAgICAgbWV0aG9kID0gJ1BVVCdcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmNPbWl0KHsgbWV0aG9kLCBidWNrZXROYW1lLCBxdWVyeSB9LCBwb2xpY3ksIFsyMDRdLCAnJylcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXQgdGhlIHBvbGljeSBvbiBhIGJ1Y2tldCBvciBhbiBvYmplY3QgcHJlZml4LlxuICAgKi9cbiAgYXN5bmMgZ2V0QnVja2V0UG9saWN5KGJ1Y2tldE5hbWU6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nPiB7XG4gICAgLy8gVmFsaWRhdGUgYXJndW1lbnRzLlxuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcihgSW52YWxpZCBidWNrZXQgbmFtZTogJHtidWNrZXROYW1lfWApXG4gICAgfVxuXG4gICAgY29uc3QgbWV0aG9kID0gJ0dFVCdcbiAgICBjb25zdCBxdWVyeSA9ICdwb2xpY3knXG4gICAgY29uc3QgcmVzID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jKHsgbWV0aG9kLCBidWNrZXROYW1lLCBxdWVyeSB9KVxuICAgIHJldHVybiBhd2FpdCByZWFkQXNTdHJpbmcocmVzKVxuICB9XG5cbiAgYXN5bmMgcHV0T2JqZWN0UmV0ZW50aW9uKGJ1Y2tldE5hbWU6IHN0cmluZywgb2JqZWN0TmFtZTogc3RyaW5nLCByZXRlbnRpb25PcHRzOiBSZXRlbnRpb24gPSB7fSk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcihgSW52YWxpZCBidWNrZXQgbmFtZTogJHtidWNrZXROYW1lfWApXG4gICAgfVxuICAgIGlmICghaXNWYWxpZE9iamVjdE5hbWUob2JqZWN0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZE9iamVjdE5hbWVFcnJvcihgSW52YWxpZCBvYmplY3QgbmFtZTogJHtvYmplY3ROYW1lfWApXG4gICAgfVxuICAgIGlmICghaXNPYmplY3QocmV0ZW50aW9uT3B0cykpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ3JldGVudGlvbk9wdHMgc2hvdWxkIGJlIG9mIHR5cGUgXCJvYmplY3RcIicpXG4gICAgfSBlbHNlIHtcbiAgICAgIGlmIChyZXRlbnRpb25PcHRzLmdvdmVybmFuY2VCeXBhc3MgJiYgIWlzQm9vbGVhbihyZXRlbnRpb25PcHRzLmdvdmVybmFuY2VCeXBhc3MpKSB7XG4gICAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoYEludmFsaWQgdmFsdWUgZm9yIGdvdmVybmFuY2VCeXBhc3M6ICR7cmV0ZW50aW9uT3B0cy5nb3Zlcm5hbmNlQnlwYXNzfWApXG4gICAgICB9XG4gICAgICBpZiAoXG4gICAgICAgIHJldGVudGlvbk9wdHMubW9kZSAmJlxuICAgICAgICAhW1JFVEVOVElPTl9NT0RFUy5DT01QTElBTkNFLCBSRVRFTlRJT05fTU9ERVMuR09WRVJOQU5DRV0uaW5jbHVkZXMocmV0ZW50aW9uT3B0cy5tb2RlKVxuICAgICAgKSB7XG4gICAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoYEludmFsaWQgb2JqZWN0IHJldGVudGlvbiBtb2RlOiAke3JldGVudGlvbk9wdHMubW9kZX1gKVxuICAgICAgfVxuICAgICAgaWYgKHJldGVudGlvbk9wdHMucmV0YWluVW50aWxEYXRlICYmICFpc1N0cmluZyhyZXRlbnRpb25PcHRzLnJldGFpblVudGlsRGF0ZSkpIHtcbiAgICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcihgSW52YWxpZCB2YWx1ZSBmb3IgcmV0YWluVW50aWxEYXRlOiAke3JldGVudGlvbk9wdHMucmV0YWluVW50aWxEYXRlfWApXG4gICAgICB9XG4gICAgICBpZiAocmV0ZW50aW9uT3B0cy52ZXJzaW9uSWQgJiYgIWlzU3RyaW5nKHJldGVudGlvbk9wdHMudmVyc2lvbklkKSkge1xuICAgICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKGBJbnZhbGlkIHZhbHVlIGZvciB2ZXJzaW9uSWQ6ICR7cmV0ZW50aW9uT3B0cy52ZXJzaW9uSWR9YClcbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCBtZXRob2QgPSAnUFVUJ1xuICAgIGxldCBxdWVyeSA9ICdyZXRlbnRpb24nXG5cbiAgICBjb25zdCBoZWFkZXJzOiBSZXF1ZXN0SGVhZGVycyA9IHt9XG4gICAgaWYgKHJldGVudGlvbk9wdHMuZ292ZXJuYW5jZUJ5cGFzcykge1xuICAgICAgaGVhZGVyc1snWC1BbXotQnlwYXNzLUdvdmVybmFuY2UtUmV0ZW50aW9uJ10gPSB0cnVlXG4gICAgfVxuXG4gICAgY29uc3QgYnVpbGRlciA9IG5ldyB4bWwyanMuQnVpbGRlcih7IHJvb3ROYW1lOiAnUmV0ZW50aW9uJywgcmVuZGVyT3B0czogeyBwcmV0dHk6IGZhbHNlIH0sIGhlYWRsZXNzOiB0cnVlIH0pXG4gICAgY29uc3QgcGFyYW1zOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge31cblxuICAgIGlmIChyZXRlbnRpb25PcHRzLm1vZGUpIHtcbiAgICAgIHBhcmFtcy5Nb2RlID0gcmV0ZW50aW9uT3B0cy5tb2RlXG4gICAgfVxuICAgIGlmIChyZXRlbnRpb25PcHRzLnJldGFpblVudGlsRGF0ZSkge1xuICAgICAgcGFyYW1zLlJldGFpblVudGlsRGF0ZSA9IHJldGVudGlvbk9wdHMucmV0YWluVW50aWxEYXRlXG4gICAgfVxuICAgIGlmIChyZXRlbnRpb25PcHRzLnZlcnNpb25JZCkge1xuICAgICAgcXVlcnkgKz0gYCZ2ZXJzaW9uSWQ9JHtyZXRlbnRpb25PcHRzLnZlcnNpb25JZH1gXG4gICAgfVxuXG4gICAgY29uc3QgcGF5bG9hZCA9IGJ1aWxkZXIuYnVpbGRPYmplY3QocGFyYW1zKVxuXG4gICAgaGVhZGVyc1snQ29udGVudC1NRDUnXSA9IHRvTWQ1KHBheWxvYWQpXG4gICAgYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jT21pdCh7IG1ldGhvZCwgYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgcXVlcnksIGhlYWRlcnMgfSwgcGF5bG9hZCwgWzIwMCwgMjA0XSlcbiAgfVxuXG4gIGdldE9iamVjdExvY2tDb25maWcoYnVja2V0TmFtZTogc3RyaW5nLCBjYWxsYmFjazogUmVzdWx0Q2FsbGJhY2s8T2JqZWN0TG9ja0luZm8+KTogdm9pZFxuICBnZXRPYmplY3RMb2NrQ29uZmlnKGJ1Y2tldE5hbWU6IHN0cmluZyk6IHZvaWRcbiAgYXN5bmMgZ2V0T2JqZWN0TG9ja0NvbmZpZyhidWNrZXROYW1lOiBzdHJpbmcpOiBQcm9taXNlPE9iamVjdExvY2tJbmZvPlxuICBhc3luYyBnZXRPYmplY3RMb2NrQ29uZmlnKGJ1Y2tldE5hbWU6IHN0cmluZykge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGNvbnN0IG1ldGhvZCA9ICdHRVQnXG4gICAgY29uc3QgcXVlcnkgPSAnb2JqZWN0LWxvY2snXG5cbiAgICBjb25zdCBodHRwUmVzID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jKHsgbWV0aG9kLCBidWNrZXROYW1lLCBxdWVyeSB9KVxuICAgIGNvbnN0IHhtbFJlc3VsdCA9IGF3YWl0IHJlYWRBc1N0cmluZyhodHRwUmVzKVxuICAgIHJldHVybiB4bWxQYXJzZXJzLnBhcnNlT2JqZWN0TG9ja0NvbmZpZyh4bWxSZXN1bHQpXG4gIH1cblxuICBzZXRPYmplY3RMb2NrQ29uZmlnKGJ1Y2tldE5hbWU6IHN0cmluZywgbG9ja0NvbmZpZ09wdHM6IE9taXQ8T2JqZWN0TG9ja0luZm8sICdvYmplY3RMb2NrRW5hYmxlZCc+KTogdm9pZFxuICBhc3luYyBzZXRPYmplY3RMb2NrQ29uZmlnKFxuICAgIGJ1Y2tldE5hbWU6IHN0cmluZyxcbiAgICBsb2NrQ29uZmlnT3B0czogT21pdDxPYmplY3RMb2NrSW5mbywgJ29iamVjdExvY2tFbmFibGVkJz4sXG4gICk6IFByb21pc2U8dm9pZD5cbiAgYXN5bmMgc2V0T2JqZWN0TG9ja0NvbmZpZyhidWNrZXROYW1lOiBzdHJpbmcsIGxvY2tDb25maWdPcHRzOiBPbWl0PE9iamVjdExvY2tJbmZvLCAnb2JqZWN0TG9ja0VuYWJsZWQnPikge1xuICAgIGNvbnN0IHJldGVudGlvbk1vZGVzID0gW1JFVEVOVElPTl9NT0RFUy5DT01QTElBTkNFLCBSRVRFTlRJT05fTU9ERVMuR09WRVJOQU5DRV1cbiAgICBjb25zdCB2YWxpZFVuaXRzID0gW1JFVEVOVElPTl9WQUxJRElUWV9VTklUUy5EQVlTLCBSRVRFTlRJT05fVkFMSURJVFlfVU5JVFMuWUVBUlNdXG5cbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cblxuICAgIGlmIChsb2NrQ29uZmlnT3B0cy5tb2RlICYmICFyZXRlbnRpb25Nb2Rlcy5pbmNsdWRlcyhsb2NrQ29uZmlnT3B0cy5tb2RlKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihgbG9ja0NvbmZpZ09wdHMubW9kZSBzaG91bGQgYmUgb25lIG9mICR7cmV0ZW50aW9uTW9kZXN9YClcbiAgICB9XG4gICAgaWYgKGxvY2tDb25maWdPcHRzLnVuaXQgJiYgIXZhbGlkVW5pdHMuaW5jbHVkZXMobG9ja0NvbmZpZ09wdHMudW5pdCkpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoYGxvY2tDb25maWdPcHRzLnVuaXQgc2hvdWxkIGJlIG9uZSBvZiAke3ZhbGlkVW5pdHN9YClcbiAgICB9XG4gICAgaWYgKGxvY2tDb25maWdPcHRzLnZhbGlkaXR5ICYmICFpc051bWJlcihsb2NrQ29uZmlnT3B0cy52YWxpZGl0eSkpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoYGxvY2tDb25maWdPcHRzLnZhbGlkaXR5IHNob3VsZCBiZSBhIG51bWJlcmApXG4gICAgfVxuXG4gICAgY29uc3QgbWV0aG9kID0gJ1BVVCdcbiAgICBjb25zdCBxdWVyeSA9ICdvYmplY3QtbG9jaydcblxuICAgIGNvbnN0IGNvbmZpZzogT2JqZWN0TG9ja0NvbmZpZ1BhcmFtID0ge1xuICAgICAgT2JqZWN0TG9ja0VuYWJsZWQ6ICdFbmFibGVkJyxcbiAgICB9XG4gICAgY29uc3QgY29uZmlnS2V5cyA9IE9iamVjdC5rZXlzKGxvY2tDb25maWdPcHRzKVxuXG4gICAgY29uc3QgaXNBbGxLZXlzU2V0ID0gWyd1bml0JywgJ21vZGUnLCAndmFsaWRpdHknXS5ldmVyeSgobGNrKSA9PiBjb25maWdLZXlzLmluY2x1ZGVzKGxjaykpXG4gICAgLy8gQ2hlY2sgaWYga2V5cyBhcmUgcHJlc2VudCBhbmQgYWxsIGtleXMgYXJlIHByZXNlbnQuXG4gICAgaWYgKGNvbmZpZ0tleXMubGVuZ3RoID4gMCkge1xuICAgICAgaWYgKCFpc0FsbEtleXNTZXQpIHtcbiAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihcbiAgICAgICAgICBgbG9ja0NvbmZpZ09wdHMubW9kZSxsb2NrQ29uZmlnT3B0cy51bml0LGxvY2tDb25maWdPcHRzLnZhbGlkaXR5IGFsbCB0aGUgcHJvcGVydGllcyBzaG91bGQgYmUgc3BlY2lmaWVkLmAsXG4gICAgICAgIClcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNvbmZpZy5SdWxlID0ge1xuICAgICAgICAgIERlZmF1bHRSZXRlbnRpb246IHt9LFxuICAgICAgICB9XG4gICAgICAgIGlmIChsb2NrQ29uZmlnT3B0cy5tb2RlKSB7XG4gICAgICAgICAgY29uZmlnLlJ1bGUuRGVmYXVsdFJldGVudGlvbi5Nb2RlID0gbG9ja0NvbmZpZ09wdHMubW9kZVxuICAgICAgICB9XG4gICAgICAgIGlmIChsb2NrQ29uZmlnT3B0cy51bml0ID09PSBSRVRFTlRJT05fVkFMSURJVFlfVU5JVFMuREFZUykge1xuICAgICAgICAgIGNvbmZpZy5SdWxlLkRlZmF1bHRSZXRlbnRpb24uRGF5cyA9IGxvY2tDb25maWdPcHRzLnZhbGlkaXR5XG4gICAgICAgIH0gZWxzZSBpZiAobG9ja0NvbmZpZ09wdHMudW5pdCA9PT0gUkVURU5USU9OX1ZBTElESVRZX1VOSVRTLllFQVJTKSB7XG4gICAgICAgICAgY29uZmlnLlJ1bGUuRGVmYXVsdFJldGVudGlvbi5ZZWFycyA9IGxvY2tDb25maWdPcHRzLnZhbGlkaXR5XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCBidWlsZGVyID0gbmV3IHhtbDJqcy5CdWlsZGVyKHtcbiAgICAgIHJvb3ROYW1lOiAnT2JqZWN0TG9ja0NvbmZpZ3VyYXRpb24nLFxuICAgICAgcmVuZGVyT3B0czogeyBwcmV0dHk6IGZhbHNlIH0sXG4gICAgICBoZWFkbGVzczogdHJ1ZSxcbiAgICB9KVxuICAgIGNvbnN0IHBheWxvYWQgPSBidWlsZGVyLmJ1aWxkT2JqZWN0KGNvbmZpZylcblxuICAgIGNvbnN0IGhlYWRlcnM6IFJlcXVlc3RIZWFkZXJzID0ge31cbiAgICBoZWFkZXJzWydDb250ZW50LU1ENSddID0gdG9NZDUocGF5bG9hZClcblxuICAgIGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luY09taXQoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIHF1ZXJ5LCBoZWFkZXJzIH0sIHBheWxvYWQpXG4gIH1cblxuICBhc3luYyBnZXRCdWNrZXRWZXJzaW9uaW5nKGJ1Y2tldE5hbWU6IHN0cmluZyk6IFByb21pc2U8QnVja2V0VmVyc2lvbmluZ0NvbmZpZ3VyYXRpb24+IHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBjb25zdCBtZXRob2QgPSAnR0VUJ1xuICAgIGNvbnN0IHF1ZXJ5ID0gJ3ZlcnNpb25pbmcnXG5cbiAgICBjb25zdCBodHRwUmVzID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jKHsgbWV0aG9kLCBidWNrZXROYW1lLCBxdWVyeSB9KVxuICAgIGNvbnN0IHhtbFJlc3VsdCA9IGF3YWl0IHJlYWRBc1N0cmluZyhodHRwUmVzKVxuICAgIHJldHVybiBhd2FpdCB4bWxQYXJzZXJzLnBhcnNlQnVja2V0VmVyc2lvbmluZ0NvbmZpZyh4bWxSZXN1bHQpXG4gIH1cblxuICBhc3luYyBzZXRCdWNrZXRWZXJzaW9uaW5nKGJ1Y2tldE5hbWU6IHN0cmluZywgdmVyc2lvbkNvbmZpZzogQnVja2V0VmVyc2lvbmluZ0NvbmZpZ3VyYXRpb24pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIU9iamVjdC5rZXlzKHZlcnNpb25Db25maWcpLmxlbmd0aCkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcigndmVyc2lvbkNvbmZpZyBzaG91bGQgYmUgb2YgdHlwZSBcIm9iamVjdFwiJylcbiAgICB9XG5cbiAgICBjb25zdCBtZXRob2QgPSAnUFVUJ1xuICAgIGNvbnN0IHF1ZXJ5ID0gJ3ZlcnNpb25pbmcnXG4gICAgY29uc3QgYnVpbGRlciA9IG5ldyB4bWwyanMuQnVpbGRlcih7XG4gICAgICByb290TmFtZTogJ1ZlcnNpb25pbmdDb25maWd1cmF0aW9uJyxcbiAgICAgIHJlbmRlck9wdHM6IHsgcHJldHR5OiBmYWxzZSB9LFxuICAgICAgaGVhZGxlc3M6IHRydWUsXG4gICAgfSlcbiAgICBjb25zdCBwYXlsb2FkID0gYnVpbGRlci5idWlsZE9iamVjdCh2ZXJzaW9uQ29uZmlnKVxuXG4gICAgYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jT21pdCh7IG1ldGhvZCwgYnVja2V0TmFtZSwgcXVlcnkgfSwgcGF5bG9hZClcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgc2V0VGFnZ2luZyh0YWdnaW5nUGFyYW1zOiBQdXRUYWdnaW5nUGFyYW1zKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgeyBidWNrZXROYW1lLCBvYmplY3ROYW1lLCB0YWdzLCBwdXRPcHRzIH0gPSB0YWdnaW5nUGFyYW1zXG4gICAgY29uc3QgbWV0aG9kID0gJ1BVVCdcbiAgICBsZXQgcXVlcnkgPSAndGFnZ2luZydcblxuICAgIGlmIChwdXRPcHRzICYmIHB1dE9wdHM/LnZlcnNpb25JZCkge1xuICAgICAgcXVlcnkgPSBgJHtxdWVyeX0mdmVyc2lvbklkPSR7cHV0T3B0cy52ZXJzaW9uSWR9YFxuICAgIH1cbiAgICBjb25zdCB0YWdzTGlzdCA9IFtdXG4gICAgZm9yIChjb25zdCBba2V5LCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXModGFncykpIHtcbiAgICAgIHRhZ3NMaXN0LnB1c2goeyBLZXk6IGtleSwgVmFsdWU6IHZhbHVlIH0pXG4gICAgfVxuICAgIGNvbnN0IHRhZ2dpbmdDb25maWcgPSB7XG4gICAgICBUYWdnaW5nOiB7XG4gICAgICAgIFRhZ1NldDoge1xuICAgICAgICAgIFRhZzogdGFnc0xpc3QsXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgIH1cbiAgICBjb25zdCBoZWFkZXJzID0ge30gYXMgUmVxdWVzdEhlYWRlcnNcbiAgICBjb25zdCBidWlsZGVyID0gbmV3IHhtbDJqcy5CdWlsZGVyKHsgaGVhZGxlc3M6IHRydWUsIHJlbmRlck9wdHM6IHsgcHJldHR5OiBmYWxzZSB9IH0pXG4gICAgY29uc3QgcGF5bG9hZEJ1ZiA9IEJ1ZmZlci5mcm9tKGJ1aWxkZXIuYnVpbGRPYmplY3QodGFnZ2luZ0NvbmZpZykpXG4gICAgY29uc3QgcmVxdWVzdE9wdGlvbnMgPSB7XG4gICAgICBtZXRob2QsXG4gICAgICBidWNrZXROYW1lLFxuICAgICAgcXVlcnksXG4gICAgICBoZWFkZXJzLFxuXG4gICAgICAuLi4ob2JqZWN0TmFtZSAmJiB7IG9iamVjdE5hbWU6IG9iamVjdE5hbWUgfSksXG4gICAgfVxuXG4gICAgaGVhZGVyc1snQ29udGVudC1NRDUnXSA9IHRvTWQ1KHBheWxvYWRCdWYpXG5cbiAgICBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmNPbWl0KHJlcXVlc3RPcHRpb25zLCBwYXlsb2FkQnVmKVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyByZW1vdmVUYWdnaW5nKHsgYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgcmVtb3ZlT3B0cyB9OiBSZW1vdmVUYWdnaW5nUGFyYW1zKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgbWV0aG9kID0gJ0RFTEVURSdcbiAgICBsZXQgcXVlcnkgPSAndGFnZ2luZydcblxuICAgIGlmIChyZW1vdmVPcHRzICYmIE9iamVjdC5rZXlzKHJlbW92ZU9wdHMpLmxlbmd0aCAmJiByZW1vdmVPcHRzLnZlcnNpb25JZCkge1xuICAgICAgcXVlcnkgPSBgJHtxdWVyeX0mdmVyc2lvbklkPSR7cmVtb3ZlT3B0cy52ZXJzaW9uSWR9YFxuICAgIH1cbiAgICBjb25zdCByZXF1ZXN0T3B0aW9ucyA9IHsgbWV0aG9kLCBidWNrZXROYW1lLCBvYmplY3ROYW1lLCBxdWVyeSB9XG5cbiAgICBpZiAob2JqZWN0TmFtZSkge1xuICAgICAgcmVxdWVzdE9wdGlvbnNbJ29iamVjdE5hbWUnXSA9IG9iamVjdE5hbWVcbiAgICB9XG4gICAgYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jKHJlcXVlc3RPcHRpb25zLCAnJywgWzIwMCwgMjA0XSlcbiAgfVxuXG4gIGFzeW5jIHNldEJ1Y2tldFRhZ2dpbmcoYnVja2V0TmFtZTogc3RyaW5nLCB0YWdzOiBUYWdzKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFpc1BsYWluT2JqZWN0KHRhZ3MpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCd0YWdzIHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxuICAgIH1cbiAgICBpZiAoT2JqZWN0LmtleXModGFncykubGVuZ3RoID4gMTApIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ21heGltdW0gdGFncyBhbGxvd2VkIGlzIDEwXCInKVxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuc2V0VGFnZ2luZyh7IGJ1Y2tldE5hbWUsIHRhZ3MgfSlcbiAgfVxuXG4gIGFzeW5jIHJlbW92ZUJ1Y2tldFRhZ2dpbmcoYnVja2V0TmFtZTogc3RyaW5nKSB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgYXdhaXQgdGhpcy5yZW1vdmVUYWdnaW5nKHsgYnVja2V0TmFtZSB9KVxuICB9XG5cbiAgYXN5bmMgc2V0T2JqZWN0VGFnZ2luZyhidWNrZXROYW1lOiBzdHJpbmcsIG9iamVjdE5hbWU6IHN0cmluZywgdGFnczogVGFncywgcHV0T3B0cz86IFRhZ2dpbmdPcHRzKSB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIG9iamVjdCBuYW1lOiAnICsgb2JqZWN0TmFtZSlcbiAgICB9XG5cbiAgICBpZiAoIWlzUGxhaW5PYmplY3QodGFncykpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ3RhZ3Mgc2hvdWxkIGJlIG9mIHR5cGUgXCJvYmplY3RcIicpXG4gICAgfVxuICAgIGlmIChPYmplY3Qua2V5cyh0YWdzKS5sZW5ndGggPiAxMCkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcignTWF4aW11bSB0YWdzIGFsbG93ZWQgaXMgMTBcIicpXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5zZXRUYWdnaW5nKHsgYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgdGFncywgcHV0T3B0cyB9KVxuICB9XG5cbiAgYXN5bmMgcmVtb3ZlT2JqZWN0VGFnZ2luZyhidWNrZXROYW1lOiBzdHJpbmcsIG9iamVjdE5hbWU6IHN0cmluZywgcmVtb3ZlT3B0czogVGFnZ2luZ09wdHMpIHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgb2JqZWN0IG5hbWU6ICcgKyBvYmplY3ROYW1lKVxuICAgIH1cbiAgICBpZiAocmVtb3ZlT3B0cyAmJiBPYmplY3Qua2V5cyhyZW1vdmVPcHRzKS5sZW5ndGggJiYgIWlzT2JqZWN0KHJlbW92ZU9wdHMpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCdyZW1vdmVPcHRzIHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMucmVtb3ZlVGFnZ2luZyh7IGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIHJlbW92ZU9wdHMgfSlcbiAgfVxuXG4gIGFzeW5jIHNlbGVjdE9iamVjdENvbnRlbnQoXG4gICAgYnVja2V0TmFtZTogc3RyaW5nLFxuICAgIG9iamVjdE5hbWU6IHN0cmluZyxcbiAgICBzZWxlY3RPcHRzOiBTZWxlY3RPcHRpb25zLFxuICApOiBQcm9taXNlPFNlbGVjdFJlc3VsdHMgfCB1bmRlZmluZWQ+IHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoYEludmFsaWQgYnVja2V0IG5hbWU6ICR7YnVja2V0TmFtZX1gKVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRPYmplY3ROYW1lRXJyb3IoYEludmFsaWQgb2JqZWN0IG5hbWU6ICR7b2JqZWN0TmFtZX1gKVxuICAgIH1cbiAgICBpZiAoIV8uaXNFbXB0eShzZWxlY3RPcHRzKSkge1xuICAgICAgaWYgKCFpc1N0cmluZyhzZWxlY3RPcHRzLmV4cHJlc3Npb24pKSB7XG4gICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3NxbEV4cHJlc3Npb24gc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXG4gICAgICB9XG4gICAgICBpZiAoIV8uaXNFbXB0eShzZWxlY3RPcHRzLmlucHV0U2VyaWFsaXphdGlvbikpIHtcbiAgICAgICAgaWYgKCFpc09iamVjdChzZWxlY3RPcHRzLmlucHV0U2VyaWFsaXphdGlvbikpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdpbnB1dFNlcmlhbGl6YXRpb24gc2hvdWxkIGJlIG9mIHR5cGUgXCJvYmplY3RcIicpXG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2lucHV0U2VyaWFsaXphdGlvbiBpcyByZXF1aXJlZCcpXG4gICAgICB9XG4gICAgICBpZiAoIV8uaXNFbXB0eShzZWxlY3RPcHRzLm91dHB1dFNlcmlhbGl6YXRpb24pKSB7XG4gICAgICAgIGlmICghaXNPYmplY3Qoc2VsZWN0T3B0cy5vdXRwdXRTZXJpYWxpemF0aW9uKSkge1xuICAgICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ291dHB1dFNlcmlhbGl6YXRpb24gc2hvdWxkIGJlIG9mIHR5cGUgXCJvYmplY3RcIicpXG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ291dHB1dFNlcmlhbGl6YXRpb24gaXMgcmVxdWlyZWQnKVxuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCd2YWxpZCBzZWxlY3QgY29uZmlndXJhdGlvbiBpcyByZXF1aXJlZCcpXG4gICAgfVxuXG4gICAgY29uc3QgbWV0aG9kID0gJ1BPU1QnXG4gICAgY29uc3QgcXVlcnkgPSBgc2VsZWN0JnNlbGVjdC10eXBlPTJgXG5cbiAgICBjb25zdCBjb25maWc6IFJlY29yZDxzdHJpbmcsIHVua25vd24+W10gPSBbXG4gICAgICB7XG4gICAgICAgIEV4cHJlc3Npb246IHNlbGVjdE9wdHMuZXhwcmVzc2lvbixcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIEV4cHJlc3Npb25UeXBlOiBzZWxlY3RPcHRzLmV4cHJlc3Npb25UeXBlIHx8ICdTUUwnLFxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgSW5wdXRTZXJpYWxpemF0aW9uOiBbc2VsZWN0T3B0cy5pbnB1dFNlcmlhbGl6YXRpb25dLFxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgT3V0cHV0U2VyaWFsaXphdGlvbjogW3NlbGVjdE9wdHMub3V0cHV0U2VyaWFsaXphdGlvbl0sXG4gICAgICB9LFxuICAgIF1cblxuICAgIC8vIE9wdGlvbmFsXG4gICAgaWYgKHNlbGVjdE9wdHMucmVxdWVzdFByb2dyZXNzKSB7XG4gICAgICBjb25maWcucHVzaCh7IFJlcXVlc3RQcm9ncmVzczogc2VsZWN0T3B0cz8ucmVxdWVzdFByb2dyZXNzIH0pXG4gICAgfVxuICAgIC8vIE9wdGlvbmFsXG4gICAgaWYgKHNlbGVjdE9wdHMuc2NhblJhbmdlKSB7XG4gICAgICBjb25maWcucHVzaCh7IFNjYW5SYW5nZTogc2VsZWN0T3B0cy5zY2FuUmFuZ2UgfSlcbiAgICB9XG5cbiAgICBjb25zdCBidWlsZGVyID0gbmV3IHhtbDJqcy5CdWlsZGVyKHtcbiAgICAgIHJvb3ROYW1lOiAnU2VsZWN0T2JqZWN0Q29udGVudFJlcXVlc3QnLFxuICAgICAgcmVuZGVyT3B0czogeyBwcmV0dHk6IGZhbHNlIH0sXG4gICAgICBoZWFkbGVzczogdHJ1ZSxcbiAgICB9KVxuICAgIGNvbnN0IHBheWxvYWQgPSBidWlsZGVyLmJ1aWxkT2JqZWN0KGNvbmZpZylcblxuICAgIGNvbnN0IHJlcyA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luYyh7IG1ldGhvZCwgYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgcXVlcnkgfSwgcGF5bG9hZClcbiAgICBjb25zdCBib2R5ID0gYXdhaXQgcmVhZEFzQnVmZmVyKHJlcylcbiAgICByZXR1cm4gcGFyc2VTZWxlY3RPYmplY3RDb250ZW50UmVzcG9uc2UoYm9keSlcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgYXBwbHlCdWNrZXRMaWZlY3ljbGUoYnVja2V0TmFtZTogc3RyaW5nLCBwb2xpY3lDb25maWc6IExpZmVDeWNsZUNvbmZpZ1BhcmFtKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgbWV0aG9kID0gJ1BVVCdcbiAgICBjb25zdCBxdWVyeSA9ICdsaWZlY3ljbGUnXG5cbiAgICBjb25zdCBoZWFkZXJzOiBSZXF1ZXN0SGVhZGVycyA9IHt9XG4gICAgY29uc3QgYnVpbGRlciA9IG5ldyB4bWwyanMuQnVpbGRlcih7XG4gICAgICByb290TmFtZTogJ0xpZmVjeWNsZUNvbmZpZ3VyYXRpb24nLFxuICAgICAgaGVhZGxlc3M6IHRydWUsXG4gICAgICByZW5kZXJPcHRzOiB7IHByZXR0eTogZmFsc2UgfSxcbiAgICB9KVxuICAgIGNvbnN0IHBheWxvYWQgPSBidWlsZGVyLmJ1aWxkT2JqZWN0KHBvbGljeUNvbmZpZylcbiAgICBoZWFkZXJzWydDb250ZW50LU1ENSddID0gdG9NZDUocGF5bG9hZClcblxuICAgIGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luY09taXQoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIHF1ZXJ5LCBoZWFkZXJzIH0sIHBheWxvYWQpXG4gIH1cblxuICBhc3luYyByZW1vdmVCdWNrZXRMaWZlY3ljbGUoYnVja2V0TmFtZTogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgY29uc3QgbWV0aG9kID0gJ0RFTEVURSdcbiAgICBjb25zdCBxdWVyeSA9ICdsaWZlY3ljbGUnXG4gICAgYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jT21pdCh7IG1ldGhvZCwgYnVja2V0TmFtZSwgcXVlcnkgfSwgJycsIFsyMDRdKVxuICB9XG5cbiAgYXN5bmMgc2V0QnVja2V0TGlmZWN5Y2xlKGJ1Y2tldE5hbWU6IHN0cmluZywgbGlmZUN5Y2xlQ29uZmlnOiBMaWZlQ3ljbGVDb25maWdQYXJhbSk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmIChfLmlzRW1wdHkobGlmZUN5Y2xlQ29uZmlnKSkge1xuICAgICAgYXdhaXQgdGhpcy5yZW1vdmVCdWNrZXRMaWZlY3ljbGUoYnVja2V0TmFtZSlcbiAgICB9IGVsc2Uge1xuICAgICAgYXdhaXQgdGhpcy5hcHBseUJ1Y2tldExpZmVjeWNsZShidWNrZXROYW1lLCBsaWZlQ3ljbGVDb25maWcpXG4gICAgfVxuICB9XG5cbiAgYXN5bmMgZ2V0QnVja2V0TGlmZWN5Y2xlKGJ1Y2tldE5hbWU6IHN0cmluZyk6IFByb21pc2U8TGlmZWN5Y2xlQ29uZmlnIHwgbnVsbD4ge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGNvbnN0IG1ldGhvZCA9ICdHRVQnXG4gICAgY29uc3QgcXVlcnkgPSAnbGlmZWN5Y2xlJ1xuXG4gICAgY29uc3QgcmVzID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jKHsgbWV0aG9kLCBidWNrZXROYW1lLCBxdWVyeSB9KVxuICAgIGNvbnN0IGJvZHkgPSBhd2FpdCByZWFkQXNTdHJpbmcocmVzKVxuICAgIHJldHVybiB4bWxQYXJzZXJzLnBhcnNlTGlmZWN5Y2xlQ29uZmlnKGJvZHkpXG4gIH1cblxuICBhc3luYyBzZXRCdWNrZXRFbmNyeXB0aW9uKGJ1Y2tldE5hbWU6IHN0cmluZywgZW5jcnlwdGlvbkNvbmZpZz86IEVuY3J5cHRpb25Db25maWcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIV8uaXNFbXB0eShlbmNyeXB0aW9uQ29uZmlnKSAmJiBlbmNyeXB0aW9uQ29uZmlnLlJ1bGUubGVuZ3RoID4gMSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcignSW52YWxpZCBSdWxlIGxlbmd0aC4gT25seSBvbmUgcnVsZSBpcyBhbGxvd2VkLjogJyArIGVuY3J5cHRpb25Db25maWcuUnVsZSlcbiAgICB9XG5cbiAgICBsZXQgZW5jcnlwdGlvbk9iaiA9IGVuY3J5cHRpb25Db25maWdcbiAgICBpZiAoXy5pc0VtcHR5KGVuY3J5cHRpb25Db25maWcpKSB7XG4gICAgICBlbmNyeXB0aW9uT2JqID0ge1xuICAgICAgICAvLyBEZWZhdWx0IE1pbklPIFNlcnZlciBTdXBwb3J0ZWQgUnVsZVxuICAgICAgICBSdWxlOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgQXBwbHlTZXJ2ZXJTaWRlRW5jcnlwdGlvbkJ5RGVmYXVsdDoge1xuICAgICAgICAgICAgICBTU0VBbGdvcml0aG06ICdBRVMyNTYnLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICBdLFxuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IG1ldGhvZCA9ICdQVVQnXG4gICAgY29uc3QgcXVlcnkgPSAnZW5jcnlwdGlvbidcbiAgICBjb25zdCBidWlsZGVyID0gbmV3IHhtbDJqcy5CdWlsZGVyKHtcbiAgICAgIHJvb3ROYW1lOiAnU2VydmVyU2lkZUVuY3J5cHRpb25Db25maWd1cmF0aW9uJyxcbiAgICAgIHJlbmRlck9wdHM6IHsgcHJldHR5OiBmYWxzZSB9LFxuICAgICAgaGVhZGxlc3M6IHRydWUsXG4gICAgfSlcbiAgICBjb25zdCBwYXlsb2FkID0gYnVpbGRlci5idWlsZE9iamVjdChlbmNyeXB0aW9uT2JqKVxuXG4gICAgY29uc3QgaGVhZGVyczogUmVxdWVzdEhlYWRlcnMgPSB7fVxuICAgIGhlYWRlcnNbJ0NvbnRlbnQtTUQ1J10gPSB0b01kNShwYXlsb2FkKVxuXG4gICAgYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jT21pdCh7IG1ldGhvZCwgYnVja2V0TmFtZSwgcXVlcnksIGhlYWRlcnMgfSwgcGF5bG9hZClcbiAgfVxuXG4gIGFzeW5jIGdldEJ1Y2tldEVuY3J5cHRpb24oYnVja2V0TmFtZTogc3RyaW5nKSB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgY29uc3QgbWV0aG9kID0gJ0dFVCdcbiAgICBjb25zdCBxdWVyeSA9ICdlbmNyeXB0aW9uJ1xuXG4gICAgY29uc3QgcmVzID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jKHsgbWV0aG9kLCBidWNrZXROYW1lLCBxdWVyeSB9KVxuICAgIGNvbnN0IGJvZHkgPSBhd2FpdCByZWFkQXNTdHJpbmcocmVzKVxuICAgIHJldHVybiB4bWxQYXJzZXJzLnBhcnNlQnVja2V0RW5jcnlwdGlvbkNvbmZpZyhib2R5KVxuICB9XG5cbiAgYXN5bmMgcmVtb3ZlQnVja2V0RW5jcnlwdGlvbihidWNrZXROYW1lOiBzdHJpbmcpIHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBjb25zdCBtZXRob2QgPSAnREVMRVRFJ1xuICAgIGNvbnN0IHF1ZXJ5ID0gJ2VuY3J5cHRpb24nXG5cbiAgICBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmNPbWl0KHsgbWV0aG9kLCBidWNrZXROYW1lLCBxdWVyeSB9LCAnJywgWzIwNF0pXG4gIH1cblxuICBhc3luYyBnZXRPYmplY3RSZXRlbnRpb24oXG4gICAgYnVja2V0TmFtZTogc3RyaW5nLFxuICAgIG9iamVjdE5hbWU6IHN0cmluZyxcbiAgICBnZXRPcHRzPzogR2V0T2JqZWN0UmV0ZW50aW9uT3B0cyxcbiAgKTogUHJvbWlzZTxPYmplY3RSZXRlbnRpb25JbmZvIHwgbnVsbCB8IHVuZGVmaW5lZD4ge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmICghaXNWYWxpZE9iamVjdE5hbWUob2JqZWN0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZE9iamVjdE5hbWVFcnJvcihgSW52YWxpZCBvYmplY3QgbmFtZTogJHtvYmplY3ROYW1lfWApXG4gICAgfVxuICAgIGlmIChnZXRPcHRzICYmICFpc09iamVjdChnZXRPcHRzKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcignZ2V0T3B0cyBzaG91bGQgYmUgb2YgdHlwZSBcIm9iamVjdFwiJylcbiAgICB9IGVsc2UgaWYgKGdldE9wdHM/LnZlcnNpb25JZCAmJiAhaXNTdHJpbmcoZ2V0T3B0cy52ZXJzaW9uSWQpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCd2ZXJzaW9uSWQgc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXG4gICAgfVxuXG4gICAgY29uc3QgbWV0aG9kID0gJ0dFVCdcbiAgICBsZXQgcXVlcnkgPSAncmV0ZW50aW9uJ1xuICAgIGlmIChnZXRPcHRzPy52ZXJzaW9uSWQpIHtcbiAgICAgIHF1ZXJ5ICs9IGAmdmVyc2lvbklkPSR7Z2V0T3B0cy52ZXJzaW9uSWR9YFxuICAgIH1cbiAgICBjb25zdCByZXMgPSBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmMoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIHF1ZXJ5IH0pXG4gICAgY29uc3QgYm9keSA9IGF3YWl0IHJlYWRBc1N0cmluZyhyZXMpXG4gICAgcmV0dXJuIHhtbFBhcnNlcnMucGFyc2VPYmplY3RSZXRlbnRpb25Db25maWcoYm9keSlcbiAgfVxuXG4gIGFzeW5jIHJlbW92ZU9iamVjdHMoYnVja2V0TmFtZTogc3RyaW5nLCBvYmplY3RzTGlzdDogUmVtb3ZlT2JqZWN0c1BhcmFtKTogUHJvbWlzZTxSZW1vdmVPYmplY3RzUmVzcG9uc2VbXT4ge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmICghQXJyYXkuaXNBcnJheShvYmplY3RzTGlzdCkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ29iamVjdHNMaXN0IHNob3VsZCBiZSBhIGxpc3QnKVxuICAgIH1cblxuICAgIGNvbnN0IHJ1bkRlbGV0ZU9iamVjdHMgPSBhc3luYyAoYmF0Y2g6IFJlbW92ZU9iamVjdHNQYXJhbSk6IFByb21pc2U8UmVtb3ZlT2JqZWN0c1Jlc3BvbnNlW10+ID0+IHtcbiAgICAgIGNvbnN0IGRlbE9iamVjdHM6IFJlbW92ZU9iamVjdHNSZXF1ZXN0RW50cnlbXSA9IGJhdGNoLm1hcCgodmFsdWUpID0+IHtcbiAgICAgICAgcmV0dXJuIGlzT2JqZWN0KHZhbHVlKSA/IHsgS2V5OiB2YWx1ZS5uYW1lLCBWZXJzaW9uSWQ6IHZhbHVlLnZlcnNpb25JZCB9IDogeyBLZXk6IHZhbHVlIH1cbiAgICAgIH0pXG5cbiAgICAgIGNvbnN0IHJlbU9iamVjdHMgPSB7IERlbGV0ZTogeyBRdWlldDogdHJ1ZSwgT2JqZWN0OiBkZWxPYmplY3RzIH0gfVxuICAgICAgY29uc3QgcGF5bG9hZCA9IEJ1ZmZlci5mcm9tKG5ldyB4bWwyanMuQnVpbGRlcih7IGhlYWRsZXNzOiB0cnVlIH0pLmJ1aWxkT2JqZWN0KHJlbU9iamVjdHMpKVxuICAgICAgY29uc3QgaGVhZGVyczogUmVxdWVzdEhlYWRlcnMgPSB7ICdDb250ZW50LU1ENSc6IHRvTWQ1KHBheWxvYWQpIH1cblxuICAgICAgY29uc3QgcmVzID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jKHsgbWV0aG9kOiAnUE9TVCcsIGJ1Y2tldE5hbWUsIHF1ZXJ5OiAnZGVsZXRlJywgaGVhZGVycyB9LCBwYXlsb2FkKVxuICAgICAgY29uc3QgYm9keSA9IGF3YWl0IHJlYWRBc1N0cmluZyhyZXMpXG4gICAgICByZXR1cm4geG1sUGFyc2Vycy5yZW1vdmVPYmplY3RzUGFyc2VyKGJvZHkpXG4gICAgfVxuXG4gICAgY29uc3QgbWF4RW50cmllcyA9IDEwMDAgLy8gbWF4IGVudHJpZXMgYWNjZXB0ZWQgaW4gc2VydmVyIGZvciBEZWxldGVNdWx0aXBsZU9iamVjdHMgQVBJLlxuICAgIC8vIENsaWVudCBzaWRlIGJhdGNoaW5nXG4gICAgY29uc3QgYmF0Y2hlcyA9IFtdXG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBvYmplY3RzTGlzdC5sZW5ndGg7IGkgKz0gbWF4RW50cmllcykge1xuICAgICAgYmF0Y2hlcy5wdXNoKG9iamVjdHNMaXN0LnNsaWNlKGksIGkgKyBtYXhFbnRyaWVzKSlcbiAgICB9XG5cbiAgICBjb25zdCBiYXRjaFJlc3VsdHMgPSBhd2FpdCBQcm9taXNlLmFsbChiYXRjaGVzLm1hcChydW5EZWxldGVPYmplY3RzKSlcbiAgICByZXR1cm4gYmF0Y2hSZXN1bHRzLmZsYXQoKVxuICB9XG5cbiAgYXN5bmMgcmVtb3ZlSW5jb21wbGV0ZVVwbG9hZChidWNrZXROYW1lOiBzdHJpbmcsIG9iamVjdE5hbWU6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSXNWYWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmICghaXNWYWxpZE9iamVjdE5hbWUob2JqZWN0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZE9iamVjdE5hbWVFcnJvcihgSW52YWxpZCBvYmplY3QgbmFtZTogJHtvYmplY3ROYW1lfWApXG4gICAgfVxuICAgIGNvbnN0IHJlbW92ZVVwbG9hZElkID0gYXdhaXQgdGhpcy5maW5kVXBsb2FkSWQoYnVja2V0TmFtZSwgb2JqZWN0TmFtZSlcbiAgICBjb25zdCBtZXRob2QgPSAnREVMRVRFJ1xuICAgIGNvbnN0IHF1ZXJ5ID0gYHVwbG9hZElkPSR7cmVtb3ZlVXBsb2FkSWR9YFxuICAgIGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luY09taXQoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIHF1ZXJ5IH0sICcnLCBbMjA0XSlcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgY29weU9iamVjdFYxKFxuICAgIHRhcmdldEJ1Y2tldE5hbWU6IHN0cmluZyxcbiAgICB0YXJnZXRPYmplY3ROYW1lOiBzdHJpbmcsXG4gICAgc291cmNlQnVja2V0TmFtZUFuZE9iamVjdE5hbWU6IHN0cmluZyxcbiAgICBjb25kaXRpb25zPzogbnVsbCB8IENvcHlDb25kaXRpb25zLFxuICApIHtcbiAgICBpZiAodHlwZW9mIGNvbmRpdGlvbnMgPT0gJ2Z1bmN0aW9uJykge1xuICAgICAgY29uZGl0aW9ucyA9IG51bGxcbiAgICB9XG5cbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKHRhcmdldEJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyB0YXJnZXRCdWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKHRhcmdldE9iamVjdE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRPYmplY3ROYW1lRXJyb3IoYEludmFsaWQgb2JqZWN0IG5hbWU6ICR7dGFyZ2V0T2JqZWN0TmFtZX1gKVxuICAgIH1cbiAgICBpZiAoIWlzU3RyaW5nKHNvdXJjZUJ1Y2tldE5hbWVBbmRPYmplY3ROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignc291cmNlQnVja2V0TmFtZUFuZE9iamVjdE5hbWUgc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXG4gICAgfVxuICAgIGlmIChzb3VyY2VCdWNrZXROYW1lQW5kT2JqZWN0TmFtZSA9PT0gJycpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZFByZWZpeEVycm9yKGBFbXB0eSBzb3VyY2UgcHJlZml4YClcbiAgICB9XG5cbiAgICBpZiAoY29uZGl0aW9ucyAhPSBudWxsICYmICEoY29uZGl0aW9ucyBpbnN0YW5jZW9mIENvcHlDb25kaXRpb25zKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignY29uZGl0aW9ucyBzaG91bGQgYmUgb2YgdHlwZSBcIkNvcHlDb25kaXRpb25zXCInKVxuICAgIH1cblxuICAgIGNvbnN0IGhlYWRlcnM6IFJlcXVlc3RIZWFkZXJzID0ge31cbiAgICBoZWFkZXJzWyd4LWFtei1jb3B5LXNvdXJjZSddID0gdXJpUmVzb3VyY2VFc2NhcGUoc291cmNlQnVja2V0TmFtZUFuZE9iamVjdE5hbWUpXG5cbiAgICBpZiAoY29uZGl0aW9ucykge1xuICAgICAgaWYgKGNvbmRpdGlvbnMubW9kaWZpZWQgIT09ICcnKSB7XG4gICAgICAgIGhlYWRlcnNbJ3gtYW16LWNvcHktc291cmNlLWlmLW1vZGlmaWVkLXNpbmNlJ10gPSBjb25kaXRpb25zLm1vZGlmaWVkXG4gICAgICB9XG4gICAgICBpZiAoY29uZGl0aW9ucy51bm1vZGlmaWVkICE9PSAnJykge1xuICAgICAgICBoZWFkZXJzWyd4LWFtei1jb3B5LXNvdXJjZS1pZi11bm1vZGlmaWVkLXNpbmNlJ10gPSBjb25kaXRpb25zLnVubW9kaWZpZWRcbiAgICAgIH1cbiAgICAgIGlmIChjb25kaXRpb25zLm1hdGNoRVRhZyAhPT0gJycpIHtcbiAgICAgICAgaGVhZGVyc1sneC1hbXotY29weS1zb3VyY2UtaWYtbWF0Y2gnXSA9IGNvbmRpdGlvbnMubWF0Y2hFVGFnXG4gICAgICB9XG4gICAgICBpZiAoY29uZGl0aW9ucy5tYXRjaEVUYWdFeGNlcHQgIT09ICcnKSB7XG4gICAgICAgIGhlYWRlcnNbJ3gtYW16LWNvcHktc291cmNlLWlmLW5vbmUtbWF0Y2gnXSA9IGNvbmRpdGlvbnMubWF0Y2hFVGFnRXhjZXB0XG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3QgbWV0aG9kID0gJ1BVVCdcblxuICAgIGNvbnN0IHJlcyA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luYyh7XG4gICAgICBtZXRob2QsXG4gICAgICBidWNrZXROYW1lOiB0YXJnZXRCdWNrZXROYW1lLFxuICAgICAgb2JqZWN0TmFtZTogdGFyZ2V0T2JqZWN0TmFtZSxcbiAgICAgIGhlYWRlcnMsXG4gICAgfSlcbiAgICBjb25zdCBib2R5ID0gYXdhaXQgcmVhZEFzU3RyaW5nKHJlcylcbiAgICByZXR1cm4geG1sUGFyc2Vycy5wYXJzZUNvcHlPYmplY3QoYm9keSlcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgY29weU9iamVjdFYyKFxuICAgIHNvdXJjZUNvbmZpZzogQ29weVNvdXJjZU9wdGlvbnMsXG4gICAgZGVzdENvbmZpZzogQ29weURlc3RpbmF0aW9uT3B0aW9ucyxcbiAgKTogUHJvbWlzZTxDb3B5T2JqZWN0UmVzdWx0VjI+IHtcbiAgICBpZiAoIShzb3VyY2VDb25maWcgaW5zdGFuY2VvZiBDb3B5U291cmNlT3B0aW9ucykpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ3NvdXJjZUNvbmZpZyBzaG91bGQgb2YgdHlwZSBDb3B5U291cmNlT3B0aW9ucyAnKVxuICAgIH1cbiAgICBpZiAoIShkZXN0Q29uZmlnIGluc3RhbmNlb2YgQ29weURlc3RpbmF0aW9uT3B0aW9ucykpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ2Rlc3RDb25maWcgc2hvdWxkIG9mIHR5cGUgQ29weURlc3RpbmF0aW9uT3B0aW9ucyAnKVxuICAgIH1cbiAgICBpZiAoIWRlc3RDb25maWcudmFsaWRhdGUoKSkge1xuICAgICAgcmV0dXJuIFByb21pc2UucmVqZWN0KClcbiAgICB9XG4gICAgaWYgKCFkZXN0Q29uZmlnLnZhbGlkYXRlKCkpIHtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlamVjdCgpXG4gICAgfVxuXG4gICAgY29uc3QgaGVhZGVycyA9IE9iamVjdC5hc3NpZ24oe30sIHNvdXJjZUNvbmZpZy5nZXRIZWFkZXJzKCksIGRlc3RDb25maWcuZ2V0SGVhZGVycygpKVxuXG4gICAgY29uc3QgYnVja2V0TmFtZSA9IGRlc3RDb25maWcuQnVja2V0XG4gICAgY29uc3Qgb2JqZWN0TmFtZSA9IGRlc3RDb25maWcuT2JqZWN0XG5cbiAgICBjb25zdCBtZXRob2QgPSAnUFVUJ1xuXG4gICAgY29uc3QgcmVzID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jKHsgbWV0aG9kLCBidWNrZXROYW1lLCBvYmplY3ROYW1lLCBoZWFkZXJzIH0pXG4gICAgY29uc3QgYm9keSA9IGF3YWl0IHJlYWRBc1N0cmluZyhyZXMpXG4gICAgY29uc3QgY29weVJlcyA9IHhtbFBhcnNlcnMucGFyc2VDb3B5T2JqZWN0KGJvZHkpXG4gICAgY29uc3QgcmVzSGVhZGVyczogSW5jb21pbmdIdHRwSGVhZGVycyA9IHJlcy5oZWFkZXJzXG5cbiAgICBjb25zdCBzaXplSGVhZGVyVmFsdWUgPSByZXNIZWFkZXJzICYmIHJlc0hlYWRlcnNbJ2NvbnRlbnQtbGVuZ3RoJ11cbiAgICBjb25zdCBzaXplID0gdHlwZW9mIHNpemVIZWFkZXJWYWx1ZSA9PT0gJ251bWJlcicgPyBzaXplSGVhZGVyVmFsdWUgOiB1bmRlZmluZWRcblxuICAgIHJldHVybiB7XG4gICAgICBCdWNrZXQ6IGRlc3RDb25maWcuQnVja2V0LFxuICAgICAgS2V5OiBkZXN0Q29uZmlnLk9iamVjdCxcbiAgICAgIExhc3RNb2RpZmllZDogY29weVJlcy5sYXN0TW9kaWZpZWQsXG4gICAgICBNZXRhRGF0YTogZXh0cmFjdE1ldGFkYXRhKHJlc0hlYWRlcnMgYXMgUmVzcG9uc2VIZWFkZXIpLFxuICAgICAgVmVyc2lvbklkOiBnZXRWZXJzaW9uSWQocmVzSGVhZGVycyBhcyBSZXNwb25zZUhlYWRlciksXG4gICAgICBTb3VyY2VWZXJzaW9uSWQ6IGdldFNvdXJjZVZlcnNpb25JZChyZXNIZWFkZXJzIGFzIFJlc3BvbnNlSGVhZGVyKSxcbiAgICAgIEV0YWc6IHNhbml0aXplRVRhZyhyZXNIZWFkZXJzLmV0YWcpLFxuICAgICAgU2l6ZTogc2l6ZSxcbiAgICB9XG4gIH1cblxuICBhc3luYyBjb3B5T2JqZWN0KHNvdXJjZTogQ29weVNvdXJjZU9wdGlvbnMsIGRlc3Q6IENvcHlEZXN0aW5hdGlvbk9wdGlvbnMpOiBQcm9taXNlPENvcHlPYmplY3RSZXN1bHQ+XG4gIGFzeW5jIGNvcHlPYmplY3QoXG4gICAgdGFyZ2V0QnVja2V0TmFtZTogc3RyaW5nLFxuICAgIHRhcmdldE9iamVjdE5hbWU6IHN0cmluZyxcbiAgICBzb3VyY2VCdWNrZXROYW1lQW5kT2JqZWN0TmFtZTogc3RyaW5nLFxuICAgIGNvbmRpdGlvbnM/OiBDb3B5Q29uZGl0aW9ucyxcbiAgKTogUHJvbWlzZTxDb3B5T2JqZWN0UmVzdWx0PlxuICBhc3luYyBjb3B5T2JqZWN0KC4uLmFsbEFyZ3M6IENvcHlPYmplY3RQYXJhbXMpOiBQcm9taXNlPENvcHlPYmplY3RSZXN1bHQ+IHtcbiAgICBpZiAodHlwZW9mIGFsbEFyZ3NbMF0gPT09ICdzdHJpbmcnKSB7XG4gICAgICBjb25zdCBbdGFyZ2V0QnVja2V0TmFtZSwgdGFyZ2V0T2JqZWN0TmFtZSwgc291cmNlQnVja2V0TmFtZUFuZE9iamVjdE5hbWUsIGNvbmRpdGlvbnNdID0gYWxsQXJncyBhcyBbXG4gICAgICAgIHN0cmluZyxcbiAgICAgICAgc3RyaW5nLFxuICAgICAgICBzdHJpbmcsXG4gICAgICAgIENvcHlDb25kaXRpb25zPyxcbiAgICAgIF1cbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLmNvcHlPYmplY3RWMSh0YXJnZXRCdWNrZXROYW1lLCB0YXJnZXRPYmplY3ROYW1lLCBzb3VyY2VCdWNrZXROYW1lQW5kT2JqZWN0TmFtZSwgY29uZGl0aW9ucylcbiAgICB9XG4gICAgY29uc3QgW3NvdXJjZSwgZGVzdF0gPSBhbGxBcmdzIGFzIFtDb3B5U291cmNlT3B0aW9ucywgQ29weURlc3RpbmF0aW9uT3B0aW9uc11cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5jb3B5T2JqZWN0VjIoc291cmNlLCBkZXN0KVxuICB9XG5cbiAgYXN5bmMgdXBsb2FkUGFydChcbiAgICBwYXJ0Q29uZmlnOiB7XG4gICAgICBidWNrZXROYW1lOiBzdHJpbmdcbiAgICAgIG9iamVjdE5hbWU6IHN0cmluZ1xuICAgICAgdXBsb2FkSUQ6IHN0cmluZ1xuICAgICAgcGFydE51bWJlcjogbnVtYmVyXG4gICAgICBoZWFkZXJzOiBSZXF1ZXN0SGVhZGVyc1xuICAgIH0sXG4gICAgcGF5bG9hZD86IEJpbmFyeSxcbiAgKSB7XG4gICAgY29uc3QgeyBidWNrZXROYW1lLCBvYmplY3ROYW1lLCB1cGxvYWRJRCwgcGFydE51bWJlciwgaGVhZGVycyB9ID0gcGFydENvbmZpZ1xuXG4gICAgY29uc3QgbWV0aG9kID0gJ1BVVCdcbiAgICBjb25zdCBxdWVyeSA9IGB1cGxvYWRJZD0ke3VwbG9hZElEfSZwYXJ0TnVtYmVyPSR7cGFydE51bWJlcn1gXG4gICAgY29uc3QgcmVxdWVzdE9wdGlvbnMgPSB7IG1ldGhvZCwgYnVja2V0TmFtZSwgb2JqZWN0TmFtZTogb2JqZWN0TmFtZSwgcXVlcnksIGhlYWRlcnMgfVxuICAgIGNvbnN0IHJlcyA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luYyhyZXF1ZXN0T3B0aW9ucywgcGF5bG9hZClcbiAgICBjb25zdCBib2R5ID0gYXdhaXQgcmVhZEFzU3RyaW5nKHJlcylcbiAgICBjb25zdCBwYXJ0UmVzID0gdXBsb2FkUGFydFBhcnNlcihib2R5KVxuICAgIGNvbnN0IHBhcnRFdGFnVmFsID0gc2FuaXRpemVFVGFnKHJlcy5oZWFkZXJzLmV0YWcpIHx8IHNhbml0aXplRVRhZyhwYXJ0UmVzLkVUYWcpXG4gICAgcmV0dXJuIHtcbiAgICAgIGV0YWc6IHBhcnRFdGFnVmFsLFxuICAgICAga2V5OiBvYmplY3ROYW1lLFxuICAgICAgcGFydDogcGFydE51bWJlcixcbiAgICB9XG4gIH1cblxuICBhc3luYyBjb21wb3NlT2JqZWN0KFxuICAgIGRlc3RPYmpDb25maWc6IENvcHlEZXN0aW5hdGlvbk9wdGlvbnMsXG4gICAgc291cmNlT2JqTGlzdDogQ29weVNvdXJjZU9wdGlvbnNbXSxcbiAgICB7IG1heENvbmN1cnJlbmN5ID0gMTAgfSA9IHt9LFxuICApOiBQcm9taXNlPGJvb2xlYW4gfCB7IGV0YWc6IHN0cmluZzsgdmVyc2lvbklkOiBzdHJpbmcgfCBudWxsIH0gfCBQcm9taXNlPHZvaWQ+IHwgQ29weU9iamVjdFJlc3VsdD4ge1xuICAgIGNvbnN0IHNvdXJjZUZpbGVzTGVuZ3RoID0gc291cmNlT2JqTGlzdC5sZW5ndGhcblxuICAgIGlmICghQXJyYXkuaXNBcnJheShzb3VyY2VPYmpMaXN0KSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcignc291cmNlQ29uZmlnIHNob3VsZCBhbiBhcnJheSBvZiBDb3B5U291cmNlT3B0aW9ucyAnKVxuICAgIH1cbiAgICBpZiAoIShkZXN0T2JqQ29uZmlnIGluc3RhbmNlb2YgQ29weURlc3RpbmF0aW9uT3B0aW9ucykpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ2Rlc3RDb25maWcgc2hvdWxkIG9mIHR5cGUgQ29weURlc3RpbmF0aW9uT3B0aW9ucyAnKVxuICAgIH1cblxuICAgIGlmIChzb3VyY2VGaWxlc0xlbmd0aCA8IDEgfHwgc291cmNlRmlsZXNMZW5ndGggPiBQQVJUX0NPTlNUUkFJTlRTLk1BWF9QQVJUU19DT1VOVCkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcihcbiAgICAgICAgYFwiVGhlcmUgbXVzdCBiZSBhcyBsZWFzdCBvbmUgYW5kIHVwIHRvICR7UEFSVF9DT05TVFJBSU5UUy5NQVhfUEFSVFNfQ09VTlR9IHNvdXJjZSBvYmplY3RzLmAsXG4gICAgICApXG4gICAgfVxuXG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBzb3VyY2VGaWxlc0xlbmd0aDsgaSsrKSB7XG4gICAgICBjb25zdCBzT2JqID0gc291cmNlT2JqTGlzdFtpXSBhcyBDb3B5U291cmNlT3B0aW9uc1xuICAgICAgaWYgKCFzT2JqLnZhbGlkYXRlKCkpIHtcbiAgICAgICAgcmV0dXJuIGZhbHNlXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKCEoZGVzdE9iakNvbmZpZyBhcyBDb3B5RGVzdGluYXRpb25PcHRpb25zKS52YWxpZGF0ZSgpKSB7XG4gICAgICByZXR1cm4gZmFsc2VcbiAgICB9XG5cbiAgICBjb25zdCBnZXRTdGF0T3B0aW9ucyA9IChzcmNDb25maWc6IENvcHlTb3VyY2VPcHRpb25zKSA9PiB7XG4gICAgICBsZXQgc3RhdE9wdHMgPSB7fVxuICAgICAgaWYgKCFfLmlzRW1wdHkoc3JjQ29uZmlnLlZlcnNpb25JRCkpIHtcbiAgICAgICAgc3RhdE9wdHMgPSB7XG4gICAgICAgICAgdmVyc2lvbklkOiBzcmNDb25maWcuVmVyc2lvbklELFxuICAgICAgICB9XG4gICAgICB9XG4gICAgICByZXR1cm4gc3RhdE9wdHNcbiAgICB9XG4gICAgY29uc3Qgc3JjT2JqZWN0U2l6ZXM6IG51bWJlcltdID0gW11cbiAgICBsZXQgdG90YWxTaXplID0gMFxuICAgIGxldCB0b3RhbFBhcnRzID0gMFxuXG4gICAgY29uc3Qgc291cmNlT2JqU3RhdHMgPSBzb3VyY2VPYmpMaXN0Lm1hcCgoc3JjSXRlbSkgPT5cbiAgICAgIHRoaXMuc3RhdE9iamVjdChzcmNJdGVtLkJ1Y2tldCwgc3JjSXRlbS5PYmplY3QsIGdldFN0YXRPcHRpb25zKHNyY0l0ZW0pKSxcbiAgICApXG5cbiAgICBjb25zdCBzcmNPYmplY3RJbmZvcyA9IGF3YWl0IFByb21pc2UuYWxsKHNvdXJjZU9ialN0YXRzKVxuXG4gICAgY29uc3QgdmFsaWRhdGVkU3RhdHMgPSBzcmNPYmplY3RJbmZvcy5tYXAoKHJlc0l0ZW1TdGF0LCBpbmRleCkgPT4ge1xuICAgICAgY29uc3Qgc3JjQ29uZmlnOiBDb3B5U291cmNlT3B0aW9ucyB8IHVuZGVmaW5lZCA9IHNvdXJjZU9iakxpc3RbaW5kZXhdXG5cbiAgICAgIGxldCBzcmNDb3B5U2l6ZSA9IHJlc0l0ZW1TdGF0LnNpemVcbiAgICAgIC8vIENoZWNrIGlmIGEgc2VnbWVudCBpcyBzcGVjaWZpZWQsIGFuZCBpZiBzbywgaXMgdGhlXG4gICAgICAvLyBzZWdtZW50IHdpdGhpbiBvYmplY3QgYm91bmRzP1xuICAgICAgaWYgKHNyY0NvbmZpZyAmJiBzcmNDb25maWcuTWF0Y2hSYW5nZSkge1xuICAgICAgICAvLyBTaW5jZSByYW5nZSBpcyBzcGVjaWZpZWQsXG4gICAgICAgIC8vICAgIDAgPD0gc3JjLnNyY1N0YXJ0IDw9IHNyYy5zcmNFbmRcbiAgICAgICAgLy8gc28gb25seSBpbnZhbGlkIGNhc2UgdG8gY2hlY2sgaXM6XG4gICAgICAgIGNvbnN0IHNyY1N0YXJ0ID0gc3JjQ29uZmlnLlN0YXJ0XG4gICAgICAgIGNvbnN0IHNyY0VuZCA9IHNyY0NvbmZpZy5FbmRcbiAgICAgICAgaWYgKHNyY0VuZCA+PSBzcmNDb3B5U2l6ZSB8fCBzcmNTdGFydCA8IDApIHtcbiAgICAgICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKFxuICAgICAgICAgICAgYENvcHlTcmNPcHRpb25zICR7aW5kZXh9IGhhcyBpbnZhbGlkIHNlZ21lbnQtdG8tY29weSBbJHtzcmNTdGFydH0sICR7c3JjRW5kfV0gKHNpemUgaXMgJHtzcmNDb3B5U2l6ZX0pYCxcbiAgICAgICAgICApXG4gICAgICAgIH1cbiAgICAgICAgc3JjQ29weVNpemUgPSBzcmNFbmQgLSBzcmNTdGFydCArIDFcbiAgICAgIH1cblxuICAgICAgLy8gT25seSB0aGUgbGFzdCBzb3VyY2UgbWF5IGJlIGxlc3MgdGhhbiBgYWJzTWluUGFydFNpemVgXG4gICAgICBpZiAoc3JjQ29weVNpemUgPCBQQVJUX0NPTlNUUkFJTlRTLkFCU19NSU5fUEFSVF9TSVpFICYmIGluZGV4IDwgc291cmNlRmlsZXNMZW5ndGggLSAxKSB7XG4gICAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoXG4gICAgICAgICAgYENvcHlTcmNPcHRpb25zICR7aW5kZXh9IGlzIHRvbyBzbWFsbCAoJHtzcmNDb3B5U2l6ZX0pIGFuZCBpdCBpcyBub3QgdGhlIGxhc3QgcGFydC5gLFxuICAgICAgICApXG4gICAgICB9XG5cbiAgICAgIC8vIElzIGRhdGEgdG8gY29weSB0b28gbGFyZ2U/XG4gICAgICB0b3RhbFNpemUgKz0gc3JjQ29weVNpemVcbiAgICAgIGlmICh0b3RhbFNpemUgPiBQQVJUX0NPTlNUUkFJTlRTLk1BWF9NVUxUSVBBUlRfUFVUX09CSkVDVF9TSVpFKSB7XG4gICAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoYENhbm5vdCBjb21wb3NlIGFuIG9iamVjdCBvZiBzaXplICR7dG90YWxTaXplfSAoPiA1VGlCKWApXG4gICAgICB9XG5cbiAgICAgIC8vIHJlY29yZCBzb3VyY2Ugc2l6ZVxuICAgICAgc3JjT2JqZWN0U2l6ZXNbaW5kZXhdID0gc3JjQ29weVNpemVcblxuICAgICAgLy8gY2FsY3VsYXRlIHBhcnRzIG5lZWRlZCBmb3IgY3VycmVudCBzb3VyY2VcbiAgICAgIHRvdGFsUGFydHMgKz0gcGFydHNSZXF1aXJlZChzcmNDb3B5U2l6ZSlcbiAgICAgIC8vIERvIHdlIG5lZWQgbW9yZSBwYXJ0cyB0aGFuIHdlIGFyZSBhbGxvd2VkP1xuICAgICAgaWYgKHRvdGFsUGFydHMgPiBQQVJUX0NPTlNUUkFJTlRTLk1BWF9QQVJUU19DT1VOVCkge1xuICAgICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKFxuICAgICAgICAgIGBZb3VyIHByb3Bvc2VkIGNvbXBvc2Ugb2JqZWN0IHJlcXVpcmVzIG1vcmUgdGhhbiAke1BBUlRfQ09OU1RSQUlOVFMuTUFYX1BBUlRTX0NPVU5UfSBwYXJ0c2AsXG4gICAgICAgIClcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHJlc0l0ZW1TdGF0XG4gICAgfSlcblxuICAgIGlmICgodG90YWxQYXJ0cyA9PT0gMSAmJiB0b3RhbFNpemUgPD0gUEFSVF9DT05TVFJBSU5UUy5NQVhfUEFSVF9TSVpFKSB8fCB0b3RhbFNpemUgPT09IDApIHtcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLmNvcHlPYmplY3Qoc291cmNlT2JqTGlzdFswXSBhcyBDb3B5U291cmNlT3B0aW9ucywgZGVzdE9iakNvbmZpZykgLy8gdXNlIGNvcHlPYmplY3RWMlxuICAgIH1cblxuICAgIC8vIHByZXNlcnZlIGV0YWcgdG8gYXZvaWQgbW9kaWZpY2F0aW9uIG9mIG9iamVjdCB3aGlsZSBjb3B5aW5nLlxuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgc291cmNlRmlsZXNMZW5ndGg7IGkrKykge1xuICAgICAgOyhzb3VyY2VPYmpMaXN0W2ldIGFzIENvcHlTb3VyY2VPcHRpb25zKS5NYXRjaEVUYWcgPSAodmFsaWRhdGVkU3RhdHNbaV0gYXMgQnVja2V0SXRlbVN0YXQpLmV0YWdcbiAgICB9XG5cbiAgICBjb25zdCBzcGxpdFBhcnRTaXplTGlzdCA9IHZhbGlkYXRlZFN0YXRzLm1hcCgocmVzSXRlbVN0YXQsIGlkeCkgPT4ge1xuICAgICAgcmV0dXJuIGNhbGN1bGF0ZUV2ZW5TcGxpdHMoc3JjT2JqZWN0U2l6ZXNbaWR4XSBhcyBudW1iZXIsIHNvdXJjZU9iakxpc3RbaWR4XSBhcyBDb3B5U291cmNlT3B0aW9ucylcbiAgICB9KVxuXG4gICAgY29uc3QgZ2V0VXBsb2FkUGFydENvbmZpZ0xpc3QgPSAodXBsb2FkSWQ6IHN0cmluZykgPT4ge1xuICAgICAgY29uc3QgdXBsb2FkUGFydENvbmZpZ0xpc3Q6IFVwbG9hZFBhcnRDb25maWdbXSA9IFtdXG5cbiAgICAgIHNwbGl0UGFydFNpemVMaXN0LmZvckVhY2goKHNwbGl0U2l6ZSwgc3BsaXRJbmRleDogbnVtYmVyKSA9PiB7XG4gICAgICAgIGlmIChzcGxpdFNpemUpIHtcbiAgICAgICAgICBjb25zdCB7IHN0YXJ0SW5kZXg6IHN0YXJ0SWR4LCBlbmRJbmRleDogZW5kSWR4LCBvYmpJbmZvOiBvYmpDb25maWcgfSA9IHNwbGl0U2l6ZVxuXG4gICAgICAgICAgY29uc3QgcGFydEluZGV4ID0gc3BsaXRJbmRleCArIDEgLy8gcGFydCBpbmRleCBzdGFydHMgZnJvbSAxLlxuICAgICAgICAgIGNvbnN0IHRvdGFsVXBsb2FkcyA9IEFycmF5LmZyb20oc3RhcnRJZHgpXG5cbiAgICAgICAgICBjb25zdCBoZWFkZXJzID0gKHNvdXJjZU9iakxpc3Rbc3BsaXRJbmRleF0gYXMgQ29weVNvdXJjZU9wdGlvbnMpLmdldEhlYWRlcnMoKVxuXG4gICAgICAgICAgdG90YWxVcGxvYWRzLmZvckVhY2goKHNwbGl0U3RhcnQsIHVwbGRDdHJJZHgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHNwbGl0RW5kID0gZW5kSWR4W3VwbGRDdHJJZHhdXG5cbiAgICAgICAgICAgIGNvbnN0IHNvdXJjZU9iaiA9IGAke29iakNvbmZpZy5CdWNrZXR9LyR7b2JqQ29uZmlnLk9iamVjdH1gXG4gICAgICAgICAgICBoZWFkZXJzWyd4LWFtei1jb3B5LXNvdXJjZSddID0gYCR7c291cmNlT2JqfWBcbiAgICAgICAgICAgIGhlYWRlcnNbJ3gtYW16LWNvcHktc291cmNlLXJhbmdlJ10gPSBgYnl0ZXM9JHtzcGxpdFN0YXJ0fS0ke3NwbGl0RW5kfWBcblxuICAgICAgICAgICAgY29uc3QgdXBsb2FkUGFydENvbmZpZyA9IHtcbiAgICAgICAgICAgICAgYnVja2V0TmFtZTogZGVzdE9iakNvbmZpZy5CdWNrZXQsXG4gICAgICAgICAgICAgIG9iamVjdE5hbWU6IGRlc3RPYmpDb25maWcuT2JqZWN0LFxuICAgICAgICAgICAgICB1cGxvYWRJRDogdXBsb2FkSWQsXG4gICAgICAgICAgICAgIHBhcnROdW1iZXI6IHBhcnRJbmRleCxcbiAgICAgICAgICAgICAgaGVhZGVyczogaGVhZGVycyxcbiAgICAgICAgICAgICAgc291cmNlT2JqOiBzb3VyY2VPYmosXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHVwbG9hZFBhcnRDb25maWdMaXN0LnB1c2godXBsb2FkUGFydENvbmZpZylcbiAgICAgICAgICB9KVxuICAgICAgICB9XG4gICAgICB9KVxuXG4gICAgICByZXR1cm4gdXBsb2FkUGFydENvbmZpZ0xpc3RcbiAgICB9XG5cbiAgICBjb25zdCB1cGxvYWRBbGxQYXJ0cyA9IGFzeW5jICh1cGxvYWRMaXN0OiBVcGxvYWRQYXJ0Q29uZmlnW10pID0+IHtcbiAgICAgIGNvbnN0IHBhcnRVcGxvYWRzOiBBd2FpdGVkPFJldHVyblR5cGU8dHlwZW9mIHRoaXMudXBsb2FkUGFydD4+W10gPSBbXVxuXG4gICAgICAvLyBQcm9jZXNzIHVwbG9hZCBwYXJ0cyBpbiBiYXRjaGVzIHRvIGF2b2lkIHRvbyBtYW55IGNvbmN1cnJlbnQgcmVxdWVzdHNcbiAgICAgIGZvciAoY29uc3QgYmF0Y2ggb2YgXy5jaHVuayh1cGxvYWRMaXN0LCBtYXhDb25jdXJyZW5jeSkpIHtcbiAgICAgICAgY29uc3QgYmF0Y2hSZXN1bHRzID0gYXdhaXQgUHJvbWlzZS5hbGwoYmF0Y2gubWFwKChpdGVtKSA9PiB0aGlzLnVwbG9hZFBhcnQoaXRlbSkpKVxuXG4gICAgICAgIHBhcnRVcGxvYWRzLnB1c2goLi4uYmF0Y2hSZXN1bHRzKVxuICAgICAgfVxuXG4gICAgICAvLyBQcm9jZXNzIHJlc3VsdHMgaGVyZSBpZiBuZWVkZWRcbiAgICAgIHJldHVybiBwYXJ0VXBsb2Fkc1xuICAgIH1cblxuICAgIGNvbnN0IHBlcmZvcm1VcGxvYWRQYXJ0cyA9IGFzeW5jICh1cGxvYWRJZDogc3RyaW5nKSA9PiB7XG4gICAgICBjb25zdCB1cGxvYWRMaXN0ID0gZ2V0VXBsb2FkUGFydENvbmZpZ0xpc3QodXBsb2FkSWQpXG4gICAgICBjb25zdCBwYXJ0c1JlcyA9IGF3YWl0IHVwbG9hZEFsbFBhcnRzKHVwbG9hZExpc3QpXG4gICAgICByZXR1cm4gcGFydHNSZXMubWFwKChwYXJ0Q29weSkgPT4gKHsgZXRhZzogcGFydENvcHkuZXRhZywgcGFydDogcGFydENvcHkucGFydCB9KSlcbiAgICB9XG5cbiAgICBjb25zdCBuZXdVcGxvYWRIZWFkZXJzID0gZGVzdE9iakNvbmZpZy5nZXRIZWFkZXJzKClcblxuICAgIGNvbnN0IHVwbG9hZElkID0gYXdhaXQgdGhpcy5pbml0aWF0ZU5ld011bHRpcGFydFVwbG9hZChkZXN0T2JqQ29uZmlnLkJ1Y2tldCwgZGVzdE9iakNvbmZpZy5PYmplY3QsIG5ld1VwbG9hZEhlYWRlcnMpXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHBhcnRzRG9uZSA9IGF3YWl0IHBlcmZvcm1VcGxvYWRQYXJ0cyh1cGxvYWRJZClcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLmNvbXBsZXRlTXVsdGlwYXJ0VXBsb2FkKGRlc3RPYmpDb25maWcuQnVja2V0LCBkZXN0T2JqQ29uZmlnLk9iamVjdCwgdXBsb2FkSWQsIHBhcnRzRG9uZSlcbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLmFib3J0TXVsdGlwYXJ0VXBsb2FkKGRlc3RPYmpDb25maWcuQnVja2V0LCBkZXN0T2JqQ29uZmlnLk9iamVjdCwgdXBsb2FkSWQpXG4gICAgfVxuICB9XG5cbiAgYXN5bmMgcHJlc2lnbmVkVXJsKFxuICAgIG1ldGhvZDogc3RyaW5nLFxuICAgIGJ1Y2tldE5hbWU6IHN0cmluZyxcbiAgICBvYmplY3ROYW1lOiBzdHJpbmcsXG4gICAgZXhwaXJlcz86IG51bWJlciB8IFByZVNpZ25SZXF1ZXN0UGFyYW1zIHwgdW5kZWZpbmVkLFxuICAgIHJlcVBhcmFtcz86IFByZVNpZ25SZXF1ZXN0UGFyYW1zIHwgRGF0ZSxcbiAgICByZXF1ZXN0RGF0ZT86IERhdGUsXG4gICk6IFByb21pc2U8c3RyaW5nPiB7XG4gICAgaWYgKHRoaXMuYW5vbnltb3VzKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkFub255bW91c1JlcXVlc3RFcnJvcihgUHJlc2lnbmVkICR7bWV0aG9kfSB1cmwgY2Fubm90IGJlIGdlbmVyYXRlZCBmb3IgYW5vbnltb3VzIHJlcXVlc3RzYClcbiAgICB9XG5cbiAgICBpZiAoIWV4cGlyZXMpIHtcbiAgICAgIGV4cGlyZXMgPSBQUkVTSUdOX0VYUElSWV9EQVlTX01BWFxuICAgIH1cbiAgICBpZiAoIXJlcVBhcmFtcykge1xuICAgICAgcmVxUGFyYW1zID0ge31cbiAgICB9XG4gICAgaWYgKCFyZXF1ZXN0RGF0ZSkge1xuICAgICAgcmVxdWVzdERhdGUgPSBuZXcgRGF0ZSgpXG4gICAgfVxuXG4gICAgLy8gVHlwZSBhc3NlcnRpb25zXG4gICAgaWYgKGV4cGlyZXMgJiYgdHlwZW9mIGV4cGlyZXMgIT09ICdudW1iZXInKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdleHBpcmVzIHNob3VsZCBiZSBvZiB0eXBlIFwibnVtYmVyXCInKVxuICAgIH1cbiAgICBpZiAocmVxUGFyYW1zICYmIHR5cGVvZiByZXFQYXJhbXMgIT09ICdvYmplY3QnKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdyZXFQYXJhbXMgc2hvdWxkIGJlIG9mIHR5cGUgXCJvYmplY3RcIicpXG4gICAgfVxuICAgIGlmICgocmVxdWVzdERhdGUgJiYgIShyZXF1ZXN0RGF0ZSBpbnN0YW5jZW9mIERhdGUpKSB8fCAocmVxdWVzdERhdGUgJiYgaXNOYU4ocmVxdWVzdERhdGU/LmdldFRpbWUoKSkpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdyZXF1ZXN0RGF0ZSBzaG91bGQgYmUgb2YgdHlwZSBcIkRhdGVcIiBhbmQgdmFsaWQnKVxuICAgIH1cblxuICAgIGNvbnN0IHF1ZXJ5ID0gcmVxUGFyYW1zID8gcXMuc3RyaW5naWZ5KHJlcVBhcmFtcykgOiB1bmRlZmluZWRcblxuICAgIHRyeSB7XG4gICAgICBjb25zdCByZWdpb24gPSBhd2FpdCB0aGlzLmdldEJ1Y2tldFJlZ2lvbkFzeW5jKGJ1Y2tldE5hbWUpXG4gICAgICBhd2FpdCB0aGlzLmNoZWNrQW5kUmVmcmVzaENyZWRzKClcbiAgICAgIGNvbnN0IHJlcU9wdGlvbnMgPSB0aGlzLmdldFJlcXVlc3RPcHRpb25zKHsgbWV0aG9kLCByZWdpb24sIGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIHF1ZXJ5IH0pXG5cbiAgICAgIHJldHVybiBwcmVzaWduU2lnbmF0dXJlVjQoXG4gICAgICAgIHJlcU9wdGlvbnMsXG4gICAgICAgIHRoaXMuYWNjZXNzS2V5LFxuICAgICAgICB0aGlzLnNlY3JldEtleSxcbiAgICAgICAgdGhpcy5zZXNzaW9uVG9rZW4sXG4gICAgICAgIHJlZ2lvbixcbiAgICAgICAgcmVxdWVzdERhdGUsXG4gICAgICAgIGV4cGlyZXMsXG4gICAgICApXG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICBpZiAoZXJyIGluc3RhbmNlb2YgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IpIHtcbiAgICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcihgVW5hYmxlIHRvIGdldCBidWNrZXQgcmVnaW9uIGZvciAke2J1Y2tldE5hbWV9LmApXG4gICAgICB9XG5cbiAgICAgIHRocm93IGVyclxuICAgIH1cbiAgfVxuXG4gIGFzeW5jIHByZXNpZ25lZEdldE9iamVjdChcbiAgICBidWNrZXROYW1lOiBzdHJpbmcsXG4gICAgb2JqZWN0TmFtZTogc3RyaW5nLFxuICAgIGV4cGlyZXM/OiBudW1iZXIsXG4gICAgcmVzcEhlYWRlcnM/OiBQcmVTaWduUmVxdWVzdFBhcmFtcyB8IERhdGUsXG4gICAgcmVxdWVzdERhdGU/OiBEYXRlLFxuICApOiBQcm9taXNlPHN0cmluZz4ge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmICghaXNWYWxpZE9iamVjdE5hbWUob2JqZWN0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZE9iamVjdE5hbWVFcnJvcihgSW52YWxpZCBvYmplY3QgbmFtZTogJHtvYmplY3ROYW1lfWApXG4gICAgfVxuXG4gICAgY29uc3QgdmFsaWRSZXNwSGVhZGVycyA9IFtcbiAgICAgICdyZXNwb25zZS1jb250ZW50LXR5cGUnLFxuICAgICAgJ3Jlc3BvbnNlLWNvbnRlbnQtbGFuZ3VhZ2UnLFxuICAgICAgJ3Jlc3BvbnNlLWV4cGlyZXMnLFxuICAgICAgJ3Jlc3BvbnNlLWNhY2hlLWNvbnRyb2wnLFxuICAgICAgJ3Jlc3BvbnNlLWNvbnRlbnQtZGlzcG9zaXRpb24nLFxuICAgICAgJ3Jlc3BvbnNlLWNvbnRlbnQtZW5jb2RpbmcnLFxuICAgIF1cbiAgICB2YWxpZFJlc3BIZWFkZXJzLmZvckVhY2goKGhlYWRlcikgPT4ge1xuICAgICAgLy8gQHRzLWlnbm9yZVxuICAgICAgaWYgKHJlc3BIZWFkZXJzICE9PSB1bmRlZmluZWQgJiYgcmVzcEhlYWRlcnNbaGVhZGVyXSAhPT0gdW5kZWZpbmVkICYmICFpc1N0cmluZyhyZXNwSGVhZGVyc1toZWFkZXJdKSkge1xuICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKGByZXNwb25zZSBoZWFkZXIgJHtoZWFkZXJ9IHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCJgKVxuICAgICAgfVxuICAgIH0pXG4gICAgcmV0dXJuIHRoaXMucHJlc2lnbmVkVXJsKCdHRVQnLCBidWNrZXROYW1lLCBvYmplY3ROYW1lLCBleHBpcmVzLCByZXNwSGVhZGVycywgcmVxdWVzdERhdGUpXG4gIH1cblxuICBhc3luYyBwcmVzaWduZWRQdXRPYmplY3QoYnVja2V0TmFtZTogc3RyaW5nLCBvYmplY3ROYW1lOiBzdHJpbmcsIGV4cGlyZXM/OiBudW1iZXIpOiBQcm9taXNlPHN0cmluZz4ge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcihgSW52YWxpZCBidWNrZXQgbmFtZTogJHtidWNrZXROYW1lfWApXG4gICAgfVxuICAgIGlmICghaXNWYWxpZE9iamVjdE5hbWUob2JqZWN0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZE9iamVjdE5hbWVFcnJvcihgSW52YWxpZCBvYmplY3QgbmFtZTogJHtvYmplY3ROYW1lfWApXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMucHJlc2lnbmVkVXJsKCdQVVQnLCBidWNrZXROYW1lLCBvYmplY3ROYW1lLCBleHBpcmVzKVxuICB9XG5cbiAgbmV3UG9zdFBvbGljeSgpOiBQb3N0UG9saWN5IHtcbiAgICByZXR1cm4gbmV3IFBvc3RQb2xpY3koKVxuICB9XG5cbiAgYXN5bmMgcHJlc2lnbmVkUG9zdFBvbGljeShwb3N0UG9saWN5OiBQb3N0UG9saWN5KTogUHJvbWlzZTxQb3N0UG9saWN5UmVzdWx0PiB7XG4gICAgaWYgKHRoaXMuYW5vbnltb3VzKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkFub255bW91c1JlcXVlc3RFcnJvcignUHJlc2lnbmVkIFBPU1QgcG9saWN5IGNhbm5vdCBiZSBnZW5lcmF0ZWQgZm9yIGFub255bW91cyByZXF1ZXN0cycpXG4gICAgfVxuICAgIGlmICghaXNPYmplY3QocG9zdFBvbGljeSkpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3Bvc3RQb2xpY3kgc2hvdWxkIGJlIG9mIHR5cGUgXCJvYmplY3RcIicpXG4gICAgfVxuICAgIGNvbnN0IGJ1Y2tldE5hbWUgPSBwb3N0UG9saWN5LmZvcm1EYXRhLmJ1Y2tldCBhcyBzdHJpbmdcbiAgICB0cnkge1xuICAgICAgY29uc3QgcmVnaW9uID0gYXdhaXQgdGhpcy5nZXRCdWNrZXRSZWdpb25Bc3luYyhidWNrZXROYW1lKVxuXG4gICAgICBjb25zdCBkYXRlID0gbmV3IERhdGUoKVxuICAgICAgY29uc3QgZGF0ZVN0ciA9IG1ha2VEYXRlTG9uZyhkYXRlKVxuICAgICAgYXdhaXQgdGhpcy5jaGVja0FuZFJlZnJlc2hDcmVkcygpXG5cbiAgICAgIGlmICghcG9zdFBvbGljeS5wb2xpY3kuZXhwaXJhdGlvbikge1xuICAgICAgICAvLyAnZXhwaXJhdGlvbicgaXMgbWFuZGF0b3J5IGZpZWxkIGZvciBTMy5cbiAgICAgICAgLy8gU2V0IGRlZmF1bHQgZXhwaXJhdGlvbiBkYXRlIG9mIDcgZGF5cy5cbiAgICAgICAgY29uc3QgZXhwaXJlcyA9IG5ldyBEYXRlKClcbiAgICAgICAgZXhwaXJlcy5zZXRTZWNvbmRzKFBSRVNJR05fRVhQSVJZX0RBWVNfTUFYKVxuICAgICAgICBwb3N0UG9saWN5LnNldEV4cGlyZXMoZXhwaXJlcylcbiAgICAgIH1cblxuICAgICAgcG9zdFBvbGljeS5wb2xpY3kuY29uZGl0aW9ucy5wdXNoKFsnZXEnLCAnJHgtYW16LWRhdGUnLCBkYXRlU3RyXSlcbiAgICAgIHBvc3RQb2xpY3kuZm9ybURhdGFbJ3gtYW16LWRhdGUnXSA9IGRhdGVTdHJcblxuICAgICAgcG9zdFBvbGljeS5wb2xpY3kuY29uZGl0aW9ucy5wdXNoKFsnZXEnLCAnJHgtYW16LWFsZ29yaXRobScsICdBV1M0LUhNQUMtU0hBMjU2J10pXG4gICAgICBwb3N0UG9saWN5LmZvcm1EYXRhWyd4LWFtei1hbGdvcml0aG0nXSA9ICdBV1M0LUhNQUMtU0hBMjU2J1xuXG4gICAgICBwb3N0UG9saWN5LnBvbGljeS5jb25kaXRpb25zLnB1c2goWydlcScsICckeC1hbXotY3JlZGVudGlhbCcsIHRoaXMuYWNjZXNzS2V5ICsgJy8nICsgZ2V0U2NvcGUocmVnaW9uLCBkYXRlKV0pXG4gICAgICBwb3N0UG9saWN5LmZvcm1EYXRhWyd4LWFtei1jcmVkZW50aWFsJ10gPSB0aGlzLmFjY2Vzc0tleSArICcvJyArIGdldFNjb3BlKHJlZ2lvbiwgZGF0ZSlcblxuICAgICAgaWYgKHRoaXMuc2Vzc2lvblRva2VuKSB7XG4gICAgICAgIHBvc3RQb2xpY3kucG9saWN5LmNvbmRpdGlvbnMucHVzaChbJ2VxJywgJyR4LWFtei1zZWN1cml0eS10b2tlbicsIHRoaXMuc2Vzc2lvblRva2VuXSlcbiAgICAgICAgcG9zdFBvbGljeS5mb3JtRGF0YVsneC1hbXotc2VjdXJpdHktdG9rZW4nXSA9IHRoaXMuc2Vzc2lvblRva2VuXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHBvbGljeUJhc2U2NCA9IEJ1ZmZlci5mcm9tKEpTT04uc3RyaW5naWZ5KHBvc3RQb2xpY3kucG9saWN5KSkudG9TdHJpbmcoJ2Jhc2U2NCcpXG5cbiAgICAgIHBvc3RQb2xpY3kuZm9ybURhdGEucG9saWN5ID0gcG9saWN5QmFzZTY0XG5cbiAgICAgIHBvc3RQb2xpY3kuZm9ybURhdGFbJ3gtYW16LXNpZ25hdHVyZSddID0gcG9zdFByZXNpZ25TaWduYXR1cmVWNChyZWdpb24sIGRhdGUsIHRoaXMuc2VjcmV0S2V5LCBwb2xpY3lCYXNlNjQpXG4gICAgICBjb25zdCBvcHRzID0ge1xuICAgICAgICByZWdpb246IHJlZ2lvbixcbiAgICAgICAgYnVja2V0TmFtZTogYnVja2V0TmFtZSxcbiAgICAgICAgbWV0aG9kOiAnUE9TVCcsXG4gICAgICB9XG4gICAgICBjb25zdCByZXFPcHRpb25zID0gdGhpcy5nZXRSZXF1ZXN0T3B0aW9ucyhvcHRzKVxuICAgICAgY29uc3QgcG9ydFN0ciA9IHRoaXMucG9ydCA9PSA4MCB8fCB0aGlzLnBvcnQgPT09IDQ0MyA/ICcnIDogYDoke3RoaXMucG9ydC50b1N0cmluZygpfWBcbiAgICAgIGNvbnN0IHVybFN0ciA9IGAke3JlcU9wdGlvbnMucHJvdG9jb2x9Ly8ke3JlcU9wdGlvbnMuaG9zdH0ke3BvcnRTdHJ9JHtyZXFPcHRpb25zLnBhdGh9YFxuICAgICAgcmV0dXJuIHsgcG9zdFVSTDogdXJsU3RyLCBmb3JtRGF0YTogcG9zdFBvbGljeS5mb3JtRGF0YSB9XG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICBpZiAoZXJyIGluc3RhbmNlb2YgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IpIHtcbiAgICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcihgVW5hYmxlIHRvIGdldCBidWNrZXQgcmVnaW9uIGZvciAke2J1Y2tldE5hbWV9LmApXG4gICAgICB9XG5cbiAgICAgIHRocm93IGVyclxuICAgIH1cbiAgfVxuICAvLyBsaXN0IGEgYmF0Y2ggb2Ygb2JqZWN0c1xuICBhc3luYyBsaXN0T2JqZWN0c1F1ZXJ5KGJ1Y2tldE5hbWU6IHN0cmluZywgcHJlZml4Pzogc3RyaW5nLCBtYXJrZXI/OiBzdHJpbmcsIGxpc3RRdWVyeU9wdHM/OiBMaXN0T2JqZWN0UXVlcnlPcHRzKSB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFpc1N0cmluZyhwcmVmaXgpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdwcmVmaXggc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXG4gICAgfVxuICAgIGlmIChtYXJrZXIgJiYgIWlzU3RyaW5nKG1hcmtlcikpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ21hcmtlciBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmluZ1wiJylcbiAgICB9XG5cbiAgICBpZiAobGlzdFF1ZXJ5T3B0cyAmJiAhaXNPYmplY3QobGlzdFF1ZXJ5T3B0cykpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2xpc3RRdWVyeU9wdHMgc2hvdWxkIGJlIG9mIHR5cGUgXCJvYmplY3RcIicpXG4gICAgfVxuICAgIGxldCB7IERlbGltaXRlciwgTWF4S2V5cywgSW5jbHVkZVZlcnNpb24sIHZlcnNpb25JZE1hcmtlciwga2V5TWFya2VyIH0gPSBsaXN0UXVlcnlPcHRzIGFzIExpc3RPYmplY3RRdWVyeU9wdHNcblxuICAgIGlmICghaXNTdHJpbmcoRGVsaW1pdGVyKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignRGVsaW1pdGVyIHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCInKVxuICAgIH1cbiAgICBpZiAoIWlzTnVtYmVyKE1heEtleXMpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdNYXhLZXlzIHNob3VsZCBiZSBvZiB0eXBlIFwibnVtYmVyXCInKVxuICAgIH1cblxuICAgIGNvbnN0IHF1ZXJpZXMgPSBbXVxuICAgIC8vIGVzY2FwZSBldmVyeSB2YWx1ZSBpbiBxdWVyeSBzdHJpbmcsIGV4Y2VwdCBtYXhLZXlzXG4gICAgcXVlcmllcy5wdXNoKGBwcmVmaXg9JHt1cmlFc2NhcGUocHJlZml4KX1gKVxuICAgIHF1ZXJpZXMucHVzaChgZGVsaW1pdGVyPSR7dXJpRXNjYXBlKERlbGltaXRlcil9YClcbiAgICBxdWVyaWVzLnB1c2goYGVuY29kaW5nLXR5cGU9dXJsYClcblxuICAgIGlmIChJbmNsdWRlVmVyc2lvbikge1xuICAgICAgcXVlcmllcy5wdXNoKGB2ZXJzaW9uc2ApXG4gICAgfVxuXG4gICAgaWYgKEluY2x1ZGVWZXJzaW9uKSB7XG4gICAgICAvLyB2MSB2ZXJzaW9uIGxpc3RpbmcuLlxuICAgICAgaWYgKGtleU1hcmtlcikge1xuICAgICAgICBxdWVyaWVzLnB1c2goYGtleS1tYXJrZXI9JHtrZXlNYXJrZXJ9YClcbiAgICAgIH1cbiAgICAgIGlmICh2ZXJzaW9uSWRNYXJrZXIpIHtcbiAgICAgICAgcXVlcmllcy5wdXNoKGB2ZXJzaW9uLWlkLW1hcmtlcj0ke3ZlcnNpb25JZE1hcmtlcn1gKVxuICAgICAgfVxuICAgIH0gZWxzZSBpZiAobWFya2VyKSB7XG4gICAgICBtYXJrZXIgPSB1cmlFc2NhcGUobWFya2VyKVxuICAgICAgcXVlcmllcy5wdXNoKGBtYXJrZXI9JHttYXJrZXJ9YClcbiAgICB9XG5cbiAgICAvLyBubyBuZWVkIHRvIGVzY2FwZSBtYXhLZXlzXG4gICAgaWYgKE1heEtleXMpIHtcbiAgICAgIGlmIChNYXhLZXlzID49IDEwMDApIHtcbiAgICAgICAgTWF4S2V5cyA9IDEwMDBcbiAgICAgIH1cbiAgICAgIHF1ZXJpZXMucHVzaChgbWF4LWtleXM9JHtNYXhLZXlzfWApXG4gICAgfVxuICAgIHF1ZXJpZXMuc29ydCgpXG4gICAgbGV0IHF1ZXJ5ID0gJydcbiAgICBpZiAocXVlcmllcy5sZW5ndGggPiAwKSB7XG4gICAgICBxdWVyeSA9IGAke3F1ZXJpZXMuam9pbignJicpfWBcbiAgICB9XG5cbiAgICBjb25zdCBtZXRob2QgPSAnR0VUJ1xuICAgIGNvbnN0IHJlcyA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luYyh7IG1ldGhvZCwgYnVja2V0TmFtZSwgcXVlcnkgfSlcbiAgICBjb25zdCBib2R5ID0gYXdhaXQgcmVhZEFzU3RyaW5nKHJlcylcbiAgICBjb25zdCBsaXN0UXJ5TGlzdCA9IHBhcnNlTGlzdE9iamVjdHMoYm9keSlcbiAgICByZXR1cm4gbGlzdFFyeUxpc3RcbiAgfVxuXG4gIGxpc3RPYmplY3RzKFxuICAgIGJ1Y2tldE5hbWU6IHN0cmluZyxcbiAgICBwcmVmaXg/OiBzdHJpbmcsXG4gICAgcmVjdXJzaXZlPzogYm9vbGVhbixcbiAgICBsaXN0T3B0cz86IExpc3RPYmplY3RRdWVyeU9wdHMgfCB1bmRlZmluZWQsXG4gICk6IEJ1Y2tldFN0cmVhbTxPYmplY3RJbmZvPiB7XG4gICAgaWYgKHByZWZpeCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICBwcmVmaXggPSAnJ1xuICAgIH1cbiAgICBpZiAocmVjdXJzaXZlID09PSB1bmRlZmluZWQpIHtcbiAgICAgIHJlY3Vyc2l2ZSA9IGZhbHNlXG4gICAgfVxuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmICghaXNWYWxpZFByZWZpeChwcmVmaXgpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRQcmVmaXhFcnJvcihgSW52YWxpZCBwcmVmaXggOiAke3ByZWZpeH1gKVxuICAgIH1cbiAgICBpZiAoIWlzU3RyaW5nKHByZWZpeCkpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3ByZWZpeCBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmluZ1wiJylcbiAgICB9XG4gICAgaWYgKCFpc0Jvb2xlYW4ocmVjdXJzaXZlKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigncmVjdXJzaXZlIHNob3VsZCBiZSBvZiB0eXBlIFwiYm9vbGVhblwiJylcbiAgICB9XG4gICAgaWYgKGxpc3RPcHRzICYmICFpc09iamVjdChsaXN0T3B0cykpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2xpc3RPcHRzIHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxuICAgIH1cbiAgICBsZXQgbWFya2VyOiBzdHJpbmcgfCB1bmRlZmluZWQgPSAnJ1xuICAgIGxldCBrZXlNYXJrZXI6IHN0cmluZyB8IHVuZGVmaW5lZCA9ICcnXG4gICAgbGV0IHZlcnNpb25JZE1hcmtlcjogc3RyaW5nIHwgdW5kZWZpbmVkID0gJydcbiAgICBsZXQgb2JqZWN0czogT2JqZWN0SW5mb1tdID0gW11cbiAgICBsZXQgZW5kZWQgPSBmYWxzZVxuICAgIGNvbnN0IHJlYWRTdHJlYW06IHN0cmVhbS5SZWFkYWJsZSA9IG5ldyBzdHJlYW0uUmVhZGFibGUoeyBvYmplY3RNb2RlOiB0cnVlIH0pXG4gICAgcmVhZFN0cmVhbS5fcmVhZCA9IGFzeW5jICgpID0+IHtcbiAgICAgIC8vIHB1c2ggb25lIG9iamVjdCBwZXIgX3JlYWQoKVxuICAgICAgaWYgKG9iamVjdHMubGVuZ3RoKSB7XG4gICAgICAgIHJlYWRTdHJlYW0ucHVzaChvYmplY3RzLnNoaWZ0KCkpXG4gICAgICAgIHJldHVyblxuICAgICAgfVxuICAgICAgaWYgKGVuZGVkKSB7XG4gICAgICAgIHJldHVybiByZWFkU3RyZWFtLnB1c2gobnVsbClcbiAgICAgIH1cblxuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgbGlzdFF1ZXJ5T3B0cyA9IHtcbiAgICAgICAgICBEZWxpbWl0ZXI6IHJlY3Vyc2l2ZSA/ICcnIDogJy8nLCAvLyBpZiByZWN1cnNpdmUgaXMgZmFsc2Ugc2V0IGRlbGltaXRlciB0byAnLydcbiAgICAgICAgICBNYXhLZXlzOiAxMDAwLFxuICAgICAgICAgIEluY2x1ZGVWZXJzaW9uOiBsaXN0T3B0cz8uSW5jbHVkZVZlcnNpb24sXG4gICAgICAgICAgLy8gdmVyc2lvbiBsaXN0aW5nIHNwZWNpZmljIG9wdGlvbnNcbiAgICAgICAgICBrZXlNYXJrZXI6IGtleU1hcmtlcixcbiAgICAgICAgICB2ZXJzaW9uSWRNYXJrZXI6IHZlcnNpb25JZE1hcmtlcixcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHJlc3VsdDogTGlzdE9iamVjdFF1ZXJ5UmVzID0gYXdhaXQgdGhpcy5saXN0T2JqZWN0c1F1ZXJ5KGJ1Y2tldE5hbWUsIHByZWZpeCwgbWFya2VyLCBsaXN0UXVlcnlPcHRzKVxuICAgICAgICBpZiAocmVzdWx0LmlzVHJ1bmNhdGVkKSB7XG4gICAgICAgICAgbWFya2VyID0gcmVzdWx0Lm5leHRNYXJrZXIgfHwgdW5kZWZpbmVkXG4gICAgICAgICAgaWYgKHJlc3VsdC5rZXlNYXJrZXIpIHtcbiAgICAgICAgICAgIGtleU1hcmtlciA9IHJlc3VsdC5rZXlNYXJrZXJcbiAgICAgICAgICB9XG4gICAgICAgICAgaWYgKHJlc3VsdC52ZXJzaW9uSWRNYXJrZXIpIHtcbiAgICAgICAgICAgIHZlcnNpb25JZE1hcmtlciA9IHJlc3VsdC52ZXJzaW9uSWRNYXJrZXJcbiAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgZW5kZWQgPSB0cnVlXG4gICAgICAgIH1cbiAgICAgICAgaWYgKHJlc3VsdC5vYmplY3RzKSB7XG4gICAgICAgICAgb2JqZWN0cyA9IHJlc3VsdC5vYmplY3RzXG4gICAgICAgIH1cbiAgICAgICAgLy8gQHRzLWlnbm9yZVxuICAgICAgICByZWFkU3RyZWFtLl9yZWFkKClcbiAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICByZWFkU3RyZWFtLmVtaXQoJ2Vycm9yJywgZXJyKVxuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gcmVhZFN0cmVhbVxuICB9XG5cbiAgYXN5bmMgbGlzdE9iamVjdHNWMlF1ZXJ5KFxuICAgIGJ1Y2tldE5hbWU6IHN0cmluZyxcbiAgICBwcmVmaXg6IHN0cmluZyxcbiAgICBjb250aW51YXRpb25Ub2tlbjogc3RyaW5nLFxuICAgIGRlbGltaXRlcjogc3RyaW5nLFxuICAgIG1heEtleXM6IG51bWJlcixcbiAgICBzdGFydEFmdGVyOiBzdHJpbmcsXG4gICk6IFByb21pc2U8TGlzdE9iamVjdFYyUmVzPiB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFpc1N0cmluZyhwcmVmaXgpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdwcmVmaXggc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXG4gICAgfVxuICAgIGlmICghaXNTdHJpbmcoY29udGludWF0aW9uVG9rZW4pKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdjb250aW51YXRpb25Ub2tlbiBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmluZ1wiJylcbiAgICB9XG4gICAgaWYgKCFpc1N0cmluZyhkZWxpbWl0ZXIpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdkZWxpbWl0ZXIgc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXG4gICAgfVxuICAgIGlmICghaXNOdW1iZXIobWF4S2V5cykpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ21heEtleXMgc2hvdWxkIGJlIG9mIHR5cGUgXCJudW1iZXJcIicpXG4gICAgfVxuICAgIGlmICghaXNTdHJpbmcoc3RhcnRBZnRlcikpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3N0YXJ0QWZ0ZXIgc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXG4gICAgfVxuXG4gICAgY29uc3QgcXVlcmllcyA9IFtdXG4gICAgcXVlcmllcy5wdXNoKGBsaXN0LXR5cGU9MmApXG4gICAgcXVlcmllcy5wdXNoKGBlbmNvZGluZy10eXBlPXVybGApXG4gICAgcXVlcmllcy5wdXNoKGBwcmVmaXg9JHt1cmlFc2NhcGUocHJlZml4KX1gKVxuICAgIHF1ZXJpZXMucHVzaChgZGVsaW1pdGVyPSR7dXJpRXNjYXBlKGRlbGltaXRlcil9YClcblxuICAgIGlmIChjb250aW51YXRpb25Ub2tlbikge1xuICAgICAgcXVlcmllcy5wdXNoKGBjb250aW51YXRpb24tdG9rZW49JHt1cmlFc2NhcGUoY29udGludWF0aW9uVG9rZW4pfWApXG4gICAgfVxuICAgIGlmIChzdGFydEFmdGVyKSB7XG4gICAgICBxdWVyaWVzLnB1c2goYHN0YXJ0LWFmdGVyPSR7dXJpRXNjYXBlKHN0YXJ0QWZ0ZXIpfWApXG4gICAgfVxuICAgIGlmIChtYXhLZXlzKSB7XG4gICAgICBpZiAobWF4S2V5cyA+PSAxMDAwKSB7XG4gICAgICAgIG1heEtleXMgPSAxMDAwXG4gICAgICB9XG4gICAgICBxdWVyaWVzLnB1c2goYG1heC1rZXlzPSR7bWF4S2V5c31gKVxuICAgIH1cbiAgICBxdWVyaWVzLnNvcnQoKVxuICAgIGxldCBxdWVyeSA9ICcnXG4gICAgaWYgKHF1ZXJpZXMubGVuZ3RoID4gMCkge1xuICAgICAgcXVlcnkgPSBgJHtxdWVyaWVzLmpvaW4oJyYnKX1gXG4gICAgfVxuXG4gICAgY29uc3QgbWV0aG9kID0gJ0dFVCdcbiAgICBjb25zdCByZXMgPSBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmMoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIHF1ZXJ5IH0pXG4gICAgY29uc3QgYm9keSA9IGF3YWl0IHJlYWRBc1N0cmluZyhyZXMpXG4gICAgcmV0dXJuIHBhcnNlTGlzdE9iamVjdHNWMihib2R5KVxuICB9XG5cbiAgbGlzdE9iamVjdHNWMihcbiAgICBidWNrZXROYW1lOiBzdHJpbmcsXG4gICAgcHJlZml4Pzogc3RyaW5nLFxuICAgIHJlY3Vyc2l2ZT86IGJvb2xlYW4sXG4gICAgc3RhcnRBZnRlcj86IHN0cmluZyxcbiAgKTogQnVja2V0U3RyZWFtPEJ1Y2tldEl0ZW0+IHtcbiAgICBpZiAocHJlZml4ID09PSB1bmRlZmluZWQpIHtcbiAgICAgIHByZWZpeCA9ICcnXG4gICAgfVxuICAgIGlmIChyZWN1cnNpdmUgPT09IHVuZGVmaW5lZCkge1xuICAgICAgcmVjdXJzaXZlID0gZmFsc2VcbiAgICB9XG4gICAgaWYgKHN0YXJ0QWZ0ZXIgPT09IHVuZGVmaW5lZCkge1xuICAgICAgc3RhcnRBZnRlciA9ICcnXG4gICAgfVxuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmICghaXNWYWxpZFByZWZpeChwcmVmaXgpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRQcmVmaXhFcnJvcihgSW52YWxpZCBwcmVmaXggOiAke3ByZWZpeH1gKVxuICAgIH1cbiAgICBpZiAoIWlzU3RyaW5nKHByZWZpeCkpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3ByZWZpeCBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmluZ1wiJylcbiAgICB9XG4gICAgaWYgKCFpc0Jvb2xlYW4ocmVjdXJzaXZlKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigncmVjdXJzaXZlIHNob3VsZCBiZSBvZiB0eXBlIFwiYm9vbGVhblwiJylcbiAgICB9XG4gICAgaWYgKCFpc1N0cmluZyhzdGFydEFmdGVyKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignc3RhcnRBZnRlciBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmluZ1wiJylcbiAgICB9XG5cbiAgICBjb25zdCBkZWxpbWl0ZXIgPSByZWN1cnNpdmUgPyAnJyA6ICcvJ1xuICAgIGNvbnN0IHByZWZpeFN0ciA9IHByZWZpeFxuICAgIGNvbnN0IHN0YXJ0QWZ0ZXJTdHIgPSBzdGFydEFmdGVyXG4gICAgbGV0IGNvbnRpbnVhdGlvblRva2VuID0gJydcbiAgICBsZXQgb2JqZWN0czogQnVja2V0SXRlbVtdID0gW11cbiAgICBsZXQgZW5kZWQgPSBmYWxzZVxuICAgIGNvbnN0IHJlYWRTdHJlYW06IHN0cmVhbS5SZWFkYWJsZSA9IG5ldyBzdHJlYW0uUmVhZGFibGUoeyBvYmplY3RNb2RlOiB0cnVlIH0pXG4gICAgcmVhZFN0cmVhbS5fcmVhZCA9IGFzeW5jICgpID0+IHtcbiAgICAgIGlmIChvYmplY3RzLmxlbmd0aCkge1xuICAgICAgICByZWFkU3RyZWFtLnB1c2gob2JqZWN0cy5zaGlmdCgpKVxuICAgICAgICByZXR1cm5cbiAgICAgIH1cbiAgICAgIGlmIChlbmRlZCkge1xuICAgICAgICByZXR1cm4gcmVhZFN0cmVhbS5wdXNoKG51bGwpXG4gICAgICB9XG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMubGlzdE9iamVjdHNWMlF1ZXJ5KFxuICAgICAgICAgIGJ1Y2tldE5hbWUsXG4gICAgICAgICAgcHJlZml4U3RyLFxuICAgICAgICAgIGNvbnRpbnVhdGlvblRva2VuLFxuICAgICAgICAgIGRlbGltaXRlcixcbiAgICAgICAgICAxMDAwLFxuICAgICAgICAgIHN0YXJ0QWZ0ZXJTdHIsXG4gICAgICAgIClcbiAgICAgICAgaWYgKHJlc3VsdC5pc1RydW5jYXRlZCkge1xuICAgICAgICAgIGNvbnRpbnVhdGlvblRva2VuID0gcmVzdWx0Lm5leHRDb250aW51YXRpb25Ub2tlblxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGVuZGVkID0gdHJ1ZVxuICAgICAgICB9XG4gICAgICAgIG9iamVjdHMgPSByZXN1bHQub2JqZWN0c1xuICAgICAgICAvLyBAdHMtaWdub3JlXG4gICAgICAgIHJlYWRTdHJlYW0uX3JlYWQoKVxuICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgIHJlYWRTdHJlYW0uZW1pdCgnZXJyb3InLCBlcnIpXG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiByZWFkU3RyZWFtXG4gIH1cblxuICBhc3luYyBzZXRCdWNrZXROb3RpZmljYXRpb24oYnVja2V0TmFtZTogc3RyaW5nLCBjb25maWc6IE5vdGlmaWNhdGlvbkNvbmZpZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmICghaXNPYmplY3QoY29uZmlnKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignbm90aWZpY2F0aW9uIGNvbmZpZyBzaG91bGQgYmUgb2YgdHlwZSBcIk9iamVjdFwiJylcbiAgICB9XG4gICAgY29uc3QgbWV0aG9kID0gJ1BVVCdcbiAgICBjb25zdCBxdWVyeSA9ICdub3RpZmljYXRpb24nXG4gICAgY29uc3QgYnVpbGRlciA9IG5ldyB4bWwyanMuQnVpbGRlcih7XG4gICAgICByb290TmFtZTogJ05vdGlmaWNhdGlvbkNvbmZpZ3VyYXRpb24nLFxuICAgICAgcmVuZGVyT3B0czogeyBwcmV0dHk6IGZhbHNlIH0sXG4gICAgICBoZWFkbGVzczogdHJ1ZSxcbiAgICB9KVxuICAgIGNvbnN0IHBheWxvYWQgPSBidWlsZGVyLmJ1aWxkT2JqZWN0KGNvbmZpZylcbiAgICBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmNPbWl0KHsgbWV0aG9kLCBidWNrZXROYW1lLCBxdWVyeSB9LCBwYXlsb2FkKVxuICB9XG5cbiAgYXN5bmMgcmVtb3ZlQWxsQnVja2V0Tm90aWZpY2F0aW9uKGJ1Y2tldE5hbWU6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGF3YWl0IHRoaXMuc2V0QnVja2V0Tm90aWZpY2F0aW9uKGJ1Y2tldE5hbWUsIG5ldyBOb3RpZmljYXRpb25Db25maWcoKSlcbiAgfVxuXG4gIGFzeW5jIGdldEJ1Y2tldE5vdGlmaWNhdGlvbihidWNrZXROYW1lOiBzdHJpbmcpOiBQcm9taXNlPE5vdGlmaWNhdGlvbkNvbmZpZ1Jlc3VsdD4ge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGNvbnN0IG1ldGhvZCA9ICdHRVQnXG4gICAgY29uc3QgcXVlcnkgPSAnbm90aWZpY2F0aW9uJ1xuICAgIGNvbnN0IHJlcyA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luYyh7IG1ldGhvZCwgYnVja2V0TmFtZSwgcXVlcnkgfSlcbiAgICBjb25zdCBib2R5ID0gYXdhaXQgcmVhZEFzU3RyaW5nKHJlcylcbiAgICByZXR1cm4gcGFyc2VCdWNrZXROb3RpZmljYXRpb24oYm9keSlcbiAgfVxuXG4gIGxpc3RlbkJ1Y2tldE5vdGlmaWNhdGlvbihcbiAgICBidWNrZXROYW1lOiBzdHJpbmcsXG4gICAgcHJlZml4OiBzdHJpbmcsXG4gICAgc3VmZml4OiBzdHJpbmcsXG4gICAgZXZlbnRzOiBOb3RpZmljYXRpb25FdmVudFtdLFxuICApOiBOb3RpZmljYXRpb25Qb2xsZXIge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcihgSW52YWxpZCBidWNrZXQgbmFtZTogJHtidWNrZXROYW1lfWApXG4gICAgfVxuICAgIGlmICghaXNTdHJpbmcocHJlZml4KSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigncHJlZml4IG11c3QgYmUgb2YgdHlwZSBzdHJpbmcnKVxuICAgIH1cbiAgICBpZiAoIWlzU3RyaW5nKHN1ZmZpeCkpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3N1ZmZpeCBtdXN0IGJlIG9mIHR5cGUgc3RyaW5nJylcbiAgICB9XG4gICAgaWYgKCFBcnJheS5pc0FycmF5KGV2ZW50cykpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2V2ZW50cyBtdXN0IGJlIG9mIHR5cGUgQXJyYXknKVxuICAgIH1cbiAgICBjb25zdCBsaXN0ZW5lciA9IG5ldyBOb3RpZmljYXRpb25Qb2xsZXIodGhpcywgYnVja2V0TmFtZSwgcHJlZml4LCBzdWZmaXgsIGV2ZW50cylcbiAgICBsaXN0ZW5lci5zdGFydCgpXG4gICAgcmV0dXJuIGxpc3RlbmVyXG4gIH1cbn1cbiJdLCJtYXBwaW5ncyI6Ijs7Ozs7QUFBQSxJQUFBQSxNQUFBLEdBQUFDLHVCQUFBLENBQUFDLE9BQUE7QUFDQSxJQUFBQyxFQUFBLEdBQUFGLHVCQUFBLENBQUFDLE9BQUE7QUFFQSxJQUFBRSxJQUFBLEdBQUFILHVCQUFBLENBQUFDLE9BQUE7QUFDQSxJQUFBRyxLQUFBLEdBQUFKLHVCQUFBLENBQUFDLE9BQUE7QUFDQSxJQUFBSSxJQUFBLEdBQUFMLHVCQUFBLENBQUFDLE9BQUE7QUFD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