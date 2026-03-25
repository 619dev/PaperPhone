import * as crypto from "crypto";
import * as fs from "fs";
import * as http from "http";
import * as https from "https";
import * as path from "path";
import * as stream from "stream";
import * as async from 'async';
import BlockStream2 from 'block-stream2';
import { isBrowser } from 'browser-or-node';
import _ from 'lodash';
import * as qs from 'query-string';
import xml2js from 'xml2js';
import { CredentialProvider } from "../CredentialProvider.mjs";
import * as errors from "../errors.mjs";
import { CopyDestinationOptions, CopySourceOptions, DEFAULT_REGION, LEGAL_HOLD_STATUS, PRESIGN_EXPIRY_DAYS_MAX, RETENTION_MODES, RETENTION_VALIDITY_UNITS } from "../helpers.mjs";
import { NotificationConfig, NotificationPoller } from "../notification.mjs";
import { postPresignSignatureV4, presignSignatureV4, signV4 } from "../signing.mjs";
import { fsp, streamPromise } from "./async.mjs";
import { CopyConditions } from "./copy-conditions.mjs";
import { Extensions } from "./extensions.mjs";
import { calculateEvenSplits, extractMetadata, getContentLength, getScope, getSourceVersionId, getVersionId, hashBinary, insertContentType, isAmazonEndpoint, isBoolean, isDefined, isEmpty, isNumber, isObject, isPlainObject, isReadableStream, isString, isValidBucketName, isValidEndpoint, isValidObjectName, isValidPort, isValidPrefix, isVirtualHostStyle, makeDateLong, PART_CONSTRAINTS, partsRequired, prependXAMZMeta, readableStream, sanitizeETag, toMd5, toSha256, uriEscape, uriResourceEscape } from "./helper.mjs";
import { joinHostPort } from "./join-host-port.mjs";
import { PostPolicy } from "./post-policy.mjs";
import { requestWithRetry } from "./request.mjs";
import { drainResponse, readAsBuffer, readAsString } from "./response.mjs";
import { getS3Endpoint } from "./s3-endpoints.mjs";
import { parseBucketNotification, parseCompleteMultipart, parseInitiateMultipart, parseListObjects, parseListObjectsV2, parseObjectLegalHoldConfig, parseSelectObjectContentResponse, uploadPartParser } from "./xml-parser.mjs";
import * as xmlParsers from "./xml-parser.mjs";
const xml = new xml2js.Builder({
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
export class TypedClient {
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
    if (!isValidEndpoint(params.endPoint)) {
      throw new errors.InvalidEndpointError(`Invalid endPoint : ${params.endPoint}`);
    }
    if (!isValidPort(params.port)) {
      throw new errors.InvalidArgumentError(`Invalid port : ${params.port}`);
    }
    if (!isBoolean(params.useSSL)) {
      throw new errors.InvalidArgumentError(`Invalid useSSL flag type : ${params.useSSL}, expected to be of type "boolean"`);
    }

    // Validate region only if its set.
    if (params.region) {
      if (!isString(params.region)) {
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
      if (!isObject(params.transport)) {
        throw new errors.InvalidArgumentError(`Invalid transport type : ${params.transport}, expected to be type "object"`);
      }
      transport = params.transport;
    }

    // if custom transport agent is set, use it.
    if (params.transportAgent) {
      if (!isObject(params.transportAgent)) {
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
    this.clientExtensions = new Extensions(this);
    if (params.retryOptions) {
      if (!isObject(params.retryOptions)) {
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
    if (!isObject(options)) {
      throw new TypeError('request options should be of type "object"');
    }
    this.reqOptions = _.pick(options, requestOptionProperties);
  }

  /**
   *  This is s3 Specific and does not hold validity in any other Object storage.
   */
  getAccelerateEndPointIfSet(bucketName, objectName) {
    if (!isEmpty(this.s3AccelerateEndpoint) && !isEmpty(bucketName) && !isEmpty(objectName)) {
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
    if (!isString(appName)) {
      throw new TypeError(`Invalid appName: ${appName}`);
    }
    if (appName.trim() === '') {
      throw new errors.InvalidArgumentError('Input appName cannot be empty.');
    }
    if (!isString(appVersion)) {
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
      virtualHostStyle = isVirtualHostStyle(this.host, this.protocol, bucketName, this.pathStyle);
    }
    let path = '/';
    let host = this.host;
    let port;
    if (this.port) {
      port = this.port;
    }
    if (objectName) {
      objectName = uriResourceEscape(objectName);
    }

    // For Amazon S3 endpoint, get endpoint based on region.
    if (isAmazonEndpoint(host)) {
      const accelerateEndPoint = this.getAccelerateEndPointIfSet(bucketName, objectName);
      if (accelerateEndPoint) {
        host = `${accelerateEndPoint}`;
      } else {
        host = getS3Endpoint(region);
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
      reqOptions.headers.host = joinHostPort(host, port);
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
      headers: _.mapValues(_.pickBy(reqOptions.headers, isDefined), v => v.toString()),
      host,
      port,
      path
    };
  }
  async setCredentialsProvider(credentialsProvider) {
    if (!(credentialsProvider instanceof CredentialProvider)) {
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
    if (!isObject(reqOptions)) {
      throw new TypeError('reqOptions should be of type "object"');
    }
    if (response && !isReadableStream(response)) {
      throw new TypeError('response should be of type "Stream"');
    }
    if (err && !(err instanceof Error)) {
      throw new TypeError('err should be of type "Error"');
    }
    const logStream = this.logStream;
    const logHeaders = headers => {
      Object.entries(headers).forEach(([k, v]) => {
        if (k == 'authorization') {
          if (isString(v)) {
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
    if (!isObject(options)) {
      throw new TypeError('options should be of type "object"');
    }
    if (!isString(payload) && !isObject(payload)) {
      // Buffer is of type 'object'
      throw new TypeError('payload should be of type "string" or "Buffer"');
    }
    expectedCodes.forEach(statusCode => {
      if (!isNumber(statusCode)) {
        throw new TypeError('statusCode should be of type "number"');
      }
    });
    if (!isString(region)) {
      throw new TypeError('region should be of type "string"');
    }
    if (!options.headers) {
      options.headers = {};
    }
    if (options.method === 'POST' || options.method === 'PUT' || options.method === 'DELETE') {
      options.headers['content-length'] = payload.length.toString();
    }
    const sha256sum = this.enableSHA256 ? toSha256(payload) : '';
    return this.makeRequestStreamAsync(options, payload, sha256sum, expectedCodes, region);
  }

  /**
   * new request with promise
   *
   * No need to drain response, response body is not valid
   */
  async makeRequestAsyncOmit(options, payload = '', statusCodes = [200], region = '') {
    const res = await this.makeRequestAsync(options, payload, statusCodes, region);
    await drainResponse(res);
    return res;
  }

  /**
   * makeRequestStream will be used directly instead of makeRequest in case the payload
   * is available as a stream. for ex. putObject
   *
   * @internal
   */
  async makeRequestStreamAsync(options, body, sha256sum, statusCodes, region) {
    if (!isObject(options)) {
      throw new TypeError('options should be of type "object"');
    }
    if (!(Buffer.isBuffer(body) || typeof body === 'string' || isReadableStream(body))) {
      throw new errors.InvalidArgumentError(`stream should be a Buffer, string or readable Stream, got ${typeof body} instead`);
    }
    if (!isString(sha256sum)) {
      throw new TypeError('sha256sum should be of type "string"');
    }
    statusCodes.forEach(statusCode => {
      if (!isNumber(statusCode)) {
        throw new TypeError('statusCode should be of type "number"');
      }
    });
    if (!isString(region)) {
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
      reqOptions.headers['x-amz-date'] = makeDateLong(date);
      reqOptions.headers['x-amz-content-sha256'] = sha256sum;
      if (this.sessionToken) {
        reqOptions.headers['x-amz-security-token'] = this.sessionToken;
      }
      reqOptions.headers.authorization = signV4(reqOptions, this.accessKey, this.secretKey, region, date, sha256sum);
    }
    const response = await requestWithRetry(this.transport, reqOptions, body, this.retryOptions.disableRetry === true ? 0 : this.retryOptions.maximumRetryCount, this.retryOptions.baseDelayMs, this.retryOptions.maximumDelayMs);
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
    if (!isValidBucketName(bucketName)) {
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
      const body = await readAsString(response);
      const region = xmlParsers.parseBucketRegion(body) || DEFAULT_REGION;
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
    const pathStyle = this.pathStyle && !isBrowser;
    let region;
    try {
      const res = await this.makeRequestAsync({
        method,
        bucketName,
        query,
        pathStyle
      }, '', [200], DEFAULT_REGION);
      return extractRegionAsync(res);
    } catch (e) {
      // make alignment with mc cli
      if (e instanceof errors.S3Error) {
        const errCode = e.code;
        const errRegion = e.region;
        if (errCode === 'AccessDenied' && !errRegion) {
          return DEFAULT_REGION;
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
        await drainResponse(res);
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
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    // Backward Compatibility
    if (isObject(region)) {
      makeOpts = region;
      region = '';
    }
    if (!isString(region)) {
      throw new TypeError('region should be of type "string"');
    }
    if (makeOpts && !isObject(makeOpts)) {
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
    if (region && region !== DEFAULT_REGION) {
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
    const finalRegion = this.region || region || DEFAULT_REGION;
    const requestOpt = {
      method,
      bucketName,
      headers
    };
    try {
      await this.makeRequestAsyncOmit(requestOpt, payload, [200], finalRegion);
    } catch (err) {
      if (region === '' || region === DEFAULT_REGION) {
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
    if (!isValidBucketName(bucketName)) {
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
    if (!isValidBucketName(bucketName)) {
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
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
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
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!isNumber(offset)) {
      throw new TypeError('offset should be of type "number"');
    }
    if (!isNumber(length)) {
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
        ...prependXAMZMeta(sseHeaders),
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
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!isString(filePath)) {
      throw new TypeError('filePath should be of type "string"');
    }
    const downloadToTmpFile = async () => {
      let partFileStream;
      const objStat = await this.statObject(bucketName, objectName, getOpts);
      const encodedEtag = Buffer.from(objStat.etag).toString('base64');
      const partFile = `${filePath}.${encodedEtag}.part.minio`;
      await fsp.mkdir(path.dirname(filePath), {
        recursive: true
      });
      let offset = 0;
      try {
        const stats = await fsp.stat(partFile);
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
      await streamPromise.pipeline(downloadStream, partFileStream);
      const stats = await fsp.stat(partFile);
      if (stats.size === objStat.size) {
        return partFile;
      }
      throw new Error('Size mismatch between downloaded file and the object');
    };
    const partFile = await downloadToTmpFile();
    await fsp.rename(partFile, filePath);
  }

  /**
   * Stat information of the object.
   */
  async statObject(bucketName, objectName, statOpts) {
    const statOptDef = statOpts || {};
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!isObject(statOptDef)) {
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
      metaData: extractMetadata(res.headers),
      lastModified: new Date(res.headers['last-modified']),
      versionId: getVersionId(res.headers),
      etag: sanitizeETag(res.headers.etag)
    };
  }
  async removeObject(bucketName, objectName, removeOpts) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name: ${bucketName}`);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (removeOpts && !isObject(removeOpts)) {
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
    if (!isValidBucketName(bucket)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucket);
    }
    if (!isValidPrefix(prefix)) {
      throw new errors.InvalidPrefixError(`Invalid prefix : ${prefix}`);
    }
    if (!isBoolean(recursive)) {
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
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isString(prefix)) {
      throw new TypeError('prefix should be of type "string"');
    }
    if (!isString(keyMarker)) {
      throw new TypeError('keyMarker should be of type "string"');
    }
    if (!isString(uploadIdMarker)) {
      throw new TypeError('uploadIdMarker should be of type "string"');
    }
    if (!isString(delimiter)) {
      throw new TypeError('delimiter should be of type "string"');
    }
    const queries = [];
    queries.push(`prefix=${uriEscape(prefix)}`);
    queries.push(`delimiter=${uriEscape(delimiter)}`);
    if (keyMarker) {
      queries.push(`key-marker=${uriEscape(keyMarker)}`);
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
    const body = await readAsString(res);
    return xmlParsers.parseListMultipart(body);
  }

  /**
   * Initiate a new multipart upload.
   * @internal
   */
  async initiateNewMultipartUpload(bucketName, objectName, headers) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!isObject(headers)) {
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
    const body = await readAsBuffer(res);
    return parseInitiateMultipart(body.toString());
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
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
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
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!isString(uploadId)) {
      throw new TypeError('uploadId should be of type "string"');
    }
    if (!isObject(etags)) {
      throw new TypeError('etags should be of type "Array"');
    }
    if (!uploadId) {
      throw new errors.InvalidArgumentError('uploadId cannot be empty');
    }
    const method = 'POST';
    const query = `uploadId=${uriEscape(uploadId)}`;
    const builder = new xml2js.Builder();
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
    const body = await readAsBuffer(res);
    const result = parseCompleteMultipart(body.toString());
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
      versionId: getVersionId(res.headers)
    };
  }

  /**
   * Get part-info of all parts of an incomplete upload specified by uploadId.
   */
  async listParts(bucketName, objectName, uploadId) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!isString(uploadId)) {
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
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!isString(uploadId)) {
      throw new TypeError('uploadId should be of type "string"');
    }
    if (!isNumber(marker)) {
      throw new TypeError('marker should be of type "number"');
    }
    if (!uploadId) {
      throw new errors.InvalidArgumentError('uploadId cannot be empty');
    }
    let query = `uploadId=${uriEscape(uploadId)}`;
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
    return xmlParsers.parseListParts(await readAsString(res));
  }
  async listBuckets() {
    const method = 'GET';
    const regionConf = this.region || DEFAULT_REGION;
    const httpRes = await this.makeRequestAsync({
      method
    }, '', [200], regionConf);
    const xmlResult = await readAsString(httpRes);
    return xmlParsers.parseListBucket(xmlResult);
  }

  /**
   * Calculate part size given the object size. Part size will be atleast this.partSize
   */
  calculatePartSize(size) {
    if (!isNumber(size)) {
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
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!isString(filePath)) {
      throw new TypeError('filePath should be of type "string"');
    }
    if (metaData && !isObject(metaData)) {
      throw new TypeError('metaData should be of type "object"');
    }

    // Inserts correct `content-type` attribute based on metaData and filePath
    metaData = insertContentType(metaData || {}, filePath);
    const stat = await fsp.stat(filePath);
    return await this.putObject(bucketName, objectName, fs.createReadStream(filePath), stat.size, metaData);
  }

  /**
   *  Uploading a stream, "Buffer" or "string".
   *  It's recommended to pass `size` argument with stream.
   */
  async putObject(bucketName, objectName, stream, size, metaData) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name: ${bucketName}`);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }

    // We'll need to shift arguments to the left because of metaData
    // and size being optional.
    if (isObject(size)) {
      metaData = size;
    }
    // Ensures Metadata has appropriate prefix for A3 API
    const headers = prependXAMZMeta(metaData);
    if (typeof stream === 'string' || stream instanceof Buffer) {
      // Adapts the non-stream interface into a stream.
      size = stream.length;
      stream = readableStream(stream);
    } else if (!isReadableStream(stream)) {
      throw new TypeError('third argument should be of type "stream.Readable" or "Buffer" or "string"');
    }
    if (isNumber(size) && size < 0) {
      throw new errors.InvalidArgumentError(`size cannot be negative, given size: ${size}`);
    }

    // Get the part size and forward that to the BlockStream. Default to the
    // largest block size possible if necessary.
    if (!isNumber(size)) {
      size = this.maxObjectSize;
    }

    // Get the part size and forward that to the BlockStream. Default to the
    // largest block size possible if necessary.
    if (size === undefined) {
      const statSize = await getContentLength(stream);
      if (statSize !== null) {
        size = statSize;
      }
    }
    if (!isNumber(size)) {
      // Backward compatibility
      size = this.maxObjectSize;
    }
    if (size === 0) {
      return this.uploadBuffer(bucketName, objectName, headers, Buffer.from(''));
    }
    const partSize = this.calculatePartSize(size);
    if (typeof stream === 'string' || Buffer.isBuffer(stream) || size <= partSize) {
      const buf = isReadableStream(stream) ? await readAsBuffer(stream) : Buffer.from(stream);
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
    } = hashBinary(buf, this.enableSHA256);
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
    await drainResponse(res);
    return {
      etag: sanitizeETag(res.headers.etag),
      versionId: getVersionId(res.headers)
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
    const chunkier = new BlockStream2({
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
    if (!isValidBucketName(bucketName)) {
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
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isObject(replicationConfig)) {
      throw new errors.InvalidArgumentError('replicationConfig should be of type "object"');
    } else {
      if (_.isEmpty(replicationConfig.role)) {
        throw new errors.InvalidArgumentError('Role cannot be empty');
      } else if (replicationConfig.role && !isString(replicationConfig.role)) {
        throw new errors.InvalidArgumentError('Invalid value for role', replicationConfig.role);
      }
      if (_.isEmpty(replicationConfig.rules)) {
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
    const builder = new xml2js.Builder({
      renderOpts: {
        pretty: false
      },
      headless: true
    });
    const payload = builder.buildObject(replicationParamsConfig);
    headers['Content-MD5'] = toMd5(payload);
    await this.makeRequestAsyncOmit({
      method,
      bucketName,
      query,
      headers
    }, payload);
  }
  async getBucketReplication(bucketName) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    const method = 'GET';
    const query = 'replication';
    const httpRes = await this.makeRequestAsync({
      method,
      bucketName,
      query
    }, '', [200, 204]);
    const xmlResult = await readAsString(httpRes);
    return xmlParsers.parseReplicationConfig(xmlResult);
  }
  async getObjectLegalHold(bucketName, objectName, getOpts) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (getOpts) {
      if (!isObject(getOpts)) {
        throw new TypeError('getOpts should be of type "Object"');
      } else if (Object.keys(getOpts).length > 0 && getOpts.versionId && !isString(getOpts.versionId)) {
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
    const strRes = await readAsString(httpRes);
    return parseObjectLegalHoldConfig(strRes);
  }
  async setObjectLegalHold(bucketName, objectName, setOpts = {
    status: LEGAL_HOLD_STATUS.ENABLED
  }) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!isObject(setOpts)) {
      throw new TypeError('setOpts should be of type "Object"');
    } else {
      if (![LEGAL_HOLD_STATUS.ENABLED, LEGAL_HOLD_STATUS.DISABLED].includes(setOpts === null || setOpts === void 0 ? void 0 : setOpts.status)) {
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
    const builder = new xml2js.Builder({
      rootName: 'LegalHold',
      renderOpts: {
        pretty: false
      },
      headless: true
    });
    const payload = builder.buildObject(config);
    const headers = {};
    headers['Content-MD5'] = toMd5(payload);
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
    if (!isValidBucketName(bucketName)) {
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
    const body = await readAsString(response);
    return xmlParsers.parseTagging(body);
  }

  /**
   *  Get the tags associated with a bucket OR an object
   */
  async getObjectTagging(bucketName, objectName, getOpts) {
    const method = 'GET';
    let query = 'tagging';
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidBucketNameError('Invalid object name: ' + objectName);
    }
    if (getOpts && !isObject(getOpts)) {
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
    const body = await readAsString(response);
    return xmlParsers.parseTagging(body);
  }

  /**
   *  Set the policy on a bucket or an object prefix.
   */
  async setBucketPolicy(bucketName, policy) {
    // Validate arguments.
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name: ${bucketName}`);
    }
    if (!isString(policy)) {
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
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name: ${bucketName}`);
    }
    const method = 'GET';
    const query = 'policy';
    const res = await this.makeRequestAsync({
      method,
      bucketName,
      query
    });
    return await readAsString(res);
  }
  async putObjectRetention(bucketName, objectName, retentionOpts = {}) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name: ${bucketName}`);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!isObject(retentionOpts)) {
      throw new errors.InvalidArgumentError('retentionOpts should be of type "object"');
    } else {
      if (retentionOpts.governanceBypass && !isBoolean(retentionOpts.governanceBypass)) {
        throw new errors.InvalidArgumentError(`Invalid value for governanceBypass: ${retentionOpts.governanceBypass}`);
      }
      if (retentionOpts.mode && ![RETENTION_MODES.COMPLIANCE, RETENTION_MODES.GOVERNANCE].includes(retentionOpts.mode)) {
        throw new errors.InvalidArgumentError(`Invalid object retention mode: ${retentionOpts.mode}`);
      }
      if (retentionOpts.retainUntilDate && !isString(retentionOpts.retainUntilDate)) {
        throw new errors.InvalidArgumentError(`Invalid value for retainUntilDate: ${retentionOpts.retainUntilDate}`);
      }
      if (retentionOpts.versionId && !isString(retentionOpts.versionId)) {
        throw new errors.InvalidArgumentError(`Invalid value for versionId: ${retentionOpts.versionId}`);
      }
    }
    const method = 'PUT';
    let query = 'retention';
    const headers = {};
    if (retentionOpts.governanceBypass) {
      headers['X-Amz-Bypass-Governance-Retention'] = true;
    }
    const builder = new xml2js.Builder({
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
    headers['Content-MD5'] = toMd5(payload);
    await this.makeRequestAsyncOmit({
      method,
      bucketName,
      objectName,
      query,
      headers
    }, payload, [200, 204]);
  }
  async getObjectLockConfig(bucketName) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    const method = 'GET';
    const query = 'object-lock';
    const httpRes = await this.makeRequestAsync({
      method,
      bucketName,
      query
    });
    const xmlResult = await readAsString(httpRes);
    return xmlParsers.parseObjectLockConfig(xmlResult);
  }
  async setObjectLockConfig(bucketName, lockConfigOpts) {
    const retentionModes = [RETENTION_MODES.COMPLIANCE, RETENTION_MODES.GOVERNANCE];
    const validUnits = [RETENTION_VALIDITY_UNITS.DAYS, RETENTION_VALIDITY_UNITS.YEARS];
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (lockConfigOpts.mode && !retentionModes.includes(lockConfigOpts.mode)) {
      throw new TypeError(`lockConfigOpts.mode should be one of ${retentionModes}`);
    }
    if (lockConfigOpts.unit && !validUnits.includes(lockConfigOpts.unit)) {
      throw new TypeError(`lockConfigOpts.unit should be one of ${validUnits}`);
    }
    if (lockConfigOpts.validity && !isNumber(lockConfigOpts.validity)) {
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
        if (lockConfigOpts.unit === RETENTION_VALIDITY_UNITS.DAYS) {
          config.Rule.DefaultRetention.Days = lockConfigOpts.validity;
        } else if (lockConfigOpts.unit === RETENTION_VALIDITY_UNITS.YEARS) {
          config.Rule.DefaultRetention.Years = lockConfigOpts.validity;
        }
      }
    }
    const builder = new xml2js.Builder({
      rootName: 'ObjectLockConfiguration',
      renderOpts: {
        pretty: false
      },
      headless: true
    });
    const payload = builder.buildObject(config);
    const headers = {};
    headers['Content-MD5'] = toMd5(payload);
    await this.makeRequestAsyncOmit({
      method,
      bucketName,
      query,
      headers
    }, payload);
  }
  async getBucketVersioning(bucketName) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    const method = 'GET';
    const query = 'versioning';
    const httpRes = await this.makeRequestAsync({
      method,
      bucketName,
      query
    });
    const xmlResult = await readAsString(httpRes);
    return await xmlParsers.parseBucketVersioningConfig(xmlResult);
  }
  async setBucketVersioning(bucketName, versionConfig) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!Object.keys(versionConfig).length) {
      throw new errors.InvalidArgumentError('versionConfig should be of type "object"');
    }
    const method = 'PUT';
    const query = 'versioning';
    const builder = new xml2js.Builder({
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
    const builder = new xml2js.Builder({
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
    headers['Content-MD5'] = toMd5(payloadBuf);
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
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isPlainObject(tags)) {
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
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    await this.removeTagging({
      bucketName
    });
  }
  async setObjectTagging(bucketName, objectName, tags, putOpts) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidBucketNameError('Invalid object name: ' + objectName);
    }
    if (!isPlainObject(tags)) {
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
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidBucketNameError('Invalid object name: ' + objectName);
    }
    if (removeOpts && Object.keys(removeOpts).length && !isObject(removeOpts)) {
      throw new errors.InvalidArgumentError('removeOpts should be of type "object"');
    }
    await this.removeTagging({
      bucketName,
      objectName,
      removeOpts
    });
  }
  async selectObjectContent(bucketName, objectName, selectOpts) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name: ${bucketName}`);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (!_.isEmpty(selectOpts)) {
      if (!isString(selectOpts.expression)) {
        throw new TypeError('sqlExpression should be of type "string"');
      }
      if (!_.isEmpty(selectOpts.inputSerialization)) {
        if (!isObject(selectOpts.inputSerialization)) {
          throw new TypeError('inputSerialization should be of type "object"');
        }
      } else {
        throw new TypeError('inputSerialization is required');
      }
      if (!_.isEmpty(selectOpts.outputSerialization)) {
        if (!isObject(selectOpts.outputSerialization)) {
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
    const builder = new xml2js.Builder({
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
    const body = await readAsBuffer(res);
    return parseSelectObjectContentResponse(body);
  }
  async applyBucketLifecycle(bucketName, policyConfig) {
    const method = 'PUT';
    const query = 'lifecycle';
    const headers = {};
    const builder = new xml2js.Builder({
      rootName: 'LifecycleConfiguration',
      headless: true,
      renderOpts: {
        pretty: false
      }
    });
    const payload = builder.buildObject(policyConfig);
    headers['Content-MD5'] = toMd5(payload);
    await this.makeRequestAsyncOmit({
      method,
      bucketName,
      query,
      headers
    }, payload);
  }
  async removeBucketLifecycle(bucketName) {
    if (!isValidBucketName(bucketName)) {
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
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (_.isEmpty(lifeCycleConfig)) {
      await this.removeBucketLifecycle(bucketName);
    } else {
      await this.applyBucketLifecycle(bucketName, lifeCycleConfig);
    }
  }
  async getBucketLifecycle(bucketName) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    const method = 'GET';
    const query = 'lifecycle';
    const res = await this.makeRequestAsync({
      method,
      bucketName,
      query
    });
    const body = await readAsString(res);
    return xmlParsers.parseLifecycleConfig(body);
  }
  async setBucketEncryption(bucketName, encryptionConfig) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!_.isEmpty(encryptionConfig) && encryptionConfig.Rule.length > 1) {
      throw new errors.InvalidArgumentError('Invalid Rule length. Only one rule is allowed.: ' + encryptionConfig.Rule);
    }
    let encryptionObj = encryptionConfig;
    if (_.isEmpty(encryptionConfig)) {
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
    const builder = new xml2js.Builder({
      rootName: 'ServerSideEncryptionConfiguration',
      renderOpts: {
        pretty: false
      },
      headless: true
    });
    const payload = builder.buildObject(encryptionObj);
    const headers = {};
    headers['Content-MD5'] = toMd5(payload);
    await this.makeRequestAsyncOmit({
      method,
      bucketName,
      query,
      headers
    }, payload);
  }
  async getBucketEncryption(bucketName) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    const method = 'GET';
    const query = 'encryption';
    const res = await this.makeRequestAsync({
      method,
      bucketName,
      query
    });
    const body = await readAsString(res);
    return xmlParsers.parseBucketEncryptionConfig(body);
  }
  async removeBucketEncryption(bucketName) {
    if (!isValidBucketName(bucketName)) {
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
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    if (getOpts && !isObject(getOpts)) {
      throw new errors.InvalidArgumentError('getOpts should be of type "object"');
    } else if (getOpts !== null && getOpts !== void 0 && getOpts.versionId && !isString(getOpts.versionId)) {
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
    const body = await readAsString(res);
    return xmlParsers.parseObjectRetentionConfig(body);
  }
  async removeObjects(bucketName, objectsList) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!Array.isArray(objectsList)) {
      throw new errors.InvalidArgumentError('objectsList should be a list');
    }
    const runDeleteObjects = async batch => {
      const delObjects = batch.map(value => {
        return isObject(value) ? {
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
      const payload = Buffer.from(new xml2js.Builder({
        headless: true
      }).buildObject(remObjects));
      const headers = {
        'Content-MD5': toMd5(payload)
      };
      const res = await this.makeRequestAsync({
        method: 'POST',
        bucketName,
        query: 'delete',
        headers
      }, payload);
      const body = await readAsString(res);
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
    if (!isValidBucketName(bucketName)) {
      throw new errors.IsValidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
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
    if (!isValidBucketName(targetBucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + targetBucketName);
    }
    if (!isValidObjectName(targetObjectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${targetObjectName}`);
    }
    if (!isString(sourceBucketNameAndObjectName)) {
      throw new TypeError('sourceBucketNameAndObjectName should be of type "string"');
    }
    if (sourceBucketNameAndObjectName === '') {
      throw new errors.InvalidPrefixError(`Empty source prefix`);
    }
    if (conditions != null && !(conditions instanceof CopyConditions)) {
      throw new TypeError('conditions should be of type "CopyConditions"');
    }
    const headers = {};
    headers['x-amz-copy-source'] = uriResourceEscape(sourceBucketNameAndObjectName);
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
    const body = await readAsString(res);
    return xmlParsers.parseCopyObject(body);
  }
  async copyObjectV2(sourceConfig, destConfig) {
    if (!(sourceConfig instanceof CopySourceOptions)) {
      throw new errors.InvalidArgumentError('sourceConfig should of type CopySourceOptions ');
    }
    if (!(destConfig instanceof CopyDestinationOptions)) {
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
    const body = await readAsString(res);
    const copyRes = xmlParsers.parseCopyObject(body);
    const resHeaders = res.headers;
    const sizeHeaderValue = resHeaders && resHeaders['content-length'];
    const size = typeof sizeHeaderValue === 'number' ? sizeHeaderValue : undefined;
    return {
      Bucket: destConfig.Bucket,
      Key: destConfig.Object,
      LastModified: copyRes.lastModified,
      MetaData: extractMetadata(resHeaders),
      VersionId: getVersionId(resHeaders),
      SourceVersionId: getSourceVersionId(resHeaders),
      Etag: sanitizeETag(resHeaders.etag),
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
    const body = await readAsString(res);
    const partRes = uploadPartParser(body);
    const partEtagVal = sanitizeETag(res.headers.etag) || sanitizeETag(partRes.ETag);
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
    if (!(destObjConfig instanceof CopyDestinationOptions)) {
      throw new errors.InvalidArgumentError('destConfig should of type CopyDestinationOptions ');
    }
    if (sourceFilesLength < 1 || sourceFilesLength > PART_CONSTRAINTS.MAX_PARTS_COUNT) {
      throw new errors.InvalidArgumentError(`"There must be as least one and up to ${PART_CONSTRAINTS.MAX_PARTS_COUNT} source objects.`);
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
      if (!_.isEmpty(srcConfig.VersionID)) {
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
      if (srcCopySize < PART_CONSTRAINTS.ABS_MIN_PART_SIZE && index < sourceFilesLength - 1) {
        throw new errors.InvalidArgumentError(`CopySrcOptions ${index} is too small (${srcCopySize}) and it is not the last part.`);
      }

      // Is data to copy too large?
      totalSize += srcCopySize;
      if (totalSize > PART_CONSTRAINTS.MAX_MULTIPART_PUT_OBJECT_SIZE) {
        throw new errors.InvalidArgumentError(`Cannot compose an object of size ${totalSize} (> 5TiB)`);
      }

      // record source size
      srcObjectSizes[index] = srcCopySize;

      // calculate parts needed for current source
      totalParts += partsRequired(srcCopySize);
      // Do we need more parts than we are allowed?
      if (totalParts > PART_CONSTRAINTS.MAX_PARTS_COUNT) {
        throw new errors.InvalidArgumentError(`Your proposed compose object requires more than ${PART_CONSTRAINTS.MAX_PARTS_COUNT} parts`);
      }
      return resItemStat;
    });
    if (totalParts === 1 && totalSize <= PART_CONSTRAINTS.MAX_PART_SIZE || totalSize === 0) {
      return await this.copyObject(sourceObjList[0], destObjConfig); // use copyObjectV2
    }

    // preserve etag to avoid modification of object while copying.
    for (let i = 0; i < sourceFilesLength; i++) {
      ;
      sourceObjList[i].MatchETag = validatedStats[i].etag;
    }
    const splitPartSizeList = validatedStats.map((resItemStat, idx) => {
      return calculateEvenSplits(srcObjectSizes[idx], sourceObjList[idx]);
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
      for (const batch of _.chunk(uploadList, maxConcurrency)) {
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
      expires = PRESIGN_EXPIRY_DAYS_MAX;
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
      return presignSignatureV4(reqOptions, this.accessKey, this.secretKey, this.sessionToken, region, requestDate, expires);
    } catch (err) {
      if (err instanceof errors.InvalidBucketNameError) {
        throw new errors.InvalidArgumentError(`Unable to get bucket region for ${bucketName}.`);
      }
      throw err;
    }
  }
  async presignedGetObject(bucketName, objectName, expires, respHeaders, requestDate) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    const validRespHeaders = ['response-content-type', 'response-content-language', 'response-expires', 'response-cache-control', 'response-content-disposition', 'response-content-encoding'];
    validRespHeaders.forEach(header => {
      // @ts-ignore
      if (respHeaders !== undefined && respHeaders[header] !== undefined && !isString(respHeaders[header])) {
        throw new TypeError(`response header ${header} should be of type "string"`);
      }
    });
    return this.presignedUrl('GET', bucketName, objectName, expires, respHeaders, requestDate);
  }
  async presignedPutObject(bucketName, objectName, expires) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name: ${bucketName}`);
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(`Invalid object name: ${objectName}`);
    }
    return this.presignedUrl('PUT', bucketName, objectName, expires);
  }
  newPostPolicy() {
    return new PostPolicy();
  }
  async presignedPostPolicy(postPolicy) {
    if (this.anonymous) {
      throw new errors.AnonymousRequestError('Presigned POST policy cannot be generated for anonymous requests');
    }
    if (!isObject(postPolicy)) {
      throw new TypeError('postPolicy should be of type "object"');
    }
    const bucketName = postPolicy.formData.bucket;
    try {
      const region = await this.getBucketRegionAsync(bucketName);
      const date = new Date();
      const dateStr = makeDateLong(date);
      await this.checkAndRefreshCreds();
      if (!postPolicy.policy.expiration) {
        // 'expiration' is mandatory field for S3.
        // Set default expiration date of 7 days.
        const expires = new Date();
        expires.setSeconds(PRESIGN_EXPIRY_DAYS_MAX);
        postPolicy.setExpires(expires);
      }
      postPolicy.policy.conditions.push(['eq', '$x-amz-date', dateStr]);
      postPolicy.formData['x-amz-date'] = dateStr;
      postPolicy.policy.conditions.push(['eq', '$x-amz-algorithm', 'AWS4-HMAC-SHA256']);
      postPolicy.formData['x-amz-algorithm'] = 'AWS4-HMAC-SHA256';
      postPolicy.policy.conditions.push(['eq', '$x-amz-credential', this.accessKey + '/' + getScope(region, date)]);
      postPolicy.formData['x-amz-credential'] = this.accessKey + '/' + getScope(region, date);
      if (this.sessionToken) {
        postPolicy.policy.conditions.push(['eq', '$x-amz-security-token', this.sessionToken]);
        postPolicy.formData['x-amz-security-token'] = this.sessionToken;
      }
      const policyBase64 = Buffer.from(JSON.stringify(postPolicy.policy)).toString('base64');
      postPolicy.formData.policy = policyBase64;
      postPolicy.formData['x-amz-signature'] = postPresignSignatureV4(region, date, this.secretKey, policyBase64);
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
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isString(prefix)) {
      throw new TypeError('prefix should be of type "string"');
    }
    if (marker && !isString(marker)) {
      throw new TypeError('marker should be of type "string"');
    }
    if (listQueryOpts && !isObject(listQueryOpts)) {
      throw new TypeError('listQueryOpts should be of type "object"');
    }
    let {
      Delimiter,
      MaxKeys,
      IncludeVersion,
      versionIdMarker,
      keyMarker
    } = listQueryOpts;
    if (!isString(Delimiter)) {
      throw new TypeError('Delimiter should be of type "string"');
    }
    if (!isNumber(MaxKeys)) {
      throw new TypeError('MaxKeys should be of type "number"');
    }
    const queries = [];
    // escape every value in query string, except maxKeys
    queries.push(`prefix=${uriEscape(prefix)}`);
    queries.push(`delimiter=${uriEscape(Delimiter)}`);
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
      marker = uriEscape(marker);
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
    const body = await readAsString(res);
    const listQryList = parseListObjects(body);
    return listQryList;
  }
  listObjects(bucketName, prefix, recursive, listOpts) {
    if (prefix === undefined) {
      prefix = '';
    }
    if (recursive === undefined) {
      recursive = false;
    }
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidPrefix(prefix)) {
      throw new errors.InvalidPrefixError(`Invalid prefix : ${prefix}`);
    }
    if (!isString(prefix)) {
      throw new TypeError('prefix should be of type "string"');
    }
    if (!isBoolean(recursive)) {
      throw new TypeError('recursive should be of type "boolean"');
    }
    if (listOpts && !isObject(listOpts)) {
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
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isString(prefix)) {
      throw new TypeError('prefix should be of type "string"');
    }
    if (!isString(continuationToken)) {
      throw new TypeError('continuationToken should be of type "string"');
    }
    if (!isString(delimiter)) {
      throw new TypeError('delimiter should be of type "string"');
    }
    if (!isNumber(maxKeys)) {
      throw new TypeError('maxKeys should be of type "number"');
    }
    if (!isString(startAfter)) {
      throw new TypeError('startAfter should be of type "string"');
    }
    const queries = [];
    queries.push(`list-type=2`);
    queries.push(`encoding-type=url`);
    queries.push(`prefix=${uriEscape(prefix)}`);
    queries.push(`delimiter=${uriEscape(delimiter)}`);
    if (continuationToken) {
      queries.push(`continuation-token=${uriEscape(continuationToken)}`);
    }
    if (startAfter) {
      queries.push(`start-after=${uriEscape(startAfter)}`);
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
    const body = await readAsString(res);
    return parseListObjectsV2(body);
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
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isValidPrefix(prefix)) {
      throw new errors.InvalidPrefixError(`Invalid prefix : ${prefix}`);
    }
    if (!isString(prefix)) {
      throw new TypeError('prefix should be of type "string"');
    }
    if (!isBoolean(recursive)) {
      throw new TypeError('recursive should be of type "boolean"');
    }
    if (!isString(startAfter)) {
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
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    if (!isObject(config)) {
      throw new TypeError('notification config should be of type "Object"');
    }
    const method = 'PUT';
    const query = 'notification';
    const builder = new xml2js.Builder({
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
    await this.setBucketNotification(bucketName, new NotificationConfig());
  }
  async getBucketNotification(bucketName) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError('Invalid bucket name: ' + bucketName);
    }
    const method = 'GET';
    const query = 'notification';
    const res = await this.makeRequestAsync({
      method,
      bucketName,
      query
    });
    const body = await readAsString(res);
    return parseBucketNotification(body);
  }
  listenBucketNotification(bucketName, prefix, suffix, events) {
    if (!isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError(`Invalid bucket name: ${bucketName}`);
    }
    if (!isString(prefix)) {
      throw new TypeError('prefix must be of type string');
    }
    if (!isString(suffix)) {
      throw new TypeError('suffix must be of type string');
    }
    if (!Array.isArray(events)) {
      throw new TypeError('events must be of type Array');
    }
    const listener = new NotificationPoller(this, bucketName, prefix, suffix, events);
    listener.start();
    return listener;
  }
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJjcnlwdG8iLCJmcyIsImh0dHAiLCJodHRwcyIsInBhdGgiLCJzdHJlYW0iLCJhc3luYyIsIkJsb2NrU3RyZWFtMiIsImlzQnJvd3NlciIsIl8iLCJxcyIsInhtbDJqcyIsIkNyZWRlbnRpYWxQcm92aWRlciIsImVycm9ycyIsIkNvcHlEZXN0aW5hdGlvbk9wdGlvbnMiLCJDb3B5U291cmNlT3B0aW9ucyIsIkRFRkFVTFRfUkVHSU9OIiwiTEVHQUxfSE9MRF9TVEFUVVMiLCJQUkVTSUdOX0VYUElSWV9EQVlTX01BWCIsIlJFVEVOVElPTl9NT0RFUyIsIlJFVEVOVElPTl9WQUxJRElUWV9VTklUUyIsIk5vdGlmaWNhdGlvbkNvbmZpZyIsIk5vdGlmaWNhdGlvblBvbGxlciIsInBvc3RQcmVzaWduU2lnbmF0dXJlVjQiLCJwcmVzaWduU2lnbmF0dXJlVjQiLCJzaWduVjQiLCJmc3AiLCJzdHJlYW1Qcm9taXNlIiwiQ29weUNvbmRpdGlvbnMiLCJFeHRlbnNpb25zIiwiY2FsY3VsYXRlRXZlblNwbGl0cyIsImV4dHJhY3RNZXRhZGF0YSIsImdldENvbnRlbnRMZW5ndGgiLCJnZXRTY29wZSIsImdldFNvdXJjZVZlcnNpb25JZCIsImdldFZlcnNpb25JZCIsImhhc2hCaW5hcnkiLCJpbnNlcnRDb250ZW50VHlwZSIsImlzQW1hem9uRW5kcG9pbnQiLCJpc0Jvb2xlYW4iLCJpc0RlZmluZWQiLCJpc0VtcHR5IiwiaXNOdW1iZXIiLCJpc09iamVjdCIsImlzUGxhaW5PYmplY3QiLCJpc1JlYWRhYmxlU3RyZWFtIiwiaXNTdHJpbmciLCJpc1ZhbGlkQnVja2V0TmFtZSIsImlzVmFsaWRFbmRwb2ludCIsImlzVmFsaWRPYmplY3ROYW1lIiwiaXNWYWxpZFBvcnQiLCJpc1ZhbGlkUHJlZml4IiwiaXNWaXJ0dWFsSG9zdFN0eWxlIiwibWFrZURhdGVMb25nIiwiUEFSVF9DT05TVFJBSU5UUyIsInBhcnRzUmVxdWlyZWQiLCJwcmVwZW5kWEFNWk1ldGEiLCJyZWFkYWJsZVN0cmVhbSIsInNhbml0aXplRVRhZyIsInRvTWQ1IiwidG9TaGEyNTYiLCJ1cmlFc2NhcGUiLCJ1cmlSZXNvdXJjZUVzY2FwZSIsImpvaW5Ib3N0UG9ydCIsIlBvc3RQb2xpY3kiLCJyZXF1ZXN0V2l0aFJldHJ5IiwiZHJhaW5SZXNwb25zZSIsInJlYWRBc0J1ZmZlciIsInJlYWRBc1N0cmluZyIsImdldFMzRW5kcG9pbnQiLCJwYXJzZUJ1Y2tldE5vdGlmaWNhdGlvbiIsInBhcnNlQ29tcGxldGVNdWx0aXBhcnQiLCJwYXJzZUluaXRpYXRlTXVsdGlwYXJ0IiwicGFyc2VMaXN0T2JqZWN0cyIsInBhcnNlTGlzdE9iamVjdHNWMiIsInBhcnNlT2JqZWN0TGVnYWxIb2xkQ29uZmlnIiwicGFyc2VTZWxlY3RPYmplY3RDb250ZW50UmVzcG9uc2UiLCJ1cGxvYWRQYXJ0UGFyc2VyIiwieG1sUGFyc2VycyIsInhtbCIsIkJ1aWxkZXIiLCJyZW5kZXJPcHRzIiwicHJldHR5IiwiaGVhZGxlc3MiLCJQYWNrYWdlIiwidmVyc2lvbiIsInJlcXVlc3RPcHRpb25Qcm9wZXJ0aWVzIiwiVHlwZWRDbGllbnQiLCJwYXJ0U2l6ZSIsIm1heGltdW1QYXJ0U2l6ZSIsIm1heE9iamVjdFNpemUiLCJjb25zdHJ1Y3RvciIsInBhcmFtcyIsInNlY3VyZSIsInVuZGVmaW5lZCIsIkVycm9yIiwidXNlU1NMIiwicG9ydCIsImVuZFBvaW50IiwiSW52YWxpZEVuZHBvaW50RXJyb3IiLCJJbnZhbGlkQXJndW1lbnRFcnJvciIsInJlZ2lvbiIsImhvc3QiLCJ0b0xvd2VyQ2FzZSIsInByb3RvY29sIiwidHJhbnNwb3J0IiwidHJhbnNwb3J0QWdlbnQiLCJnbG9iYWxBZ2VudCIsImxpYnJhcnlDb21tZW50cyIsInByb2Nlc3MiLCJwbGF0Zm9ybSIsImFyY2giLCJsaWJyYXJ5QWdlbnQiLCJ1c2VyQWdlbnQiLCJwYXRoU3R5bGUiLCJhY2Nlc3NLZXkiLCJzZWNyZXRLZXkiLCJzZXNzaW9uVG9rZW4iLCJhbm9ueW1vdXMiLCJjcmVkZW50aWFsc1Byb3ZpZGVyIiwicmVnaW9uTWFwIiwib3ZlclJpZGVQYXJ0U2l6ZSIsImVuYWJsZVNIQTI1NiIsInMzQWNjZWxlcmF0ZUVuZHBvaW50IiwicmVxT3B0aW9ucyIsImNsaWVudEV4dGVuc2lvbnMiLCJyZXRyeU9wdGlvbnMiLCJkaXNhYmxlUmV0cnkiLCJleHRlbnNpb25zIiwic2V0UzNUcmFuc2ZlckFjY2VsZXJhdGUiLCJzZXRSZXF1ZXN0T3B0aW9ucyIsIm9wdGlvbnMiLCJUeXBlRXJyb3IiLCJwaWNrIiwiZ2V0QWNjZWxlcmF0ZUVuZFBvaW50SWZTZXQiLCJidWNrZXROYW1lIiwib2JqZWN0TmFtZSIsImluY2x1ZGVzIiwic2V0QXBwSW5mbyIsImFwcE5hbWUiLCJhcHBWZXJzaW9uIiwidHJpbSIsImdldFJlcXVlc3RPcHRpb25zIiwib3B0cyIsIm1ldGhvZCIsImhlYWRlcnMiLCJxdWVyeSIsImFnZW50IiwidmlydHVhbEhvc3RTdHlsZSIsImFjY2VsZXJhdGVFbmRQb2ludCIsImsiLCJ2IiwiT2JqZWN0IiwiZW50cmllcyIsImFzc2lnbiIsIm1hcFZhbHVlcyIsInBpY2tCeSIsInRvU3RyaW5nIiwic2V0Q3JlZGVudGlhbHNQcm92aWRlciIsImNoZWNrQW5kUmVmcmVzaENyZWRzIiwiY3JlZGVudGlhbHNDb25mIiwiZ2V0Q3JlZGVudGlhbHMiLCJnZXRBY2Nlc3NLZXkiLCJnZXRTZWNyZXRLZXkiLCJnZXRTZXNzaW9uVG9rZW4iLCJlIiwiY2F1c2UiLCJsb2dIVFRQIiwicmVzcG9uc2UiLCJlcnIiLCJsb2dTdHJlYW0iLCJsb2dIZWFkZXJzIiwiZm9yRWFjaCIsInJlZGFjdG9yIiwiUmVnRXhwIiwicmVwbGFjZSIsIndyaXRlIiwic3RhdHVzQ29kZSIsImVyckpTT04iLCJKU09OIiwic3RyaW5naWZ5IiwidHJhY2VPbiIsInN0ZG91dCIsInRyYWNlT2ZmIiwibWFrZVJlcXVlc3RBc3luYyIsInBheWxvYWQiLCJleHBlY3RlZENvZGVzIiwibGVuZ3RoIiwic2hhMjU2c3VtIiwibWFrZVJlcXVlc3RTdHJlYW1Bc3luYyIsIm1ha2VSZXF1ZXN0QXN5bmNPbWl0Iiwic3RhdHVzQ29kZXMiLCJyZXMiLCJib2R5IiwiQnVmZmVyIiwiaXNCdWZmZXIiLCJnZXRCdWNrZXRSZWdpb25Bc3luYyIsImRhdGUiLCJEYXRlIiwiYXV0aG9yaXphdGlvbiIsIm1heGltdW1SZXRyeUNvdW50IiwiYmFzZURlbGF5TXMiLCJtYXhpbXVtRGVsYXlNcyIsInBhcnNlUmVzcG9uc2VFcnJvciIsIkludmFsaWRCdWNrZXROYW1lRXJyb3IiLCJjYWNoZWQiLCJleHRyYWN0UmVnaW9uQXN5bmMiLCJwYXJzZUJ1Y2tldFJlZ2lvbiIsIlMzRXJyb3IiLCJlcnJDb2RlIiwiY29kZSIsImVyclJlZ2lvbiIsIm5hbWUiLCJSZWdpb24iLCJtYWtlUmVxdWVzdCIsInJldHVyblJlc3BvbnNlIiwiY2IiLCJwcm9tIiwidGhlbiIsInJlc3VsdCIsIm1ha2VSZXF1ZXN0U3RyZWFtIiwiZXhlY3V0b3IiLCJnZXRCdWNrZXRSZWdpb24iLCJtYWtlQnVja2V0IiwibWFrZU9wdHMiLCJidWlsZE9iamVjdCIsIkNyZWF0ZUJ1Y2tldENvbmZpZ3VyYXRpb24iLCIkIiwieG1sbnMiLCJMb2NhdGlvbkNvbnN0cmFpbnQiLCJPYmplY3RMb2NraW5nIiwiZmluYWxSZWdpb24iLCJyZXF1ZXN0T3B0IiwiYnVja2V0RXhpc3RzIiwicmVtb3ZlQnVja2V0IiwiZ2V0T2JqZWN0IiwiZ2V0T3B0cyIsIkludmFsaWRPYmplY3ROYW1lRXJyb3IiLCJnZXRQYXJ0aWFsT2JqZWN0Iiwib2Zmc2V0IiwicmFuZ2UiLCJzc2VIZWFkZXJzIiwiU1NFQ3VzdG9tZXJBbGdvcml0aG0iLCJTU0VDdXN0b21lcktleSIsIlNTRUN1c3RvbWVyS2V5TUQ1IiwiZXhwZWN0ZWRTdGF0dXNDb2RlcyIsInB1c2giLCJmR2V0T2JqZWN0IiwiZmlsZVBhdGgiLCJkb3dubG9hZFRvVG1wRmlsZSIsInBhcnRGaWxlU3RyZWFtIiwib2JqU3RhdCIsInN0YXRPYmplY3QiLCJlbmNvZGVkRXRhZyIsImZyb20iLCJldGFnIiwicGFydEZpbGUiLCJta2RpciIsImRpcm5hbWUiLCJyZWN1cnNpdmUiLCJzdGF0cyIsInN0YXQiLCJzaXplIiwiY3JlYXRlV3JpdGVTdHJlYW0iLCJmbGFncyIsImRvd25sb2FkU3RyZWFtIiwicGlwZWxpbmUiLCJyZW5hbWUiLCJzdGF0T3B0cyIsInN0YXRPcHREZWYiLCJwYXJzZUludCIsIm1ldGFEYXRhIiwibGFzdE1vZGlmaWVkIiwidmVyc2lvbklkIiwicmVtb3ZlT2JqZWN0IiwicmVtb3ZlT3B0cyIsImdvdmVybmFuY2VCeXBhc3MiLCJmb3JjZURlbGV0ZSIsInF1ZXJ5UGFyYW1zIiwibGlzdEluY29tcGxldGVVcGxvYWRzIiwiYnVja2V0IiwicHJlZml4IiwiSW52YWxpZFByZWZpeEVycm9yIiwiZGVsaW1pdGVyIiwia2V5TWFya2VyIiwidXBsb2FkSWRNYXJrZXIiLCJ1cGxvYWRzIiwiZW5kZWQiLCJyZWFkU3RyZWFtIiwiUmVhZGFibGUiLCJvYmplY3RNb2RlIiwiX3JlYWQiLCJzaGlmdCIsImxpc3RJbmNvbXBsZXRlVXBsb2Fkc1F1ZXJ5IiwicHJlZml4ZXMiLCJlYWNoU2VyaWVzIiwidXBsb2FkIiwibGlzdFBhcnRzIiwia2V5IiwidXBsb2FkSWQiLCJwYXJ0cyIsInJlZHVjZSIsImFjYyIsIml0ZW0iLCJlbWl0IiwiaXNUcnVuY2F0ZWQiLCJuZXh0S2V5TWFya2VyIiwibmV4dFVwbG9hZElkTWFya2VyIiwicXVlcmllcyIsIm1heFVwbG9hZHMiLCJzb3J0IiwidW5zaGlmdCIsImpvaW4iLCJwYXJzZUxpc3RNdWx0aXBhcnQiLCJpbml0aWF0ZU5ld011bHRpcGFydFVwbG9hZCIsImFib3J0TXVsdGlwYXJ0VXBsb2FkIiwicmVxdWVzdE9wdGlvbnMiLCJmaW5kVXBsb2FkSWQiLCJfbGF0ZXN0VXBsb2FkIiwibGF0ZXN0VXBsb2FkIiwiaW5pdGlhdGVkIiwiZ2V0VGltZSIsImNvbXBsZXRlTXVsdGlwYXJ0VXBsb2FkIiwiZXRhZ3MiLCJidWlsZGVyIiwiQ29tcGxldGVNdWx0aXBhcnRVcGxvYWQiLCJQYXJ0IiwibWFwIiwiUGFydE51bWJlciIsInBhcnQiLCJFVGFnIiwiZXJyTWVzc2FnZSIsIm1hcmtlciIsImxpc3RQYXJ0c1F1ZXJ5IiwicGFyc2VMaXN0UGFydHMiLCJsaXN0QnVja2V0cyIsInJlZ2lvbkNvbmYiLCJodHRwUmVzIiwieG1sUmVzdWx0IiwicGFyc2VMaXN0QnVja2V0IiwiY2FsY3VsYXRlUGFydFNpemUiLCJmUHV0T2JqZWN0IiwicHV0T2JqZWN0IiwiY3JlYXRlUmVhZFN0cmVhbSIsInN0YXRTaXplIiwidXBsb2FkQnVmZmVyIiwiYnVmIiwidXBsb2FkU3RyZWFtIiwibWQ1c3VtIiwib2xkUGFydHMiLCJlVGFncyIsInByZXZpb3VzVXBsb2FkSWQiLCJvbGRUYWdzIiwiY2h1bmtpZXIiLCJ6ZXJvUGFkZGluZyIsIm8iLCJQcm9taXNlIiwiYWxsIiwicmVzb2x2ZSIsInJlamVjdCIsInBpcGUiLCJvbiIsInBhcnROdW1iZXIiLCJjaHVuayIsIm1kNSIsImNyZWF0ZUhhc2giLCJ1cGRhdGUiLCJkaWdlc3QiLCJvbGRQYXJ0IiwicmVtb3ZlQnVja2V0UmVwbGljYXRpb24iLCJzZXRCdWNrZXRSZXBsaWNhdGlvbiIsInJlcGxpY2F0aW9uQ29uZmlnIiwicm9sZSIsInJ1bGVzIiwicmVwbGljYXRpb25QYXJhbXNDb25maWciLCJSZXBsaWNhdGlvbkNvbmZpZ3VyYXRpb24iLCJSb2xlIiwiUnVsZSIsImdldEJ1Y2tldFJlcGxpY2F0aW9uIiwicGFyc2VSZXBsaWNhdGlvbkNvbmZpZyIsImdldE9iamVjdExlZ2FsSG9sZCIsImtleXMiLCJzdHJSZXMiLCJzZXRPYmplY3RMZWdhbEhvbGQiLCJzZXRPcHRzIiwic3RhdHVzIiwiRU5BQkxFRCIsIkRJU0FCTEVEIiwiY29uZmlnIiwiU3RhdHVzIiwicm9vdE5hbWUiLCJnZXRCdWNrZXRUYWdnaW5nIiwicGFyc2VUYWdnaW5nIiwiZ2V0T2JqZWN0VGFnZ2luZyIsInNldEJ1Y2tldFBvbGljeSIsInBvbGljeSIsIkludmFsaWRCdWNrZXRQb2xpY3lFcnJvciIsImdldEJ1Y2tldFBvbGljeSIsInB1dE9iamVjdFJldGVudGlvbiIsInJldGVudGlvbk9wdHMiLCJtb2RlIiwiQ09NUExJQU5DRSIsIkdPVkVSTkFOQ0UiLCJyZXRhaW5VbnRpbERhdGUiLCJNb2RlIiwiUmV0YWluVW50aWxEYXRlIiwiZ2V0T2JqZWN0TG9ja0NvbmZpZyIsInBhcnNlT2JqZWN0TG9ja0NvbmZpZyIsInNldE9iamVjdExvY2tDb25maWciLCJsb2NrQ29uZmlnT3B0cyIsInJldGVudGlvbk1vZGVzIiwidmFsaWRVbml0cyIsIkRBWVMiLCJZRUFSUyIsInVuaXQiLCJ2YWxpZGl0eSIsIk9iamVjdExvY2tFbmFibGVkIiwiY29uZmlnS2V5cyIsImlzQWxsS2V5c1NldCIsImV2ZXJ5IiwibGNrIiwiRGVmYXVsdFJldGVudGlvbiIsIkRheXMiLCJZZWFycyIsImdldEJ1Y2tldFZlcnNpb25pbmciLCJwYXJzZUJ1Y2tldFZlcnNpb25pbmdDb25maWciLCJzZXRCdWNrZXRWZXJzaW9uaW5nIiwidmVyc2lvbkNvbmZpZyIsInNldFRhZ2dpbmciLCJ0YWdnaW5nUGFyYW1zIiwidGFncyIsInB1dE9wdHMiLCJ0YWdzTGlzdCIsInZhbHVlIiwiS2V5IiwiVmFsdWUiLCJ0YWdnaW5nQ29uZmlnIiwiVGFnZ2luZyIsIlRhZ1NldCIsIlRhZyIsInBheWxvYWRCdWYiLCJyZW1vdmVUYWdnaW5nIiwic2V0QnVja2V0VGFnZ2luZyIsInJlbW92ZUJ1Y2tldFRhZ2dpbmciLCJzZXRPYmplY3RUYWdnaW5nIiwicmVtb3ZlT2JqZWN0VGFnZ2luZyIsInNlbGVjdE9iamVjdENvbnRlbnQiLCJzZWxlY3RPcHRzIiwiZXhwcmVzc2lvbiIsImlucHV0U2VyaWFsaXphdGlvbiIsIm91dHB1dFNlcmlhbGl6YXRpb24iLCJFeHByZXNzaW9uIiwiRXhwcmVzc2lvblR5cGUiLCJleHByZXNzaW9uVHlwZSIsIklucHV0U2VyaWFsaXphdGlvbiIsIk91dHB1dFNlcmlhbGl6YXRpb24iLCJyZXF1ZXN0UHJvZ3Jlc3MiLCJSZXF1ZXN0UHJvZ3Jlc3MiLCJzY2FuUmFuZ2UiLCJTY2FuUmFuZ2UiLCJhcHBseUJ1Y2tldExpZmVjeWNsZSIsInBvbGljeUNvbmZpZyIsInJlbW92ZUJ1Y2tldExpZmVjeWNsZSIsInNldEJ1Y2tldExpZmVjeWNsZSIsImxpZmVDeWNsZUNvbmZpZyIsImdldEJ1Y2tldExpZmVjeWNsZSIsInBhcnNlTGlmZWN5Y2xlQ29uZmlnIiwic2V0QnVja2V0RW5jcnlwdGlvbiIsImVuY3J5cHRpb25Db25maWciLCJlbmNyeXB0aW9uT2JqIiwiQXBwbHlTZXJ2ZXJTaWRlRW5jcnlwdGlvbkJ5RGVmYXVsdCIsIlNTRUFsZ29yaXRobSIsImdldEJ1Y2tldEVuY3J5cHRpb24iLCJwYXJzZUJ1Y2tldEVuY3J5cHRpb25Db25maWciLCJyZW1vdmVCdWNrZXRFbmNyeXB0aW9uIiwiZ2V0T2JqZWN0UmV0ZW50aW9uIiwicGFyc2VPYmplY3RSZXRlbnRpb25Db25maWciLCJyZW1vdmVPYmplY3RzIiwib2JqZWN0c0xpc3QiLCJBcnJheSIsImlzQXJyYXkiLCJydW5EZWxldGVPYmplY3RzIiwiYmF0Y2giLCJkZWxPYmplY3RzIiwiVmVyc2lvbklkIiwicmVtT2JqZWN0cyIsIkRlbGV0ZSIsIlF1aWV0IiwicmVtb3ZlT2JqZWN0c1BhcnNlciIsIm1heEVudHJpZXMiLCJiYXRjaGVzIiwiaSIsInNsaWNlIiwiYmF0Y2hSZXN1bHRzIiwiZmxhdCIsInJlbW92ZUluY29tcGxldGVVcGxvYWQiLCJJc1ZhbGlkQnVja2V0TmFtZUVycm9yIiwicmVtb3ZlVXBsb2FkSWQiLCJjb3B5T2JqZWN0VjEiLCJ0YXJnZXRCdWNrZXROYW1lIiwidGFyZ2V0T2JqZWN0TmFtZSIsInNvdXJjZUJ1Y2tldE5hbWVBbmRPYmplY3ROYW1lIiwiY29uZGl0aW9ucyIsIm1vZGlmaWVkIiwidW5tb2RpZmllZCIsIm1hdGNoRVRhZyIsIm1hdGNoRVRhZ0V4Y2VwdCIsInBhcnNlQ29weU9iamVjdCIsImNvcHlPYmplY3RWMiIsInNvdXJjZUNvbmZpZyIsImRlc3RDb25maWciLCJ2YWxpZGF0ZSIsImdldEhlYWRlcnMiLCJCdWNrZXQiLCJjb3B5UmVzIiwicmVzSGVhZGVycyIsInNpemVIZWFkZXJWYWx1ZSIsIkxhc3RNb2RpZmllZCIsIk1ldGFEYXRhIiwiU291cmNlVmVyc2lvbklkIiwiRXRhZyIsIlNpemUiLCJjb3B5T2JqZWN0IiwiYWxsQXJncyIsInNvdXJjZSIsImRlc3QiLCJ1cGxvYWRQYXJ0IiwicGFydENvbmZpZyIsInVwbG9hZElEIiwicGFydFJlcyIsInBhcnRFdGFnVmFsIiwiY29tcG9zZU9iamVjdCIsImRlc3RPYmpDb25maWciLCJzb3VyY2VPYmpMaXN0IiwibWF4Q29uY3VycmVuY3kiLCJzb3VyY2VGaWxlc0xlbmd0aCIsIk1BWF9QQVJUU19DT1VOVCIsInNPYmoiLCJnZXRTdGF0T3B0aW9ucyIsInNyY0NvbmZpZyIsIlZlcnNpb25JRCIsInNyY09iamVjdFNpemVzIiwidG90YWxTaXplIiwidG90YWxQYXJ0cyIsInNvdXJjZU9ialN0YXRzIiwic3JjSXRlbSIsInNyY09iamVjdEluZm9zIiwidmFsaWRhdGVkU3RhdHMiLCJyZXNJdGVtU3RhdCIsImluZGV4Iiwic3JjQ29weVNpemUiLCJNYXRjaFJhbmdlIiwic3JjU3RhcnQiLCJTdGFydCIsInNyY0VuZCIsIkVuZCIsIkFCU19NSU5fUEFSVF9TSVpFIiwiTUFYX01VTFRJUEFSVF9QVVRfT0JKRUNUX1NJWkUiLCJNQVhfUEFSVF9TSVpFIiwiTWF0Y2hFVGFnIiwic3BsaXRQYXJ0U2l6ZUxpc3QiLCJpZHgiLCJnZXRVcGxvYWRQYXJ0Q29uZmlnTGlzdCIsInVwbG9hZFBhcnRDb25maWdMaXN0Iiwic3BsaXRTaXplIiwic3BsaXRJbmRleCIsInN0YXJ0SW5kZXgiLCJzdGFydElkeCIsImVuZEluZGV4IiwiZW5kSWR4Iiwib2JqSW5mbyIsIm9iakNvbmZpZyIsInBhcnRJbmRleCIsInRvdGFsVXBsb2FkcyIsInNwbGl0U3RhcnQiLCJ1cGxkQ3RySWR4Iiwic3BsaXRFbmQiLCJzb3VyY2VPYmoiLCJ1cGxvYWRQYXJ0Q29uZmlnIiwidXBsb2FkQWxsUGFydHMiLCJ1cGxvYWRMaXN0IiwicGFydFVwbG9hZHMiLCJwZXJmb3JtVXBsb2FkUGFydHMiLCJwYXJ0c1JlcyIsInBhcnRDb3B5IiwibmV3VXBsb2FkSGVhZGVycyIsInBhcnRzRG9uZSIsInByZXNpZ25lZFVybCIsImV4cGlyZXMiLCJyZXFQYXJhbXMiLCJyZXF1ZXN0RGF0ZSIsIl9yZXF1ZXN0RGF0ZSIsIkFub255bW91c1JlcXVlc3RFcnJvciIsImlzTmFOIiwicHJlc2lnbmVkR2V0T2JqZWN0IiwicmVzcEhlYWRlcnMiLCJ2YWxpZFJlc3BIZWFkZXJzIiwiaGVhZGVyIiwicHJlc2lnbmVkUHV0T2JqZWN0IiwibmV3UG9zdFBvbGljeSIsInByZXNpZ25lZFBvc3RQb2xpY3kiLCJwb3N0UG9saWN5IiwiZm9ybURhdGEiLCJkYXRlU3RyIiwiZXhwaXJhdGlvbiIsInNldFNlY29uZHMiLCJzZXRFeHBpcmVzIiwicG9saWN5QmFzZTY0IiwicG9ydFN0ciIsInVybFN0ciIsInBvc3RVUkwiLCJsaXN0T2JqZWN0c1F1ZXJ5IiwibGlzdFF1ZXJ5T3B0cyIsIkRlbGltaXRlciIsIk1heEtleXMiLCJJbmNsdWRlVmVyc2lvbiIsInZlcnNpb25JZE1hcmtlciIsImxpc3RRcnlMaXN0IiwibGlzdE9iamVjdHMiLCJsaXN0T3B0cyIsIm9iamVjdHMiLCJuZXh0TWFya2VyIiwibGlzdE9iamVjdHNWMlF1ZXJ5IiwiY29udGludWF0aW9uVG9rZW4iLCJtYXhLZXlzIiwic3RhcnRBZnRlciIsImxpc3RPYmplY3RzVjIiLCJwcmVmaXhTdHIiLCJzdGFydEFmdGVyU3RyIiwibmV4dENvbnRpbnVhdGlvblRva2VuIiwic2V0QnVja2V0Tm90aWZpY2F0aW9uIiwicmVtb3ZlQWxsQnVja2V0Tm90aWZpY2F0aW9uIiwiZ2V0QnVja2V0Tm90aWZpY2F0aW9uIiwibGlzdGVuQnVja2V0Tm90aWZpY2F0aW9uIiwic3VmZml4IiwiZXZlbnRzIiwibGlzdGVuZXIiLCJzdGFydCJdLCJzb3VyY2VzIjpbImNsaWVudC50cyJdLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBjcnlwdG8gZnJvbSAnbm9kZTpjcnlwdG8nXG5pbXBvcnQgKiBhcyBmcyBmcm9tICdub2RlOmZzJ1xuaW1wb3J0IHR5cGUgeyBJbmNvbWluZ0h0dHBIZWFkZXJzIH0gZnJvbSAnbm9kZTpodHRwJ1xuaW1wb3J0ICogYXMgaHR0cCBmcm9tICdub2RlOmh0dHAnXG5pbXBvcnQgKiBhcyBodHRwcyBmcm9tICdub2RlOmh0dHBzJ1xuaW1wb3J0ICogYXMgcGF0aCBmcm9tICdub2RlOnBhdGgnXG5pbXBvcnQgKiBhcyBzdHJlYW0gZnJvbSAnbm9kZTpzdHJlYW0nXG5cbmltcG9ydCAqIGFzIGFzeW5jIGZyb20gJ2FzeW5jJ1xuaW1wb3J0IEJsb2NrU3RyZWFtMiBmcm9tICdibG9jay1zdHJlYW0yJ1xuaW1wb3J0IHsgaXNCcm93c2VyIH0gZnJvbSAnYnJvd3Nlci1vci1ub2RlJ1xuaW1wb3J0IF8gZnJvbSAnbG9kYXNoJ1xuaW1wb3J0ICogYXMgcXMgZnJvbSAncXVlcnktc3RyaW5nJ1xuaW1wb3J0IHhtbDJqcyBmcm9tICd4bWwyanMnXG5cbmltcG9ydCB7IENyZWRlbnRpYWxQcm92aWRlciB9IGZyb20gJy4uL0NyZWRlbnRpYWxQcm92aWRlci50cydcbmltcG9ydCAqIGFzIGVycm9ycyBmcm9tICcuLi9lcnJvcnMudHMnXG5pbXBvcnQgdHlwZSB7IFNlbGVjdFJlc3VsdHMgfSBmcm9tICcuLi9oZWxwZXJzLnRzJ1xuaW1wb3J0IHtcbiAgQ29weURlc3RpbmF0aW9uT3B0aW9ucyxcbiAgQ29weVNvdXJjZU9wdGlvbnMsXG4gIERFRkFVTFRfUkVHSU9OLFxuICBMRUdBTF9IT0xEX1NUQVRVUyxcbiAgUFJFU0lHTl9FWFBJUllfREFZU19NQVgsXG4gIFJFVEVOVElPTl9NT0RFUyxcbiAgUkVURU5USU9OX1ZBTElESVRZX1VOSVRTLFxufSBmcm9tICcuLi9oZWxwZXJzLnRzJ1xuaW1wb3J0IHR5cGUgeyBOb3RpZmljYXRpb25FdmVudCB9IGZyb20gJy4uL25vdGlmaWNhdGlvbi50cydcbmltcG9ydCB7IE5vdGlmaWNhdGlvbkNvbmZpZywgTm90aWZpY2F0aW9uUG9sbGVyIH0gZnJvbSAnLi4vbm90aWZpY2F0aW9uLnRzJ1xuaW1wb3J0IHsgcG9zdFByZXNpZ25TaWduYXR1cmVWNCwgcHJlc2lnblNpZ25hdHVyZVY0LCBzaWduVjQgfSBmcm9tICcuLi9zaWduaW5nLnRzJ1xuaW1wb3J0IHsgZnNwLCBzdHJlYW1Qcm9taXNlIH0gZnJvbSAnLi9hc3luYy50cydcbmltcG9ydCB7IENvcHlDb25kaXRpb25zIH0gZnJvbSAnLi9jb3B5LWNvbmRpdGlvbnMudHMnXG5pbXBvcnQgeyBFeHRlbnNpb25zIH0gZnJvbSAnLi9leHRlbnNpb25zLnRzJ1xuaW1wb3J0IHtcbiAgY2FsY3VsYXRlRXZlblNwbGl0cyxcbiAgZXh0cmFjdE1ldGFkYXRhLFxuICBnZXRDb250ZW50TGVuZ3RoLFxuICBnZXRTY29wZSxcbiAgZ2V0U291cmNlVmVyc2lvbklkLFxuICBnZXRWZXJzaW9uSWQsXG4gIGhhc2hCaW5hcnksXG4gIGluc2VydENvbnRlbnRUeXBlLFxuICBpc0FtYXpvbkVuZHBvaW50LFxuICBpc0Jvb2xlYW4sXG4gIGlzRGVmaW5lZCxcbiAgaXNFbXB0eSxcbiAgaXNOdW1iZXIsXG4gIGlzT2JqZWN0LFxuICBpc1BsYWluT2JqZWN0LFxuICBpc1JlYWRhYmxlU3RyZWFtLFxuICBpc1N0cmluZyxcbiAgaXNWYWxpZEJ1Y2tldE5hbWUsXG4gIGlzVmFsaWRFbmRwb2ludCxcbiAgaXNWYWxpZE9iamVjdE5hbWUsXG4gIGlzVmFsaWRQb3J0LFxuICBpc1ZhbGlkUHJlZml4LFxuICBpc1ZpcnR1YWxIb3N0U3R5bGUsXG4gIG1ha2VEYXRlTG9uZyxcbiAgUEFSVF9DT05TVFJBSU5UUyxcbiAgcGFydHNSZXF1aXJlZCxcbiAgcHJlcGVuZFhBTVpNZXRhLFxuICByZWFkYWJsZVN0cmVhbSxcbiAgc2FuaXRpemVFVGFnLFxuICB0b01kNSxcbiAgdG9TaGEyNTYsXG4gIHVyaUVzY2FwZSxcbiAgdXJpUmVzb3VyY2VFc2NhcGUsXG59IGZyb20gJy4vaGVscGVyLnRzJ1xuaW1wb3J0IHsgam9pbkhvc3RQb3J0IH0gZnJvbSAnLi9qb2luLWhvc3QtcG9ydC50cydcbmltcG9ydCB7IFBvc3RQb2xpY3kgfSBmcm9tICcuL3Bvc3QtcG9saWN5LnRzJ1xuaW1wb3J0IHsgcmVxdWVzdFdpdGhSZXRyeSB9IGZyb20gJy4vcmVxdWVzdC50cydcbmltcG9ydCB7IGRyYWluUmVzcG9uc2UsIHJlYWRBc0J1ZmZlciwgcmVhZEFzU3RyaW5nIH0gZnJvbSAnLi9yZXNwb25zZS50cydcbmltcG9ydCB0eXBlIHsgUmVnaW9uIH0gZnJvbSAnLi9zMy1lbmRwb2ludHMudHMnXG5pbXBvcnQgeyBnZXRTM0VuZHBvaW50IH0gZnJvbSAnLi9zMy1lbmRwb2ludHMudHMnXG5pbXBvcnQgdHlwZSB7XG4gIEJpbmFyeSxcbiAgQnVja2V0SXRlbSxcbiAgQnVja2V0SXRlbUZyb21MaXN0LFxuICBCdWNrZXRJdGVtU3RhdCxcbiAgQnVja2V0U3RyZWFtLFxuICBCdWNrZXRWZXJzaW9uaW5nQ29uZmlndXJhdGlvbixcbiAgQ29weU9iamVjdFBhcmFtcyxcbiAgQ29weU9iamVjdFJlc3VsdCxcbiAgQ29weU9iamVjdFJlc3VsdFYyLFxuICBFbmNyeXB0aW9uQ29uZmlnLFxuICBHZXRPYmplY3RMZWdhbEhvbGRPcHRpb25zLFxuICBHZXRPYmplY3RPcHRzLFxuICBHZXRPYmplY3RSZXRlbnRpb25PcHRzLFxuICBJbmNvbXBsZXRlVXBsb2FkZWRCdWNrZXRJdGVtLFxuICBJUmVxdWVzdCxcbiAgSXRlbUJ1Y2tldE1ldGFkYXRhLFxuICBMaWZlY3ljbGVDb25maWcsXG4gIExpZmVDeWNsZUNvbmZpZ1BhcmFtLFxuICBMaXN0T2JqZWN0UXVlcnlPcHRzLFxuICBMaXN0T2JqZWN0UXVlcnlSZXMsXG4gIExpc3RPYmplY3RWMlJlcyxcbiAgTm90aWZpY2F0aW9uQ29uZmlnUmVzdWx0LFxuICBPYmplY3RJbmZvLFxuICBPYmplY3RMb2NrQ29uZmlnUGFyYW0sXG4gIE9iamVjdExvY2tJbmZvLFxuICBPYmplY3RNZXRhRGF0YSxcbiAgT2JqZWN0UmV0ZW50aW9uSW5mbyxcbiAgUG9zdFBvbGljeVJlc3VsdCxcbiAgUHJlU2lnblJlcXVlc3RQYXJhbXMsXG4gIFB1dE9iamVjdExlZ2FsSG9sZE9wdGlvbnMsXG4gIFB1dFRhZ2dpbmdQYXJhbXMsXG4gIFJlbW92ZU9iamVjdHNQYXJhbSxcbiAgUmVtb3ZlT2JqZWN0c1JlcXVlc3RFbnRyeSxcbiAgUmVtb3ZlT2JqZWN0c1Jlc3BvbnNlLFxuICBSZW1vdmVUYWdnaW5nUGFyYW1zLFxuICBSZXBsaWNhdGlvbkNvbmZpZyxcbiAgUmVwbGljYXRpb25Db25maWdPcHRzLFxuICBSZXF1ZXN0SGVhZGVycyxcbiAgUmVzcG9uc2VIZWFkZXIsXG4gIFJlc3VsdENhbGxiYWNrLFxuICBSZXRlbnRpb24sXG4gIFNlbGVjdE9wdGlvbnMsXG4gIFN0YXRPYmplY3RPcHRzLFxuICBUYWcsXG4gIFRhZ2dpbmdPcHRzLFxuICBUYWdzLFxuICBUcmFuc3BvcnQsXG4gIFVwbG9hZGVkT2JqZWN0SW5mbyxcbiAgVXBsb2FkUGFydENvbmZpZyxcbn0gZnJvbSAnLi90eXBlLnRzJ1xuaW1wb3J0IHR5cGUgeyBMaXN0TXVsdGlwYXJ0UmVzdWx0LCBVcGxvYWRlZFBhcnQgfSBmcm9tICcuL3htbC1wYXJzZXIudHMnXG5pbXBvcnQge1xuICBwYXJzZUJ1Y2tldE5vdGlmaWNhdGlvbixcbiAgcGFyc2VDb21wbGV0ZU11bHRpcGFydCxcbiAgcGFyc2VJbml0aWF0ZU11bHRpcGFydCxcbiAgcGFyc2VMaXN0T2JqZWN0cyxcbiAgcGFyc2VMaXN0T2JqZWN0c1YyLFxuICBwYXJzZU9iamVjdExlZ2FsSG9sZENvbmZpZyxcbiAgcGFyc2VTZWxlY3RPYmplY3RDb250ZW50UmVzcG9uc2UsXG4gIHVwbG9hZFBhcnRQYXJzZXIsXG59IGZyb20gJy4veG1sLXBhcnNlci50cydcbmltcG9ydCAqIGFzIHhtbFBhcnNlcnMgZnJvbSAnLi94bWwtcGFyc2VyLnRzJ1xuXG5jb25zdCB4bWwgPSBuZXcgeG1sMmpzLkJ1aWxkZXIoeyByZW5kZXJPcHRzOiB7IHByZXR0eTogZmFsc2UgfSwgaGVhZGxlc3M6IHRydWUgfSlcblxuLy8gd2lsbCBiZSByZXBsYWNlZCBieSBidW5kbGVyLlxuY29uc3QgUGFja2FnZSA9IHsgdmVyc2lvbjogcHJvY2Vzcy5lbnYuTUlOSU9fSlNfUEFDS0FHRV9WRVJTSU9OIHx8ICdkZXZlbG9wbWVudCcgfVxuXG5jb25zdCByZXF1ZXN0T3B0aW9uUHJvcGVydGllcyA9IFtcbiAgJ2FnZW50JyxcbiAgJ2NhJyxcbiAgJ2NlcnQnLFxuICAnY2lwaGVycycsXG4gICdjbGllbnRDZXJ0RW5naW5lJyxcbiAgJ2NybCcsXG4gICdkaHBhcmFtJyxcbiAgJ2VjZGhDdXJ2ZScsXG4gICdmYW1pbHknLFxuICAnaG9ub3JDaXBoZXJPcmRlcicsXG4gICdrZXknLFxuICAncGFzc3BocmFzZScsXG4gICdwZngnLFxuICAncmVqZWN0VW5hdXRob3JpemVkJyxcbiAgJ3NlY3VyZU9wdGlvbnMnLFxuICAnc2VjdXJlUHJvdG9jb2wnLFxuICAnc2VydmVybmFtZScsXG4gICdzZXNzaW9uSWRDb250ZXh0Jyxcbl0gYXMgY29uc3RcblxuZXhwb3J0IGludGVyZmFjZSBSZXRyeU9wdGlvbnMge1xuICAvKipcbiAgICogSWYgdGhpcyBzZXQgdG8gdHJ1ZSwgaXQgd2lsbCB0YWtlIHByZWNlZGVuY2Ugb3ZlciBhbGwgb3RoZXIgcmV0cnkgb3B0aW9ucy5cbiAgICogQGRlZmF1bHQgZmFsc2VcbiAgICovXG4gIGRpc2FibGVSZXRyeT86IGJvb2xlYW5cbiAgLyoqXG4gICAqIFRoZSBtYXhpbXVtIGFtb3VudCBvZiByZXRyaWVzIGZvciBhIHJlcXVlc3QuXG4gICAqIEBkZWZhdWx0IDFcbiAgICovXG4gIG1heGltdW1SZXRyeUNvdW50PzogbnVtYmVyXG4gIC8qKlxuICAgKiBUaGUgbWluaW11bSBkdXJhdGlvbiAoaW4gbWlsbGlzZWNvbmRzKSBmb3IgdGhlIGV4cG9uZW50aWFsIGJhY2tvZmYgYWxnb3JpdGhtLlxuICAgKiBAZGVmYXVsdCAxMDBcbiAgICovXG4gIGJhc2VEZWxheU1zPzogbnVtYmVyXG4gIC8qKlxuICAgKiBUaGUgbWF4aW11bSBkdXJhdGlvbiAoaW4gbWlsbGlzZWNvbmRzKSBmb3IgdGhlIGV4cG9uZW50aWFsIGJhY2tvZmYgYWxnb3JpdGhtLlxuICAgKiBAZGVmYXVsdCA2MDAwMFxuICAgKi9cbiAgbWF4aW11bURlbGF5TXM/OiBudW1iZXJcbn1cblxuZXhwb3J0IGludGVyZmFjZSBDbGllbnRPcHRpb25zIHtcbiAgZW5kUG9pbnQ6IHN0cmluZ1xuICBhY2Nlc3NLZXk/OiBzdHJpbmdcbiAgc2VjcmV0S2V5Pzogc3RyaW5nXG4gIHVzZVNTTD86IGJvb2xlYW5cbiAgcG9ydD86IG51bWJlclxuICByZWdpb24/OiBSZWdpb25cbiAgdHJhbnNwb3J0PzogVHJhbnNwb3J0XG4gIHNlc3Npb25Ub2tlbj86IHN0cmluZ1xuICBwYXJ0U2l6ZT86IG51bWJlclxuICBwYXRoU3R5bGU/OiBib29sZWFuXG4gIGNyZWRlbnRpYWxzUHJvdmlkZXI/OiBDcmVkZW50aWFsUHJvdmlkZXJcbiAgczNBY2NlbGVyYXRlRW5kcG9pbnQ/OiBzdHJpbmdcbiAgdHJhbnNwb3J0QWdlbnQ/OiBodHRwLkFnZW50XG4gIHJldHJ5T3B0aW9ucz86IFJldHJ5T3B0aW9uc1xufVxuXG5leHBvcnQgdHlwZSBSZXF1ZXN0T3B0aW9uID0gUGFydGlhbDxJUmVxdWVzdD4gJiB7XG4gIG1ldGhvZDogc3RyaW5nXG4gIGJ1Y2tldE5hbWU/OiBzdHJpbmdcbiAgb2JqZWN0TmFtZT86IHN0cmluZ1xuICBxdWVyeT86IHN0cmluZ1xuICBwYXRoU3R5bGU/OiBib29sZWFuXG59XG5cbmV4cG9ydCB0eXBlIE5vUmVzdWx0Q2FsbGJhY2sgPSAoZXJyb3I6IHVua25vd24pID0+IHZvaWRcblxuZXhwb3J0IGludGVyZmFjZSBNYWtlQnVja2V0T3B0IHtcbiAgT2JqZWN0TG9ja2luZz86IGJvb2xlYW5cbn1cblxuZXhwb3J0IGludGVyZmFjZSBSZW1vdmVPcHRpb25zIHtcbiAgdmVyc2lvbklkPzogc3RyaW5nXG4gIGdvdmVybmFuY2VCeXBhc3M/OiBib29sZWFuXG4gIGZvcmNlRGVsZXRlPzogYm9vbGVhblxufVxuXG50eXBlIFBhcnQgPSB7XG4gIHBhcnQ6IG51bWJlclxuICBldGFnOiBzdHJpbmdcbn1cblxuZXhwb3J0IGNsYXNzIFR5cGVkQ2xpZW50IHtcbiAgcHJvdGVjdGVkIHRyYW5zcG9ydDogVHJhbnNwb3J0XG4gIHByb3RlY3RlZCBob3N0OiBzdHJpbmdcbiAgcHJvdGVjdGVkIHBvcnQ6IG51bWJlclxuICBwcm90ZWN0ZWQgcHJvdG9jb2w6IHN0cmluZ1xuICBwcm90ZWN0ZWQgYWNjZXNzS2V5OiBzdHJpbmdcbiAgcHJvdGVjdGVkIHNlY3JldEtleTogc3RyaW5nXG4gIHByb3RlY3RlZCBzZXNzaW9uVG9rZW4/OiBzdHJpbmdcbiAgcHJvdGVjdGVkIHVzZXJBZ2VudDogc3RyaW5nXG4gIHByb3RlY3RlZCBhbm9ueW1vdXM6IGJvb2xlYW5cbiAgcHJvdGVjdGVkIHBhdGhTdHlsZTogYm9vbGVhblxuICBwcm90ZWN0ZWQgcmVnaW9uTWFwOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+XG4gIHB1YmxpYyByZWdpb24/OiBzdHJpbmdcbiAgcHJvdGVjdGVkIGNyZWRlbnRpYWxzUHJvdmlkZXI/OiBDcmVkZW50aWFsUHJvdmlkZXJcbiAgcGFydFNpemU6IG51bWJlciA9IDY0ICogMTAyNCAqIDEwMjRcbiAgcHJvdGVjdGVkIG92ZXJSaWRlUGFydFNpemU/OiBib29sZWFuXG4gIHByb3RlY3RlZCByZXRyeU9wdGlvbnM6IFJldHJ5T3B0aW9uc1xuXG4gIHByb3RlY3RlZCBtYXhpbXVtUGFydFNpemUgPSA1ICogMTAyNCAqIDEwMjQgKiAxMDI0XG4gIHByb3RlY3RlZCBtYXhPYmplY3RTaXplID0gNSAqIDEwMjQgKiAxMDI0ICogMTAyNCAqIDEwMjRcbiAgcHVibGljIGVuYWJsZVNIQTI1NjogYm9vbGVhblxuICBwcm90ZWN0ZWQgczNBY2NlbGVyYXRlRW5kcG9pbnQ/OiBzdHJpbmdcbiAgcHJvdGVjdGVkIHJlcU9wdGlvbnM6IFJlY29yZDxzdHJpbmcsIHVua25vd24+XG5cbiAgcHJvdGVjdGVkIHRyYW5zcG9ydEFnZW50OiBodHRwLkFnZW50XG4gIHByaXZhdGUgcmVhZG9ubHkgY2xpZW50RXh0ZW5zaW9uczogRXh0ZW5zaW9uc1xuXG4gIGNvbnN0cnVjdG9yKHBhcmFtczogQ2xpZW50T3B0aW9ucykge1xuICAgIC8vIEB0cy1leHBlY3QtZXJyb3IgZGVwcmVjYXRlZCBwcm9wZXJ0eVxuICAgIGlmIChwYXJhbXMuc2VjdXJlICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignXCJzZWN1cmVcIiBvcHRpb24gZGVwcmVjYXRlZCwgXCJ1c2VTU0xcIiBzaG91bGQgYmUgdXNlZCBpbnN0ZWFkJylcbiAgICB9XG4gICAgLy8gRGVmYXVsdCB2YWx1ZXMgaWYgbm90IHNwZWNpZmllZC5cbiAgICBpZiAocGFyYW1zLnVzZVNTTCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICBwYXJhbXMudXNlU1NMID0gdHJ1ZVxuICAgIH1cbiAgICBpZiAoIXBhcmFtcy5wb3J0KSB7XG4gICAgICBwYXJhbXMucG9ydCA9IDBcbiAgICB9XG4gICAgLy8gVmFsaWRhdGUgaW5wdXQgcGFyYW1zLlxuICAgIGlmICghaXNWYWxpZEVuZHBvaW50KHBhcmFtcy5lbmRQb2ludCkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEVuZHBvaW50RXJyb3IoYEludmFsaWQgZW5kUG9pbnQgOiAke3BhcmFtcy5lbmRQb2ludH1gKVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRQb3J0KHBhcmFtcy5wb3J0KSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcihgSW52YWxpZCBwb3J0IDogJHtwYXJhbXMucG9ydH1gKVxuICAgIH1cbiAgICBpZiAoIWlzQm9vbGVhbihwYXJhbXMudXNlU1NMKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcihcbiAgICAgICAgYEludmFsaWQgdXNlU1NMIGZsYWcgdHlwZSA6ICR7cGFyYW1zLnVzZVNTTH0sIGV4cGVjdGVkIHRvIGJlIG9mIHR5cGUgXCJib29sZWFuXCJgLFxuICAgICAgKVxuICAgIH1cblxuICAgIC8vIFZhbGlkYXRlIHJlZ2lvbiBvbmx5IGlmIGl0cyBzZXQuXG4gICAgaWYgKHBhcmFtcy5yZWdpb24pIHtcbiAgICAgIGlmICghaXNTdHJpbmcocGFyYW1zLnJlZ2lvbikpIHtcbiAgICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcihgSW52YWxpZCByZWdpb24gOiAke3BhcmFtcy5yZWdpb259YClcbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCBob3N0ID0gcGFyYW1zLmVuZFBvaW50LnRvTG93ZXJDYXNlKClcbiAgICBsZXQgcG9ydCA9IHBhcmFtcy5wb3J0XG4gICAgbGV0IHByb3RvY29sOiBzdHJpbmdcbiAgICBsZXQgdHJhbnNwb3J0XG4gICAgbGV0IHRyYW5zcG9ydEFnZW50OiBodHRwLkFnZW50XG4gICAgLy8gVmFsaWRhdGUgaWYgY29uZmlndXJhdGlvbiBpcyBub3QgdXNpbmcgU1NMXG4gICAgLy8gZm9yIGNvbnN0cnVjdGluZyByZWxldmFudCBlbmRwb2ludHMuXG4gICAgaWYgKHBhcmFtcy51c2VTU0wpIHtcbiAgICAgIC8vIERlZmF1bHRzIHRvIHNlY3VyZS5cbiAgICAgIHRyYW5zcG9ydCA9IGh0dHBzXG4gICAgICBwcm90b2NvbCA9ICdodHRwczonXG4gICAgICBwb3J0ID0gcG9ydCB8fCA0NDNcbiAgICAgIHRyYW5zcG9ydEFnZW50ID0gaHR0cHMuZ2xvYmFsQWdlbnRcbiAgICB9IGVsc2Uge1xuICAgICAgdHJhbnNwb3J0ID0gaHR0cFxuICAgICAgcHJvdG9jb2wgPSAnaHR0cDonXG4gICAgICBwb3J0ID0gcG9ydCB8fCA4MFxuICAgICAgdHJhbnNwb3J0QWdlbnQgPSBodHRwLmdsb2JhbEFnZW50XG4gICAgfVxuXG4gICAgLy8gaWYgY3VzdG9tIHRyYW5zcG9ydCBpcyBzZXQsIHVzZSBpdC5cbiAgICBpZiAocGFyYW1zLnRyYW5zcG9ydCkge1xuICAgICAgaWYgKCFpc09iamVjdChwYXJhbXMudHJhbnNwb3J0KSkge1xuICAgICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKFxuICAgICAgICAgIGBJbnZhbGlkIHRyYW5zcG9ydCB0eXBlIDogJHtwYXJhbXMudHJhbnNwb3J0fSwgZXhwZWN0ZWQgdG8gYmUgdHlwZSBcIm9iamVjdFwiYCxcbiAgICAgICAgKVxuICAgICAgfVxuICAgICAgdHJhbnNwb3J0ID0gcGFyYW1zLnRyYW5zcG9ydFxuICAgIH1cblxuICAgIC8vIGlmIGN1c3RvbSB0cmFuc3BvcnQgYWdlbnQgaXMgc2V0LCB1c2UgaXQuXG4gICAgaWYgKHBhcmFtcy50cmFuc3BvcnRBZ2VudCkge1xuICAgICAgaWYgKCFpc09iamVjdChwYXJhbXMudHJhbnNwb3J0QWdlbnQpKSB7XG4gICAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoXG4gICAgICAgICAgYEludmFsaWQgdHJhbnNwb3J0QWdlbnQgdHlwZTogJHtwYXJhbXMudHJhbnNwb3J0QWdlbnR9LCBleHBlY3RlZCB0byBiZSB0eXBlIFwib2JqZWN0XCJgLFxuICAgICAgICApXG4gICAgICB9XG5cbiAgICAgIHRyYW5zcG9ydEFnZW50ID0gcGFyYW1zLnRyYW5zcG9ydEFnZW50XG4gICAgfVxuXG4gICAgLy8gVXNlciBBZ2VudCBzaG91bGQgYWx3YXlzIGZvbGxvd2luZyB0aGUgYmVsb3cgc3R5bGUuXG4gICAgLy8gUGxlYXNlIG9wZW4gYW4gaXNzdWUgdG8gZGlzY3VzcyBhbnkgbmV3IGNoYW5nZXMgaGVyZS5cbiAgICAvL1xuICAgIC8vICAgICAgIE1pbklPIChPUzsgQVJDSCkgTElCL1ZFUiBBUFAvVkVSXG4gICAgLy9cbiAgICBjb25zdCBsaWJyYXJ5Q29tbWVudHMgPSBgKCR7cHJvY2Vzcy5wbGF0Zm9ybX07ICR7cHJvY2Vzcy5hcmNofSlgXG4gICAgY29uc3QgbGlicmFyeUFnZW50ID0gYE1pbklPICR7bGlicmFyeUNvbW1lbnRzfSBtaW5pby1qcy8ke1BhY2thZ2UudmVyc2lvbn1gXG4gICAgLy8gVXNlciBhZ2VudCBibG9jayBlbmRzLlxuXG4gICAgdGhpcy50cmFuc3BvcnQgPSB0cmFuc3BvcnRcbiAgICB0aGlzLnRyYW5zcG9ydEFnZW50ID0gdHJhbnNwb3J0QWdlbnRcbiAgICB0aGlzLmhvc3QgPSBob3N0XG4gICAgdGhpcy5wb3J0ID0gcG9ydFxuICAgIHRoaXMucHJvdG9jb2wgPSBwcm90b2NvbFxuICAgIHRoaXMudXNlckFnZW50ID0gYCR7bGlicmFyeUFnZW50fWBcblxuICAgIC8vIERlZmF1bHQgcGF0aCBzdHlsZSBpcyB0cnVlXG4gICAgaWYgKHBhcmFtcy5wYXRoU3R5bGUgPT09IHVuZGVmaW5lZCkge1xuICAgICAgdGhpcy5wYXRoU3R5bGUgPSB0cnVlXG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMucGF0aFN0eWxlID0gcGFyYW1zLnBhdGhTdHlsZVxuICAgIH1cblxuICAgIHRoaXMuYWNjZXNzS2V5ID0gcGFyYW1zLmFjY2Vzc0tleSA/PyAnJ1xuICAgIHRoaXMuc2VjcmV0S2V5ID0gcGFyYW1zLnNlY3JldEtleSA/PyAnJ1xuICAgIHRoaXMuc2Vzc2lvblRva2VuID0gcGFyYW1zLnNlc3Npb25Ub2tlblxuICAgIHRoaXMuYW5vbnltb3VzID0gIXRoaXMuYWNjZXNzS2V5IHx8ICF0aGlzLnNlY3JldEtleVxuXG4gICAgaWYgKHBhcmFtcy5jcmVkZW50aWFsc1Byb3ZpZGVyKSB7XG4gICAgICB0aGlzLmFub255bW91cyA9IGZhbHNlXG4gICAgICB0aGlzLmNyZWRlbnRpYWxzUHJvdmlkZXIgPSBwYXJhbXMuY3JlZGVudGlhbHNQcm92aWRlclxuICAgIH1cblxuICAgIHRoaXMucmVnaW9uTWFwID0ge31cbiAgICBpZiAocGFyYW1zLnJlZ2lvbikge1xuICAgICAgdGhpcy5yZWdpb24gPSBwYXJhbXMucmVnaW9uXG4gICAgfVxuXG4gICAgaWYgKHBhcmFtcy5wYXJ0U2l6ZSkge1xuICAgICAgdGhpcy5wYXJ0U2l6ZSA9IHBhcmFtcy5wYXJ0U2l6ZVxuICAgICAgdGhpcy5vdmVyUmlkZVBhcnRTaXplID0gdHJ1ZVxuICAgIH1cbiAgICBpZiAodGhpcy5wYXJ0U2l6ZSA8IDUgKiAxMDI0ICogMTAyNCkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcihgUGFydCBzaXplIHNob3VsZCBiZSBncmVhdGVyIHRoYW4gNU1CYClcbiAgICB9XG4gICAgaWYgKHRoaXMucGFydFNpemUgPiA1ICogMTAyNCAqIDEwMjQgKiAxMDI0KSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKGBQYXJ0IHNpemUgc2hvdWxkIGJlIGxlc3MgdGhhbiA1R0JgKVxuICAgIH1cblxuICAgIC8vIFNIQTI1NiBpcyBlbmFibGVkIG9ubHkgZm9yIGF1dGhlbnRpY2F0ZWQgaHR0cCByZXF1ZXN0cy4gSWYgdGhlIHJlcXVlc3QgaXMgYXV0aGVudGljYXRlZFxuICAgIC8vIGFuZCB0aGUgY29ubmVjdGlvbiBpcyBodHRwcyB3ZSB1c2UgeC1hbXotY29udGVudC1zaGEyNTY9VU5TSUdORUQtUEFZTE9BRFxuICAgIC8vIGhlYWRlciBmb3Igc2lnbmF0dXJlIGNhbGN1bGF0aW9uLlxuICAgIHRoaXMuZW5hYmxlU0hBMjU2ID0gIXRoaXMuYW5vbnltb3VzICYmICFwYXJhbXMudXNlU1NMXG5cbiAgICB0aGlzLnMzQWNjZWxlcmF0ZUVuZHBvaW50ID0gcGFyYW1zLnMzQWNjZWxlcmF0ZUVuZHBvaW50IHx8IHVuZGVmaW5lZFxuICAgIHRoaXMucmVxT3B0aW9ucyA9IHt9XG4gICAgdGhpcy5jbGllbnRFeHRlbnNpb25zID0gbmV3IEV4dGVuc2lvbnModGhpcylcblxuICAgIGlmIChwYXJhbXMucmV0cnlPcHRpb25zKSB7XG4gICAgICBpZiAoIWlzT2JqZWN0KHBhcmFtcy5yZXRyeU9wdGlvbnMpKSB7XG4gICAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoXG4gICAgICAgICAgYEludmFsaWQgcmV0cnlPcHRpb25zIHR5cGU6ICR7cGFyYW1zLnJldHJ5T3B0aW9uc30sIGV4cGVjdGVkIHRvIGJlIHR5cGUgXCJvYmplY3RcImAsXG4gICAgICAgIClcbiAgICAgIH1cblxuICAgICAgdGhpcy5yZXRyeU9wdGlvbnMgPSBwYXJhbXMucmV0cnlPcHRpb25zXG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMucmV0cnlPcHRpb25zID0ge1xuICAgICAgICBkaXNhYmxlUmV0cnk6IGZhbHNlLFxuICAgICAgfVxuICAgIH1cbiAgfVxuICAvKipcbiAgICogTWluaW8gZXh0ZW5zaW9ucyB0aGF0IGFyZW4ndCBuZWNlc3NhcnkgcHJlc2VudCBmb3IgQW1hem9uIFMzIGNvbXBhdGlibGUgc3RvcmFnZSBzZXJ2ZXJzXG4gICAqL1xuICBnZXQgZXh0ZW5zaW9ucygpIHtcbiAgICByZXR1cm4gdGhpcy5jbGllbnRFeHRlbnNpb25zXG4gIH1cblxuICAvKipcbiAgICogQHBhcmFtIGVuZFBvaW50IC0gdmFsaWQgUzMgYWNjZWxlcmF0aW9uIGVuZCBwb2ludFxuICAgKi9cbiAgc2V0UzNUcmFuc2ZlckFjY2VsZXJhdGUoZW5kUG9pbnQ6IHN0cmluZykge1xuICAgIHRoaXMuczNBY2NlbGVyYXRlRW5kcG9pbnQgPSBlbmRQb2ludFxuICB9XG5cbiAgLyoqXG4gICAqIFNldHMgdGhlIHN1cHBvcnRlZCByZXF1ZXN0IG9wdGlvbnMuXG4gICAqL1xuICBwdWJsaWMgc2V0UmVxdWVzdE9wdGlvbnMob3B0aW9uczogUGljazxodHRwcy5SZXF1ZXN0T3B0aW9ucywgKHR5cGVvZiByZXF1ZXN0T3B0aW9uUHJvcGVydGllcylbbnVtYmVyXT4pIHtcbiAgICBpZiAoIWlzT2JqZWN0KG9wdGlvbnMpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdyZXF1ZXN0IG9wdGlvbnMgc2hvdWxkIGJlIG9mIHR5cGUgXCJvYmplY3RcIicpXG4gICAgfVxuICAgIHRoaXMucmVxT3B0aW9ucyA9IF8ucGljayhvcHRpb25zLCByZXF1ZXN0T3B0aW9uUHJvcGVydGllcylcbiAgfVxuXG4gIC8qKlxuICAgKiAgVGhpcyBpcyBzMyBTcGVjaWZpYyBhbmQgZG9lcyBub3QgaG9sZCB2YWxpZGl0eSBpbiBhbnkgb3RoZXIgT2JqZWN0IHN0b3JhZ2UuXG4gICAqL1xuICBwcml2YXRlIGdldEFjY2VsZXJhdGVFbmRQb2ludElmU2V0KGJ1Y2tldE5hbWU/OiBzdHJpbmcsIG9iamVjdE5hbWU/OiBzdHJpbmcpIHtcbiAgICBpZiAoIWlzRW1wdHkodGhpcy5zM0FjY2VsZXJhdGVFbmRwb2ludCkgJiYgIWlzRW1wdHkoYnVja2V0TmFtZSkgJiYgIWlzRW1wdHkob2JqZWN0TmFtZSkpIHtcbiAgICAgIC8vIGh0dHA6Ly9kb2NzLmF3cy5hbWF6b24uY29tL0FtYXpvblMzL2xhdGVzdC9kZXYvdHJhbnNmZXItYWNjZWxlcmF0aW9uLmh0bWxcbiAgICAgIC8vIERpc2FibGUgdHJhbnNmZXIgYWNjZWxlcmF0aW9uIGZvciBub24tY29tcGxpYW50IGJ1Y2tldCBuYW1lcy5cbiAgICAgIGlmIChidWNrZXROYW1lLmluY2x1ZGVzKCcuJykpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBUcmFuc2ZlciBBY2NlbGVyYXRpb24gaXMgbm90IHN1cHBvcnRlZCBmb3Igbm9uIGNvbXBsaWFudCBidWNrZXQ6JHtidWNrZXROYW1lfWApXG4gICAgICB9XG4gICAgICAvLyBJZiB0cmFuc2ZlciBhY2NlbGVyYXRpb24gaXMgcmVxdWVzdGVkIHNldCBuZXcgaG9zdC5cbiAgICAgIC8vIEZvciBtb3JlIGRldGFpbHMgYWJvdXQgZW5hYmxpbmcgdHJhbnNmZXIgYWNjZWxlcmF0aW9uIHJlYWQgaGVyZS5cbiAgICAgIC8vIGh0dHA6Ly9kb2NzLmF3cy5hbWF6b24uY29tL0FtYXpvblMzL2xhdGVzdC9kZXYvdHJhbnNmZXItYWNjZWxlcmF0aW9uLmh0bWxcbiAgICAgIHJldHVybiB0aGlzLnMzQWNjZWxlcmF0ZUVuZHBvaW50XG4gICAgfVxuICAgIHJldHVybiBmYWxzZVxuICB9XG5cbiAgLyoqXG4gICAqICAgU2V0IGFwcGxpY2F0aW9uIHNwZWNpZmljIGluZm9ybWF0aW9uLlxuICAgKiAgIEdlbmVyYXRlcyBVc2VyLUFnZW50IGluIHRoZSBmb2xsb3dpbmcgc3R5bGUuXG4gICAqICAgTWluSU8gKE9TOyBBUkNIKSBMSUIvVkVSIEFQUC9WRVJcbiAgICovXG4gIHNldEFwcEluZm8oYXBwTmFtZTogc3RyaW5nLCBhcHBWZXJzaW9uOiBzdHJpbmcpIHtcbiAgICBpZiAoIWlzU3RyaW5nKGFwcE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKGBJbnZhbGlkIGFwcE5hbWU6ICR7YXBwTmFtZX1gKVxuICAgIH1cbiAgICBpZiAoYXBwTmFtZS50cmltKCkgPT09ICcnKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCdJbnB1dCBhcHBOYW1lIGNhbm5vdCBiZSBlbXB0eS4nKVxuICAgIH1cbiAgICBpZiAoIWlzU3RyaW5nKGFwcFZlcnNpb24pKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKGBJbnZhbGlkIGFwcFZlcnNpb246ICR7YXBwVmVyc2lvbn1gKVxuICAgIH1cbiAgICBpZiAoYXBwVmVyc2lvbi50cmltKCkgPT09ICcnKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCdJbnB1dCBhcHBWZXJzaW9uIGNhbm5vdCBiZSBlbXB0eS4nKVxuICAgIH1cbiAgICB0aGlzLnVzZXJBZ2VudCA9IGAke3RoaXMudXNlckFnZW50fSAke2FwcE5hbWV9LyR7YXBwVmVyc2lvbn1gXG4gIH1cblxuICAvKipcbiAgICogcmV0dXJucyBvcHRpb25zIG9iamVjdCB0aGF0IGNhbiBiZSB1c2VkIHdpdGggaHR0cC5yZXF1ZXN0KClcbiAgICogVGFrZXMgY2FyZSBvZiBjb25zdHJ1Y3RpbmcgdmlydHVhbC1ob3N0LXN0eWxlIG9yIHBhdGgtc3R5bGUgaG9zdG5hbWVcbiAgICovXG4gIHByb3RlY3RlZCBnZXRSZXF1ZXN0T3B0aW9ucyhcbiAgICBvcHRzOiBSZXF1ZXN0T3B0aW9uICYge1xuICAgICAgcmVnaW9uOiBzdHJpbmdcbiAgICB9LFxuICApOiBJUmVxdWVzdCAmIHtcbiAgICBob3N0OiBzdHJpbmdcbiAgICBoZWFkZXJzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+XG4gIH0ge1xuICAgIGNvbnN0IG1ldGhvZCA9IG9wdHMubWV0aG9kXG4gICAgY29uc3QgcmVnaW9uID0gb3B0cy5yZWdpb25cbiAgICBjb25zdCBidWNrZXROYW1lID0gb3B0cy5idWNrZXROYW1lXG4gICAgbGV0IG9iamVjdE5hbWUgPSBvcHRzLm9iamVjdE5hbWVcbiAgICBjb25zdCBoZWFkZXJzID0gb3B0cy5oZWFkZXJzXG4gICAgY29uc3QgcXVlcnkgPSBvcHRzLnF1ZXJ5XG5cbiAgICBsZXQgcmVxT3B0aW9ucyA9IHtcbiAgICAgIG1ldGhvZCxcbiAgICAgIGhlYWRlcnM6IHt9IGFzIFJlcXVlc3RIZWFkZXJzLFxuICAgICAgcHJvdG9jb2w6IHRoaXMucHJvdG9jb2wsXG4gICAgICAvLyBJZiBjdXN0b20gdHJhbnNwb3J0QWdlbnQgd2FzIHN1cHBsaWVkIGVhcmxpZXIsIHdlJ2xsIGluamVjdCBpdCBoZXJlXG4gICAgICBhZ2VudDogdGhpcy50cmFuc3BvcnRBZ2VudCxcbiAgICB9XG5cbiAgICAvLyBWZXJpZnkgaWYgdmlydHVhbCBob3N0IHN1cHBvcnRlZC5cbiAgICBsZXQgdmlydHVhbEhvc3RTdHlsZVxuICAgIGlmIChidWNrZXROYW1lKSB7XG4gICAgICB2aXJ0dWFsSG9zdFN0eWxlID0gaXNWaXJ0dWFsSG9zdFN0eWxlKHRoaXMuaG9zdCwgdGhpcy5wcm90b2NvbCwgYnVja2V0TmFtZSwgdGhpcy5wYXRoU3R5bGUpXG4gICAgfVxuXG4gICAgbGV0IHBhdGggPSAnLydcbiAgICBsZXQgaG9zdCA9IHRoaXMuaG9zdFxuXG4gICAgbGV0IHBvcnQ6IHVuZGVmaW5lZCB8IG51bWJlclxuICAgIGlmICh0aGlzLnBvcnQpIHtcbiAgICAgIHBvcnQgPSB0aGlzLnBvcnRcbiAgICB9XG5cbiAgICBpZiAob2JqZWN0TmFtZSkge1xuICAgICAgb2JqZWN0TmFtZSA9IHVyaVJlc291cmNlRXNjYXBlKG9iamVjdE5hbWUpXG4gICAgfVxuXG4gICAgLy8gRm9yIEFtYXpvbiBTMyBlbmRwb2ludCwgZ2V0IGVuZHBvaW50IGJhc2VkIG9uIHJlZ2lvbi5cbiAgICBpZiAoaXNBbWF6b25FbmRwb2ludChob3N0KSkge1xuICAgICAgY29uc3QgYWNjZWxlcmF0ZUVuZFBvaW50ID0gdGhpcy5nZXRBY2NlbGVyYXRlRW5kUG9pbnRJZlNldChidWNrZXROYW1lLCBvYmplY3ROYW1lKVxuICAgICAgaWYgKGFjY2VsZXJhdGVFbmRQb2ludCkge1xuICAgICAgICBob3N0ID0gYCR7YWNjZWxlcmF0ZUVuZFBvaW50fWBcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGhvc3QgPSBnZXRTM0VuZHBvaW50KHJlZ2lvbilcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAodmlydHVhbEhvc3RTdHlsZSAmJiAhb3B0cy5wYXRoU3R5bGUpIHtcbiAgICAgIC8vIEZvciBhbGwgaG9zdHMgd2hpY2ggc3VwcG9ydCB2aXJ0dWFsIGhvc3Qgc3R5bGUsIGBidWNrZXROYW1lYFxuICAgICAgLy8gaXMgcGFydCBvZiB0aGUgaG9zdG5hbWUgaW4gdGhlIGZvbGxvd2luZyBmb3JtYXQ6XG4gICAgICAvL1xuICAgICAgLy8gIHZhciBob3N0ID0gJ2J1Y2tldE5hbWUuZXhhbXBsZS5jb20nXG4gICAgICAvL1xuICAgICAgaWYgKGJ1Y2tldE5hbWUpIHtcbiAgICAgICAgaG9zdCA9IGAke2J1Y2tldE5hbWV9LiR7aG9zdH1gXG4gICAgICB9XG4gICAgICBpZiAob2JqZWN0TmFtZSkge1xuICAgICAgICBwYXRoID0gYC8ke29iamVjdE5hbWV9YFxuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICAvLyBGb3IgYWxsIFMzIGNvbXBhdGlibGUgc3RvcmFnZSBzZXJ2aWNlcyB3ZSB3aWxsIGZhbGxiYWNrIHRvXG4gICAgICAvLyBwYXRoIHN0eWxlIHJlcXVlc3RzLCB3aGVyZSBgYnVja2V0TmFtZWAgaXMgcGFydCBvZiB0aGUgVVJJXG4gICAgICAvLyBwYXRoLlxuICAgICAgaWYgKGJ1Y2tldE5hbWUpIHtcbiAgICAgICAgcGF0aCA9IGAvJHtidWNrZXROYW1lfWBcbiAgICAgIH1cbiAgICAgIGlmIChvYmplY3ROYW1lKSB7XG4gICAgICAgIHBhdGggPSBgLyR7YnVja2V0TmFtZX0vJHtvYmplY3ROYW1lfWBcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAocXVlcnkpIHtcbiAgICAgIHBhdGggKz0gYD8ke3F1ZXJ5fWBcbiAgICB9XG4gICAgcmVxT3B0aW9ucy5oZWFkZXJzLmhvc3QgPSBob3N0XG4gICAgaWYgKChyZXFPcHRpb25zLnByb3RvY29sID09PSAnaHR0cDonICYmIHBvcnQgIT09IDgwKSB8fCAocmVxT3B0aW9ucy5wcm90b2NvbCA9PT0gJ2h0dHBzOicgJiYgcG9ydCAhPT0gNDQzKSkge1xuICAgICAgcmVxT3B0aW9ucy5oZWFkZXJzLmhvc3QgPSBqb2luSG9zdFBvcnQoaG9zdCwgcG9ydClcbiAgICB9XG5cbiAgICByZXFPcHRpb25zLmhlYWRlcnNbJ3VzZXItYWdlbnQnXSA9IHRoaXMudXNlckFnZW50XG4gICAgaWYgKGhlYWRlcnMpIHtcbiAgICAgIC8vIGhhdmUgYWxsIGhlYWRlciBrZXlzIGluIGxvd2VyIGNhc2UgLSB0byBtYWtlIHNpZ25pbmcgZWFzeVxuICAgICAgZm9yIChjb25zdCBbaywgdl0gb2YgT2JqZWN0LmVudHJpZXMoaGVhZGVycykpIHtcbiAgICAgICAgcmVxT3B0aW9ucy5oZWFkZXJzW2sudG9Mb3dlckNhc2UoKV0gPSB2XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gVXNlIGFueSByZXF1ZXN0IG9wdGlvbiBzcGVjaWZpZWQgaW4gbWluaW9DbGllbnQuc2V0UmVxdWVzdE9wdGlvbnMoKVxuICAgIHJlcU9wdGlvbnMgPSBPYmplY3QuYXNzaWduKHt9LCB0aGlzLnJlcU9wdGlvbnMsIHJlcU9wdGlvbnMpXG5cbiAgICByZXR1cm4ge1xuICAgICAgLi4ucmVxT3B0aW9ucyxcbiAgICAgIGhlYWRlcnM6IF8ubWFwVmFsdWVzKF8ucGlja0J5KHJlcU9wdGlvbnMuaGVhZGVycywgaXNEZWZpbmVkKSwgKHYpID0+IHYudG9TdHJpbmcoKSksXG4gICAgICBob3N0LFxuICAgICAgcG9ydCxcbiAgICAgIHBhdGgsXG4gICAgfSBzYXRpc2ZpZXMgaHR0cHMuUmVxdWVzdE9wdGlvbnNcbiAgfVxuXG4gIHB1YmxpYyBhc3luYyBzZXRDcmVkZW50aWFsc1Byb3ZpZGVyKGNyZWRlbnRpYWxzUHJvdmlkZXI6IENyZWRlbnRpYWxQcm92aWRlcikge1xuICAgIGlmICghKGNyZWRlbnRpYWxzUHJvdmlkZXIgaW5zdGFuY2VvZiBDcmVkZW50aWFsUHJvdmlkZXIpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ1VuYWJsZSB0byBnZXQgY3JlZGVudGlhbHMuIEV4cGVjdGVkIGluc3RhbmNlIG9mIENyZWRlbnRpYWxQcm92aWRlcicpXG4gICAgfVxuICAgIHRoaXMuY3JlZGVudGlhbHNQcm92aWRlciA9IGNyZWRlbnRpYWxzUHJvdmlkZXJcbiAgICBhd2FpdCB0aGlzLmNoZWNrQW5kUmVmcmVzaENyZWRzKClcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgY2hlY2tBbmRSZWZyZXNoQ3JlZHMoKSB7XG4gICAgaWYgKHRoaXMuY3JlZGVudGlhbHNQcm92aWRlcikge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgY3JlZGVudGlhbHNDb25mID0gYXdhaXQgdGhpcy5jcmVkZW50aWFsc1Byb3ZpZGVyLmdldENyZWRlbnRpYWxzKClcbiAgICAgICAgdGhpcy5hY2Nlc3NLZXkgPSBjcmVkZW50aWFsc0NvbmYuZ2V0QWNjZXNzS2V5KClcbiAgICAgICAgdGhpcy5zZWNyZXRLZXkgPSBjcmVkZW50aWFsc0NvbmYuZ2V0U2VjcmV0S2V5KClcbiAgICAgICAgdGhpcy5zZXNzaW9uVG9rZW4gPSBjcmVkZW50aWFsc0NvbmYuZ2V0U2Vzc2lvblRva2VuKClcbiAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmFibGUgdG8gZ2V0IGNyZWRlbnRpYWxzOiAke2V9YCwgeyBjYXVzZTogZSB9KVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgbG9nU3RyZWFtPzogc3RyZWFtLldyaXRhYmxlXG5cbiAgLyoqXG4gICAqIGxvZyB0aGUgcmVxdWVzdCwgcmVzcG9uc2UsIGVycm9yXG4gICAqL1xuICBwcml2YXRlIGxvZ0hUVFAocmVxT3B0aW9uczogSVJlcXVlc3QsIHJlc3BvbnNlOiBodHRwLkluY29taW5nTWVzc2FnZSB8IG51bGwsIGVycj86IHVua25vd24pIHtcbiAgICAvLyBpZiBubyBsb2dTdHJlYW0gYXZhaWxhYmxlIHJldHVybi5cbiAgICBpZiAoIXRoaXMubG9nU3RyZWFtKSB7XG4gICAgICByZXR1cm5cbiAgICB9XG4gICAgaWYgKCFpc09iamVjdChyZXFPcHRpb25zKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigncmVxT3B0aW9ucyBzaG91bGQgYmUgb2YgdHlwZSBcIm9iamVjdFwiJylcbiAgICB9XG4gICAgaWYgKHJlc3BvbnNlICYmICFpc1JlYWRhYmxlU3RyZWFtKHJlc3BvbnNlKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigncmVzcG9uc2Ugc2hvdWxkIGJlIG9mIHR5cGUgXCJTdHJlYW1cIicpXG4gICAgfVxuICAgIGlmIChlcnIgJiYgIShlcnIgaW5zdGFuY2VvZiBFcnJvcikpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2VyciBzaG91bGQgYmUgb2YgdHlwZSBcIkVycm9yXCInKVxuICAgIH1cbiAgICBjb25zdCBsb2dTdHJlYW0gPSB0aGlzLmxvZ1N0cmVhbVxuICAgIGNvbnN0IGxvZ0hlYWRlcnMgPSAoaGVhZGVyczogUmVxdWVzdEhlYWRlcnMpID0+IHtcbiAgICAgIE9iamVjdC5lbnRyaWVzKGhlYWRlcnMpLmZvckVhY2goKFtrLCB2XSkgPT4ge1xuICAgICAgICBpZiAoayA9PSAnYXV0aG9yaXphdGlvbicpIHtcbiAgICAgICAgICBpZiAoaXNTdHJpbmcodikpIHtcbiAgICAgICAgICAgIGNvbnN0IHJlZGFjdG9yID0gbmV3IFJlZ0V4cCgnU2lnbmF0dXJlPShbMC05YS1mXSspJylcbiAgICAgICAgICAgIHYgPSB2LnJlcGxhY2UocmVkYWN0b3IsICdTaWduYXR1cmU9KipSRURBQ1RFRCoqJylcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgbG9nU3RyZWFtLndyaXRlKGAke2t9OiAke3Z9XFxuYClcbiAgICAgIH0pXG4gICAgICBsb2dTdHJlYW0ud3JpdGUoJ1xcbicpXG4gICAgfVxuICAgIGxvZ1N0cmVhbS53cml0ZShgUkVRVUVTVDogJHtyZXFPcHRpb25zLm1ldGhvZH0gJHtyZXFPcHRpb25zLnBhdGh9XFxuYClcbiAgICBsb2dIZWFkZXJzKHJlcU9wdGlvbnMuaGVhZGVycylcbiAgICBpZiAocmVzcG9uc2UpIHtcbiAgICAgIHRoaXMubG9nU3RyZWFtLndyaXRlKGBSRVNQT05TRTogJHtyZXNwb25zZS5zdGF0dXNDb2RlfVxcbmApXG4gICAgICBsb2dIZWFkZXJzKHJlc3BvbnNlLmhlYWRlcnMgYXMgUmVxdWVzdEhlYWRlcnMpXG4gICAgfVxuICAgIGlmIChlcnIpIHtcbiAgICAgIGxvZ1N0cmVhbS53cml0ZSgnRVJST1IgQk9EWTpcXG4nKVxuICAgICAgY29uc3QgZXJySlNPTiA9IEpTT04uc3RyaW5naWZ5KGVyciwgbnVsbCwgJ1xcdCcpXG4gICAgICBsb2dTdHJlYW0ud3JpdGUoYCR7ZXJySlNPTn1cXG5gKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBFbmFibGUgdHJhY2luZ1xuICAgKi9cbiAgcHVibGljIHRyYWNlT24oc3RyZWFtPzogc3RyZWFtLldyaXRhYmxlKSB7XG4gICAgaWYgKCFzdHJlYW0pIHtcbiAgICAgIHN0cmVhbSA9IHByb2Nlc3Muc3Rkb3V0XG4gICAgfVxuICAgIHRoaXMubG9nU3RyZWFtID0gc3RyZWFtXG4gIH1cblxuICAvKipcbiAgICogRGlzYWJsZSB0cmFjaW5nXG4gICAqL1xuICBwdWJsaWMgdHJhY2VPZmYoKSB7XG4gICAgdGhpcy5sb2dTdHJlYW0gPSB1bmRlZmluZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBtYWtlUmVxdWVzdCBpcyB0aGUgcHJpbWl0aXZlIHVzZWQgYnkgdGhlIGFwaXMgZm9yIG1ha2luZyBTMyByZXF1ZXN0cy5cbiAgICogcGF5bG9hZCBjYW4gYmUgZW1wdHkgc3RyaW5nIGluIGNhc2Ugb2Ygbm8gcGF5bG9hZC5cbiAgICogc3RhdHVzQ29kZSBpcyB0aGUgZXhwZWN0ZWQgc3RhdHVzQ29kZS4gSWYgcmVzcG9uc2Uuc3RhdHVzQ29kZSBkb2VzIG5vdCBtYXRjaFxuICAgKiB3ZSBwYXJzZSB0aGUgWE1MIGVycm9yIGFuZCBjYWxsIHRoZSBjYWxsYmFjayB3aXRoIHRoZSBlcnJvciBtZXNzYWdlLlxuICAgKlxuICAgKiBBIHZhbGlkIHJlZ2lvbiBpcyBwYXNzZWQgYnkgdGhlIGNhbGxzIC0gbGlzdEJ1Y2tldHMsIG1ha2VCdWNrZXQgYW5kIGdldEJ1Y2tldFJlZ2lvbi5cbiAgICpcbiAgICogQGludGVybmFsXG4gICAqL1xuICBhc3luYyBtYWtlUmVxdWVzdEFzeW5jKFxuICAgIG9wdGlvbnM6IFJlcXVlc3RPcHRpb24sXG4gICAgcGF5bG9hZDogQmluYXJ5ID0gJycsXG4gICAgZXhwZWN0ZWRDb2RlczogbnVtYmVyW10gPSBbMjAwXSxcbiAgICByZWdpb24gPSAnJyxcbiAgKTogUHJvbWlzZTxodHRwLkluY29taW5nTWVzc2FnZT4ge1xuICAgIGlmICghaXNPYmplY3Qob3B0aW9ucykpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ29wdGlvbnMgc2hvdWxkIGJlIG9mIHR5cGUgXCJvYmplY3RcIicpXG4gICAgfVxuICAgIGlmICghaXNTdHJpbmcocGF5bG9hZCkgJiYgIWlzT2JqZWN0KHBheWxvYWQpKSB7XG4gICAgICAvLyBCdWZmZXIgaXMgb2YgdHlwZSAnb2JqZWN0J1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigncGF5bG9hZCBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmluZ1wiIG9yIFwiQnVmZmVyXCInKVxuICAgIH1cbiAgICBleHBlY3RlZENvZGVzLmZvckVhY2goKHN0YXR1c0NvZGUpID0+IHtcbiAgICAgIGlmICghaXNOdW1iZXIoc3RhdHVzQ29kZSkpIHtcbiAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignc3RhdHVzQ29kZSBzaG91bGQgYmUgb2YgdHlwZSBcIm51bWJlclwiJylcbiAgICAgIH1cbiAgICB9KVxuICAgIGlmICghaXNTdHJpbmcocmVnaW9uKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigncmVnaW9uIHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCInKVxuICAgIH1cbiAgICBpZiAoIW9wdGlvbnMuaGVhZGVycykge1xuICAgICAgb3B0aW9ucy5oZWFkZXJzID0ge31cbiAgICB9XG4gICAgaWYgKG9wdGlvbnMubWV0aG9kID09PSAnUE9TVCcgfHwgb3B0aW9ucy5tZXRob2QgPT09ICdQVVQnIHx8IG9wdGlvbnMubWV0aG9kID09PSAnREVMRVRFJykge1xuICAgICAgb3B0aW9ucy5oZWFkZXJzWydjb250ZW50LWxlbmd0aCddID0gcGF5bG9hZC5sZW5ndGgudG9TdHJpbmcoKVxuICAgIH1cbiAgICBjb25zdCBzaGEyNTZzdW0gPSB0aGlzLmVuYWJsZVNIQTI1NiA/IHRvU2hhMjU2KHBheWxvYWQpIDogJydcbiAgICByZXR1cm4gdGhpcy5tYWtlUmVxdWVzdFN0cmVhbUFzeW5jKG9wdGlvbnMsIHBheWxvYWQsIHNoYTI1NnN1bSwgZXhwZWN0ZWRDb2RlcywgcmVnaW9uKVxuICB9XG5cbiAgLyoqXG4gICAqIG5ldyByZXF1ZXN0IHdpdGggcHJvbWlzZVxuICAgKlxuICAgKiBObyBuZWVkIHRvIGRyYWluIHJlc3BvbnNlLCByZXNwb25zZSBib2R5IGlzIG5vdCB2YWxpZFxuICAgKi9cbiAgYXN5bmMgbWFrZVJlcXVlc3RBc3luY09taXQoXG4gICAgb3B0aW9uczogUmVxdWVzdE9wdGlvbixcbiAgICBwYXlsb2FkOiBCaW5hcnkgPSAnJyxcbiAgICBzdGF0dXNDb2RlczogbnVtYmVyW10gPSBbMjAwXSxcbiAgICByZWdpb24gPSAnJyxcbiAgKTogUHJvbWlzZTxPbWl0PGh0dHAuSW5jb21pbmdNZXNzYWdlLCAnb24nPj4ge1xuICAgIGNvbnN0IHJlcyA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luYyhvcHRpb25zLCBwYXlsb2FkLCBzdGF0dXNDb2RlcywgcmVnaW9uKVxuICAgIGF3YWl0IGRyYWluUmVzcG9uc2UocmVzKVxuICAgIHJldHVybiByZXNcbiAgfVxuXG4gIC8qKlxuICAgKiBtYWtlUmVxdWVzdFN0cmVhbSB3aWxsIGJlIHVzZWQgZGlyZWN0bHkgaW5zdGVhZCBvZiBtYWtlUmVxdWVzdCBpbiBjYXNlIHRoZSBwYXlsb2FkXG4gICAqIGlzIGF2YWlsYWJsZSBhcyBhIHN0cmVhbS4gZm9yIGV4LiBwdXRPYmplY3RcbiAgICpcbiAgICogQGludGVybmFsXG4gICAqL1xuICBhc3luYyBtYWtlUmVxdWVzdFN0cmVhbUFzeW5jKFxuICAgIG9wdGlvbnM6IFJlcXVlc3RPcHRpb24sXG4gICAgYm9keTogc3RyZWFtLlJlYWRhYmxlIHwgQmluYXJ5LFxuICAgIHNoYTI1NnN1bTogc3RyaW5nLFxuICAgIHN0YXR1c0NvZGVzOiBudW1iZXJbXSxcbiAgICByZWdpb246IHN0cmluZyxcbiAgKTogUHJvbWlzZTxodHRwLkluY29taW5nTWVzc2FnZT4ge1xuICAgIGlmICghaXNPYmplY3Qob3B0aW9ucykpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ29wdGlvbnMgc2hvdWxkIGJlIG9mIHR5cGUgXCJvYmplY3RcIicpXG4gICAgfVxuICAgIGlmICghKEJ1ZmZlci5pc0J1ZmZlcihib2R5KSB8fCB0eXBlb2YgYm9keSA9PT0gJ3N0cmluZycgfHwgaXNSZWFkYWJsZVN0cmVhbShib2R5KSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoXG4gICAgICAgIGBzdHJlYW0gc2hvdWxkIGJlIGEgQnVmZmVyLCBzdHJpbmcgb3IgcmVhZGFibGUgU3RyZWFtLCBnb3QgJHt0eXBlb2YgYm9keX0gaW5zdGVhZGAsXG4gICAgICApXG4gICAgfVxuICAgIGlmICghaXNTdHJpbmcoc2hhMjU2c3VtKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignc2hhMjU2c3VtIHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCInKVxuICAgIH1cbiAgICBzdGF0dXNDb2Rlcy5mb3JFYWNoKChzdGF0dXNDb2RlKSA9PiB7XG4gICAgICBpZiAoIWlzTnVtYmVyKHN0YXR1c0NvZGUpKSB7XG4gICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3N0YXR1c0NvZGUgc2hvdWxkIGJlIG9mIHR5cGUgXCJudW1iZXJcIicpXG4gICAgICB9XG4gICAgfSlcbiAgICBpZiAoIWlzU3RyaW5nKHJlZ2lvbikpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3JlZ2lvbiBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmluZ1wiJylcbiAgICB9XG4gICAgLy8gc2hhMjU2c3VtIHdpbGwgYmUgZW1wdHkgZm9yIGFub255bW91cyBvciBodHRwcyByZXF1ZXN0c1xuICAgIGlmICghdGhpcy5lbmFibGVTSEEyNTYgJiYgc2hhMjU2c3VtLmxlbmd0aCAhPT0gMCkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcihgc2hhMjU2c3VtIGV4cGVjdGVkIHRvIGJlIGVtcHR5IGZvciBhbm9ueW1vdXMgb3IgaHR0cHMgcmVxdWVzdHNgKVxuICAgIH1cbiAgICAvLyBzaGEyNTZzdW0gc2hvdWxkIGJlIHZhbGlkIGZvciBub24tYW5vbnltb3VzIGh0dHAgcmVxdWVzdHMuXG4gICAgaWYgKHRoaXMuZW5hYmxlU0hBMjU2ICYmIHNoYTI1NnN1bS5sZW5ndGggIT09IDY0KSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKGBJbnZhbGlkIHNoYTI1NnN1bSA6ICR7c2hhMjU2c3VtfWApXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5jaGVja0FuZFJlZnJlc2hDcmVkcygpXG5cbiAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgQHR5cGVzY3JpcHQtZXNsaW50L25vLW5vbi1udWxsLWFzc2VydGlvblxuICAgIHJlZ2lvbiA9IHJlZ2lvbiB8fCAoYXdhaXQgdGhpcy5nZXRCdWNrZXRSZWdpb25Bc3luYyhvcHRpb25zLmJ1Y2tldE5hbWUhKSlcblxuICAgIGNvbnN0IHJlcU9wdGlvbnMgPSB0aGlzLmdldFJlcXVlc3RPcHRpb25zKHsgLi4ub3B0aW9ucywgcmVnaW9uIH0pXG4gICAgaWYgKCF0aGlzLmFub255bW91cykge1xuICAgICAgLy8gRm9yIG5vbi1hbm9ueW1vdXMgaHR0cHMgcmVxdWVzdHMgc2hhMjU2c3VtIGlzICdVTlNJR05FRC1QQVlMT0FEJyBmb3Igc2lnbmF0dXJlIGNhbGN1bGF0aW9uLlxuICAgICAgaWYgKCF0aGlzLmVuYWJsZVNIQTI1Nikge1xuICAgICAgICBzaGEyNTZzdW0gPSAnVU5TSUdORUQtUEFZTE9BRCdcbiAgICAgIH1cbiAgICAgIGNvbnN0IGRhdGUgPSBuZXcgRGF0ZSgpXG4gICAgICByZXFPcHRpb25zLmhlYWRlcnNbJ3gtYW16LWRhdGUnXSA9IG1ha2VEYXRlTG9uZyhkYXRlKVxuICAgICAgcmVxT3B0aW9ucy5oZWFkZXJzWyd4LWFtei1jb250ZW50LXNoYTI1NiddID0gc2hhMjU2c3VtXG4gICAgICBpZiAodGhpcy5zZXNzaW9uVG9rZW4pIHtcbiAgICAgICAgcmVxT3B0aW9ucy5oZWFkZXJzWyd4LWFtei1zZWN1cml0eS10b2tlbiddID0gdGhpcy5zZXNzaW9uVG9rZW5cbiAgICAgIH1cbiAgICAgIHJlcU9wdGlvbnMuaGVhZGVycy5hdXRob3JpemF0aW9uID0gc2lnblY0KHJlcU9wdGlvbnMsIHRoaXMuYWNjZXNzS2V5LCB0aGlzLnNlY3JldEtleSwgcmVnaW9uLCBkYXRlLCBzaGEyNTZzdW0pXG4gICAgfVxuXG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCByZXF1ZXN0V2l0aFJldHJ5KFxuICAgICAgdGhpcy50cmFuc3BvcnQsXG4gICAgICByZXFPcHRpb25zLFxuICAgICAgYm9keSxcbiAgICAgIHRoaXMucmV0cnlPcHRpb25zLmRpc2FibGVSZXRyeSA9PT0gdHJ1ZSA/IDAgOiB0aGlzLnJldHJ5T3B0aW9ucy5tYXhpbXVtUmV0cnlDb3VudCxcbiAgICAgIHRoaXMucmV0cnlPcHRpb25zLmJhc2VEZWxheU1zLFxuICAgICAgdGhpcy5yZXRyeU9wdGlvbnMubWF4aW11bURlbGF5TXMsXG4gICAgKVxuICAgIGlmICghcmVzcG9uc2Uuc3RhdHVzQ29kZSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQlVHOiByZXNwb25zZSBkb2Vzbid0IGhhdmUgYSBzdGF0dXNDb2RlXCIpXG4gICAgfVxuXG4gICAgaWYgKCFzdGF0dXNDb2Rlcy5pbmNsdWRlcyhyZXNwb25zZS5zdGF0dXNDb2RlKSkge1xuICAgICAgLy8gRm9yIGFuIGluY29ycmVjdCByZWdpb24sIFMzIHNlcnZlciBhbHdheXMgc2VuZHMgYmFjayA0MDAuXG4gICAgICAvLyBCdXQgd2Ugd2lsbCBkbyBjYWNoZSBpbnZhbGlkYXRpb24gZm9yIGFsbCBlcnJvcnMgc28gdGhhdCxcbiAgICAgIC8vIGluIGZ1dHVyZSwgaWYgQVdTIFMzIGRlY2lkZXMgdG8gc2VuZCBhIGRpZmZlcmVudCBzdGF0dXMgY29kZSBvclxuICAgICAgLy8gWE1MIGVycm9yIGNvZGUgd2Ugd2lsbCBzdGlsbCB3b3JrIGZpbmUuXG4gICAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgQHR5cGVzY3JpcHQtZXNsaW50L25vLW5vbi1udWxsLWFzc2VydGlvblxuICAgICAgZGVsZXRlIHRoaXMucmVnaW9uTWFwW29wdGlvbnMuYnVja2V0TmFtZSFdXG5cbiAgICAgIGNvbnN0IGVyciA9IGF3YWl0IHhtbFBhcnNlcnMucGFyc2VSZXNwb25zZUVycm9yKHJlc3BvbnNlKVxuICAgICAgdGhpcy5sb2dIVFRQKHJlcU9wdGlvbnMsIHJlc3BvbnNlLCBlcnIpXG4gICAgICB0aHJvdyBlcnJcbiAgICB9XG5cbiAgICB0aGlzLmxvZ0hUVFAocmVxT3B0aW9ucywgcmVzcG9uc2UpXG5cbiAgICByZXR1cm4gcmVzcG9uc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBnZXRzIHRoZSByZWdpb24gb2YgdGhlIGJ1Y2tldFxuICAgKlxuICAgKiBAcGFyYW0gYnVja2V0TmFtZVxuICAgKlxuICAgKi9cbiAgYXN5bmMgZ2V0QnVja2V0UmVnaW9uQXN5bmMoYnVja2V0TmFtZTogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoYEludmFsaWQgYnVja2V0IG5hbWUgOiAke2J1Y2tldE5hbWV9YClcbiAgICB9XG5cbiAgICAvLyBSZWdpb24gaXMgc2V0IHdpdGggY29uc3RydWN0b3IsIHJldHVybiB0aGUgcmVnaW9uIHJpZ2h0IGhlcmUuXG4gICAgaWYgKHRoaXMucmVnaW9uKSB7XG4gICAgICByZXR1cm4gdGhpcy5yZWdpb25cbiAgICB9XG5cbiAgICBjb25zdCBjYWNoZWQgPSB0aGlzLnJlZ2lvbk1hcFtidWNrZXROYW1lXVxuICAgIGlmIChjYWNoZWQpIHtcbiAgICAgIHJldHVybiBjYWNoZWRcbiAgICB9XG5cbiAgICBjb25zdCBleHRyYWN0UmVnaW9uQXN5bmMgPSBhc3luYyAocmVzcG9uc2U6IGh0dHAuSW5jb21pbmdNZXNzYWdlKSA9PiB7XG4gICAgICBjb25zdCBib2R5ID0gYXdhaXQgcmVhZEFzU3RyaW5nKHJlc3BvbnNlKVxuICAgICAgY29uc3QgcmVnaW9uID0geG1sUGFyc2Vycy5wYXJzZUJ1Y2tldFJlZ2lvbihib2R5KSB8fCBERUZBVUxUX1JFR0lPTlxuICAgICAgdGhpcy5yZWdpb25NYXBbYnVja2V0TmFtZV0gPSByZWdpb25cbiAgICAgIHJldHVybiByZWdpb25cbiAgICB9XG5cbiAgICBjb25zdCBtZXRob2QgPSAnR0VUJ1xuICAgIGNvbnN0IHF1ZXJ5ID0gJ2xvY2F0aW9uJ1xuICAgIC8vIGBnZXRCdWNrZXRMb2NhdGlvbmAgYmVoYXZlcyBkaWZmZXJlbnRseSBpbiBmb2xsb3dpbmcgd2F5cyBmb3JcbiAgICAvLyBkaWZmZXJlbnQgZW52aXJvbm1lbnRzLlxuICAgIC8vXG4gICAgLy8gLSBGb3Igbm9kZWpzIGVudiB3ZSBkZWZhdWx0IHRvIHBhdGggc3R5bGUgcmVxdWVzdHMuXG4gICAgLy8gLSBGb3IgYnJvd3NlciBlbnYgcGF0aCBzdHlsZSByZXF1ZXN0cyBvbiBidWNrZXRzIHlpZWxkcyBDT1JTXG4gICAgLy8gICBlcnJvci4gVG8gY2lyY3VtdmVudCB0aGlzIHByb2JsZW0gd2UgbWFrZSBhIHZpcnR1YWwgaG9zdFxuICAgIC8vICAgc3R5bGUgcmVxdWVzdCBzaWduZWQgd2l0aCAndXMtZWFzdC0xJy4gVGhpcyByZXF1ZXN0IGZhaWxzXG4gICAgLy8gICB3aXRoIGFuIGVycm9yICdBdXRob3JpemF0aW9uSGVhZGVyTWFsZm9ybWVkJywgYWRkaXRpb25hbGx5XG4gICAgLy8gICB0aGUgZXJyb3IgWE1MIGFsc28gcHJvdmlkZXMgUmVnaW9uIG9mIHRoZSBidWNrZXQuIFRvIHZhbGlkYXRlXG4gICAgLy8gICB0aGlzIHJlZ2lvbiBpcyBwcm9wZXIgd2UgcmV0cnkgdGhlIHNhbWUgcmVxdWVzdCB3aXRoIHRoZSBuZXdseVxuICAgIC8vICAgb2J0YWluZWQgcmVnaW9uLlxuICAgIGNvbnN0IHBhdGhTdHlsZSA9IHRoaXMucGF0aFN0eWxlICYmICFpc0Jyb3dzZXJcbiAgICBsZXQgcmVnaW9uOiBzdHJpbmdcbiAgICB0cnkge1xuICAgICAgY29uc3QgcmVzID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jKHsgbWV0aG9kLCBidWNrZXROYW1lLCBxdWVyeSwgcGF0aFN0eWxlIH0sICcnLCBbMjAwXSwgREVGQVVMVF9SRUdJT04pXG4gICAgICByZXR1cm4gZXh0cmFjdFJlZ2lvbkFzeW5jKHJlcylcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICAvLyBtYWtlIGFsaWdubWVudCB3aXRoIG1jIGNsaVxuICAgICAgaWYgKGUgaW5zdGFuY2VvZiBlcnJvcnMuUzNFcnJvcikge1xuICAgICAgICBjb25zdCBlcnJDb2RlID0gZS5jb2RlXG4gICAgICAgIGNvbnN0IGVyclJlZ2lvbiA9IGUucmVnaW9uXG4gICAgICAgIGlmIChlcnJDb2RlID09PSAnQWNjZXNzRGVuaWVkJyAmJiAhZXJyUmVnaW9uKSB7XG4gICAgICAgICAgcmV0dXJuIERFRkFVTFRfUkVHSU9OXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBAdHlwZXNjcmlwdC1lc2xpbnQvYmFuLXRzLWNvbW1lbnRcbiAgICAgIC8vIEB0cy1pZ25vcmVcbiAgICAgIGlmICghKGUubmFtZSA9PT0gJ0F1dGhvcml6YXRpb25IZWFkZXJNYWxmb3JtZWQnKSkge1xuICAgICAgICB0aHJvdyBlXG4gICAgICB9XG4gICAgICAvLyBAdHMtZXhwZWN0LWVycm9yIHdlIHNldCBleHRyYSBwcm9wZXJ0aWVzIG9uIGVycm9yIG9iamVjdFxuICAgICAgcmVnaW9uID0gZS5SZWdpb24gYXMgc3RyaW5nXG4gICAgICBpZiAoIXJlZ2lvbikge1xuICAgICAgICB0aHJvdyBlXG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3QgcmVzID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jKHsgbWV0aG9kLCBidWNrZXROYW1lLCBxdWVyeSwgcGF0aFN0eWxlIH0sICcnLCBbMjAwXSwgcmVnaW9uKVxuICAgIHJldHVybiBhd2FpdCBleHRyYWN0UmVnaW9uQXN5bmMocmVzKVxuICB9XG5cbiAgLyoqXG4gICAqIG1ha2VSZXF1ZXN0IGlzIHRoZSBwcmltaXRpdmUgdXNlZCBieSB0aGUgYXBpcyBmb3IgbWFraW5nIFMzIHJlcXVlc3RzLlxuICAgKiBwYXlsb2FkIGNhbiBiZSBlbXB0eSBzdHJpbmcgaW4gY2FzZSBvZiBubyBwYXlsb2FkLlxuICAgKiBzdGF0dXNDb2RlIGlzIHRoZSBleHBlY3RlZCBzdGF0dXNDb2RlLiBJZiByZXNwb25zZS5zdGF0dXNDb2RlIGRvZXMgbm90IG1hdGNoXG4gICAqIHdlIHBhcnNlIHRoZSBYTUwgZXJyb3IgYW5kIGNhbGwgdGhlIGNhbGxiYWNrIHdpdGggdGhlIGVycm9yIG1lc3NhZ2UuXG4gICAqIEEgdmFsaWQgcmVnaW9uIGlzIHBhc3NlZCBieSB0aGUgY2FsbHMgLSBsaXN0QnVja2V0cywgbWFrZUJ1Y2tldCBhbmRcbiAgICogZ2V0QnVja2V0UmVnaW9uLlxuICAgKlxuICAgKiBAZGVwcmVjYXRlZCB1c2UgYG1ha2VSZXF1ZXN0QXN5bmNgIGluc3RlYWRcbiAgICovXG4gIG1ha2VSZXF1ZXN0KFxuICAgIG9wdGlvbnM6IFJlcXVlc3RPcHRpb24sXG4gICAgcGF5bG9hZDogQmluYXJ5ID0gJycsXG4gICAgZXhwZWN0ZWRDb2RlczogbnVtYmVyW10gPSBbMjAwXSxcbiAgICByZWdpb24gPSAnJyxcbiAgICByZXR1cm5SZXNwb25zZTogYm9vbGVhbixcbiAgICBjYjogKGNiOiB1bmtub3duLCByZXN1bHQ6IGh0dHAuSW5jb21pbmdNZXNzYWdlKSA9PiB2b2lkLFxuICApIHtcbiAgICBsZXQgcHJvbTogUHJvbWlzZTxodHRwLkluY29taW5nTWVzc2FnZT5cbiAgICBpZiAocmV0dXJuUmVzcG9uc2UpIHtcbiAgICAgIHByb20gPSB0aGlzLm1ha2VSZXF1ZXN0QXN5bmMob3B0aW9ucywgcGF5bG9hZCwgZXhwZWN0ZWRDb2RlcywgcmVnaW9uKVxuICAgIH0gZWxzZSB7XG4gICAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgQHR5cGVzY3JpcHQtZXNsaW50L2Jhbi10cy1jb21tZW50XG4gICAgICAvLyBAdHMtZXhwZWN0LWVycm9yIGNvbXBhdGlibGUgZm9yIG9sZCBiZWhhdmlvdXJcbiAgICAgIHByb20gPSB0aGlzLm1ha2VSZXF1ZXN0QXN5bmNPbWl0KG9wdGlvbnMsIHBheWxvYWQsIGV4cGVjdGVkQ29kZXMsIHJlZ2lvbilcbiAgICB9XG5cbiAgICBwcm9tLnRoZW4oXG4gICAgICAocmVzdWx0KSA9PiBjYihudWxsLCByZXN1bHQpLFxuICAgICAgKGVycikgPT4ge1xuICAgICAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgQHR5cGVzY3JpcHQtZXNsaW50L2Jhbi10cy1jb21tZW50XG4gICAgICAgIC8vIEB0cy1pZ25vcmVcbiAgICAgICAgY2IoZXJyKVxuICAgICAgfSxcbiAgICApXG4gIH1cblxuICAvKipcbiAgICogbWFrZVJlcXVlc3RTdHJlYW0gd2lsbCBiZSB1c2VkIGRpcmVjdGx5IGluc3RlYWQgb2YgbWFrZVJlcXVlc3QgaW4gY2FzZSB0aGUgcGF5bG9hZFxuICAgKiBpcyBhdmFpbGFibGUgYXMgYSBzdHJlYW0uIGZvciBleC4gcHV0T2JqZWN0XG4gICAqXG4gICAqIEBkZXByZWNhdGVkIHVzZSBgbWFrZVJlcXVlc3RTdHJlYW1Bc3luY2AgaW5zdGVhZFxuICAgKi9cbiAgbWFrZVJlcXVlc3RTdHJlYW0oXG4gICAgb3B0aW9uczogUmVxdWVzdE9wdGlvbixcbiAgICBzdHJlYW06IHN0cmVhbS5SZWFkYWJsZSB8IEJ1ZmZlcixcbiAgICBzaGEyNTZzdW06IHN0cmluZyxcbiAgICBzdGF0dXNDb2RlczogbnVtYmVyW10sXG4gICAgcmVnaW9uOiBzdHJpbmcsXG4gICAgcmV0dXJuUmVzcG9uc2U6IGJvb2xlYW4sXG4gICAgY2I6IChjYjogdW5rbm93biwgcmVzdWx0OiBodHRwLkluY29taW5nTWVzc2FnZSkgPT4gdm9pZCxcbiAgKSB7XG4gICAgY29uc3QgZXhlY3V0b3IgPSBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCByZXMgPSBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0U3RyZWFtQXN5bmMob3B0aW9ucywgc3RyZWFtLCBzaGEyNTZzdW0sIHN0YXR1c0NvZGVzLCByZWdpb24pXG4gICAgICBpZiAoIXJldHVyblJlc3BvbnNlKSB7XG4gICAgICAgIGF3YWl0IGRyYWluUmVzcG9uc2UocmVzKVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gcmVzXG4gICAgfVxuXG4gICAgZXhlY3V0b3IoKS50aGVuKFxuICAgICAgKHJlc3VsdCkgPT4gY2IobnVsbCwgcmVzdWx0KSxcbiAgICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBAdHlwZXNjcmlwdC1lc2xpbnQvYmFuLXRzLWNvbW1lbnRcbiAgICAgIC8vIEB0cy1pZ25vcmVcbiAgICAgIChlcnIpID0+IGNiKGVyciksXG4gICAgKVxuICB9XG5cbiAgLyoqXG4gICAqIEBkZXByZWNhdGVkIHVzZSBgZ2V0QnVja2V0UmVnaW9uQXN5bmNgIGluc3RlYWRcbiAgICovXG4gIGdldEJ1Y2tldFJlZ2lvbihidWNrZXROYW1lOiBzdHJpbmcsIGNiOiAoZXJyOiB1bmtub3duLCByZWdpb246IHN0cmluZykgPT4gdm9pZCkge1xuICAgIHJldHVybiB0aGlzLmdldEJ1Y2tldFJlZ2lvbkFzeW5jKGJ1Y2tldE5hbWUpLnRoZW4oXG4gICAgICAocmVzdWx0KSA9PiBjYihudWxsLCByZXN1bHQpLFxuICAgICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIEB0eXBlc2NyaXB0LWVzbGludC9iYW4tdHMtY29tbWVudFxuICAgICAgLy8gQHRzLWlnbm9yZVxuICAgICAgKGVycikgPT4gY2IoZXJyKSxcbiAgICApXG4gIH1cblxuICAvLyBCdWNrZXQgb3BlcmF0aW9uc1xuXG4gIC8qKlxuICAgKiBDcmVhdGVzIHRoZSBidWNrZXQgYGJ1Y2tldE5hbWVgLlxuICAgKlxuICAgKi9cbiAgYXN5bmMgbWFrZUJ1Y2tldChidWNrZXROYW1lOiBzdHJpbmcsIHJlZ2lvbjogUmVnaW9uID0gJycsIG1ha2VPcHRzPzogTWFrZUJ1Y2tldE9wdCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIC8vIEJhY2t3YXJkIENvbXBhdGliaWxpdHlcbiAgICBpZiAoaXNPYmplY3QocmVnaW9uKSkge1xuICAgICAgbWFrZU9wdHMgPSByZWdpb25cbiAgICAgIHJlZ2lvbiA9ICcnXG4gICAgfVxuXG4gICAgaWYgKCFpc1N0cmluZyhyZWdpb24pKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdyZWdpb24gc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXG4gICAgfVxuICAgIGlmIChtYWtlT3B0cyAmJiAhaXNPYmplY3QobWFrZU9wdHMpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdtYWtlT3B0cyBzaG91bGQgYmUgb2YgdHlwZSBcIm9iamVjdFwiJylcbiAgICB9XG5cbiAgICBsZXQgcGF5bG9hZCA9ICcnXG5cbiAgICAvLyBSZWdpb24gYWxyZWFkeSBzZXQgaW4gY29uc3RydWN0b3IsIHZhbGlkYXRlIGlmXG4gICAgLy8gY2FsbGVyIHJlcXVlc3RlZCBidWNrZXQgbG9jYXRpb24gaXMgc2FtZS5cbiAgICBpZiAocmVnaW9uICYmIHRoaXMucmVnaW9uKSB7XG4gICAgICBpZiAocmVnaW9uICE9PSB0aGlzLnJlZ2lvbikge1xuICAgICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKGBDb25maWd1cmVkIHJlZ2lvbiAke3RoaXMucmVnaW9ufSwgcmVxdWVzdGVkICR7cmVnaW9ufWApXG4gICAgICB9XG4gICAgfVxuICAgIC8vIHNlbmRpbmcgbWFrZUJ1Y2tldCByZXF1ZXN0IHdpdGggWE1MIGNvbnRhaW5pbmcgJ3VzLWVhc3QtMScgZmFpbHMuIEZvclxuICAgIC8vIGRlZmF1bHQgcmVnaW9uIHNlcnZlciBleHBlY3RzIHRoZSByZXF1ZXN0IHdpdGhvdXQgYm9keVxuICAgIGlmIChyZWdpb24gJiYgcmVnaW9uICE9PSBERUZBVUxUX1JFR0lPTikge1xuICAgICAgcGF5bG9hZCA9IHhtbC5idWlsZE9iamVjdCh7XG4gICAgICAgIENyZWF0ZUJ1Y2tldENvbmZpZ3VyYXRpb246IHtcbiAgICAgICAgICAkOiB7IHhtbG5zOiAnaHR0cDovL3MzLmFtYXpvbmF3cy5jb20vZG9jLzIwMDYtMDMtMDEvJyB9LFxuICAgICAgICAgIExvY2F0aW9uQ29uc3RyYWludDogcmVnaW9uLFxuICAgICAgICB9LFxuICAgICAgfSlcbiAgICB9XG4gICAgY29uc3QgbWV0aG9kID0gJ1BVVCdcbiAgICBjb25zdCBoZWFkZXJzOiBSZXF1ZXN0SGVhZGVycyA9IHt9XG5cbiAgICBpZiAobWFrZU9wdHMgJiYgbWFrZU9wdHMuT2JqZWN0TG9ja2luZykge1xuICAgICAgaGVhZGVyc1sneC1hbXotYnVja2V0LW9iamVjdC1sb2NrLWVuYWJsZWQnXSA9IHRydWVcbiAgICB9XG5cbiAgICAvLyBGb3IgY3VzdG9tIHJlZ2lvbiBjbGllbnRzICBkZWZhdWx0IHRvIGN1c3RvbSByZWdpb24gc3BlY2lmaWVkIGluIGNsaWVudCBjb25zdHJ1Y3RvclxuICAgIGNvbnN0IGZpbmFsUmVnaW9uID0gdGhpcy5yZWdpb24gfHwgcmVnaW9uIHx8IERFRkFVTFRfUkVHSU9OXG5cbiAgICBjb25zdCByZXF1ZXN0T3B0OiBSZXF1ZXN0T3B0aW9uID0geyBtZXRob2QsIGJ1Y2tldE5hbWUsIGhlYWRlcnMgfVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luY09taXQocmVxdWVzdE9wdCwgcGF5bG9hZCwgWzIwMF0sIGZpbmFsUmVnaW9uKVxuICAgIH0gY2F0Y2ggKGVycjogdW5rbm93bikge1xuICAgICAgaWYgKHJlZ2lvbiA9PT0gJycgfHwgcmVnaW9uID09PSBERUZBVUxUX1JFR0lPTikge1xuICAgICAgICBpZiAoZXJyIGluc3RhbmNlb2YgZXJyb3JzLlMzRXJyb3IpIHtcbiAgICAgICAgICBjb25zdCBlcnJDb2RlID0gZXJyLmNvZGVcbiAgICAgICAgICBjb25zdCBlcnJSZWdpb24gPSBlcnIucmVnaW9uXG4gICAgICAgICAgaWYgKGVyckNvZGUgPT09ICdBdXRob3JpemF0aW9uSGVhZGVyTWFsZm9ybWVkJyAmJiBlcnJSZWdpb24gIT09ICcnKSB7XG4gICAgICAgICAgICAvLyBSZXRyeSB3aXRoIHJlZ2lvbiByZXR1cm5lZCBhcyBwYXJ0IG9mIGVycm9yXG4gICAgICAgICAgICBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmNPbWl0KHJlcXVlc3RPcHQsIHBheWxvYWQsIFsyMDBdLCBlcnJDb2RlKVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgdGhyb3cgZXJyXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFRvIGNoZWNrIGlmIGEgYnVja2V0IGFscmVhZHkgZXhpc3RzLlxuICAgKi9cbiAgYXN5bmMgYnVja2V0RXhpc3RzKGJ1Y2tldE5hbWU6IHN0cmluZyk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGNvbnN0IG1ldGhvZCA9ICdIRUFEJ1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmNPbWl0KHsgbWV0aG9kLCBidWNrZXROYW1lIH0pXG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAvLyBAdHMtaWdub3JlXG4gICAgICBpZiAoZXJyLmNvZGUgPT09ICdOb1N1Y2hCdWNrZXQnIHx8IGVyci5jb2RlID09PSAnTm90Rm91bmQnKSB7XG4gICAgICAgIHJldHVybiBmYWxzZVxuICAgICAgfVxuICAgICAgdGhyb3cgZXJyXG4gICAgfVxuXG4gICAgcmV0dXJuIHRydWVcbiAgfVxuXG4gIGFzeW5jIHJlbW92ZUJ1Y2tldChidWNrZXROYW1lOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+XG5cbiAgLyoqXG4gICAqIEBkZXByZWNhdGVkIHVzZSBwcm9taXNlIHN0eWxlIEFQSVxuICAgKi9cbiAgcmVtb3ZlQnVja2V0KGJ1Y2tldE5hbWU6IHN0cmluZywgY2FsbGJhY2s6IE5vUmVzdWx0Q2FsbGJhY2spOiB2b2lkXG5cbiAgYXN5bmMgcmVtb3ZlQnVja2V0KGJ1Y2tldE5hbWU6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGNvbnN0IG1ldGhvZCA9ICdERUxFVEUnXG4gICAgYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jT21pdCh7IG1ldGhvZCwgYnVja2V0TmFtZSB9LCAnJywgWzIwNF0pXG4gICAgZGVsZXRlIHRoaXMucmVnaW9uTWFwW2J1Y2tldE5hbWVdXG4gIH1cblxuICAvKipcbiAgICogQ2FsbGJhY2sgaXMgY2FsbGVkIHdpdGggcmVhZGFibGUgc3RyZWFtIG9mIHRoZSBvYmplY3QgY29udGVudC5cbiAgICovXG4gIGFzeW5jIGdldE9iamVjdChidWNrZXROYW1lOiBzdHJpbmcsIG9iamVjdE5hbWU6IHN0cmluZywgZ2V0T3B0cz86IEdldE9iamVjdE9wdHMpOiBQcm9taXNlPHN0cmVhbS5SZWFkYWJsZT4ge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmICghaXNWYWxpZE9iamVjdE5hbWUob2JqZWN0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZE9iamVjdE5hbWVFcnJvcihgSW52YWxpZCBvYmplY3QgbmFtZTogJHtvYmplY3ROYW1lfWApXG4gICAgfVxuICAgIHJldHVybiB0aGlzLmdldFBhcnRpYWxPYmplY3QoYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgMCwgMCwgZ2V0T3B0cylcbiAgfVxuXG4gIC8qKlxuICAgKiBDYWxsYmFjayBpcyBjYWxsZWQgd2l0aCByZWFkYWJsZSBzdHJlYW0gb2YgdGhlIHBhcnRpYWwgb2JqZWN0IGNvbnRlbnQuXG4gICAqIEBwYXJhbSBidWNrZXROYW1lXG4gICAqIEBwYXJhbSBvYmplY3ROYW1lXG4gICAqIEBwYXJhbSBvZmZzZXRcbiAgICogQHBhcmFtIGxlbmd0aCAtIGxlbmd0aCBvZiB0aGUgb2JqZWN0IHRoYXQgd2lsbCBiZSByZWFkIGluIHRoZSBzdHJlYW0gKG9wdGlvbmFsLCBpZiBub3Qgc3BlY2lmaWVkIHdlIHJlYWQgdGhlIHJlc3Qgb2YgdGhlIGZpbGUgZnJvbSB0aGUgb2Zmc2V0KVxuICAgKiBAcGFyYW0gZ2V0T3B0c1xuICAgKi9cbiAgYXN5bmMgZ2V0UGFydGlhbE9iamVjdChcbiAgICBidWNrZXROYW1lOiBzdHJpbmcsXG4gICAgb2JqZWN0TmFtZTogc3RyaW5nLFxuICAgIG9mZnNldDogbnVtYmVyLFxuICAgIGxlbmd0aCA9IDAsXG4gICAgZ2V0T3B0cz86IEdldE9iamVjdE9wdHMsXG4gICk6IFByb21pc2U8c3RyZWFtLlJlYWRhYmxlPiB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkT2JqZWN0TmFtZUVycm9yKGBJbnZhbGlkIG9iamVjdCBuYW1lOiAke29iamVjdE5hbWV9YClcbiAgICB9XG4gICAgaWYgKCFpc051bWJlcihvZmZzZXQpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdvZmZzZXQgc2hvdWxkIGJlIG9mIHR5cGUgXCJudW1iZXJcIicpXG4gICAgfVxuICAgIGlmICghaXNOdW1iZXIobGVuZ3RoKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignbGVuZ3RoIHNob3VsZCBiZSBvZiB0eXBlIFwibnVtYmVyXCInKVxuICAgIH1cblxuICAgIGxldCByYW5nZSA9ICcnXG4gICAgaWYgKG9mZnNldCB8fCBsZW5ndGgpIHtcbiAgICAgIGlmIChvZmZzZXQpIHtcbiAgICAgICAgcmFuZ2UgPSBgYnl0ZXM9JHsrb2Zmc2V0fS1gXG4gICAgICB9IGVsc2Uge1xuICAgICAgICByYW5nZSA9ICdieXRlcz0wLSdcbiAgICAgICAgb2Zmc2V0ID0gMFxuICAgICAgfVxuICAgICAgaWYgKGxlbmd0aCkge1xuICAgICAgICByYW5nZSArPSBgJHsrbGVuZ3RoICsgb2Zmc2V0IC0gMX1gXG4gICAgICB9XG4gICAgfVxuXG4gICAgbGV0IHF1ZXJ5ID0gJydcbiAgICBsZXQgaGVhZGVyczogUmVxdWVzdEhlYWRlcnMgPSB7XG4gICAgICAuLi4ocmFuZ2UgIT09ICcnICYmIHsgcmFuZ2UgfSksXG4gICAgfVxuXG4gICAgaWYgKGdldE9wdHMpIHtcbiAgICAgIGNvbnN0IHNzZUhlYWRlcnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7XG4gICAgICAgIC4uLihnZXRPcHRzLlNTRUN1c3RvbWVyQWxnb3JpdGhtICYmIHtcbiAgICAgICAgICAnWC1BbXotU2VydmVyLVNpZGUtRW5jcnlwdGlvbi1DdXN0b21lci1BbGdvcml0aG0nOiBnZXRPcHRzLlNTRUN1c3RvbWVyQWxnb3JpdGhtLFxuICAgICAgICB9KSxcbiAgICAgICAgLi4uKGdldE9wdHMuU1NFQ3VzdG9tZXJLZXkgJiYgeyAnWC1BbXotU2VydmVyLVNpZGUtRW5jcnlwdGlvbi1DdXN0b21lci1LZXknOiBnZXRPcHRzLlNTRUN1c3RvbWVyS2V5IH0pLFxuICAgICAgICAuLi4oZ2V0T3B0cy5TU0VDdXN0b21lcktleU1ENSAmJiB7XG4gICAgICAgICAgJ1gtQW16LVNlcnZlci1TaWRlLUVuY3J5cHRpb24tQ3VzdG9tZXItS2V5LU1ENSc6IGdldE9wdHMuU1NFQ3VzdG9tZXJLZXlNRDUsXG4gICAgICAgIH0pLFxuICAgICAgfVxuICAgICAgcXVlcnkgPSBxcy5zdHJpbmdpZnkoZ2V0T3B0cylcbiAgICAgIGhlYWRlcnMgPSB7XG4gICAgICAgIC4uLnByZXBlbmRYQU1aTWV0YShzc2VIZWFkZXJzKSxcbiAgICAgICAgLi4uaGVhZGVycyxcbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCBleHBlY3RlZFN0YXR1c0NvZGVzID0gWzIwMF1cbiAgICBpZiAocmFuZ2UpIHtcbiAgICAgIGV4cGVjdGVkU3RhdHVzQ29kZXMucHVzaCgyMDYpXG4gICAgfVxuICAgIGNvbnN0IG1ldGhvZCA9ICdHRVQnXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jKHsgbWV0aG9kLCBidWNrZXROYW1lLCBvYmplY3ROYW1lLCBoZWFkZXJzLCBxdWVyeSB9LCAnJywgZXhwZWN0ZWRTdGF0dXNDb2RlcylcbiAgfVxuXG4gIC8qKlxuICAgKiBkb3dubG9hZCBvYmplY3QgY29udGVudCB0byBhIGZpbGUuXG4gICAqIFRoaXMgbWV0aG9kIHdpbGwgY3JlYXRlIGEgdGVtcCBmaWxlIG5hbWVkIGAke2ZpbGVuYW1lfS4ke2Jhc2U2NChldGFnKX0ucGFydC5taW5pb2Agd2hlbiBkb3dubG9hZGluZy5cbiAgICpcbiAgICogQHBhcmFtIGJ1Y2tldE5hbWUgLSBuYW1lIG9mIHRoZSBidWNrZXRcbiAgICogQHBhcmFtIG9iamVjdE5hbWUgLSBuYW1lIG9mIHRoZSBvYmplY3RcbiAgICogQHBhcmFtIGZpbGVQYXRoIC0gcGF0aCB0byB3aGljaCB0aGUgb2JqZWN0IGRhdGEgd2lsbCBiZSB3cml0dGVuIHRvXG4gICAqIEBwYXJhbSBnZXRPcHRzIC0gT3B0aW9uYWwgb2JqZWN0IGdldCBvcHRpb25cbiAgICovXG4gIGFzeW5jIGZHZXRPYmplY3QoYnVja2V0TmFtZTogc3RyaW5nLCBvYmplY3ROYW1lOiBzdHJpbmcsIGZpbGVQYXRoOiBzdHJpbmcsIGdldE9wdHM/OiBHZXRPYmplY3RPcHRzKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgLy8gSW5wdXQgdmFsaWRhdGlvbi5cbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRPYmplY3ROYW1lRXJyb3IoYEludmFsaWQgb2JqZWN0IG5hbWU6ICR7b2JqZWN0TmFtZX1gKVxuICAgIH1cbiAgICBpZiAoIWlzU3RyaW5nKGZpbGVQYXRoKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignZmlsZVBhdGggc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXG4gICAgfVxuXG4gICAgY29uc3QgZG93bmxvYWRUb1RtcEZpbGUgPSBhc3luYyAoKTogUHJvbWlzZTxzdHJpbmc+ID0+IHtcbiAgICAgIGxldCBwYXJ0RmlsZVN0cmVhbTogc3RyZWFtLldyaXRhYmxlXG4gICAgICBjb25zdCBvYmpTdGF0ID0gYXdhaXQgdGhpcy5zdGF0T2JqZWN0KGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIGdldE9wdHMpXG4gICAgICBjb25zdCBlbmNvZGVkRXRhZyA9IEJ1ZmZlci5mcm9tKG9ialN0YXQuZXRhZykudG9TdHJpbmcoJ2Jhc2U2NCcpXG4gICAgICBjb25zdCBwYXJ0RmlsZSA9IGAke2ZpbGVQYXRofS4ke2VuY29kZWRFdGFnfS5wYXJ0Lm1pbmlvYFxuXG4gICAgICBhd2FpdCBmc3AubWtkaXIocGF0aC5kaXJuYW1lKGZpbGVQYXRoKSwgeyByZWN1cnNpdmU6IHRydWUgfSlcblxuICAgICAgbGV0IG9mZnNldCA9IDBcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHN0YXRzID0gYXdhaXQgZnNwLnN0YXQocGFydEZpbGUpXG4gICAgICAgIGlmIChvYmpTdGF0LnNpemUgPT09IHN0YXRzLnNpemUpIHtcbiAgICAgICAgICByZXR1cm4gcGFydEZpbGVcbiAgICAgICAgfVxuICAgICAgICBvZmZzZXQgPSBzdGF0cy5zaXplXG4gICAgICAgIHBhcnRGaWxlU3RyZWFtID0gZnMuY3JlYXRlV3JpdGVTdHJlYW0ocGFydEZpbGUsIHsgZmxhZ3M6ICdhJyB9KVxuICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICBpZiAoZSBpbnN0YW5jZW9mIEVycm9yICYmIChlIGFzIHVua25vd24gYXMgeyBjb2RlOiBzdHJpbmcgfSkuY29kZSA9PT0gJ0VOT0VOVCcpIHtcbiAgICAgICAgICAvLyBmaWxlIG5vdCBleGlzdFxuICAgICAgICAgIHBhcnRGaWxlU3RyZWFtID0gZnMuY3JlYXRlV3JpdGVTdHJlYW0ocGFydEZpbGUsIHsgZmxhZ3M6ICd3JyB9KVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIC8vIG90aGVyIGVycm9yLCBtYXliZSBhY2Nlc3MgZGVueVxuICAgICAgICAgIHRocm93IGVcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBjb25zdCBkb3dubG9hZFN0cmVhbSA9IGF3YWl0IHRoaXMuZ2V0UGFydGlhbE9iamVjdChidWNrZXROYW1lLCBvYmplY3ROYW1lLCBvZmZzZXQsIDAsIGdldE9wdHMpXG5cbiAgICAgIGF3YWl0IHN0cmVhbVByb21pc2UucGlwZWxpbmUoZG93bmxvYWRTdHJlYW0sIHBhcnRGaWxlU3RyZWFtKVxuICAgICAgY29uc3Qgc3RhdHMgPSBhd2FpdCBmc3Auc3RhdChwYXJ0RmlsZSlcbiAgICAgIGlmIChzdGF0cy5zaXplID09PSBvYmpTdGF0LnNpemUpIHtcbiAgICAgICAgcmV0dXJuIHBhcnRGaWxlXG4gICAgICB9XG5cbiAgICAgIHRocm93IG5ldyBFcnJvcignU2l6ZSBtaXNtYXRjaCBiZXR3ZWVuIGRvd25sb2FkZWQgZmlsZSBhbmQgdGhlIG9iamVjdCcpXG4gICAgfVxuXG4gICAgY29uc3QgcGFydEZpbGUgPSBhd2FpdCBkb3dubG9hZFRvVG1wRmlsZSgpXG4gICAgYXdhaXQgZnNwLnJlbmFtZShwYXJ0RmlsZSwgZmlsZVBhdGgpXG4gIH1cblxuICAvKipcbiAgICogU3RhdCBpbmZvcm1hdGlvbiBvZiB0aGUgb2JqZWN0LlxuICAgKi9cbiAgYXN5bmMgc3RhdE9iamVjdChidWNrZXROYW1lOiBzdHJpbmcsIG9iamVjdE5hbWU6IHN0cmluZywgc3RhdE9wdHM/OiBTdGF0T2JqZWN0T3B0cyk6IFByb21pc2U8QnVja2V0SXRlbVN0YXQ+IHtcbiAgICBjb25zdCBzdGF0T3B0RGVmID0gc3RhdE9wdHMgfHwge31cbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRPYmplY3ROYW1lRXJyb3IoYEludmFsaWQgb2JqZWN0IG5hbWU6ICR7b2JqZWN0TmFtZX1gKVxuICAgIH1cblxuICAgIGlmICghaXNPYmplY3Qoc3RhdE9wdERlZikpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ3N0YXRPcHRzIHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxuICAgIH1cblxuICAgIGNvbnN0IHF1ZXJ5ID0gcXMuc3RyaW5naWZ5KHN0YXRPcHREZWYpXG4gICAgY29uc3QgbWV0aG9kID0gJ0hFQUQnXG4gICAgY29uc3QgcmVzID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jT21pdCh7IG1ldGhvZCwgYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgcXVlcnkgfSlcblxuICAgIHJldHVybiB7XG4gICAgICBzaXplOiBwYXJzZUludChyZXMuaGVhZGVyc1snY29udGVudC1sZW5ndGgnXSBhcyBzdHJpbmcpLFxuICAgICAgbWV0YURhdGE6IGV4dHJhY3RNZXRhZGF0YShyZXMuaGVhZGVycyBhcyBSZXNwb25zZUhlYWRlciksXG4gICAgICBsYXN0TW9kaWZpZWQ6IG5ldyBEYXRlKHJlcy5oZWFkZXJzWydsYXN0LW1vZGlmaWVkJ10gYXMgc3RyaW5nKSxcbiAgICAgIHZlcnNpb25JZDogZ2V0VmVyc2lvbklkKHJlcy5oZWFkZXJzIGFzIFJlc3BvbnNlSGVhZGVyKSxcbiAgICAgIGV0YWc6IHNhbml0aXplRVRhZyhyZXMuaGVhZGVycy5ldGFnKSxcbiAgICB9XG4gIH1cblxuICBhc3luYyByZW1vdmVPYmplY3QoYnVja2V0TmFtZTogc3RyaW5nLCBvYmplY3ROYW1lOiBzdHJpbmcsIHJlbW92ZU9wdHM/OiBSZW1vdmVPcHRpb25zKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKGBJbnZhbGlkIGJ1Y2tldCBuYW1lOiAke2J1Y2tldE5hbWV9YClcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkT2JqZWN0TmFtZUVycm9yKGBJbnZhbGlkIG9iamVjdCBuYW1lOiAke29iamVjdE5hbWV9YClcbiAgICB9XG5cbiAgICBpZiAocmVtb3ZlT3B0cyAmJiAhaXNPYmplY3QocmVtb3ZlT3B0cykpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ3JlbW92ZU9wdHMgc2hvdWxkIGJlIG9mIHR5cGUgXCJvYmplY3RcIicpXG4gICAgfVxuXG4gICAgY29uc3QgbWV0aG9kID0gJ0RFTEVURSdcblxuICAgIGNvbnN0IGhlYWRlcnM6IFJlcXVlc3RIZWFkZXJzID0ge31cbiAgICBpZiAocmVtb3ZlT3B0cz8uZ292ZXJuYW5jZUJ5cGFzcykge1xuICAgICAgaGVhZGVyc1snWC1BbXotQnlwYXNzLUdvdmVybmFuY2UtUmV0ZW50aW9uJ10gPSB0cnVlXG4gICAgfVxuICAgIGlmIChyZW1vdmVPcHRzPy5mb3JjZURlbGV0ZSkge1xuICAgICAgaGVhZGVyc1sneC1taW5pby1mb3JjZS1kZWxldGUnXSA9IHRydWVcbiAgICB9XG5cbiAgICBjb25zdCBxdWVyeVBhcmFtczogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHt9XG4gICAgaWYgKHJlbW92ZU9wdHM/LnZlcnNpb25JZCkge1xuICAgICAgcXVlcnlQYXJhbXMudmVyc2lvbklkID0gYCR7cmVtb3ZlT3B0cy52ZXJzaW9uSWR9YFxuICAgIH1cbiAgICBjb25zdCBxdWVyeSA9IHFzLnN0cmluZ2lmeShxdWVyeVBhcmFtcylcblxuICAgIGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luY09taXQoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIGhlYWRlcnMsIHF1ZXJ5IH0sICcnLCBbMjAwLCAyMDRdKVxuICB9XG5cbiAgLy8gQ2FsbHMgaW1wbGVtZW50ZWQgYmVsb3cgYXJlIHJlbGF0ZWQgdG8gbXVsdGlwYXJ0LlxuXG4gIGxpc3RJbmNvbXBsZXRlVXBsb2FkcyhcbiAgICBidWNrZXQ6IHN0cmluZyxcbiAgICBwcmVmaXg6IHN0cmluZyxcbiAgICByZWN1cnNpdmU6IGJvb2xlYW4sXG4gICk6IEJ1Y2tldFN0cmVhbTxJbmNvbXBsZXRlVXBsb2FkZWRCdWNrZXRJdGVtPiB7XG4gICAgaWYgKHByZWZpeCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICBwcmVmaXggPSAnJ1xuICAgIH1cbiAgICBpZiAocmVjdXJzaXZlID09PSB1bmRlZmluZWQpIHtcbiAgICAgIHJlY3Vyc2l2ZSA9IGZhbHNlXG4gICAgfVxuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0KSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0KVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRQcmVmaXgocHJlZml4KSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkUHJlZml4RXJyb3IoYEludmFsaWQgcHJlZml4IDogJHtwcmVmaXh9YClcbiAgICB9XG4gICAgaWYgKCFpc0Jvb2xlYW4ocmVjdXJzaXZlKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigncmVjdXJzaXZlIHNob3VsZCBiZSBvZiB0eXBlIFwiYm9vbGVhblwiJylcbiAgICB9XG4gICAgY29uc3QgZGVsaW1pdGVyID0gcmVjdXJzaXZlID8gJycgOiAnLydcbiAgICBsZXQga2V5TWFya2VyID0gJydcbiAgICBsZXQgdXBsb2FkSWRNYXJrZXIgPSAnJ1xuICAgIGNvbnN0IHVwbG9hZHM6IHVua25vd25bXSA9IFtdXG4gICAgbGV0IGVuZGVkID0gZmFsc2VcblxuICAgIC8vIFRPRE86IHJlZmFjdG9yIHRoaXMgd2l0aCBhc3luYy9hd2FpdCBhbmQgYHN0cmVhbS5SZWFkYWJsZS5mcm9tYFxuICAgIGNvbnN0IHJlYWRTdHJlYW0gPSBuZXcgc3RyZWFtLlJlYWRhYmxlKHsgb2JqZWN0TW9kZTogdHJ1ZSB9KVxuICAgIHJlYWRTdHJlYW0uX3JlYWQgPSAoKSA9PiB7XG4gICAgICAvLyBwdXNoIG9uZSB1cGxvYWQgaW5mbyBwZXIgX3JlYWQoKVxuICAgICAgaWYgKHVwbG9hZHMubGVuZ3RoKSB7XG4gICAgICAgIHJldHVybiByZWFkU3RyZWFtLnB1c2godXBsb2Fkcy5zaGlmdCgpKVxuICAgICAgfVxuICAgICAgaWYgKGVuZGVkKSB7XG4gICAgICAgIHJldHVybiByZWFkU3RyZWFtLnB1c2gobnVsbClcbiAgICAgIH1cbiAgICAgIHRoaXMubGlzdEluY29tcGxldGVVcGxvYWRzUXVlcnkoYnVja2V0LCBwcmVmaXgsIGtleU1hcmtlciwgdXBsb2FkSWRNYXJrZXIsIGRlbGltaXRlcikudGhlbihcbiAgICAgICAgKHJlc3VsdCkgPT4ge1xuICAgICAgICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBAdHlwZXNjcmlwdC1lc2xpbnQvYmFuLXRzLWNvbW1lbnRcbiAgICAgICAgICAvLyBAdHMtaWdub3JlXG4gICAgICAgICAgcmVzdWx0LnByZWZpeGVzLmZvckVhY2goKHByZWZpeCkgPT4gdXBsb2Fkcy5wdXNoKHByZWZpeCkpXG4gICAgICAgICAgYXN5bmMuZWFjaFNlcmllcyhcbiAgICAgICAgICAgIHJlc3VsdC51cGxvYWRzLFxuICAgICAgICAgICAgKHVwbG9hZCwgY2IpID0+IHtcbiAgICAgICAgICAgICAgLy8gZm9yIGVhY2ggaW5jb21wbGV0ZSB1cGxvYWQgYWRkIHRoZSBzaXplcyBvZiBpdHMgdXBsb2FkZWQgcGFydHNcbiAgICAgICAgICAgICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIEB0eXBlc2NyaXB0LWVzbGludC9iYW4tdHMtY29tbWVudFxuICAgICAgICAgICAgICAvLyBAdHMtaWdub3JlXG4gICAgICAgICAgICAgIHRoaXMubGlzdFBhcnRzKGJ1Y2tldCwgdXBsb2FkLmtleSwgdXBsb2FkLnVwbG9hZElkKS50aGVuKFxuICAgICAgICAgICAgICAgIChwYXJ0czogUGFydFtdKSA9PiB7XG4gICAgICAgICAgICAgICAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgQHR5cGVzY3JpcHQtZXNsaW50L2Jhbi10cy1jb21tZW50XG4gICAgICAgICAgICAgICAgICAvLyBAdHMtaWdub3JlXG4gICAgICAgICAgICAgICAgICB1cGxvYWQuc2l6ZSA9IHBhcnRzLnJlZHVjZSgoYWNjLCBpdGVtKSA9PiBhY2MgKyBpdGVtLnNpemUsIDApXG4gICAgICAgICAgICAgICAgICB1cGxvYWRzLnB1c2godXBsb2FkKVxuICAgICAgICAgICAgICAgICAgY2IoKVxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgKGVycjogRXJyb3IpID0+IGNiKGVyciksXG4gICAgICAgICAgICAgIClcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAoZXJyKSA9PiB7XG4gICAgICAgICAgICAgIGlmIChlcnIpIHtcbiAgICAgICAgICAgICAgICByZWFkU3RyZWFtLmVtaXQoJ2Vycm9yJywgZXJyKVxuICAgICAgICAgICAgICAgIHJldHVyblxuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIGlmIChyZXN1bHQuaXNUcnVuY2F0ZWQpIHtcbiAgICAgICAgICAgICAgICBrZXlNYXJrZXIgPSByZXN1bHQubmV4dEtleU1hcmtlclxuICAgICAgICAgICAgICAgIHVwbG9hZElkTWFya2VyID0gcmVzdWx0Lm5leHRVcGxvYWRJZE1hcmtlclxuICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIGVuZGVkID0gdHJ1ZVxuICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIEB0eXBlc2NyaXB0LWVzbGludC9iYW4tdHMtY29tbWVudFxuICAgICAgICAgICAgICAvLyBAdHMtaWdub3JlXG4gICAgICAgICAgICAgIHJlYWRTdHJlYW0uX3JlYWQoKVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICApXG4gICAgICAgIH0sXG4gICAgICAgIChlKSA9PiB7XG4gICAgICAgICAgcmVhZFN0cmVhbS5lbWl0KCdlcnJvcicsIGUpXG4gICAgICAgIH0sXG4gICAgICApXG4gICAgfVxuICAgIHJldHVybiByZWFkU3RyZWFtXG4gIH1cblxuICAvKipcbiAgICogQ2FsbGVkIGJ5IGxpc3RJbmNvbXBsZXRlVXBsb2FkcyB0byBmZXRjaCBhIGJhdGNoIG9mIGluY29tcGxldGUgdXBsb2Fkcy5cbiAgICovXG4gIGFzeW5jIGxpc3RJbmNvbXBsZXRlVXBsb2Fkc1F1ZXJ5KFxuICAgIGJ1Y2tldE5hbWU6IHN0cmluZyxcbiAgICBwcmVmaXg6IHN0cmluZyxcbiAgICBrZXlNYXJrZXI6IHN0cmluZyxcbiAgICB1cGxvYWRJZE1hcmtlcjogc3RyaW5nLFxuICAgIGRlbGltaXRlcjogc3RyaW5nLFxuICApOiBQcm9taXNlPExpc3RNdWx0aXBhcnRSZXN1bHQ+IHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzU3RyaW5nKHByZWZpeCkpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3ByZWZpeCBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmluZ1wiJylcbiAgICB9XG4gICAgaWYgKCFpc1N0cmluZyhrZXlNYXJrZXIpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdrZXlNYXJrZXIgc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXG4gICAgfVxuICAgIGlmICghaXNTdHJpbmcodXBsb2FkSWRNYXJrZXIpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCd1cGxvYWRJZE1hcmtlciBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmluZ1wiJylcbiAgICB9XG4gICAgaWYgKCFpc1N0cmluZyhkZWxpbWl0ZXIpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdkZWxpbWl0ZXIgc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXG4gICAgfVxuICAgIGNvbnN0IHF1ZXJpZXMgPSBbXVxuICAgIHF1ZXJpZXMucHVzaChgcHJlZml4PSR7dXJpRXNjYXBlKHByZWZpeCl9YClcbiAgICBxdWVyaWVzLnB1c2goYGRlbGltaXRlcj0ke3VyaUVzY2FwZShkZWxpbWl0ZXIpfWApXG5cbiAgICBpZiAoa2V5TWFya2VyKSB7XG4gICAgICBxdWVyaWVzLnB1c2goYGtleS1tYXJrZXI9JHt1cmlFc2NhcGUoa2V5TWFya2VyKX1gKVxuICAgIH1cbiAgICBpZiAodXBsb2FkSWRNYXJrZXIpIHtcbiAgICAgIHF1ZXJpZXMucHVzaChgdXBsb2FkLWlkLW1hcmtlcj0ke3VwbG9hZElkTWFya2VyfWApXG4gICAgfVxuXG4gICAgY29uc3QgbWF4VXBsb2FkcyA9IDEwMDBcbiAgICBxdWVyaWVzLnB1c2goYG1heC11cGxvYWRzPSR7bWF4VXBsb2Fkc31gKVxuICAgIHF1ZXJpZXMuc29ydCgpXG4gICAgcXVlcmllcy51bnNoaWZ0KCd1cGxvYWRzJylcbiAgICBsZXQgcXVlcnkgPSAnJ1xuICAgIGlmIChxdWVyaWVzLmxlbmd0aCA+IDApIHtcbiAgICAgIHF1ZXJ5ID0gYCR7cXVlcmllcy5qb2luKCcmJyl9YFxuICAgIH1cbiAgICBjb25zdCBtZXRob2QgPSAnR0VUJ1xuICAgIGNvbnN0IHJlcyA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luYyh7IG1ldGhvZCwgYnVja2V0TmFtZSwgcXVlcnkgfSlcbiAgICBjb25zdCBib2R5ID0gYXdhaXQgcmVhZEFzU3RyaW5nKHJlcylcbiAgICByZXR1cm4geG1sUGFyc2Vycy5wYXJzZUxpc3RNdWx0aXBhcnQoYm9keSlcbiAgfVxuXG4gIC8qKlxuICAgKiBJbml0aWF0ZSBhIG5ldyBtdWx0aXBhcnQgdXBsb2FkLlxuICAgKiBAaW50ZXJuYWxcbiAgICovXG4gIGFzeW5jIGluaXRpYXRlTmV3TXVsdGlwYXJ0VXBsb2FkKGJ1Y2tldE5hbWU6IHN0cmluZywgb2JqZWN0TmFtZTogc3RyaW5nLCBoZWFkZXJzOiBSZXF1ZXN0SGVhZGVycyk6IFByb21pc2U8c3RyaW5nPiB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkT2JqZWN0TmFtZUVycm9yKGBJbnZhbGlkIG9iamVjdCBuYW1lOiAke29iamVjdE5hbWV9YClcbiAgICB9XG4gICAgaWYgKCFpc09iamVjdChoZWFkZXJzKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkT2JqZWN0TmFtZUVycm9yKCdjb250ZW50VHlwZSBzaG91bGQgYmUgb2YgdHlwZSBcIm9iamVjdFwiJylcbiAgICB9XG4gICAgY29uc3QgbWV0aG9kID0gJ1BPU1QnXG4gICAgY29uc3QgcXVlcnkgPSAndXBsb2FkcydcbiAgICBjb25zdCByZXMgPSBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmMoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIHF1ZXJ5LCBoZWFkZXJzIH0pXG4gICAgY29uc3QgYm9keSA9IGF3YWl0IHJlYWRBc0J1ZmZlcihyZXMpXG4gICAgcmV0dXJuIHBhcnNlSW5pdGlhdGVNdWx0aXBhcnQoYm9keS50b1N0cmluZygpKVxuICB9XG5cbiAgLyoqXG4gICAqIEludGVybmFsIE1ldGhvZCB0byBhYm9ydCBhIG11bHRpcGFydCB1cGxvYWQgcmVxdWVzdCBpbiBjYXNlIG9mIGFueSBlcnJvcnMuXG4gICAqXG4gICAqIEBwYXJhbSBidWNrZXROYW1lIC0gQnVja2V0IE5hbWVcbiAgICogQHBhcmFtIG9iamVjdE5hbWUgLSBPYmplY3QgTmFtZVxuICAgKiBAcGFyYW0gdXBsb2FkSWQgLSBpZCBvZiBhIG11bHRpcGFydCB1cGxvYWQgdG8gY2FuY2VsIGR1cmluZyBjb21wb3NlIG9iamVjdCBzZXF1ZW5jZS5cbiAgICovXG4gIGFzeW5jIGFib3J0TXVsdGlwYXJ0VXBsb2FkKGJ1Y2tldE5hbWU6IHN0cmluZywgb2JqZWN0TmFtZTogc3RyaW5nLCB1cGxvYWRJZDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgbWV0aG9kID0gJ0RFTEVURSdcbiAgICBjb25zdCBxdWVyeSA9IGB1cGxvYWRJZD0ke3VwbG9hZElkfWBcblxuICAgIGNvbnN0IHJlcXVlc3RPcHRpb25zID0geyBtZXRob2QsIGJ1Y2tldE5hbWUsIG9iamVjdE5hbWU6IG9iamVjdE5hbWUsIHF1ZXJ5IH1cbiAgICBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmNPbWl0KHJlcXVlc3RPcHRpb25zLCAnJywgWzIwNF0pXG4gIH1cblxuICBhc3luYyBmaW5kVXBsb2FkSWQoYnVja2V0TmFtZTogc3RyaW5nLCBvYmplY3ROYW1lOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZyB8IHVuZGVmaW5lZD4ge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmICghaXNWYWxpZE9iamVjdE5hbWUob2JqZWN0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZE9iamVjdE5hbWVFcnJvcihgSW52YWxpZCBvYmplY3QgbmFtZTogJHtvYmplY3ROYW1lfWApXG4gICAgfVxuXG4gICAgbGV0IGxhdGVzdFVwbG9hZDogTGlzdE11bHRpcGFydFJlc3VsdFsndXBsb2FkcyddW251bWJlcl0gfCB1bmRlZmluZWRcbiAgICBsZXQga2V5TWFya2VyID0gJydcbiAgICBsZXQgdXBsb2FkSWRNYXJrZXIgPSAnJ1xuICAgIGZvciAoOzspIHtcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMubGlzdEluY29tcGxldGVVcGxvYWRzUXVlcnkoYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwga2V5TWFya2VyLCB1cGxvYWRJZE1hcmtlciwgJycpXG4gICAgICBmb3IgKGNvbnN0IHVwbG9hZCBvZiByZXN1bHQudXBsb2Fkcykge1xuICAgICAgICBpZiAodXBsb2FkLmtleSA9PT0gb2JqZWN0TmFtZSkge1xuICAgICAgICAgIGlmICghbGF0ZXN0VXBsb2FkIHx8IHVwbG9hZC5pbml0aWF0ZWQuZ2V0VGltZSgpID4gbGF0ZXN0VXBsb2FkLmluaXRpYXRlZC5nZXRUaW1lKCkpIHtcbiAgICAgICAgICAgIGxhdGVzdFVwbG9hZCA9IHVwbG9hZFxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgaWYgKHJlc3VsdC5pc1RydW5jYXRlZCkge1xuICAgICAgICBrZXlNYXJrZXIgPSByZXN1bHQubmV4dEtleU1hcmtlclxuICAgICAgICB1cGxvYWRJZE1hcmtlciA9IHJlc3VsdC5uZXh0VXBsb2FkSWRNYXJrZXJcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgYnJlYWtcbiAgICB9XG4gICAgcmV0dXJuIGxhdGVzdFVwbG9hZD8udXBsb2FkSWRcbiAgfVxuXG4gIC8qKlxuICAgKiB0aGlzIGNhbGwgd2lsbCBhZ2dyZWdhdGUgdGhlIHBhcnRzIG9uIHRoZSBzZXJ2ZXIgaW50byBhIHNpbmdsZSBvYmplY3QuXG4gICAqL1xuICBhc3luYyBjb21wbGV0ZU11bHRpcGFydFVwbG9hZChcbiAgICBidWNrZXROYW1lOiBzdHJpbmcsXG4gICAgb2JqZWN0TmFtZTogc3RyaW5nLFxuICAgIHVwbG9hZElkOiBzdHJpbmcsXG4gICAgZXRhZ3M6IHtcbiAgICAgIHBhcnQ6IG51bWJlclxuICAgICAgZXRhZz86IHN0cmluZ1xuICAgIH1bXSxcbiAgKTogUHJvbWlzZTx7IGV0YWc6IHN0cmluZzsgdmVyc2lvbklkOiBzdHJpbmcgfCBudWxsIH0+IHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRPYmplY3ROYW1lRXJyb3IoYEludmFsaWQgb2JqZWN0IG5hbWU6ICR7b2JqZWN0TmFtZX1gKVxuICAgIH1cbiAgICBpZiAoIWlzU3RyaW5nKHVwbG9hZElkKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigndXBsb2FkSWQgc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXG4gICAgfVxuICAgIGlmICghaXNPYmplY3QoZXRhZ3MpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdldGFncyBzaG91bGQgYmUgb2YgdHlwZSBcIkFycmF5XCInKVxuICAgIH1cblxuICAgIGlmICghdXBsb2FkSWQpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ3VwbG9hZElkIGNhbm5vdCBiZSBlbXB0eScpXG4gICAgfVxuXG4gICAgY29uc3QgbWV0aG9kID0gJ1BPU1QnXG4gICAgY29uc3QgcXVlcnkgPSBgdXBsb2FkSWQ9JHt1cmlFc2NhcGUodXBsb2FkSWQpfWBcblxuICAgIGNvbnN0IGJ1aWxkZXIgPSBuZXcgeG1sMmpzLkJ1aWxkZXIoKVxuICAgIGNvbnN0IHBheWxvYWQgPSBidWlsZGVyLmJ1aWxkT2JqZWN0KHtcbiAgICAgIENvbXBsZXRlTXVsdGlwYXJ0VXBsb2FkOiB7XG4gICAgICAgICQ6IHtcbiAgICAgICAgICB4bWxuczogJ2h0dHA6Ly9zMy5hbWF6b25hd3MuY29tL2RvYy8yMDA2LTAzLTAxLycsXG4gICAgICAgIH0sXG4gICAgICAgIFBhcnQ6IGV0YWdzLm1hcCgoZXRhZykgPT4ge1xuICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBQYXJ0TnVtYmVyOiBldGFnLnBhcnQsXG4gICAgICAgICAgICBFVGFnOiBldGFnLmV0YWcsXG4gICAgICAgICAgfVxuICAgICAgICB9KSxcbiAgICAgIH0sXG4gICAgfSlcblxuICAgIGNvbnN0IHJlcyA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luYyh7IG1ldGhvZCwgYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgcXVlcnkgfSwgcGF5bG9hZClcbiAgICBjb25zdCBib2R5ID0gYXdhaXQgcmVhZEFzQnVmZmVyKHJlcylcbiAgICBjb25zdCByZXN1bHQgPSBwYXJzZUNvbXBsZXRlTXVsdGlwYXJ0KGJvZHkudG9TdHJpbmcoKSlcbiAgICBpZiAoIXJlc3VsdCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdCVUc6IGZhaWxlZCB0byBwYXJzZSBzZXJ2ZXIgcmVzcG9uc2UnKVxuICAgIH1cblxuICAgIGlmIChyZXN1bHQuZXJyQ29kZSkge1xuICAgICAgLy8gTXVsdGlwYXJ0IENvbXBsZXRlIEFQSSByZXR1cm5zIGFuIGVycm9yIFhNTCBhZnRlciBhIDIwMCBodHRwIHN0YXR1c1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5TM0Vycm9yKHJlc3VsdC5lcnJNZXNzYWdlKVxuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgQHR5cGVzY3JpcHQtZXNsaW50L2Jhbi10cy1jb21tZW50XG4gICAgICAvLyBAdHMtaWdub3JlXG4gICAgICBldGFnOiByZXN1bHQuZXRhZyBhcyBzdHJpbmcsXG4gICAgICB2ZXJzaW9uSWQ6IGdldFZlcnNpb25JZChyZXMuaGVhZGVycyBhcyBSZXNwb25zZUhlYWRlciksXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEdldCBwYXJ0LWluZm8gb2YgYWxsIHBhcnRzIG9mIGFuIGluY29tcGxldGUgdXBsb2FkIHNwZWNpZmllZCBieSB1cGxvYWRJZC5cbiAgICovXG4gIHByb3RlY3RlZCBhc3luYyBsaXN0UGFydHMoYnVja2V0TmFtZTogc3RyaW5nLCBvYmplY3ROYW1lOiBzdHJpbmcsIHVwbG9hZElkOiBzdHJpbmcpOiBQcm9taXNlPFVwbG9hZGVkUGFydFtdPiB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkT2JqZWN0TmFtZUVycm9yKGBJbnZhbGlkIG9iamVjdCBuYW1lOiAke29iamVjdE5hbWV9YClcbiAgICB9XG4gICAgaWYgKCFpc1N0cmluZyh1cGxvYWRJZCkpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3VwbG9hZElkIHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCInKVxuICAgIH1cbiAgICBpZiAoIXVwbG9hZElkKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCd1cGxvYWRJZCBjYW5ub3QgYmUgZW1wdHknKVxuICAgIH1cblxuICAgIGNvbnN0IHBhcnRzOiBVcGxvYWRlZFBhcnRbXSA9IFtdXG4gICAgbGV0IG1hcmtlciA9IDBcbiAgICBsZXQgcmVzdWx0XG4gICAgZG8ge1xuICAgICAgcmVzdWx0ID0gYXdhaXQgdGhpcy5saXN0UGFydHNRdWVyeShidWNrZXROYW1lLCBvYmplY3ROYW1lLCB1cGxvYWRJZCwgbWFya2VyKVxuICAgICAgbWFya2VyID0gcmVzdWx0Lm1hcmtlclxuICAgICAgcGFydHMucHVzaCguLi5yZXN1bHQucGFydHMpXG4gICAgfSB3aGlsZSAocmVzdWx0LmlzVHJ1bmNhdGVkKVxuXG4gICAgcmV0dXJuIHBhcnRzXG4gIH1cblxuICAvKipcbiAgICogQ2FsbGVkIGJ5IGxpc3RQYXJ0cyB0byBmZXRjaCBhIGJhdGNoIG9mIHBhcnQtaW5mb1xuICAgKi9cbiAgcHJpdmF0ZSBhc3luYyBsaXN0UGFydHNRdWVyeShidWNrZXROYW1lOiBzdHJpbmcsIG9iamVjdE5hbWU6IHN0cmluZywgdXBsb2FkSWQ6IHN0cmluZywgbWFya2VyOiBudW1iZXIpIHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRPYmplY3ROYW1lRXJyb3IoYEludmFsaWQgb2JqZWN0IG5hbWU6ICR7b2JqZWN0TmFtZX1gKVxuICAgIH1cbiAgICBpZiAoIWlzU3RyaW5nKHVwbG9hZElkKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigndXBsb2FkSWQgc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXG4gICAgfVxuICAgIGlmICghaXNOdW1iZXIobWFya2VyKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignbWFya2VyIHNob3VsZCBiZSBvZiB0eXBlIFwibnVtYmVyXCInKVxuICAgIH1cbiAgICBpZiAoIXVwbG9hZElkKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCd1cGxvYWRJZCBjYW5ub3QgYmUgZW1wdHknKVxuICAgIH1cblxuICAgIGxldCBxdWVyeSA9IGB1cGxvYWRJZD0ke3VyaUVzY2FwZSh1cGxvYWRJZCl9YFxuICAgIGlmIChtYXJrZXIpIHtcbiAgICAgIHF1ZXJ5ICs9IGAmcGFydC1udW1iZXItbWFya2VyPSR7bWFya2VyfWBcbiAgICB9XG5cbiAgICBjb25zdCBtZXRob2QgPSAnR0VUJ1xuICAgIGNvbnN0IHJlcyA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luYyh7IG1ldGhvZCwgYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgcXVlcnkgfSlcbiAgICByZXR1cm4geG1sUGFyc2Vycy5wYXJzZUxpc3RQYXJ0cyhhd2FpdCByZWFkQXNTdHJpbmcocmVzKSlcbiAgfVxuXG4gIGFzeW5jIGxpc3RCdWNrZXRzKCk6IFByb21pc2U8QnVja2V0SXRlbUZyb21MaXN0W10+IHtcbiAgICBjb25zdCBtZXRob2QgPSAnR0VUJ1xuICAgIGNvbnN0IHJlZ2lvbkNvbmYgPSB0aGlzLnJlZ2lvbiB8fCBERUZBVUxUX1JFR0lPTlxuICAgIGNvbnN0IGh0dHBSZXMgPSBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmMoeyBtZXRob2QgfSwgJycsIFsyMDBdLCByZWdpb25Db25mKVxuICAgIGNvbnN0IHhtbFJlc3VsdCA9IGF3YWl0IHJlYWRBc1N0cmluZyhodHRwUmVzKVxuICAgIHJldHVybiB4bWxQYXJzZXJzLnBhcnNlTGlzdEJ1Y2tldCh4bWxSZXN1bHQpXG4gIH1cblxuICAvKipcbiAgICogQ2FsY3VsYXRlIHBhcnQgc2l6ZSBnaXZlbiB0aGUgb2JqZWN0IHNpemUuIFBhcnQgc2l6ZSB3aWxsIGJlIGF0bGVhc3QgdGhpcy5wYXJ0U2l6ZVxuICAgKi9cbiAgY2FsY3VsYXRlUGFydFNpemUoc2l6ZTogbnVtYmVyKSB7XG4gICAgaWYgKCFpc051bWJlcihzaXplKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignc2l6ZSBzaG91bGQgYmUgb2YgdHlwZSBcIm51bWJlclwiJylcbiAgICB9XG4gICAgaWYgKHNpemUgPiB0aGlzLm1heE9iamVjdFNpemUpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoYHNpemUgc2hvdWxkIG5vdCBiZSBtb3JlIHRoYW4gJHt0aGlzLm1heE9iamVjdFNpemV9YClcbiAgICB9XG4gICAgaWYgKHRoaXMub3ZlclJpZGVQYXJ0U2l6ZSkge1xuICAgICAgcmV0dXJuIHRoaXMucGFydFNpemVcbiAgICB9XG4gICAgbGV0IHBhcnRTaXplID0gdGhpcy5wYXJ0U2l6ZVxuICAgIGZvciAoOzspIHtcbiAgICAgIC8vIHdoaWxlKHRydWUpIHsuLi59IHRocm93cyBsaW50aW5nIGVycm9yLlxuICAgICAgLy8gSWYgcGFydFNpemUgaXMgYmlnIGVub3VnaCB0byBhY2NvbW9kYXRlIHRoZSBvYmplY3Qgc2l6ZSwgdGhlbiB1c2UgaXQuXG4gICAgICBpZiAocGFydFNpemUgKiAxMDAwMCA+IHNpemUpIHtcbiAgICAgICAgcmV0dXJuIHBhcnRTaXplXG4gICAgICB9XG4gICAgICAvLyBUcnkgcGFydCBzaXplcyBhcyA2NE1CLCA4ME1CLCA5Nk1CIGV0Yy5cbiAgICAgIHBhcnRTaXplICs9IDE2ICogMTAyNCAqIDEwMjRcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogVXBsb2FkcyB0aGUgb2JqZWN0IHVzaW5nIGNvbnRlbnRzIGZyb20gYSBmaWxlXG4gICAqL1xuICBhc3luYyBmUHV0T2JqZWN0KGJ1Y2tldE5hbWU6IHN0cmluZywgb2JqZWN0TmFtZTogc3RyaW5nLCBmaWxlUGF0aDogc3RyaW5nLCBtZXRhRGF0YT86IE9iamVjdE1ldGFEYXRhKSB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkT2JqZWN0TmFtZUVycm9yKGBJbnZhbGlkIG9iamVjdCBuYW1lOiAke29iamVjdE5hbWV9YClcbiAgICB9XG5cbiAgICBpZiAoIWlzU3RyaW5nKGZpbGVQYXRoKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignZmlsZVBhdGggc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXG4gICAgfVxuICAgIGlmIChtZXRhRGF0YSAmJiAhaXNPYmplY3QobWV0YURhdGEpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdtZXRhRGF0YSBzaG91bGQgYmUgb2YgdHlwZSBcIm9iamVjdFwiJylcbiAgICB9XG5cbiAgICAvLyBJbnNlcnRzIGNvcnJlY3QgYGNvbnRlbnQtdHlwZWAgYXR0cmlidXRlIGJhc2VkIG9uIG1ldGFEYXRhIGFuZCBmaWxlUGF0aFxuICAgIG1ldGFEYXRhID0gaW5zZXJ0Q29udGVudFR5cGUobWV0YURhdGEgfHwge30sIGZpbGVQYXRoKVxuICAgIGNvbnN0IHN0YXQgPSBhd2FpdCBmc3Auc3RhdChmaWxlUGF0aClcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5wdXRPYmplY3QoYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgZnMuY3JlYXRlUmVhZFN0cmVhbShmaWxlUGF0aCksIHN0YXQuc2l6ZSwgbWV0YURhdGEpXG4gIH1cblxuICAvKipcbiAgICogIFVwbG9hZGluZyBhIHN0cmVhbSwgXCJCdWZmZXJcIiBvciBcInN0cmluZ1wiLlxuICAgKiAgSXQncyByZWNvbW1lbmRlZCB0byBwYXNzIGBzaXplYCBhcmd1bWVudCB3aXRoIHN0cmVhbS5cbiAgICovXG4gIGFzeW5jIHB1dE9iamVjdChcbiAgICBidWNrZXROYW1lOiBzdHJpbmcsXG4gICAgb2JqZWN0TmFtZTogc3RyaW5nLFxuICAgIHN0cmVhbTogc3RyZWFtLlJlYWRhYmxlIHwgQnVmZmVyIHwgc3RyaW5nLFxuICAgIHNpemU/OiBudW1iZXIsXG4gICAgbWV0YURhdGE/OiBJdGVtQnVja2V0TWV0YWRhdGEsXG4gICk6IFByb21pc2U8VXBsb2FkZWRPYmplY3RJbmZvPiB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKGBJbnZhbGlkIGJ1Y2tldCBuYW1lOiAke2J1Y2tldE5hbWV9YClcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkT2JqZWN0TmFtZUVycm9yKGBJbnZhbGlkIG9iamVjdCBuYW1lOiAke29iamVjdE5hbWV9YClcbiAgICB9XG5cbiAgICAvLyBXZSdsbCBuZWVkIHRvIHNoaWZ0IGFyZ3VtZW50cyB0byB0aGUgbGVmdCBiZWNhdXNlIG9mIG1ldGFEYXRhXG4gICAgLy8gYW5kIHNpemUgYmVpbmcgb3B0aW9uYWwuXG4gICAgaWYgKGlzT2JqZWN0KHNpemUpKSB7XG4gICAgICBtZXRhRGF0YSA9IHNpemVcbiAgICB9XG4gICAgLy8gRW5zdXJlcyBNZXRhZGF0YSBoYXMgYXBwcm9wcmlhdGUgcHJlZml4IGZvciBBMyBBUElcbiAgICBjb25zdCBoZWFkZXJzID0gcHJlcGVuZFhBTVpNZXRhKG1ldGFEYXRhKVxuICAgIGlmICh0eXBlb2Ygc3RyZWFtID09PSAnc3RyaW5nJyB8fCBzdHJlYW0gaW5zdGFuY2VvZiBCdWZmZXIpIHtcbiAgICAgIC8vIEFkYXB0cyB0aGUgbm9uLXN0cmVhbSBpbnRlcmZhY2UgaW50byBhIHN0cmVhbS5cbiAgICAgIHNpemUgPSBzdHJlYW0ubGVuZ3RoXG4gICAgICBzdHJlYW0gPSByZWFkYWJsZVN0cmVhbShzdHJlYW0pXG4gICAgfSBlbHNlIGlmICghaXNSZWFkYWJsZVN0cmVhbShzdHJlYW0pKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCd0aGlyZCBhcmd1bWVudCBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmVhbS5SZWFkYWJsZVwiIG9yIFwiQnVmZmVyXCIgb3IgXCJzdHJpbmdcIicpXG4gICAgfVxuXG4gICAgaWYgKGlzTnVtYmVyKHNpemUpICYmIHNpemUgPCAwKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKGBzaXplIGNhbm5vdCBiZSBuZWdhdGl2ZSwgZ2l2ZW4gc2l6ZTogJHtzaXplfWApXG4gICAgfVxuXG4gICAgLy8gR2V0IHRoZSBwYXJ0IHNpemUgYW5kIGZvcndhcmQgdGhhdCB0byB0aGUgQmxvY2tTdHJlYW0uIERlZmF1bHQgdG8gdGhlXG4gICAgLy8gbGFyZ2VzdCBibG9jayBzaXplIHBvc3NpYmxlIGlmIG5lY2Vzc2FyeS5cbiAgICBpZiAoIWlzTnVtYmVyKHNpemUpKSB7XG4gICAgICBzaXplID0gdGhpcy5tYXhPYmplY3RTaXplXG4gICAgfVxuXG4gICAgLy8gR2V0IHRoZSBwYXJ0IHNpemUgYW5kIGZvcndhcmQgdGhhdCB0byB0aGUgQmxvY2tTdHJlYW0uIERlZmF1bHQgdG8gdGhlXG4gICAgLy8gbGFyZ2VzdCBibG9jayBzaXplIHBvc3NpYmxlIGlmIG5lY2Vzc2FyeS5cbiAgICBpZiAoc2l6ZSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICBjb25zdCBzdGF0U2l6ZSA9IGF3YWl0IGdldENvbnRlbnRMZW5ndGgoc3RyZWFtKVxuICAgICAgaWYgKHN0YXRTaXplICE9PSBudWxsKSB7XG4gICAgICAgIHNpemUgPSBzdGF0U2l6ZVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmICghaXNOdW1iZXIoc2l6ZSkpIHtcbiAgICAgIC8vIEJhY2t3YXJkIGNvbXBhdGliaWxpdHlcbiAgICAgIHNpemUgPSB0aGlzLm1heE9iamVjdFNpemVcbiAgICB9XG4gICAgaWYgKHNpemUgPT09IDApIHtcbiAgICAgIHJldHVybiB0aGlzLnVwbG9hZEJ1ZmZlcihidWNrZXROYW1lLCBvYmplY3ROYW1lLCBoZWFkZXJzLCBCdWZmZXIuZnJvbSgnJykpXG4gICAgfVxuXG4gICAgY29uc3QgcGFydFNpemUgPSB0aGlzLmNhbGN1bGF0ZVBhcnRTaXplKHNpemUpXG4gICAgaWYgKHR5cGVvZiBzdHJlYW0gPT09ICdzdHJpbmcnIHx8IEJ1ZmZlci5pc0J1ZmZlcihzdHJlYW0pIHx8IHNpemUgPD0gcGFydFNpemUpIHtcbiAgICAgIGNvbnN0IGJ1ZiA9IGlzUmVhZGFibGVTdHJlYW0oc3RyZWFtKSA/IGF3YWl0IHJlYWRBc0J1ZmZlcihzdHJlYW0pIDogQnVmZmVyLmZyb20oc3RyZWFtKVxuICAgICAgcmV0dXJuIHRoaXMudXBsb2FkQnVmZmVyKGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIGhlYWRlcnMsIGJ1ZilcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy51cGxvYWRTdHJlYW0oYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgaGVhZGVycywgc3RyZWFtLCBwYXJ0U2l6ZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBtZXRob2QgdG8gdXBsb2FkIGJ1ZmZlciBpbiBvbmUgY2FsbFxuICAgKiBAcHJpdmF0ZVxuICAgKi9cbiAgcHJpdmF0ZSBhc3luYyB1cGxvYWRCdWZmZXIoXG4gICAgYnVja2V0TmFtZTogc3RyaW5nLFxuICAgIG9iamVjdE5hbWU6IHN0cmluZyxcbiAgICBoZWFkZXJzOiBSZXF1ZXN0SGVhZGVycyxcbiAgICBidWY6IEJ1ZmZlcixcbiAgKTogUHJvbWlzZTxVcGxvYWRlZE9iamVjdEluZm8+IHtcbiAgICBjb25zdCB7IG1kNXN1bSwgc2hhMjU2c3VtIH0gPSBoYXNoQmluYXJ5KGJ1ZiwgdGhpcy5lbmFibGVTSEEyNTYpXG4gICAgaGVhZGVyc1snQ29udGVudC1MZW5ndGgnXSA9IGJ1Zi5sZW5ndGhcbiAgICBpZiAoIXRoaXMuZW5hYmxlU0hBMjU2KSB7XG4gICAgICBoZWFkZXJzWydDb250ZW50LU1ENSddID0gbWQ1c3VtXG4gICAgfVxuICAgIGNvbnN0IHJlcyA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RTdHJlYW1Bc3luYyhcbiAgICAgIHtcbiAgICAgICAgbWV0aG9kOiAnUFVUJyxcbiAgICAgICAgYnVja2V0TmFtZSxcbiAgICAgICAgb2JqZWN0TmFtZSxcbiAgICAgICAgaGVhZGVycyxcbiAgICAgIH0sXG4gICAgICBidWYsXG4gICAgICBzaGEyNTZzdW0sXG4gICAgICBbMjAwXSxcbiAgICAgICcnLFxuICAgIClcbiAgICBhd2FpdCBkcmFpblJlc3BvbnNlKHJlcylcbiAgICByZXR1cm4ge1xuICAgICAgZXRhZzogc2FuaXRpemVFVGFnKHJlcy5oZWFkZXJzLmV0YWcpLFxuICAgICAgdmVyc2lvbklkOiBnZXRWZXJzaW9uSWQocmVzLmhlYWRlcnMgYXMgUmVzcG9uc2VIZWFkZXIpLFxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiB1cGxvYWQgc3RyZWFtIHdpdGggTXVsdGlwYXJ0VXBsb2FkXG4gICAqIEBwcml2YXRlXG4gICAqL1xuICBwcml2YXRlIGFzeW5jIHVwbG9hZFN0cmVhbShcbiAgICBidWNrZXROYW1lOiBzdHJpbmcsXG4gICAgb2JqZWN0TmFtZTogc3RyaW5nLFxuICAgIGhlYWRlcnM6IFJlcXVlc3RIZWFkZXJzLFxuICAgIGJvZHk6IHN0cmVhbS5SZWFkYWJsZSxcbiAgICBwYXJ0U2l6ZTogbnVtYmVyLFxuICApOiBQcm9taXNlPFVwbG9hZGVkT2JqZWN0SW5mbz4ge1xuICAgIC8vIEEgbWFwIG9mIHRoZSBwcmV2aW91c2x5IHVwbG9hZGVkIGNodW5rcywgZm9yIHJlc3VtaW5nIGEgZmlsZSB1cGxvYWQuIFRoaXNcbiAgICAvLyB3aWxsIGJlIG51bGwgaWYgd2UgYXJlbid0IHJlc3VtaW5nIGFuIHVwbG9hZC5cbiAgICBjb25zdCBvbGRQYXJ0czogUmVjb3JkPG51bWJlciwgUGFydD4gPSB7fVxuXG4gICAgLy8gS2VlcCB0cmFjayBvZiB0aGUgZXRhZ3MgZm9yIGFnZ3JlZ2F0aW5nIHRoZSBjaHVua3MgdG9nZXRoZXIgbGF0ZXIuIEVhY2hcbiAgICAvLyBldGFnIHJlcHJlc2VudHMgYSBzaW5nbGUgY2h1bmsgb2YgdGhlIGZpbGUuXG4gICAgY29uc3QgZVRhZ3M6IFBhcnRbXSA9IFtdXG5cbiAgICBjb25zdCBwcmV2aW91c1VwbG9hZElkID0gYXdhaXQgdGhpcy5maW5kVXBsb2FkSWQoYnVja2V0TmFtZSwgb2JqZWN0TmFtZSlcbiAgICBsZXQgdXBsb2FkSWQ6IHN0cmluZ1xuICAgIGlmICghcHJldmlvdXNVcGxvYWRJZCkge1xuICAgICAgdXBsb2FkSWQgPSBhd2FpdCB0aGlzLmluaXRpYXRlTmV3TXVsdGlwYXJ0VXBsb2FkKGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIGhlYWRlcnMpXG4gICAgfSBlbHNlIHtcbiAgICAgIHVwbG9hZElkID0gcHJldmlvdXNVcGxvYWRJZFxuICAgICAgY29uc3Qgb2xkVGFncyA9IGF3YWl0IHRoaXMubGlzdFBhcnRzKGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIHByZXZpb3VzVXBsb2FkSWQpXG4gICAgICBvbGRUYWdzLmZvckVhY2goKGUpID0+IHtcbiAgICAgICAgb2xkUGFydHNbZS5wYXJ0XSA9IGVcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgY29uc3QgY2h1bmtpZXIgPSBuZXcgQmxvY2tTdHJlYW0yKHsgc2l6ZTogcGFydFNpemUsIHplcm9QYWRkaW5nOiBmYWxzZSB9KVxuXG4gICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIEB0eXBlc2NyaXB0LWVzbGludC9uby11bnVzZWQtdmFyc1xuICAgIGNvbnN0IFtfLCBvXSA9IGF3YWl0IFByb21pc2UuYWxsKFtcbiAgICAgIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgYm9keS5waXBlKGNodW5raWVyKS5vbignZXJyb3InLCByZWplY3QpXG4gICAgICAgIGNodW5raWVyLm9uKCdlbmQnLCByZXNvbHZlKS5vbignZXJyb3InLCByZWplY3QpXG4gICAgICB9KSxcbiAgICAgIChhc3luYyAoKSA9PiB7XG4gICAgICAgIGxldCBwYXJ0TnVtYmVyID0gMVxuXG4gICAgICAgIGZvciBhd2FpdCAoY29uc3QgY2h1bmsgb2YgY2h1bmtpZXIpIHtcbiAgICAgICAgICBjb25zdCBtZDUgPSBjcnlwdG8uY3JlYXRlSGFzaCgnbWQ1JykudXBkYXRlKGNodW5rKS5kaWdlc3QoKVxuXG4gICAgICAgICAgY29uc3Qgb2xkUGFydCA9IG9sZFBhcnRzW3BhcnROdW1iZXJdXG4gICAgICAgICAgaWYgKG9sZFBhcnQpIHtcbiAgICAgICAgICAgIGlmIChvbGRQYXJ0LmV0YWcgPT09IG1kNS50b1N0cmluZygnaGV4JykpIHtcbiAgICAgICAgICAgICAgZVRhZ3MucHVzaCh7IHBhcnQ6IHBhcnROdW1iZXIsIGV0YWc6IG9sZFBhcnQuZXRhZyB9KVxuICAgICAgICAgICAgICBwYXJ0TnVtYmVyKytcbiAgICAgICAgICAgICAgY29udGludWVcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG5cbiAgICAgICAgICBwYXJ0TnVtYmVyKytcblxuICAgICAgICAgIC8vIG5vdyBzdGFydCB0byB1cGxvYWQgbWlzc2luZyBwYXJ0XG4gICAgICAgICAgY29uc3Qgb3B0aW9uczogUmVxdWVzdE9wdGlvbiA9IHtcbiAgICAgICAgICAgIG1ldGhvZDogJ1BVVCcsXG4gICAgICAgICAgICBxdWVyeTogcXMuc3RyaW5naWZ5KHsgcGFydE51bWJlciwgdXBsb2FkSWQgfSksXG4gICAgICAgICAgICBoZWFkZXJzOiB7XG4gICAgICAgICAgICAgICdDb250ZW50LUxlbmd0aCc6IGNodW5rLmxlbmd0aCxcbiAgICAgICAgICAgICAgJ0NvbnRlbnQtTUQ1JzogbWQ1LnRvU3RyaW5nKCdiYXNlNjQnKSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBidWNrZXROYW1lLFxuICAgICAgICAgICAgb2JqZWN0TmFtZSxcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luY09taXQob3B0aW9ucywgY2h1bmspXG5cbiAgICAgICAgICBsZXQgZXRhZyA9IHJlc3BvbnNlLmhlYWRlcnMuZXRhZ1xuICAgICAgICAgIGlmIChldGFnKSB7XG4gICAgICAgICAgICBldGFnID0gZXRhZy5yZXBsYWNlKC9eXCIvLCAnJykucmVwbGFjZSgvXCIkLywgJycpXG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGV0YWcgPSAnJ1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGVUYWdzLnB1c2goeyBwYXJ0OiBwYXJ0TnVtYmVyLCBldGFnIH0pXG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gYXdhaXQgdGhpcy5jb21wbGV0ZU11bHRpcGFydFVwbG9hZChidWNrZXROYW1lLCBvYmplY3ROYW1lLCB1cGxvYWRJZCwgZVRhZ3MpXG4gICAgICB9KSgpLFxuICAgIF0pXG5cbiAgICByZXR1cm4gb1xuICB9XG5cbiAgYXN5bmMgcmVtb3ZlQnVja2V0UmVwbGljYXRpb24oYnVja2V0TmFtZTogc3RyaW5nKTogUHJvbWlzZTx2b2lkPlxuICByZW1vdmVCdWNrZXRSZXBsaWNhdGlvbihidWNrZXROYW1lOiBzdHJpbmcsIGNhbGxiYWNrOiBOb1Jlc3VsdENhbGxiYWNrKTogdm9pZFxuICBhc3luYyByZW1vdmVCdWNrZXRSZXBsaWNhdGlvbihidWNrZXROYW1lOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBjb25zdCBtZXRob2QgPSAnREVMRVRFJ1xuICAgIGNvbnN0IHF1ZXJ5ID0gJ3JlcGxpY2F0aW9uJ1xuICAgIGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luY09taXQoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIHF1ZXJ5IH0sICcnLCBbMjAwLCAyMDRdLCAnJylcbiAgfVxuXG4gIHNldEJ1Y2tldFJlcGxpY2F0aW9uKGJ1Y2tldE5hbWU6IHN0cmluZywgcmVwbGljYXRpb25Db25maWc6IFJlcGxpY2F0aW9uQ29uZmlnT3B0cyk6IHZvaWRcbiAgYXN5bmMgc2V0QnVja2V0UmVwbGljYXRpb24oYnVja2V0TmFtZTogc3RyaW5nLCByZXBsaWNhdGlvbkNvbmZpZzogUmVwbGljYXRpb25Db25maWdPcHRzKTogUHJvbWlzZTx2b2lkPlxuICBhc3luYyBzZXRCdWNrZXRSZXBsaWNhdGlvbihidWNrZXROYW1lOiBzdHJpbmcsIHJlcGxpY2F0aW9uQ29uZmlnOiBSZXBsaWNhdGlvbkNvbmZpZ09wdHMpIHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzT2JqZWN0KHJlcGxpY2F0aW9uQ29uZmlnKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcigncmVwbGljYXRpb25Db25maWcgc2hvdWxkIGJlIG9mIHR5cGUgXCJvYmplY3RcIicpXG4gICAgfSBlbHNlIHtcbiAgICAgIGlmIChfLmlzRW1wdHkocmVwbGljYXRpb25Db25maWcucm9sZSkpIHtcbiAgICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcignUm9sZSBjYW5ub3QgYmUgZW1wdHknKVxuICAgICAgfSBlbHNlIGlmIChyZXBsaWNhdGlvbkNvbmZpZy5yb2xlICYmICFpc1N0cmluZyhyZXBsaWNhdGlvbkNvbmZpZy5yb2xlKSkge1xuICAgICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCdJbnZhbGlkIHZhbHVlIGZvciByb2xlJywgcmVwbGljYXRpb25Db25maWcucm9sZSlcbiAgICAgIH1cbiAgICAgIGlmIChfLmlzRW1wdHkocmVwbGljYXRpb25Db25maWcucnVsZXMpKSB7XG4gICAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ01pbmltdW0gb25lIHJlcGxpY2F0aW9uIHJ1bGUgbXVzdCBiZSBzcGVjaWZpZWQnKVxuICAgICAgfVxuICAgIH1cbiAgICBjb25zdCBtZXRob2QgPSAnUFVUJ1xuICAgIGNvbnN0IHF1ZXJ5ID0gJ3JlcGxpY2F0aW9uJ1xuICAgIGNvbnN0IGhlYWRlcnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7fVxuXG4gICAgY29uc3QgcmVwbGljYXRpb25QYXJhbXNDb25maWcgPSB7XG4gICAgICBSZXBsaWNhdGlvbkNvbmZpZ3VyYXRpb246IHtcbiAgICAgICAgUm9sZTogcmVwbGljYXRpb25Db25maWcucm9sZSxcbiAgICAgICAgUnVsZTogcmVwbGljYXRpb25Db25maWcucnVsZXMsXG4gICAgICB9LFxuICAgIH1cblxuICAgIGNvbnN0IGJ1aWxkZXIgPSBuZXcgeG1sMmpzLkJ1aWxkZXIoeyByZW5kZXJPcHRzOiB7IHByZXR0eTogZmFsc2UgfSwgaGVhZGxlc3M6IHRydWUgfSlcbiAgICBjb25zdCBwYXlsb2FkID0gYnVpbGRlci5idWlsZE9iamVjdChyZXBsaWNhdGlvblBhcmFtc0NvbmZpZylcbiAgICBoZWFkZXJzWydDb250ZW50LU1ENSddID0gdG9NZDUocGF5bG9hZClcbiAgICBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmNPbWl0KHsgbWV0aG9kLCBidWNrZXROYW1lLCBxdWVyeSwgaGVhZGVycyB9LCBwYXlsb2FkKVxuICB9XG5cbiAgZ2V0QnVja2V0UmVwbGljYXRpb24oYnVja2V0TmFtZTogc3RyaW5nKTogdm9pZFxuICBhc3luYyBnZXRCdWNrZXRSZXBsaWNhdGlvbihidWNrZXROYW1lOiBzdHJpbmcpOiBQcm9taXNlPFJlcGxpY2F0aW9uQ29uZmlnPlxuICBhc3luYyBnZXRCdWNrZXRSZXBsaWNhdGlvbihidWNrZXROYW1lOiBzdHJpbmcpIHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBjb25zdCBtZXRob2QgPSAnR0VUJ1xuICAgIGNvbnN0IHF1ZXJ5ID0gJ3JlcGxpY2F0aW9uJ1xuXG4gICAgY29uc3QgaHR0cFJlcyA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luYyh7IG1ldGhvZCwgYnVja2V0TmFtZSwgcXVlcnkgfSwgJycsIFsyMDAsIDIwNF0pXG4gICAgY29uc3QgeG1sUmVzdWx0ID0gYXdhaXQgcmVhZEFzU3RyaW5nKGh0dHBSZXMpXG4gICAgcmV0dXJuIHhtbFBhcnNlcnMucGFyc2VSZXBsaWNhdGlvbkNvbmZpZyh4bWxSZXN1bHQpXG4gIH1cblxuICBnZXRPYmplY3RMZWdhbEhvbGQoXG4gICAgYnVja2V0TmFtZTogc3RyaW5nLFxuICAgIG9iamVjdE5hbWU6IHN0cmluZyxcbiAgICBnZXRPcHRzPzogR2V0T2JqZWN0TGVnYWxIb2xkT3B0aW9ucyxcbiAgICBjYWxsYmFjaz86IFJlc3VsdENhbGxiYWNrPExFR0FMX0hPTERfU1RBVFVTPixcbiAgKTogUHJvbWlzZTxMRUdBTF9IT0xEX1NUQVRVUz5cbiAgYXN5bmMgZ2V0T2JqZWN0TGVnYWxIb2xkKFxuICAgIGJ1Y2tldE5hbWU6IHN0cmluZyxcbiAgICBvYmplY3ROYW1lOiBzdHJpbmcsXG4gICAgZ2V0T3B0cz86IEdldE9iamVjdExlZ2FsSG9sZE9wdGlvbnMsXG4gICk6IFByb21pc2U8TEVHQUxfSE9MRF9TVEFUVVM+IHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRPYmplY3ROYW1lRXJyb3IoYEludmFsaWQgb2JqZWN0IG5hbWU6ICR7b2JqZWN0TmFtZX1gKVxuICAgIH1cblxuICAgIGlmIChnZXRPcHRzKSB7XG4gICAgICBpZiAoIWlzT2JqZWN0KGdldE9wdHMpKSB7XG4gICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2dldE9wdHMgc2hvdWxkIGJlIG9mIHR5cGUgXCJPYmplY3RcIicpXG4gICAgICB9IGVsc2UgaWYgKE9iamVjdC5rZXlzKGdldE9wdHMpLmxlbmd0aCA+IDAgJiYgZ2V0T3B0cy52ZXJzaW9uSWQgJiYgIWlzU3RyaW5nKGdldE9wdHMudmVyc2lvbklkKSkge1xuICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCd2ZXJzaW9uSWQgc2hvdWxkIGJlIG9mIHR5cGUgc3RyaW5nLjonLCBnZXRPcHRzLnZlcnNpb25JZClcbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCBtZXRob2QgPSAnR0VUJ1xuICAgIGxldCBxdWVyeSA9ICdsZWdhbC1ob2xkJ1xuXG4gICAgaWYgKGdldE9wdHM/LnZlcnNpb25JZCkge1xuICAgICAgcXVlcnkgKz0gYCZ2ZXJzaW9uSWQ9JHtnZXRPcHRzLnZlcnNpb25JZH1gXG4gICAgfVxuXG4gICAgY29uc3QgaHR0cFJlcyA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luYyh7IG1ldGhvZCwgYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgcXVlcnkgfSwgJycsIFsyMDBdKVxuICAgIGNvbnN0IHN0clJlcyA9IGF3YWl0IHJlYWRBc1N0cmluZyhodHRwUmVzKVxuICAgIHJldHVybiBwYXJzZU9iamVjdExlZ2FsSG9sZENvbmZpZyhzdHJSZXMpXG4gIH1cblxuICBzZXRPYmplY3RMZWdhbEhvbGQoYnVja2V0TmFtZTogc3RyaW5nLCBvYmplY3ROYW1lOiBzdHJpbmcsIHNldE9wdHM/OiBQdXRPYmplY3RMZWdhbEhvbGRPcHRpb25zKTogdm9pZFxuICBhc3luYyBzZXRPYmplY3RMZWdhbEhvbGQoXG4gICAgYnVja2V0TmFtZTogc3RyaW5nLFxuICAgIG9iamVjdE5hbWU6IHN0cmluZyxcbiAgICBzZXRPcHRzID0ge1xuICAgICAgc3RhdHVzOiBMRUdBTF9IT0xEX1NUQVRVUy5FTkFCTEVELFxuICAgIH0gYXMgUHV0T2JqZWN0TGVnYWxIb2xkT3B0aW9ucyxcbiAgKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkT2JqZWN0TmFtZUVycm9yKGBJbnZhbGlkIG9iamVjdCBuYW1lOiAke29iamVjdE5hbWV9YClcbiAgICB9XG5cbiAgICBpZiAoIWlzT2JqZWN0KHNldE9wdHMpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdzZXRPcHRzIHNob3VsZCBiZSBvZiB0eXBlIFwiT2JqZWN0XCInKVxuICAgIH0gZWxzZSB7XG4gICAgICBpZiAoIVtMRUdBTF9IT0xEX1NUQVRVUy5FTkFCTEVELCBMRUdBTF9IT0xEX1NUQVRVUy5ESVNBQkxFRF0uaW5jbHVkZXMoc2V0T3B0cz8uc3RhdHVzKSkge1xuICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdJbnZhbGlkIHN0YXR1czogJyArIHNldE9wdHMuc3RhdHVzKVxuICAgICAgfVxuICAgICAgaWYgKHNldE9wdHMudmVyc2lvbklkICYmICFzZXRPcHRzLnZlcnNpb25JZC5sZW5ndGgpIHtcbiAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigndmVyc2lvbklkIHNob3VsZCBiZSBvZiB0eXBlIHN0cmluZy46JyArIHNldE9wdHMudmVyc2lvbklkKVxuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IG1ldGhvZCA9ICdQVVQnXG4gICAgbGV0IHF1ZXJ5ID0gJ2xlZ2FsLWhvbGQnXG5cbiAgICBpZiAoc2V0T3B0cy52ZXJzaW9uSWQpIHtcbiAgICAgIHF1ZXJ5ICs9IGAmdmVyc2lvbklkPSR7c2V0T3B0cy52ZXJzaW9uSWR9YFxuICAgIH1cblxuICAgIGNvbnN0IGNvbmZpZyA9IHtcbiAgICAgIFN0YXR1czogc2V0T3B0cy5zdGF0dXMsXG4gICAgfVxuXG4gICAgY29uc3QgYnVpbGRlciA9IG5ldyB4bWwyanMuQnVpbGRlcih7IHJvb3ROYW1lOiAnTGVnYWxIb2xkJywgcmVuZGVyT3B0czogeyBwcmV0dHk6IGZhbHNlIH0sIGhlYWRsZXNzOiB0cnVlIH0pXG4gICAgY29uc3QgcGF5bG9hZCA9IGJ1aWxkZXIuYnVpbGRPYmplY3QoY29uZmlnKVxuICAgIGNvbnN0IGhlYWRlcnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7fVxuICAgIGhlYWRlcnNbJ0NvbnRlbnQtTUQ1J10gPSB0b01kNShwYXlsb2FkKVxuXG4gICAgYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jT21pdCh7IG1ldGhvZCwgYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgcXVlcnksIGhlYWRlcnMgfSwgcGF5bG9hZClcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXQgVGFncyBhc3NvY2lhdGVkIHdpdGggYSBCdWNrZXRcbiAgICovXG4gIGFzeW5jIGdldEJ1Y2tldFRhZ2dpbmcoYnVja2V0TmFtZTogc3RyaW5nKTogUHJvbWlzZTxUYWdbXT4ge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcihgSW52YWxpZCBidWNrZXQgbmFtZTogJHtidWNrZXROYW1lfWApXG4gICAgfVxuXG4gICAgY29uc3QgbWV0aG9kID0gJ0dFVCdcbiAgICBjb25zdCBxdWVyeSA9ICd0YWdnaW5nJ1xuICAgIGNvbnN0IHJlcXVlc3RPcHRpb25zID0geyBtZXRob2QsIGJ1Y2tldE5hbWUsIHF1ZXJ5IH1cblxuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jKHJlcXVlc3RPcHRpb25zKVxuICAgIGNvbnN0IGJvZHkgPSBhd2FpdCByZWFkQXNTdHJpbmcocmVzcG9uc2UpXG4gICAgcmV0dXJuIHhtbFBhcnNlcnMucGFyc2VUYWdnaW5nKGJvZHkpXG4gIH1cblxuICAvKipcbiAgICogIEdldCB0aGUgdGFncyBhc3NvY2lhdGVkIHdpdGggYSBidWNrZXQgT1IgYW4gb2JqZWN0XG4gICAqL1xuICBhc3luYyBnZXRPYmplY3RUYWdnaW5nKGJ1Y2tldE5hbWU6IHN0cmluZywgb2JqZWN0TmFtZTogc3RyaW5nLCBnZXRPcHRzPzogR2V0T2JqZWN0T3B0cyk6IFByb21pc2U8VGFnW10+IHtcbiAgICBjb25zdCBtZXRob2QgPSAnR0VUJ1xuICAgIGxldCBxdWVyeSA9ICd0YWdnaW5nJ1xuXG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIG9iamVjdCBuYW1lOiAnICsgb2JqZWN0TmFtZSlcbiAgICB9XG4gICAgaWYgKGdldE9wdHMgJiYgIWlzT2JqZWN0KGdldE9wdHMpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCdnZXRPcHRzIHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxuICAgIH1cblxuICAgIGlmIChnZXRPcHRzICYmIGdldE9wdHMudmVyc2lvbklkKSB7XG4gICAgICBxdWVyeSA9IGAke3F1ZXJ5fSZ2ZXJzaW9uSWQ9JHtnZXRPcHRzLnZlcnNpb25JZH1gXG4gICAgfVxuICAgIGNvbnN0IHJlcXVlc3RPcHRpb25zOiBSZXF1ZXN0T3B0aW9uID0geyBtZXRob2QsIGJ1Y2tldE5hbWUsIHF1ZXJ5IH1cbiAgICBpZiAob2JqZWN0TmFtZSkge1xuICAgICAgcmVxdWVzdE9wdGlvbnNbJ29iamVjdE5hbWUnXSA9IG9iamVjdE5hbWVcbiAgICB9XG5cbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luYyhyZXF1ZXN0T3B0aW9ucylcbiAgICBjb25zdCBib2R5ID0gYXdhaXQgcmVhZEFzU3RyaW5nKHJlc3BvbnNlKVxuICAgIHJldHVybiB4bWxQYXJzZXJzLnBhcnNlVGFnZ2luZyhib2R5KVxuICB9XG5cbiAgLyoqXG4gICAqICBTZXQgdGhlIHBvbGljeSBvbiBhIGJ1Y2tldCBvciBhbiBvYmplY3QgcHJlZml4LlxuICAgKi9cbiAgYXN5bmMgc2V0QnVja2V0UG9saWN5KGJ1Y2tldE5hbWU6IHN0cmluZywgcG9saWN5OiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAvLyBWYWxpZGF0ZSBhcmd1bWVudHMuXG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKGBJbnZhbGlkIGJ1Y2tldCBuYW1lOiAke2J1Y2tldE5hbWV9YClcbiAgICB9XG4gICAgaWYgKCFpc1N0cmluZyhwb2xpY3kpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXRQb2xpY3lFcnJvcihgSW52YWxpZCBidWNrZXQgcG9saWN5OiAke3BvbGljeX0gLSBtdXN0IGJlIFwic3RyaW5nXCJgKVxuICAgIH1cblxuICAgIGNvbnN0IHF1ZXJ5ID0gJ3BvbGljeSdcblxuICAgIGxldCBtZXRob2QgPSAnREVMRVRFJ1xuICAgIGlmIChwb2xpY3kpIHtcbiAgICAgIG1ldGhvZCA9ICdQVVQnXG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jT21pdCh7IG1ldGhvZCwgYnVja2V0TmFtZSwgcXVlcnkgfSwgcG9saWN5LCBbMjA0XSwgJycpXG4gIH1cblxuICAvKipcbiAgICogR2V0IHRoZSBwb2xpY3kgb24gYSBidWNrZXQgb3IgYW4gb2JqZWN0IHByZWZpeC5cbiAgICovXG4gIGFzeW5jIGdldEJ1Y2tldFBvbGljeShidWNrZXROYW1lOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZz4ge1xuICAgIC8vIFZhbGlkYXRlIGFyZ3VtZW50cy5cbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoYEludmFsaWQgYnVja2V0IG5hbWU6ICR7YnVja2V0TmFtZX1gKVxuICAgIH1cblxuICAgIGNvbnN0IG1ldGhvZCA9ICdHRVQnXG4gICAgY29uc3QgcXVlcnkgPSAncG9saWN5J1xuICAgIGNvbnN0IHJlcyA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luYyh7IG1ldGhvZCwgYnVja2V0TmFtZSwgcXVlcnkgfSlcbiAgICByZXR1cm4gYXdhaXQgcmVhZEFzU3RyaW5nKHJlcylcbiAgfVxuXG4gIGFzeW5jIHB1dE9iamVjdFJldGVudGlvbihidWNrZXROYW1lOiBzdHJpbmcsIG9iamVjdE5hbWU6IHN0cmluZywgcmV0ZW50aW9uT3B0czogUmV0ZW50aW9uID0ge30pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoYEludmFsaWQgYnVja2V0IG5hbWU6ICR7YnVja2V0TmFtZX1gKVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRPYmplY3ROYW1lRXJyb3IoYEludmFsaWQgb2JqZWN0IG5hbWU6ICR7b2JqZWN0TmFtZX1gKVxuICAgIH1cbiAgICBpZiAoIWlzT2JqZWN0KHJldGVudGlvbk9wdHMpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCdyZXRlbnRpb25PcHRzIHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxuICAgIH0gZWxzZSB7XG4gICAgICBpZiAocmV0ZW50aW9uT3B0cy5nb3Zlcm5hbmNlQnlwYXNzICYmICFpc0Jvb2xlYW4ocmV0ZW50aW9uT3B0cy5nb3Zlcm5hbmNlQnlwYXNzKSkge1xuICAgICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKGBJbnZhbGlkIHZhbHVlIGZvciBnb3Zlcm5hbmNlQnlwYXNzOiAke3JldGVudGlvbk9wdHMuZ292ZXJuYW5jZUJ5cGFzc31gKVxuICAgICAgfVxuICAgICAgaWYgKFxuICAgICAgICByZXRlbnRpb25PcHRzLm1vZGUgJiZcbiAgICAgICAgIVtSRVRFTlRJT05fTU9ERVMuQ09NUExJQU5DRSwgUkVURU5USU9OX01PREVTLkdPVkVSTkFOQ0VdLmluY2x1ZGVzKHJldGVudGlvbk9wdHMubW9kZSlcbiAgICAgICkge1xuICAgICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKGBJbnZhbGlkIG9iamVjdCByZXRlbnRpb24gbW9kZTogJHtyZXRlbnRpb25PcHRzLm1vZGV9YClcbiAgICAgIH1cbiAgICAgIGlmIChyZXRlbnRpb25PcHRzLnJldGFpblVudGlsRGF0ZSAmJiAhaXNTdHJpbmcocmV0ZW50aW9uT3B0cy5yZXRhaW5VbnRpbERhdGUpKSB7XG4gICAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoYEludmFsaWQgdmFsdWUgZm9yIHJldGFpblVudGlsRGF0ZTogJHtyZXRlbnRpb25PcHRzLnJldGFpblVudGlsRGF0ZX1gKVxuICAgICAgfVxuICAgICAgaWYgKHJldGVudGlvbk9wdHMudmVyc2lvbklkICYmICFpc1N0cmluZyhyZXRlbnRpb25PcHRzLnZlcnNpb25JZCkpIHtcbiAgICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcihgSW52YWxpZCB2YWx1ZSBmb3IgdmVyc2lvbklkOiAke3JldGVudGlvbk9wdHMudmVyc2lvbklkfWApXG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3QgbWV0aG9kID0gJ1BVVCdcbiAgICBsZXQgcXVlcnkgPSAncmV0ZW50aW9uJ1xuXG4gICAgY29uc3QgaGVhZGVyczogUmVxdWVzdEhlYWRlcnMgPSB7fVxuICAgIGlmIChyZXRlbnRpb25PcHRzLmdvdmVybmFuY2VCeXBhc3MpIHtcbiAgICAgIGhlYWRlcnNbJ1gtQW16LUJ5cGFzcy1Hb3Zlcm5hbmNlLVJldGVudGlvbiddID0gdHJ1ZVxuICAgIH1cblxuICAgIGNvbnN0IGJ1aWxkZXIgPSBuZXcgeG1sMmpzLkJ1aWxkZXIoeyByb290TmFtZTogJ1JldGVudGlvbicsIHJlbmRlck9wdHM6IHsgcHJldHR5OiBmYWxzZSB9LCBoZWFkbGVzczogdHJ1ZSB9KVxuICAgIGNvbnN0IHBhcmFtczogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHt9XG5cbiAgICBpZiAocmV0ZW50aW9uT3B0cy5tb2RlKSB7XG4gICAgICBwYXJhbXMuTW9kZSA9IHJldGVudGlvbk9wdHMubW9kZVxuICAgIH1cbiAgICBpZiAocmV0ZW50aW9uT3B0cy5yZXRhaW5VbnRpbERhdGUpIHtcbiAgICAgIHBhcmFtcy5SZXRhaW5VbnRpbERhdGUgPSByZXRlbnRpb25PcHRzLnJldGFpblVudGlsRGF0ZVxuICAgIH1cbiAgICBpZiAocmV0ZW50aW9uT3B0cy52ZXJzaW9uSWQpIHtcbiAgICAgIHF1ZXJ5ICs9IGAmdmVyc2lvbklkPSR7cmV0ZW50aW9uT3B0cy52ZXJzaW9uSWR9YFxuICAgIH1cblxuICAgIGNvbnN0IHBheWxvYWQgPSBidWlsZGVyLmJ1aWxkT2JqZWN0KHBhcmFtcylcblxuICAgIGhlYWRlcnNbJ0NvbnRlbnQtTUQ1J10gPSB0b01kNShwYXlsb2FkKVxuICAgIGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luY09taXQoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIHF1ZXJ5LCBoZWFkZXJzIH0sIHBheWxvYWQsIFsyMDAsIDIwNF0pXG4gIH1cblxuICBnZXRPYmplY3RMb2NrQ29uZmlnKGJ1Y2tldE5hbWU6IHN0cmluZywgY2FsbGJhY2s6IFJlc3VsdENhbGxiYWNrPE9iamVjdExvY2tJbmZvPik6IHZvaWRcbiAgZ2V0T2JqZWN0TG9ja0NvbmZpZyhidWNrZXROYW1lOiBzdHJpbmcpOiB2b2lkXG4gIGFzeW5jIGdldE9iamVjdExvY2tDb25maWcoYnVja2V0TmFtZTogc3RyaW5nKTogUHJvbWlzZTxPYmplY3RMb2NrSW5mbz5cbiAgYXN5bmMgZ2V0T2JqZWN0TG9ja0NvbmZpZyhidWNrZXROYW1lOiBzdHJpbmcpIHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBjb25zdCBtZXRob2QgPSAnR0VUJ1xuICAgIGNvbnN0IHF1ZXJ5ID0gJ29iamVjdC1sb2NrJ1xuXG4gICAgY29uc3QgaHR0cFJlcyA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luYyh7IG1ldGhvZCwgYnVja2V0TmFtZSwgcXVlcnkgfSlcbiAgICBjb25zdCB4bWxSZXN1bHQgPSBhd2FpdCByZWFkQXNTdHJpbmcoaHR0cFJlcylcbiAgICByZXR1cm4geG1sUGFyc2Vycy5wYXJzZU9iamVjdExvY2tDb25maWcoeG1sUmVzdWx0KVxuICB9XG5cbiAgc2V0T2JqZWN0TG9ja0NvbmZpZyhidWNrZXROYW1lOiBzdHJpbmcsIGxvY2tDb25maWdPcHRzOiBPbWl0PE9iamVjdExvY2tJbmZvLCAnb2JqZWN0TG9ja0VuYWJsZWQnPik6IHZvaWRcbiAgYXN5bmMgc2V0T2JqZWN0TG9ja0NvbmZpZyhcbiAgICBidWNrZXROYW1lOiBzdHJpbmcsXG4gICAgbG9ja0NvbmZpZ09wdHM6IE9taXQ8T2JqZWN0TG9ja0luZm8sICdvYmplY3RMb2NrRW5hYmxlZCc+LFxuICApOiBQcm9taXNlPHZvaWQ+XG4gIGFzeW5jIHNldE9iamVjdExvY2tDb25maWcoYnVja2V0TmFtZTogc3RyaW5nLCBsb2NrQ29uZmlnT3B0czogT21pdDxPYmplY3RMb2NrSW5mbywgJ29iamVjdExvY2tFbmFibGVkJz4pIHtcbiAgICBjb25zdCByZXRlbnRpb25Nb2RlcyA9IFtSRVRFTlRJT05fTU9ERVMuQ09NUExJQU5DRSwgUkVURU5USU9OX01PREVTLkdPVkVSTkFOQ0VdXG4gICAgY29uc3QgdmFsaWRVbml0cyA9IFtSRVRFTlRJT05fVkFMSURJVFlfVU5JVFMuREFZUywgUkVURU5USU9OX1ZBTElESVRZX1VOSVRTLllFQVJTXVxuXG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG5cbiAgICBpZiAobG9ja0NvbmZpZ09wdHMubW9kZSAmJiAhcmV0ZW50aW9uTW9kZXMuaW5jbHVkZXMobG9ja0NvbmZpZ09wdHMubW9kZSkpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoYGxvY2tDb25maWdPcHRzLm1vZGUgc2hvdWxkIGJlIG9uZSBvZiAke3JldGVudGlvbk1vZGVzfWApXG4gICAgfVxuICAgIGlmIChsb2NrQ29uZmlnT3B0cy51bml0ICYmICF2YWxpZFVuaXRzLmluY2x1ZGVzKGxvY2tDb25maWdPcHRzLnVuaXQpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKGBsb2NrQ29uZmlnT3B0cy51bml0IHNob3VsZCBiZSBvbmUgb2YgJHt2YWxpZFVuaXRzfWApXG4gICAgfVxuICAgIGlmIChsb2NrQ29uZmlnT3B0cy52YWxpZGl0eSAmJiAhaXNOdW1iZXIobG9ja0NvbmZpZ09wdHMudmFsaWRpdHkpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKGBsb2NrQ29uZmlnT3B0cy52YWxpZGl0eSBzaG91bGQgYmUgYSBudW1iZXJgKVxuICAgIH1cblxuICAgIGNvbnN0IG1ldGhvZCA9ICdQVVQnXG4gICAgY29uc3QgcXVlcnkgPSAnb2JqZWN0LWxvY2snXG5cbiAgICBjb25zdCBjb25maWc6IE9iamVjdExvY2tDb25maWdQYXJhbSA9IHtcbiAgICAgIE9iamVjdExvY2tFbmFibGVkOiAnRW5hYmxlZCcsXG4gICAgfVxuICAgIGNvbnN0IGNvbmZpZ0tleXMgPSBPYmplY3Qua2V5cyhsb2NrQ29uZmlnT3B0cylcblxuICAgIGNvbnN0IGlzQWxsS2V5c1NldCA9IFsndW5pdCcsICdtb2RlJywgJ3ZhbGlkaXR5J10uZXZlcnkoKGxjaykgPT4gY29uZmlnS2V5cy5pbmNsdWRlcyhsY2spKVxuICAgIC8vIENoZWNrIGlmIGtleXMgYXJlIHByZXNlbnQgYW5kIGFsbCBrZXlzIGFyZSBwcmVzZW50LlxuICAgIGlmIChjb25maWdLZXlzLmxlbmd0aCA+IDApIHtcbiAgICAgIGlmICghaXNBbGxLZXlzU2V0KSB7XG4gICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoXG4gICAgICAgICAgYGxvY2tDb25maWdPcHRzLm1vZGUsbG9ja0NvbmZpZ09wdHMudW5pdCxsb2NrQ29uZmlnT3B0cy52YWxpZGl0eSBhbGwgdGhlIHByb3BlcnRpZXMgc2hvdWxkIGJlIHNwZWNpZmllZC5gLFxuICAgICAgICApXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjb25maWcuUnVsZSA9IHtcbiAgICAgICAgICBEZWZhdWx0UmV0ZW50aW9uOiB7fSxcbiAgICAgICAgfVxuICAgICAgICBpZiAobG9ja0NvbmZpZ09wdHMubW9kZSkge1xuICAgICAgICAgIGNvbmZpZy5SdWxlLkRlZmF1bHRSZXRlbnRpb24uTW9kZSA9IGxvY2tDb25maWdPcHRzLm1vZGVcbiAgICAgICAgfVxuICAgICAgICBpZiAobG9ja0NvbmZpZ09wdHMudW5pdCA9PT0gUkVURU5USU9OX1ZBTElESVRZX1VOSVRTLkRBWVMpIHtcbiAgICAgICAgICBjb25maWcuUnVsZS5EZWZhdWx0UmV0ZW50aW9uLkRheXMgPSBsb2NrQ29uZmlnT3B0cy52YWxpZGl0eVxuICAgICAgICB9IGVsc2UgaWYgKGxvY2tDb25maWdPcHRzLnVuaXQgPT09IFJFVEVOVElPTl9WQUxJRElUWV9VTklUUy5ZRUFSUykge1xuICAgICAgICAgIGNvbmZpZy5SdWxlLkRlZmF1bHRSZXRlbnRpb24uWWVhcnMgPSBsb2NrQ29uZmlnT3B0cy52YWxpZGl0eVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3QgYnVpbGRlciA9IG5ldyB4bWwyanMuQnVpbGRlcih7XG4gICAgICByb290TmFtZTogJ09iamVjdExvY2tDb25maWd1cmF0aW9uJyxcbiAgICAgIHJlbmRlck9wdHM6IHsgcHJldHR5OiBmYWxzZSB9LFxuICAgICAgaGVhZGxlc3M6IHRydWUsXG4gICAgfSlcbiAgICBjb25zdCBwYXlsb2FkID0gYnVpbGRlci5idWlsZE9iamVjdChjb25maWcpXG5cbiAgICBjb25zdCBoZWFkZXJzOiBSZXF1ZXN0SGVhZGVycyA9IHt9XG4gICAgaGVhZGVyc1snQ29udGVudC1NRDUnXSA9IHRvTWQ1KHBheWxvYWQpXG5cbiAgICBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmNPbWl0KHsgbWV0aG9kLCBidWNrZXROYW1lLCBxdWVyeSwgaGVhZGVycyB9LCBwYXlsb2FkKVxuICB9XG5cbiAgYXN5bmMgZ2V0QnVja2V0VmVyc2lvbmluZyhidWNrZXROYW1lOiBzdHJpbmcpOiBQcm9taXNlPEJ1Y2tldFZlcnNpb25pbmdDb25maWd1cmF0aW9uPiB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgY29uc3QgbWV0aG9kID0gJ0dFVCdcbiAgICBjb25zdCBxdWVyeSA9ICd2ZXJzaW9uaW5nJ1xuXG4gICAgY29uc3QgaHR0cFJlcyA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luYyh7IG1ldGhvZCwgYnVja2V0TmFtZSwgcXVlcnkgfSlcbiAgICBjb25zdCB4bWxSZXN1bHQgPSBhd2FpdCByZWFkQXNTdHJpbmcoaHR0cFJlcylcbiAgICByZXR1cm4gYXdhaXQgeG1sUGFyc2Vycy5wYXJzZUJ1Y2tldFZlcnNpb25pbmdDb25maWcoeG1sUmVzdWx0KVxuICB9XG5cbiAgYXN5bmMgc2V0QnVja2V0VmVyc2lvbmluZyhidWNrZXROYW1lOiBzdHJpbmcsIHZlcnNpb25Db25maWc6IEJ1Y2tldFZlcnNpb25pbmdDb25maWd1cmF0aW9uKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFPYmplY3Qua2V5cyh2ZXJzaW9uQ29uZmlnKS5sZW5ndGgpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ3ZlcnNpb25Db25maWcgc2hvdWxkIGJlIG9mIHR5cGUgXCJvYmplY3RcIicpXG4gICAgfVxuXG4gICAgY29uc3QgbWV0aG9kID0gJ1BVVCdcbiAgICBjb25zdCBxdWVyeSA9ICd2ZXJzaW9uaW5nJ1xuICAgIGNvbnN0IGJ1aWxkZXIgPSBuZXcgeG1sMmpzLkJ1aWxkZXIoe1xuICAgICAgcm9vdE5hbWU6ICdWZXJzaW9uaW5nQ29uZmlndXJhdGlvbicsXG4gICAgICByZW5kZXJPcHRzOiB7IHByZXR0eTogZmFsc2UgfSxcbiAgICAgIGhlYWRsZXNzOiB0cnVlLFxuICAgIH0pXG4gICAgY29uc3QgcGF5bG9hZCA9IGJ1aWxkZXIuYnVpbGRPYmplY3QodmVyc2lvbkNvbmZpZylcblxuICAgIGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luY09taXQoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIHF1ZXJ5IH0sIHBheWxvYWQpXG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHNldFRhZ2dpbmcodGFnZ2luZ1BhcmFtczogUHV0VGFnZ2luZ1BhcmFtcyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHsgYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgdGFncywgcHV0T3B0cyB9ID0gdGFnZ2luZ1BhcmFtc1xuICAgIGNvbnN0IG1ldGhvZCA9ICdQVVQnXG4gICAgbGV0IHF1ZXJ5ID0gJ3RhZ2dpbmcnXG5cbiAgICBpZiAocHV0T3B0cyAmJiBwdXRPcHRzPy52ZXJzaW9uSWQpIHtcbiAgICAgIHF1ZXJ5ID0gYCR7cXVlcnl9JnZlcnNpb25JZD0ke3B1dE9wdHMudmVyc2lvbklkfWBcbiAgICB9XG4gICAgY29uc3QgdGFnc0xpc3QgPSBbXVxuICAgIGZvciAoY29uc3QgW2tleSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKHRhZ3MpKSB7XG4gICAgICB0YWdzTGlzdC5wdXNoKHsgS2V5OiBrZXksIFZhbHVlOiB2YWx1ZSB9KVxuICAgIH1cbiAgICBjb25zdCB0YWdnaW5nQ29uZmlnID0ge1xuICAgICAgVGFnZ2luZzoge1xuICAgICAgICBUYWdTZXQ6IHtcbiAgICAgICAgICBUYWc6IHRhZ3NMaXN0LFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICB9XG4gICAgY29uc3QgaGVhZGVycyA9IHt9IGFzIFJlcXVlc3RIZWFkZXJzXG4gICAgY29uc3QgYnVpbGRlciA9IG5ldyB4bWwyanMuQnVpbGRlcih7IGhlYWRsZXNzOiB0cnVlLCByZW5kZXJPcHRzOiB7IHByZXR0eTogZmFsc2UgfSB9KVxuICAgIGNvbnN0IHBheWxvYWRCdWYgPSBCdWZmZXIuZnJvbShidWlsZGVyLmJ1aWxkT2JqZWN0KHRhZ2dpbmdDb25maWcpKVxuICAgIGNvbnN0IHJlcXVlc3RPcHRpb25zID0ge1xuICAgICAgbWV0aG9kLFxuICAgICAgYnVja2V0TmFtZSxcbiAgICAgIHF1ZXJ5LFxuICAgICAgaGVhZGVycyxcblxuICAgICAgLi4uKG9iamVjdE5hbWUgJiYgeyBvYmplY3ROYW1lOiBvYmplY3ROYW1lIH0pLFxuICAgIH1cblxuICAgIGhlYWRlcnNbJ0NvbnRlbnQtTUQ1J10gPSB0b01kNShwYXlsb2FkQnVmKVxuXG4gICAgYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jT21pdChyZXF1ZXN0T3B0aW9ucywgcGF5bG9hZEJ1ZilcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcmVtb3ZlVGFnZ2luZyh7IGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIHJlbW92ZU9wdHMgfTogUmVtb3ZlVGFnZ2luZ1BhcmFtcyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IG1ldGhvZCA9ICdERUxFVEUnXG4gICAgbGV0IHF1ZXJ5ID0gJ3RhZ2dpbmcnXG5cbiAgICBpZiAocmVtb3ZlT3B0cyAmJiBPYmplY3Qua2V5cyhyZW1vdmVPcHRzKS5sZW5ndGggJiYgcmVtb3ZlT3B0cy52ZXJzaW9uSWQpIHtcbiAgICAgIHF1ZXJ5ID0gYCR7cXVlcnl9JnZlcnNpb25JZD0ke3JlbW92ZU9wdHMudmVyc2lvbklkfWBcbiAgICB9XG4gICAgY29uc3QgcmVxdWVzdE9wdGlvbnMgPSB7IG1ldGhvZCwgYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgcXVlcnkgfVxuXG4gICAgaWYgKG9iamVjdE5hbWUpIHtcbiAgICAgIHJlcXVlc3RPcHRpb25zWydvYmplY3ROYW1lJ10gPSBvYmplY3ROYW1lXG4gICAgfVxuICAgIGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luYyhyZXF1ZXN0T3B0aW9ucywgJycsIFsyMDAsIDIwNF0pXG4gIH1cblxuICBhc3luYyBzZXRCdWNrZXRUYWdnaW5nKGJ1Y2tldE5hbWU6IHN0cmluZywgdGFnczogVGFncyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmICghaXNQbGFpbk9iamVjdCh0YWdzKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcigndGFncyBzaG91bGQgYmUgb2YgdHlwZSBcIm9iamVjdFwiJylcbiAgICB9XG4gICAgaWYgKE9iamVjdC5rZXlzKHRhZ3MpLmxlbmd0aCA+IDEwKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCdtYXhpbXVtIHRhZ3MgYWxsb3dlZCBpcyAxMFwiJylcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLnNldFRhZ2dpbmcoeyBidWNrZXROYW1lLCB0YWdzIH0pXG4gIH1cblxuICBhc3luYyByZW1vdmVCdWNrZXRUYWdnaW5nKGJ1Y2tldE5hbWU6IHN0cmluZykge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGF3YWl0IHRoaXMucmVtb3ZlVGFnZ2luZyh7IGJ1Y2tldE5hbWUgfSlcbiAgfVxuXG4gIGFzeW5jIHNldE9iamVjdFRhZ2dpbmcoYnVja2V0TmFtZTogc3RyaW5nLCBvYmplY3ROYW1lOiBzdHJpbmcsIHRhZ3M6IFRhZ3MsIHB1dE9wdHM/OiBUYWdnaW5nT3B0cykge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmICghaXNWYWxpZE9iamVjdE5hbWUob2JqZWN0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBvYmplY3QgbmFtZTogJyArIG9iamVjdE5hbWUpXG4gICAgfVxuXG4gICAgaWYgKCFpc1BsYWluT2JqZWN0KHRhZ3MpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCd0YWdzIHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxuICAgIH1cbiAgICBpZiAoT2JqZWN0LmtleXModGFncykubGVuZ3RoID4gMTApIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ01heGltdW0gdGFncyBhbGxvd2VkIGlzIDEwXCInKVxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuc2V0VGFnZ2luZyh7IGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIHRhZ3MsIHB1dE9wdHMgfSlcbiAgfVxuXG4gIGFzeW5jIHJlbW92ZU9iamVjdFRhZ2dpbmcoYnVja2V0TmFtZTogc3RyaW5nLCBvYmplY3ROYW1lOiBzdHJpbmcsIHJlbW92ZU9wdHM6IFRhZ2dpbmdPcHRzKSB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIG9iamVjdCBuYW1lOiAnICsgb2JqZWN0TmFtZSlcbiAgICB9XG4gICAgaWYgKHJlbW92ZU9wdHMgJiYgT2JqZWN0LmtleXMocmVtb3ZlT3B0cykubGVuZ3RoICYmICFpc09iamVjdChyZW1vdmVPcHRzKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcigncmVtb3ZlT3B0cyBzaG91bGQgYmUgb2YgdHlwZSBcIm9iamVjdFwiJylcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLnJlbW92ZVRhZ2dpbmcoeyBidWNrZXROYW1lLCBvYmplY3ROYW1lLCByZW1vdmVPcHRzIH0pXG4gIH1cblxuICBhc3luYyBzZWxlY3RPYmplY3RDb250ZW50KFxuICAgIGJ1Y2tldE5hbWU6IHN0cmluZyxcbiAgICBvYmplY3ROYW1lOiBzdHJpbmcsXG4gICAgc2VsZWN0T3B0czogU2VsZWN0T3B0aW9ucyxcbiAgKTogUHJvbWlzZTxTZWxlY3RSZXN1bHRzIHwgdW5kZWZpbmVkPiB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKGBJbnZhbGlkIGJ1Y2tldCBuYW1lOiAke2J1Y2tldE5hbWV9YClcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkT2JqZWN0TmFtZUVycm9yKGBJbnZhbGlkIG9iamVjdCBuYW1lOiAke29iamVjdE5hbWV9YClcbiAgICB9XG4gICAgaWYgKCFfLmlzRW1wdHkoc2VsZWN0T3B0cykpIHtcbiAgICAgIGlmICghaXNTdHJpbmcoc2VsZWN0T3B0cy5leHByZXNzaW9uKSkge1xuICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdzcWxFeHByZXNzaW9uIHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCInKVxuICAgICAgfVxuICAgICAgaWYgKCFfLmlzRW1wdHkoc2VsZWN0T3B0cy5pbnB1dFNlcmlhbGl6YXRpb24pKSB7XG4gICAgICAgIGlmICghaXNPYmplY3Qoc2VsZWN0T3B0cy5pbnB1dFNlcmlhbGl6YXRpb24pKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignaW5wdXRTZXJpYWxpemF0aW9uIHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdpbnB1dFNlcmlhbGl6YXRpb24gaXMgcmVxdWlyZWQnKVxuICAgICAgfVxuICAgICAgaWYgKCFfLmlzRW1wdHkoc2VsZWN0T3B0cy5vdXRwdXRTZXJpYWxpemF0aW9uKSkge1xuICAgICAgICBpZiAoIWlzT2JqZWN0KHNlbGVjdE9wdHMub3V0cHV0U2VyaWFsaXphdGlvbikpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdvdXRwdXRTZXJpYWxpemF0aW9uIHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdvdXRwdXRTZXJpYWxpemF0aW9uIGlzIHJlcXVpcmVkJylcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigndmFsaWQgc2VsZWN0IGNvbmZpZ3VyYXRpb24gaXMgcmVxdWlyZWQnKVxuICAgIH1cblxuICAgIGNvbnN0IG1ldGhvZCA9ICdQT1NUJ1xuICAgIGNvbnN0IHF1ZXJ5ID0gYHNlbGVjdCZzZWxlY3QtdHlwZT0yYFxuXG4gICAgY29uc3QgY29uZmlnOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPltdID0gW1xuICAgICAge1xuICAgICAgICBFeHByZXNzaW9uOiBzZWxlY3RPcHRzLmV4cHJlc3Npb24sXG4gICAgICB9LFxuICAgICAge1xuICAgICAgICBFeHByZXNzaW9uVHlwZTogc2VsZWN0T3B0cy5leHByZXNzaW9uVHlwZSB8fCAnU1FMJyxcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIElucHV0U2VyaWFsaXphdGlvbjogW3NlbGVjdE9wdHMuaW5wdXRTZXJpYWxpemF0aW9uXSxcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIE91dHB1dFNlcmlhbGl6YXRpb246IFtzZWxlY3RPcHRzLm91dHB1dFNlcmlhbGl6YXRpb25dLFxuICAgICAgfSxcbiAgICBdXG5cbiAgICAvLyBPcHRpb25hbFxuICAgIGlmIChzZWxlY3RPcHRzLnJlcXVlc3RQcm9ncmVzcykge1xuICAgICAgY29uZmlnLnB1c2goeyBSZXF1ZXN0UHJvZ3Jlc3M6IHNlbGVjdE9wdHM/LnJlcXVlc3RQcm9ncmVzcyB9KVxuICAgIH1cbiAgICAvLyBPcHRpb25hbFxuICAgIGlmIChzZWxlY3RPcHRzLnNjYW5SYW5nZSkge1xuICAgICAgY29uZmlnLnB1c2goeyBTY2FuUmFuZ2U6IHNlbGVjdE9wdHMuc2NhblJhbmdlIH0pXG4gICAgfVxuXG4gICAgY29uc3QgYnVpbGRlciA9IG5ldyB4bWwyanMuQnVpbGRlcih7XG4gICAgICByb290TmFtZTogJ1NlbGVjdE9iamVjdENvbnRlbnRSZXF1ZXN0JyxcbiAgICAgIHJlbmRlck9wdHM6IHsgcHJldHR5OiBmYWxzZSB9LFxuICAgICAgaGVhZGxlc3M6IHRydWUsXG4gICAgfSlcbiAgICBjb25zdCBwYXlsb2FkID0gYnVpbGRlci5idWlsZE9iamVjdChjb25maWcpXG5cbiAgICBjb25zdCByZXMgPSBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmMoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUsIHF1ZXJ5IH0sIHBheWxvYWQpXG4gICAgY29uc3QgYm9keSA9IGF3YWl0IHJlYWRBc0J1ZmZlcihyZXMpXG4gICAgcmV0dXJuIHBhcnNlU2VsZWN0T2JqZWN0Q29udGVudFJlc3BvbnNlKGJvZHkpXG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGFwcGx5QnVja2V0TGlmZWN5Y2xlKGJ1Y2tldE5hbWU6IHN0cmluZywgcG9saWN5Q29uZmlnOiBMaWZlQ3ljbGVDb25maWdQYXJhbSk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IG1ldGhvZCA9ICdQVVQnXG4gICAgY29uc3QgcXVlcnkgPSAnbGlmZWN5Y2xlJ1xuXG4gICAgY29uc3QgaGVhZGVyczogUmVxdWVzdEhlYWRlcnMgPSB7fVxuICAgIGNvbnN0IGJ1aWxkZXIgPSBuZXcgeG1sMmpzLkJ1aWxkZXIoe1xuICAgICAgcm9vdE5hbWU6ICdMaWZlY3ljbGVDb25maWd1cmF0aW9uJyxcbiAgICAgIGhlYWRsZXNzOiB0cnVlLFxuICAgICAgcmVuZGVyT3B0czogeyBwcmV0dHk6IGZhbHNlIH0sXG4gICAgfSlcbiAgICBjb25zdCBwYXlsb2FkID0gYnVpbGRlci5idWlsZE9iamVjdChwb2xpY3lDb25maWcpXG4gICAgaGVhZGVyc1snQ29udGVudC1NRDUnXSA9IHRvTWQ1KHBheWxvYWQpXG5cbiAgICBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmNPbWl0KHsgbWV0aG9kLCBidWNrZXROYW1lLCBxdWVyeSwgaGVhZGVycyB9LCBwYXlsb2FkKVxuICB9XG5cbiAgYXN5bmMgcmVtb3ZlQnVja2V0TGlmZWN5Y2xlKGJ1Y2tldE5hbWU6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGNvbnN0IG1ldGhvZCA9ICdERUxFVEUnXG4gICAgY29uc3QgcXVlcnkgPSAnbGlmZWN5Y2xlJ1xuICAgIGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luY09taXQoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIHF1ZXJ5IH0sICcnLCBbMjA0XSlcbiAgfVxuXG4gIGFzeW5jIHNldEJ1Y2tldExpZmVjeWNsZShidWNrZXROYW1lOiBzdHJpbmcsIGxpZmVDeWNsZUNvbmZpZzogTGlmZUN5Y2xlQ29uZmlnUGFyYW0pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoXy5pc0VtcHR5KGxpZmVDeWNsZUNvbmZpZykpIHtcbiAgICAgIGF3YWl0IHRoaXMucmVtb3ZlQnVja2V0TGlmZWN5Y2xlKGJ1Y2tldE5hbWUpXG4gICAgfSBlbHNlIHtcbiAgICAgIGF3YWl0IHRoaXMuYXBwbHlCdWNrZXRMaWZlY3ljbGUoYnVja2V0TmFtZSwgbGlmZUN5Y2xlQ29uZmlnKVxuICAgIH1cbiAgfVxuXG4gIGFzeW5jIGdldEJ1Y2tldExpZmVjeWNsZShidWNrZXROYW1lOiBzdHJpbmcpOiBQcm9taXNlPExpZmVjeWNsZUNvbmZpZyB8IG51bGw+IHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBjb25zdCBtZXRob2QgPSAnR0VUJ1xuICAgIGNvbnN0IHF1ZXJ5ID0gJ2xpZmVjeWNsZSdcblxuICAgIGNvbnN0IHJlcyA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luYyh7IG1ldGhvZCwgYnVja2V0TmFtZSwgcXVlcnkgfSlcbiAgICBjb25zdCBib2R5ID0gYXdhaXQgcmVhZEFzU3RyaW5nKHJlcylcbiAgICByZXR1cm4geG1sUGFyc2Vycy5wYXJzZUxpZmVjeWNsZUNvbmZpZyhib2R5KVxuICB9XG5cbiAgYXN5bmMgc2V0QnVja2V0RW5jcnlwdGlvbihidWNrZXROYW1lOiBzdHJpbmcsIGVuY3J5cHRpb25Db25maWc/OiBFbmNyeXB0aW9uQ29uZmlnKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFfLmlzRW1wdHkoZW5jcnlwdGlvbkNvbmZpZykgJiYgZW5jcnlwdGlvbkNvbmZpZy5SdWxlLmxlbmd0aCA+IDEpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ0ludmFsaWQgUnVsZSBsZW5ndGguIE9ubHkgb25lIHJ1bGUgaXMgYWxsb3dlZC46ICcgKyBlbmNyeXB0aW9uQ29uZmlnLlJ1bGUpXG4gICAgfVxuXG4gICAgbGV0IGVuY3J5cHRpb25PYmogPSBlbmNyeXB0aW9uQ29uZmlnXG4gICAgaWYgKF8uaXNFbXB0eShlbmNyeXB0aW9uQ29uZmlnKSkge1xuICAgICAgZW5jcnlwdGlvbk9iaiA9IHtcbiAgICAgICAgLy8gRGVmYXVsdCBNaW5JTyBTZXJ2ZXIgU3VwcG9ydGVkIFJ1bGVcbiAgICAgICAgUnVsZTogW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIEFwcGx5U2VydmVyU2lkZUVuY3J5cHRpb25CeURlZmF1bHQ6IHtcbiAgICAgICAgICAgICAgU1NFQWxnb3JpdGhtOiAnQUVTMjU2JyxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgXSxcbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCBtZXRob2QgPSAnUFVUJ1xuICAgIGNvbnN0IHF1ZXJ5ID0gJ2VuY3J5cHRpb24nXG4gICAgY29uc3QgYnVpbGRlciA9IG5ldyB4bWwyanMuQnVpbGRlcih7XG4gICAgICByb290TmFtZTogJ1NlcnZlclNpZGVFbmNyeXB0aW9uQ29uZmlndXJhdGlvbicsXG4gICAgICByZW5kZXJPcHRzOiB7IHByZXR0eTogZmFsc2UgfSxcbiAgICAgIGhlYWRsZXNzOiB0cnVlLFxuICAgIH0pXG4gICAgY29uc3QgcGF5bG9hZCA9IGJ1aWxkZXIuYnVpbGRPYmplY3QoZW5jcnlwdGlvbk9iailcblxuICAgIGNvbnN0IGhlYWRlcnM6IFJlcXVlc3RIZWFkZXJzID0ge31cbiAgICBoZWFkZXJzWydDb250ZW50LU1ENSddID0gdG9NZDUocGF5bG9hZClcblxuICAgIGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luY09taXQoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIHF1ZXJ5LCBoZWFkZXJzIH0sIHBheWxvYWQpXG4gIH1cblxuICBhc3luYyBnZXRCdWNrZXRFbmNyeXB0aW9uKGJ1Y2tldE5hbWU6IHN0cmluZykge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGNvbnN0IG1ldGhvZCA9ICdHRVQnXG4gICAgY29uc3QgcXVlcnkgPSAnZW5jcnlwdGlvbidcblxuICAgIGNvbnN0IHJlcyA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luYyh7IG1ldGhvZCwgYnVja2V0TmFtZSwgcXVlcnkgfSlcbiAgICBjb25zdCBib2R5ID0gYXdhaXQgcmVhZEFzU3RyaW5nKHJlcylcbiAgICByZXR1cm4geG1sUGFyc2Vycy5wYXJzZUJ1Y2tldEVuY3J5cHRpb25Db25maWcoYm9keSlcbiAgfVxuXG4gIGFzeW5jIHJlbW92ZUJ1Y2tldEVuY3J5cHRpb24oYnVja2V0TmFtZTogc3RyaW5nKSB7XG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZShidWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgYnVja2V0TmFtZSlcbiAgICB9XG4gICAgY29uc3QgbWV0aG9kID0gJ0RFTEVURSdcbiAgICBjb25zdCBxdWVyeSA9ICdlbmNyeXB0aW9uJ1xuXG4gICAgYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jT21pdCh7IG1ldGhvZCwgYnVja2V0TmFtZSwgcXVlcnkgfSwgJycsIFsyMDRdKVxuICB9XG5cbiAgYXN5bmMgZ2V0T2JqZWN0UmV0ZW50aW9uKFxuICAgIGJ1Y2tldE5hbWU6IHN0cmluZyxcbiAgICBvYmplY3ROYW1lOiBzdHJpbmcsXG4gICAgZ2V0T3B0cz86IEdldE9iamVjdFJldGVudGlvbk9wdHMsXG4gICk6IFByb21pc2U8T2JqZWN0UmV0ZW50aW9uSW5mbyB8IG51bGwgfCB1bmRlZmluZWQ+IHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRPYmplY3ROYW1lRXJyb3IoYEludmFsaWQgb2JqZWN0IG5hbWU6ICR7b2JqZWN0TmFtZX1gKVxuICAgIH1cbiAgICBpZiAoZ2V0T3B0cyAmJiAhaXNPYmplY3QoZ2V0T3B0cykpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ2dldE9wdHMgc2hvdWxkIGJlIG9mIHR5cGUgXCJvYmplY3RcIicpXG4gICAgfSBlbHNlIGlmIChnZXRPcHRzPy52ZXJzaW9uSWQgJiYgIWlzU3RyaW5nKGdldE9wdHMudmVyc2lvbklkKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcigndmVyc2lvbklkIHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCInKVxuICAgIH1cblxuICAgIGNvbnN0IG1ldGhvZCA9ICdHRVQnXG4gICAgbGV0IHF1ZXJ5ID0gJ3JldGVudGlvbidcbiAgICBpZiAoZ2V0T3B0cz8udmVyc2lvbklkKSB7XG4gICAgICBxdWVyeSArPSBgJnZlcnNpb25JZD0ke2dldE9wdHMudmVyc2lvbklkfWBcbiAgICB9XG4gICAgY29uc3QgcmVzID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jKHsgbWV0aG9kLCBidWNrZXROYW1lLCBvYmplY3ROYW1lLCBxdWVyeSB9KVxuICAgIGNvbnN0IGJvZHkgPSBhd2FpdCByZWFkQXNTdHJpbmcocmVzKVxuICAgIHJldHVybiB4bWxQYXJzZXJzLnBhcnNlT2JqZWN0UmV0ZW50aW9uQ29uZmlnKGJvZHkpXG4gIH1cblxuICBhc3luYyByZW1vdmVPYmplY3RzKGJ1Y2tldE5hbWU6IHN0cmluZywgb2JqZWN0c0xpc3Q6IFJlbW92ZU9iamVjdHNQYXJhbSk6IFByb21pc2U8UmVtb3ZlT2JqZWN0c1Jlc3BvbnNlW10+IHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIUFycmF5LmlzQXJyYXkob2JqZWN0c0xpc3QpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCdvYmplY3RzTGlzdCBzaG91bGQgYmUgYSBsaXN0JylcbiAgICB9XG5cbiAgICBjb25zdCBydW5EZWxldGVPYmplY3RzID0gYXN5bmMgKGJhdGNoOiBSZW1vdmVPYmplY3RzUGFyYW0pOiBQcm9taXNlPFJlbW92ZU9iamVjdHNSZXNwb25zZVtdPiA9PiB7XG4gICAgICBjb25zdCBkZWxPYmplY3RzOiBSZW1vdmVPYmplY3RzUmVxdWVzdEVudHJ5W10gPSBiYXRjaC5tYXAoKHZhbHVlKSA9PiB7XG4gICAgICAgIHJldHVybiBpc09iamVjdCh2YWx1ZSkgPyB7IEtleTogdmFsdWUubmFtZSwgVmVyc2lvbklkOiB2YWx1ZS52ZXJzaW9uSWQgfSA6IHsgS2V5OiB2YWx1ZSB9XG4gICAgICB9KVxuXG4gICAgICBjb25zdCByZW1PYmplY3RzID0geyBEZWxldGU6IHsgUXVpZXQ6IHRydWUsIE9iamVjdDogZGVsT2JqZWN0cyB9IH1cbiAgICAgIGNvbnN0IHBheWxvYWQgPSBCdWZmZXIuZnJvbShuZXcgeG1sMmpzLkJ1aWxkZXIoeyBoZWFkbGVzczogdHJ1ZSB9KS5idWlsZE9iamVjdChyZW1PYmplY3RzKSlcbiAgICAgIGNvbnN0IGhlYWRlcnM6IFJlcXVlc3RIZWFkZXJzID0geyAnQ29udGVudC1NRDUnOiB0b01kNShwYXlsb2FkKSB9XG5cbiAgICAgIGNvbnN0IHJlcyA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luYyh7IG1ldGhvZDogJ1BPU1QnLCBidWNrZXROYW1lLCBxdWVyeTogJ2RlbGV0ZScsIGhlYWRlcnMgfSwgcGF5bG9hZClcbiAgICAgIGNvbnN0IGJvZHkgPSBhd2FpdCByZWFkQXNTdHJpbmcocmVzKVxuICAgICAgcmV0dXJuIHhtbFBhcnNlcnMucmVtb3ZlT2JqZWN0c1BhcnNlcihib2R5KVxuICAgIH1cblxuICAgIGNvbnN0IG1heEVudHJpZXMgPSAxMDAwIC8vIG1heCBlbnRyaWVzIGFjY2VwdGVkIGluIHNlcnZlciBmb3IgRGVsZXRlTXVsdGlwbGVPYmplY3RzIEFQSS5cbiAgICAvLyBDbGllbnQgc2lkZSBiYXRjaGluZ1xuICAgIGNvbnN0IGJhdGNoZXMgPSBbXVxuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgb2JqZWN0c0xpc3QubGVuZ3RoOyBpICs9IG1heEVudHJpZXMpIHtcbiAgICAgIGJhdGNoZXMucHVzaChvYmplY3RzTGlzdC5zbGljZShpLCBpICsgbWF4RW50cmllcykpXG4gICAgfVxuXG4gICAgY29uc3QgYmF0Y2hSZXN1bHRzID0gYXdhaXQgUHJvbWlzZS5hbGwoYmF0Y2hlcy5tYXAocnVuRGVsZXRlT2JqZWN0cykpXG4gICAgcmV0dXJuIGJhdGNoUmVzdWx0cy5mbGF0KClcbiAgfVxuXG4gIGFzeW5jIHJlbW92ZUluY29tcGxldGVVcGxvYWQoYnVja2V0TmFtZTogc3RyaW5nLCBvYmplY3ROYW1lOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLklzVmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRPYmplY3ROYW1lRXJyb3IoYEludmFsaWQgb2JqZWN0IG5hbWU6ICR7b2JqZWN0TmFtZX1gKVxuICAgIH1cbiAgICBjb25zdCByZW1vdmVVcGxvYWRJZCA9IGF3YWl0IHRoaXMuZmluZFVwbG9hZElkKGJ1Y2tldE5hbWUsIG9iamVjdE5hbWUpXG4gICAgY29uc3QgbWV0aG9kID0gJ0RFTEVURSdcbiAgICBjb25zdCBxdWVyeSA9IGB1cGxvYWRJZD0ke3JlbW92ZVVwbG9hZElkfWBcbiAgICBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmNPbWl0KHsgbWV0aG9kLCBidWNrZXROYW1lLCBvYmplY3ROYW1lLCBxdWVyeSB9LCAnJywgWzIwNF0pXG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGNvcHlPYmplY3RWMShcbiAgICB0YXJnZXRCdWNrZXROYW1lOiBzdHJpbmcsXG4gICAgdGFyZ2V0T2JqZWN0TmFtZTogc3RyaW5nLFxuICAgIHNvdXJjZUJ1Y2tldE5hbWVBbmRPYmplY3ROYW1lOiBzdHJpbmcsXG4gICAgY29uZGl0aW9ucz86IG51bGwgfCBDb3B5Q29uZGl0aW9ucyxcbiAgKSB7XG4gICAgaWYgKHR5cGVvZiBjb25kaXRpb25zID09ICdmdW5jdGlvbicpIHtcbiAgICAgIGNvbmRpdGlvbnMgPSBudWxsXG4gICAgfVxuXG4gICAgaWYgKCFpc1ZhbGlkQnVja2V0TmFtZSh0YXJnZXRCdWNrZXROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKCdJbnZhbGlkIGJ1Y2tldCBuYW1lOiAnICsgdGFyZ2V0QnVja2V0TmFtZSlcbiAgICB9XG4gICAgaWYgKCFpc1ZhbGlkT2JqZWN0TmFtZSh0YXJnZXRPYmplY3ROYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkT2JqZWN0TmFtZUVycm9yKGBJbnZhbGlkIG9iamVjdCBuYW1lOiAke3RhcmdldE9iamVjdE5hbWV9YClcbiAgICB9XG4gICAgaWYgKCFpc1N0cmluZyhzb3VyY2VCdWNrZXROYW1lQW5kT2JqZWN0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3NvdXJjZUJ1Y2tldE5hbWVBbmRPYmplY3ROYW1lIHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCInKVxuICAgIH1cbiAgICBpZiAoc291cmNlQnVja2V0TmFtZUFuZE9iamVjdE5hbWUgPT09ICcnKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRQcmVmaXhFcnJvcihgRW1wdHkgc291cmNlIHByZWZpeGApXG4gICAgfVxuXG4gICAgaWYgKGNvbmRpdGlvbnMgIT0gbnVsbCAmJiAhKGNvbmRpdGlvbnMgaW5zdGFuY2VvZiBDb3B5Q29uZGl0aW9ucykpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2NvbmRpdGlvbnMgc2hvdWxkIGJlIG9mIHR5cGUgXCJDb3B5Q29uZGl0aW9uc1wiJylcbiAgICB9XG5cbiAgICBjb25zdCBoZWFkZXJzOiBSZXF1ZXN0SGVhZGVycyA9IHt9XG4gICAgaGVhZGVyc1sneC1hbXotY29weS1zb3VyY2UnXSA9IHVyaVJlc291cmNlRXNjYXBlKHNvdXJjZUJ1Y2tldE5hbWVBbmRPYmplY3ROYW1lKVxuXG4gICAgaWYgKGNvbmRpdGlvbnMpIHtcbiAgICAgIGlmIChjb25kaXRpb25zLm1vZGlmaWVkICE9PSAnJykge1xuICAgICAgICBoZWFkZXJzWyd4LWFtei1jb3B5LXNvdXJjZS1pZi1tb2RpZmllZC1zaW5jZSddID0gY29uZGl0aW9ucy5tb2RpZmllZFxuICAgICAgfVxuICAgICAgaWYgKGNvbmRpdGlvbnMudW5tb2RpZmllZCAhPT0gJycpIHtcbiAgICAgICAgaGVhZGVyc1sneC1hbXotY29weS1zb3VyY2UtaWYtdW5tb2RpZmllZC1zaW5jZSddID0gY29uZGl0aW9ucy51bm1vZGlmaWVkXG4gICAgICB9XG4gICAgICBpZiAoY29uZGl0aW9ucy5tYXRjaEVUYWcgIT09ICcnKSB7XG4gICAgICAgIGhlYWRlcnNbJ3gtYW16LWNvcHktc291cmNlLWlmLW1hdGNoJ10gPSBjb25kaXRpb25zLm1hdGNoRVRhZ1xuICAgICAgfVxuICAgICAgaWYgKGNvbmRpdGlvbnMubWF0Y2hFVGFnRXhjZXB0ICE9PSAnJykge1xuICAgICAgICBoZWFkZXJzWyd4LWFtei1jb3B5LXNvdXJjZS1pZi1ub25lLW1hdGNoJ10gPSBjb25kaXRpb25zLm1hdGNoRVRhZ0V4Y2VwdFxuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IG1ldGhvZCA9ICdQVVQnXG5cbiAgICBjb25zdCByZXMgPSBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmMoe1xuICAgICAgbWV0aG9kLFxuICAgICAgYnVja2V0TmFtZTogdGFyZ2V0QnVja2V0TmFtZSxcbiAgICAgIG9iamVjdE5hbWU6IHRhcmdldE9iamVjdE5hbWUsXG4gICAgICBoZWFkZXJzLFxuICAgIH0pXG4gICAgY29uc3QgYm9keSA9IGF3YWl0IHJlYWRBc1N0cmluZyhyZXMpXG4gICAgcmV0dXJuIHhtbFBhcnNlcnMucGFyc2VDb3B5T2JqZWN0KGJvZHkpXG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGNvcHlPYmplY3RWMihcbiAgICBzb3VyY2VDb25maWc6IENvcHlTb3VyY2VPcHRpb25zLFxuICAgIGRlc3RDb25maWc6IENvcHlEZXN0aW5hdGlvbk9wdGlvbnMsXG4gICk6IFByb21pc2U8Q29weU9iamVjdFJlc3VsdFYyPiB7XG4gICAgaWYgKCEoc291cmNlQ29uZmlnIGluc3RhbmNlb2YgQ29weVNvdXJjZU9wdGlvbnMpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCdzb3VyY2VDb25maWcgc2hvdWxkIG9mIHR5cGUgQ29weVNvdXJjZU9wdGlvbnMgJylcbiAgICB9XG4gICAgaWYgKCEoZGVzdENvbmZpZyBpbnN0YW5jZW9mIENvcHlEZXN0aW5hdGlvbk9wdGlvbnMpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCdkZXN0Q29uZmlnIHNob3VsZCBvZiB0eXBlIENvcHlEZXN0aW5hdGlvbk9wdGlvbnMgJylcbiAgICB9XG4gICAgaWYgKCFkZXN0Q29uZmlnLnZhbGlkYXRlKCkpIHtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlamVjdCgpXG4gICAgfVxuICAgIGlmICghZGVzdENvbmZpZy52YWxpZGF0ZSgpKSB7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZWplY3QoKVxuICAgIH1cblxuICAgIGNvbnN0IGhlYWRlcnMgPSBPYmplY3QuYXNzaWduKHt9LCBzb3VyY2VDb25maWcuZ2V0SGVhZGVycygpLCBkZXN0Q29uZmlnLmdldEhlYWRlcnMoKSlcblxuICAgIGNvbnN0IGJ1Y2tldE5hbWUgPSBkZXN0Q29uZmlnLkJ1Y2tldFxuICAgIGNvbnN0IG9iamVjdE5hbWUgPSBkZXN0Q29uZmlnLk9iamVjdFxuXG4gICAgY29uc3QgbWV0aG9kID0gJ1BVVCdcblxuICAgIGNvbnN0IHJlcyA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3RBc3luYyh7IG1ldGhvZCwgYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgaGVhZGVycyB9KVxuICAgIGNvbnN0IGJvZHkgPSBhd2FpdCByZWFkQXNTdHJpbmcocmVzKVxuICAgIGNvbnN0IGNvcHlSZXMgPSB4bWxQYXJzZXJzLnBhcnNlQ29weU9iamVjdChib2R5KVxuICAgIGNvbnN0IHJlc0hlYWRlcnM6IEluY29taW5nSHR0cEhlYWRlcnMgPSByZXMuaGVhZGVyc1xuXG4gICAgY29uc3Qgc2l6ZUhlYWRlclZhbHVlID0gcmVzSGVhZGVycyAmJiByZXNIZWFkZXJzWydjb250ZW50LWxlbmd0aCddXG4gICAgY29uc3Qgc2l6ZSA9IHR5cGVvZiBzaXplSGVhZGVyVmFsdWUgPT09ICdudW1iZXInID8gc2l6ZUhlYWRlclZhbHVlIDogdW5kZWZpbmVkXG5cbiAgICByZXR1cm4ge1xuICAgICAgQnVja2V0OiBkZXN0Q29uZmlnLkJ1Y2tldCxcbiAgICAgIEtleTogZGVzdENvbmZpZy5PYmplY3QsXG4gICAgICBMYXN0TW9kaWZpZWQ6IGNvcHlSZXMubGFzdE1vZGlmaWVkLFxuICAgICAgTWV0YURhdGE6IGV4dHJhY3RNZXRhZGF0YShyZXNIZWFkZXJzIGFzIFJlc3BvbnNlSGVhZGVyKSxcbiAgICAgIFZlcnNpb25JZDogZ2V0VmVyc2lvbklkKHJlc0hlYWRlcnMgYXMgUmVzcG9uc2VIZWFkZXIpLFxuICAgICAgU291cmNlVmVyc2lvbklkOiBnZXRTb3VyY2VWZXJzaW9uSWQocmVzSGVhZGVycyBhcyBSZXNwb25zZUhlYWRlciksXG4gICAgICBFdGFnOiBzYW5pdGl6ZUVUYWcocmVzSGVhZGVycy5ldGFnKSxcbiAgICAgIFNpemU6IHNpemUsXG4gICAgfVxuICB9XG5cbiAgYXN5bmMgY29weU9iamVjdChzb3VyY2U6IENvcHlTb3VyY2VPcHRpb25zLCBkZXN0OiBDb3B5RGVzdGluYXRpb25PcHRpb25zKTogUHJvbWlzZTxDb3B5T2JqZWN0UmVzdWx0PlxuICBhc3luYyBjb3B5T2JqZWN0KFxuICAgIHRhcmdldEJ1Y2tldE5hbWU6IHN0cmluZyxcbiAgICB0YXJnZXRPYmplY3ROYW1lOiBzdHJpbmcsXG4gICAgc291cmNlQnVja2V0TmFtZUFuZE9iamVjdE5hbWU6IHN0cmluZyxcbiAgICBjb25kaXRpb25zPzogQ29weUNvbmRpdGlvbnMsXG4gICk6IFByb21pc2U8Q29weU9iamVjdFJlc3VsdD5cbiAgYXN5bmMgY29weU9iamVjdCguLi5hbGxBcmdzOiBDb3B5T2JqZWN0UGFyYW1zKTogUHJvbWlzZTxDb3B5T2JqZWN0UmVzdWx0PiB7XG4gICAgaWYgKHR5cGVvZiBhbGxBcmdzWzBdID09PSAnc3RyaW5nJykge1xuICAgICAgY29uc3QgW3RhcmdldEJ1Y2tldE5hbWUsIHRhcmdldE9iamVjdE5hbWUsIHNvdXJjZUJ1Y2tldE5hbWVBbmRPYmplY3ROYW1lLCBjb25kaXRpb25zXSA9IGFsbEFyZ3MgYXMgW1xuICAgICAgICBzdHJpbmcsXG4gICAgICAgIHN0cmluZyxcbiAgICAgICAgc3RyaW5nLFxuICAgICAgICBDb3B5Q29uZGl0aW9ucz8sXG4gICAgICBdXG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5jb3B5T2JqZWN0VjEodGFyZ2V0QnVja2V0TmFtZSwgdGFyZ2V0T2JqZWN0TmFtZSwgc291cmNlQnVja2V0TmFtZUFuZE9iamVjdE5hbWUsIGNvbmRpdGlvbnMpXG4gICAgfVxuICAgIGNvbnN0IFtzb3VyY2UsIGRlc3RdID0gYWxsQXJncyBhcyBbQ29weVNvdXJjZU9wdGlvbnMsIENvcHlEZXN0aW5hdGlvbk9wdGlvbnNdXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuY29weU9iamVjdFYyKHNvdXJjZSwgZGVzdClcbiAgfVxuXG4gIGFzeW5jIHVwbG9hZFBhcnQoXG4gICAgcGFydENvbmZpZzoge1xuICAgICAgYnVja2V0TmFtZTogc3RyaW5nXG4gICAgICBvYmplY3ROYW1lOiBzdHJpbmdcbiAgICAgIHVwbG9hZElEOiBzdHJpbmdcbiAgICAgIHBhcnROdW1iZXI6IG51bWJlclxuICAgICAgaGVhZGVyczogUmVxdWVzdEhlYWRlcnNcbiAgICB9LFxuICAgIHBheWxvYWQ/OiBCaW5hcnksXG4gICkge1xuICAgIGNvbnN0IHsgYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgdXBsb2FkSUQsIHBhcnROdW1iZXIsIGhlYWRlcnMgfSA9IHBhcnRDb25maWdcblxuICAgIGNvbnN0IG1ldGhvZCA9ICdQVVQnXG4gICAgY29uc3QgcXVlcnkgPSBgdXBsb2FkSWQ9JHt1cGxvYWRJRH0mcGFydE51bWJlcj0ke3BhcnROdW1iZXJ9YFxuICAgIGNvbnN0IHJlcXVlc3RPcHRpb25zID0geyBtZXRob2QsIGJ1Y2tldE5hbWUsIG9iamVjdE5hbWU6IG9iamVjdE5hbWUsIHF1ZXJ5LCBoZWFkZXJzIH1cbiAgICBjb25zdCByZXMgPSBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmMocmVxdWVzdE9wdGlvbnMsIHBheWxvYWQpXG4gICAgY29uc3QgYm9keSA9IGF3YWl0IHJlYWRBc1N0cmluZyhyZXMpXG4gICAgY29uc3QgcGFydFJlcyA9IHVwbG9hZFBhcnRQYXJzZXIoYm9keSlcbiAgICBjb25zdCBwYXJ0RXRhZ1ZhbCA9IHNhbml0aXplRVRhZyhyZXMuaGVhZGVycy5ldGFnKSB8fCBzYW5pdGl6ZUVUYWcocGFydFJlcy5FVGFnKVxuICAgIHJldHVybiB7XG4gICAgICBldGFnOiBwYXJ0RXRhZ1ZhbCxcbiAgICAgIGtleTogb2JqZWN0TmFtZSxcbiAgICAgIHBhcnQ6IHBhcnROdW1iZXIsXG4gICAgfVxuICB9XG5cbiAgYXN5bmMgY29tcG9zZU9iamVjdChcbiAgICBkZXN0T2JqQ29uZmlnOiBDb3B5RGVzdGluYXRpb25PcHRpb25zLFxuICAgIHNvdXJjZU9iakxpc3Q6IENvcHlTb3VyY2VPcHRpb25zW10sXG4gICAgeyBtYXhDb25jdXJyZW5jeSA9IDEwIH0gPSB7fSxcbiAgKTogUHJvbWlzZTxib29sZWFuIHwgeyBldGFnOiBzdHJpbmc7IHZlcnNpb25JZDogc3RyaW5nIHwgbnVsbCB9IHwgUHJvbWlzZTx2b2lkPiB8IENvcHlPYmplY3RSZXN1bHQ+IHtcbiAgICBjb25zdCBzb3VyY2VGaWxlc0xlbmd0aCA9IHNvdXJjZU9iakxpc3QubGVuZ3RoXG5cbiAgICBpZiAoIUFycmF5LmlzQXJyYXkoc291cmNlT2JqTGlzdCkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoJ3NvdXJjZUNvbmZpZyBzaG91bGQgYW4gYXJyYXkgb2YgQ29weVNvdXJjZU9wdGlvbnMgJylcbiAgICB9XG4gICAgaWYgKCEoZGVzdE9iakNvbmZpZyBpbnN0YW5jZW9mIENvcHlEZXN0aW5hdGlvbk9wdGlvbnMpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKCdkZXN0Q29uZmlnIHNob3VsZCBvZiB0eXBlIENvcHlEZXN0aW5hdGlvbk9wdGlvbnMgJylcbiAgICB9XG5cbiAgICBpZiAoc291cmNlRmlsZXNMZW5ndGggPCAxIHx8IHNvdXJjZUZpbGVzTGVuZ3RoID4gUEFSVF9DT05TVFJBSU5UUy5NQVhfUEFSVFNfQ09VTlQpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoXG4gICAgICAgIGBcIlRoZXJlIG11c3QgYmUgYXMgbGVhc3Qgb25lIGFuZCB1cCB0byAke1BBUlRfQ09OU1RSQUlOVFMuTUFYX1BBUlRTX0NPVU5UfSBzb3VyY2Ugb2JqZWN0cy5gLFxuICAgICAgKVxuICAgIH1cblxuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgc291cmNlRmlsZXNMZW5ndGg7IGkrKykge1xuICAgICAgY29uc3Qgc09iaiA9IHNvdXJjZU9iakxpc3RbaV0gYXMgQ29weVNvdXJjZU9wdGlvbnNcbiAgICAgIGlmICghc09iai52YWxpZGF0ZSgpKSB7XG4gICAgICAgIHJldHVybiBmYWxzZVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmICghKGRlc3RPYmpDb25maWcgYXMgQ29weURlc3RpbmF0aW9uT3B0aW9ucykudmFsaWRhdGUoKSkge1xuICAgICAgcmV0dXJuIGZhbHNlXG4gICAgfVxuXG4gICAgY29uc3QgZ2V0U3RhdE9wdGlvbnMgPSAoc3JjQ29uZmlnOiBDb3B5U291cmNlT3B0aW9ucykgPT4ge1xuICAgICAgbGV0IHN0YXRPcHRzID0ge31cbiAgICAgIGlmICghXy5pc0VtcHR5KHNyY0NvbmZpZy5WZXJzaW9uSUQpKSB7XG4gICAgICAgIHN0YXRPcHRzID0ge1xuICAgICAgICAgIHZlcnNpb25JZDogc3JjQ29uZmlnLlZlcnNpb25JRCxcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgcmV0dXJuIHN0YXRPcHRzXG4gICAgfVxuICAgIGNvbnN0IHNyY09iamVjdFNpemVzOiBudW1iZXJbXSA9IFtdXG4gICAgbGV0IHRvdGFsU2l6ZSA9IDBcbiAgICBsZXQgdG90YWxQYXJ0cyA9IDBcblxuICAgIGNvbnN0IHNvdXJjZU9ialN0YXRzID0gc291cmNlT2JqTGlzdC5tYXAoKHNyY0l0ZW0pID0+XG4gICAgICB0aGlzLnN0YXRPYmplY3Qoc3JjSXRlbS5CdWNrZXQsIHNyY0l0ZW0uT2JqZWN0LCBnZXRTdGF0T3B0aW9ucyhzcmNJdGVtKSksXG4gICAgKVxuXG4gICAgY29uc3Qgc3JjT2JqZWN0SW5mb3MgPSBhd2FpdCBQcm9taXNlLmFsbChzb3VyY2VPYmpTdGF0cylcblxuICAgIGNvbnN0IHZhbGlkYXRlZFN0YXRzID0gc3JjT2JqZWN0SW5mb3MubWFwKChyZXNJdGVtU3RhdCwgaW5kZXgpID0+IHtcbiAgICAgIGNvbnN0IHNyY0NvbmZpZzogQ29weVNvdXJjZU9wdGlvbnMgfCB1bmRlZmluZWQgPSBzb3VyY2VPYmpMaXN0W2luZGV4XVxuXG4gICAgICBsZXQgc3JjQ29weVNpemUgPSByZXNJdGVtU3RhdC5zaXplXG4gICAgICAvLyBDaGVjayBpZiBhIHNlZ21lbnQgaXMgc3BlY2lmaWVkLCBhbmQgaWYgc28sIGlzIHRoZVxuICAgICAgLy8gc2VnbWVudCB3aXRoaW4gb2JqZWN0IGJvdW5kcz9cbiAgICAgIGlmIChzcmNDb25maWcgJiYgc3JjQ29uZmlnLk1hdGNoUmFuZ2UpIHtcbiAgICAgICAgLy8gU2luY2UgcmFuZ2UgaXMgc3BlY2lmaWVkLFxuICAgICAgICAvLyAgICAwIDw9IHNyYy5zcmNTdGFydCA8PSBzcmMuc3JjRW5kXG4gICAgICAgIC8vIHNvIG9ubHkgaW52YWxpZCBjYXNlIHRvIGNoZWNrIGlzOlxuICAgICAgICBjb25zdCBzcmNTdGFydCA9IHNyY0NvbmZpZy5TdGFydFxuICAgICAgICBjb25zdCBzcmNFbmQgPSBzcmNDb25maWcuRW5kXG4gICAgICAgIGlmIChzcmNFbmQgPj0gc3JjQ29weVNpemUgfHwgc3JjU3RhcnQgPCAwKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcihcbiAgICAgICAgICAgIGBDb3B5U3JjT3B0aW9ucyAke2luZGV4fSBoYXMgaW52YWxpZCBzZWdtZW50LXRvLWNvcHkgWyR7c3JjU3RhcnR9LCAke3NyY0VuZH1dIChzaXplIGlzICR7c3JjQ29weVNpemV9KWAsXG4gICAgICAgICAgKVxuICAgICAgICB9XG4gICAgICAgIHNyY0NvcHlTaXplID0gc3JjRW5kIC0gc3JjU3RhcnQgKyAxXG4gICAgICB9XG5cbiAgICAgIC8vIE9ubHkgdGhlIGxhc3Qgc291cmNlIG1heSBiZSBsZXNzIHRoYW4gYGFic01pblBhcnRTaXplYFxuICAgICAgaWYgKHNyY0NvcHlTaXplIDwgUEFSVF9DT05TVFJBSU5UUy5BQlNfTUlOX1BBUlRfU0laRSAmJiBpbmRleCA8IHNvdXJjZUZpbGVzTGVuZ3RoIC0gMSkge1xuICAgICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKFxuICAgICAgICAgIGBDb3B5U3JjT3B0aW9ucyAke2luZGV4fSBpcyB0b28gc21hbGwgKCR7c3JjQ29weVNpemV9KSBhbmQgaXQgaXMgbm90IHRoZSBsYXN0IHBhcnQuYCxcbiAgICAgICAgKVxuICAgICAgfVxuXG4gICAgICAvLyBJcyBkYXRhIHRvIGNvcHkgdG9vIGxhcmdlP1xuICAgICAgdG90YWxTaXplICs9IHNyY0NvcHlTaXplXG4gICAgICBpZiAodG90YWxTaXplID4gUEFSVF9DT05TVFJBSU5UUy5NQVhfTVVMVElQQVJUX1BVVF9PQkpFQ1RfU0laRSkge1xuICAgICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRBcmd1bWVudEVycm9yKGBDYW5ub3QgY29tcG9zZSBhbiBvYmplY3Qgb2Ygc2l6ZSAke3RvdGFsU2l6ZX0gKD4gNVRpQilgKVxuICAgICAgfVxuXG4gICAgICAvLyByZWNvcmQgc291cmNlIHNpemVcbiAgICAgIHNyY09iamVjdFNpemVzW2luZGV4XSA9IHNyY0NvcHlTaXplXG5cbiAgICAgIC8vIGNhbGN1bGF0ZSBwYXJ0cyBuZWVkZWQgZm9yIGN1cnJlbnQgc291cmNlXG4gICAgICB0b3RhbFBhcnRzICs9IHBhcnRzUmVxdWlyZWQoc3JjQ29weVNpemUpXG4gICAgICAvLyBEbyB3ZSBuZWVkIG1vcmUgcGFydHMgdGhhbiB3ZSBhcmUgYWxsb3dlZD9cbiAgICAgIGlmICh0b3RhbFBhcnRzID4gUEFSVF9DT05TVFJBSU5UUy5NQVhfUEFSVFNfQ09VTlQpIHtcbiAgICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkQXJndW1lbnRFcnJvcihcbiAgICAgICAgICBgWW91ciBwcm9wb3NlZCBjb21wb3NlIG9iamVjdCByZXF1aXJlcyBtb3JlIHRoYW4gJHtQQVJUX0NPTlNUUkFJTlRTLk1BWF9QQVJUU19DT1VOVH0gcGFydHNgLFxuICAgICAgICApXG4gICAgICB9XG5cbiAgICAgIHJldHVybiByZXNJdGVtU3RhdFxuICAgIH0pXG5cbiAgICBpZiAoKHRvdGFsUGFydHMgPT09IDEgJiYgdG90YWxTaXplIDw9IFBBUlRfQ09OU1RSQUlOVFMuTUFYX1BBUlRfU0laRSkgfHwgdG90YWxTaXplID09PSAwKSB7XG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5jb3B5T2JqZWN0KHNvdXJjZU9iakxpc3RbMF0gYXMgQ29weVNvdXJjZU9wdGlvbnMsIGRlc3RPYmpDb25maWcpIC8vIHVzZSBjb3B5T2JqZWN0VjJcbiAgICB9XG5cbiAgICAvLyBwcmVzZXJ2ZSBldGFnIHRvIGF2b2lkIG1vZGlmaWNhdGlvbiBvZiBvYmplY3Qgd2hpbGUgY29weWluZy5cbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHNvdXJjZUZpbGVzTGVuZ3RoOyBpKyspIHtcbiAgICAgIDsoc291cmNlT2JqTGlzdFtpXSBhcyBDb3B5U291cmNlT3B0aW9ucykuTWF0Y2hFVGFnID0gKHZhbGlkYXRlZFN0YXRzW2ldIGFzIEJ1Y2tldEl0ZW1TdGF0KS5ldGFnXG4gICAgfVxuXG4gICAgY29uc3Qgc3BsaXRQYXJ0U2l6ZUxpc3QgPSB2YWxpZGF0ZWRTdGF0cy5tYXAoKHJlc0l0ZW1TdGF0LCBpZHgpID0+IHtcbiAgICAgIHJldHVybiBjYWxjdWxhdGVFdmVuU3BsaXRzKHNyY09iamVjdFNpemVzW2lkeF0gYXMgbnVtYmVyLCBzb3VyY2VPYmpMaXN0W2lkeF0gYXMgQ29weVNvdXJjZU9wdGlvbnMpXG4gICAgfSlcblxuICAgIGNvbnN0IGdldFVwbG9hZFBhcnRDb25maWdMaXN0ID0gKHVwbG9hZElkOiBzdHJpbmcpID0+IHtcbiAgICAgIGNvbnN0IHVwbG9hZFBhcnRDb25maWdMaXN0OiBVcGxvYWRQYXJ0Q29uZmlnW10gPSBbXVxuXG4gICAgICBzcGxpdFBhcnRTaXplTGlzdC5mb3JFYWNoKChzcGxpdFNpemUsIHNwbGl0SW5kZXg6IG51bWJlcikgPT4ge1xuICAgICAgICBpZiAoc3BsaXRTaXplKSB7XG4gICAgICAgICAgY29uc3QgeyBzdGFydEluZGV4OiBzdGFydElkeCwgZW5kSW5kZXg6IGVuZElkeCwgb2JqSW5mbzogb2JqQ29uZmlnIH0gPSBzcGxpdFNpemVcblxuICAgICAgICAgIGNvbnN0IHBhcnRJbmRleCA9IHNwbGl0SW5kZXggKyAxIC8vIHBhcnQgaW5kZXggc3RhcnRzIGZyb20gMS5cbiAgICAgICAgICBjb25zdCB0b3RhbFVwbG9hZHMgPSBBcnJheS5mcm9tKHN0YXJ0SWR4KVxuXG4gICAgICAgICAgY29uc3QgaGVhZGVycyA9IChzb3VyY2VPYmpMaXN0W3NwbGl0SW5kZXhdIGFzIENvcHlTb3VyY2VPcHRpb25zKS5nZXRIZWFkZXJzKClcblxuICAgICAgICAgIHRvdGFsVXBsb2Fkcy5mb3JFYWNoKChzcGxpdFN0YXJ0LCB1cGxkQ3RySWR4KSA9PiB7XG4gICAgICAgICAgICBjb25zdCBzcGxpdEVuZCA9IGVuZElkeFt1cGxkQ3RySWR4XVxuXG4gICAgICAgICAgICBjb25zdCBzb3VyY2VPYmogPSBgJHtvYmpDb25maWcuQnVja2V0fS8ke29iakNvbmZpZy5PYmplY3R9YFxuICAgICAgICAgICAgaGVhZGVyc1sneC1hbXotY29weS1zb3VyY2UnXSA9IGAke3NvdXJjZU9ian1gXG4gICAgICAgICAgICBoZWFkZXJzWyd4LWFtei1jb3B5LXNvdXJjZS1yYW5nZSddID0gYGJ5dGVzPSR7c3BsaXRTdGFydH0tJHtzcGxpdEVuZH1gXG5cbiAgICAgICAgICAgIGNvbnN0IHVwbG9hZFBhcnRDb25maWcgPSB7XG4gICAgICAgICAgICAgIGJ1Y2tldE5hbWU6IGRlc3RPYmpDb25maWcuQnVja2V0LFxuICAgICAgICAgICAgICBvYmplY3ROYW1lOiBkZXN0T2JqQ29uZmlnLk9iamVjdCxcbiAgICAgICAgICAgICAgdXBsb2FkSUQ6IHVwbG9hZElkLFxuICAgICAgICAgICAgICBwYXJ0TnVtYmVyOiBwYXJ0SW5kZXgsXG4gICAgICAgICAgICAgIGhlYWRlcnM6IGhlYWRlcnMsXG4gICAgICAgICAgICAgIHNvdXJjZU9iajogc291cmNlT2JqLFxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB1cGxvYWRQYXJ0Q29uZmlnTGlzdC5wdXNoKHVwbG9hZFBhcnRDb25maWcpXG4gICAgICAgICAgfSlcbiAgICAgICAgfVxuICAgICAgfSlcblxuICAgICAgcmV0dXJuIHVwbG9hZFBhcnRDb25maWdMaXN0XG4gICAgfVxuXG4gICAgY29uc3QgdXBsb2FkQWxsUGFydHMgPSBhc3luYyAodXBsb2FkTGlzdDogVXBsb2FkUGFydENvbmZpZ1tdKSA9PiB7XG4gICAgICBjb25zdCBwYXJ0VXBsb2FkczogQXdhaXRlZDxSZXR1cm5UeXBlPHR5cGVvZiB0aGlzLnVwbG9hZFBhcnQ+PltdID0gW11cblxuICAgICAgLy8gUHJvY2VzcyB1cGxvYWQgcGFydHMgaW4gYmF0Y2hlcyB0byBhdm9pZCB0b28gbWFueSBjb25jdXJyZW50IHJlcXVlc3RzXG4gICAgICBmb3IgKGNvbnN0IGJhdGNoIG9mIF8uY2h1bmsodXBsb2FkTGlzdCwgbWF4Q29uY3VycmVuY3kpKSB7XG4gICAgICAgIGNvbnN0IGJhdGNoUmVzdWx0cyA9IGF3YWl0IFByb21pc2UuYWxsKGJhdGNoLm1hcCgoaXRlbSkgPT4gdGhpcy51cGxvYWRQYXJ0KGl0ZW0pKSlcblxuICAgICAgICBwYXJ0VXBsb2Fkcy5wdXNoKC4uLmJhdGNoUmVzdWx0cylcbiAgICAgIH1cblxuICAgICAgLy8gUHJvY2VzcyByZXN1bHRzIGhlcmUgaWYgbmVlZGVkXG4gICAgICByZXR1cm4gcGFydFVwbG9hZHNcbiAgICB9XG5cbiAgICBjb25zdCBwZXJmb3JtVXBsb2FkUGFydHMgPSBhc3luYyAodXBsb2FkSWQ6IHN0cmluZykgPT4ge1xuICAgICAgY29uc3QgdXBsb2FkTGlzdCA9IGdldFVwbG9hZFBhcnRDb25maWdMaXN0KHVwbG9hZElkKVxuICAgICAgY29uc3QgcGFydHNSZXMgPSBhd2FpdCB1cGxvYWRBbGxQYXJ0cyh1cGxvYWRMaXN0KVxuICAgICAgcmV0dXJuIHBhcnRzUmVzLm1hcCgocGFydENvcHkpID0+ICh7IGV0YWc6IHBhcnRDb3B5LmV0YWcsIHBhcnQ6IHBhcnRDb3B5LnBhcnQgfSkpXG4gICAgfVxuXG4gICAgY29uc3QgbmV3VXBsb2FkSGVhZGVycyA9IGRlc3RPYmpDb25maWcuZ2V0SGVhZGVycygpXG5cbiAgICBjb25zdCB1cGxvYWRJZCA9IGF3YWl0IHRoaXMuaW5pdGlhdGVOZXdNdWx0aXBhcnRVcGxvYWQoZGVzdE9iakNvbmZpZy5CdWNrZXQsIGRlc3RPYmpDb25maWcuT2JqZWN0LCBuZXdVcGxvYWRIZWFkZXJzKVxuICAgIHRyeSB7XG4gICAgICBjb25zdCBwYXJ0c0RvbmUgPSBhd2FpdCBwZXJmb3JtVXBsb2FkUGFydHModXBsb2FkSWQpXG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5jb21wbGV0ZU11bHRpcGFydFVwbG9hZChkZXN0T2JqQ29uZmlnLkJ1Y2tldCwgZGVzdE9iakNvbmZpZy5PYmplY3QsIHVwbG9hZElkLCBwYXJ0c0RvbmUpXG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5hYm9ydE11bHRpcGFydFVwbG9hZChkZXN0T2JqQ29uZmlnLkJ1Y2tldCwgZGVzdE9iakNvbmZpZy5PYmplY3QsIHVwbG9hZElkKVxuICAgIH1cbiAgfVxuXG4gIGFzeW5jIHByZXNpZ25lZFVybChcbiAgICBtZXRob2Q6IHN0cmluZyxcbiAgICBidWNrZXROYW1lOiBzdHJpbmcsXG4gICAgb2JqZWN0TmFtZTogc3RyaW5nLFxuICAgIGV4cGlyZXM/OiBudW1iZXIgfCBQcmVTaWduUmVxdWVzdFBhcmFtcyB8IHVuZGVmaW5lZCxcbiAgICByZXFQYXJhbXM/OiBQcmVTaWduUmVxdWVzdFBhcmFtcyB8IERhdGUsXG4gICAgcmVxdWVzdERhdGU/OiBEYXRlLFxuICApOiBQcm9taXNlPHN0cmluZz4ge1xuICAgIGlmICh0aGlzLmFub255bW91cykge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5Bbm9ueW1vdXNSZXF1ZXN0RXJyb3IoYFByZXNpZ25lZCAke21ldGhvZH0gdXJsIGNhbm5vdCBiZSBnZW5lcmF0ZWQgZm9yIGFub255bW91cyByZXF1ZXN0c2ApXG4gICAgfVxuXG4gICAgaWYgKCFleHBpcmVzKSB7XG4gICAgICBleHBpcmVzID0gUFJFU0lHTl9FWFBJUllfREFZU19NQVhcbiAgICB9XG4gICAgaWYgKCFyZXFQYXJhbXMpIHtcbiAgICAgIHJlcVBhcmFtcyA9IHt9XG4gICAgfVxuICAgIGlmICghcmVxdWVzdERhdGUpIHtcbiAgICAgIHJlcXVlc3REYXRlID0gbmV3IERhdGUoKVxuICAgIH1cblxuICAgIC8vIFR5cGUgYXNzZXJ0aW9uc1xuICAgIGlmIChleHBpcmVzICYmIHR5cGVvZiBleHBpcmVzICE9PSAnbnVtYmVyJykge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignZXhwaXJlcyBzaG91bGQgYmUgb2YgdHlwZSBcIm51bWJlclwiJylcbiAgICB9XG4gICAgaWYgKHJlcVBhcmFtcyAmJiB0eXBlb2YgcmVxUGFyYW1zICE9PSAnb2JqZWN0Jykge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigncmVxUGFyYW1zIHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxuICAgIH1cbiAgICBpZiAoKHJlcXVlc3REYXRlICYmICEocmVxdWVzdERhdGUgaW5zdGFuY2VvZiBEYXRlKSkgfHwgKHJlcXVlc3REYXRlICYmIGlzTmFOKHJlcXVlc3REYXRlPy5nZXRUaW1lKCkpKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigncmVxdWVzdERhdGUgc2hvdWxkIGJlIG9mIHR5cGUgXCJEYXRlXCIgYW5kIHZhbGlkJylcbiAgICB9XG5cbiAgICBjb25zdCBxdWVyeSA9IHJlcVBhcmFtcyA/IHFzLnN0cmluZ2lmeShyZXFQYXJhbXMpIDogdW5kZWZpbmVkXG5cbiAgICB0cnkge1xuICAgICAgY29uc3QgcmVnaW9uID0gYXdhaXQgdGhpcy5nZXRCdWNrZXRSZWdpb25Bc3luYyhidWNrZXROYW1lKVxuICAgICAgYXdhaXQgdGhpcy5jaGVja0FuZFJlZnJlc2hDcmVkcygpXG4gICAgICBjb25zdCByZXFPcHRpb25zID0gdGhpcy5nZXRSZXF1ZXN0T3B0aW9ucyh7IG1ldGhvZCwgcmVnaW9uLCBidWNrZXROYW1lLCBvYmplY3ROYW1lLCBxdWVyeSB9KVxuXG4gICAgICByZXR1cm4gcHJlc2lnblNpZ25hdHVyZVY0KFxuICAgICAgICByZXFPcHRpb25zLFxuICAgICAgICB0aGlzLmFjY2Vzc0tleSxcbiAgICAgICAgdGhpcy5zZWNyZXRLZXksXG4gICAgICAgIHRoaXMuc2Vzc2lvblRva2VuLFxuICAgICAgICByZWdpb24sXG4gICAgICAgIHJlcXVlc3REYXRlLFxuICAgICAgICBleHBpcmVzLFxuICAgICAgKVxuICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgaWYgKGVyciBpbnN0YW5jZW9mIGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKSB7XG4gICAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoYFVuYWJsZSB0byBnZXQgYnVja2V0IHJlZ2lvbiBmb3IgJHtidWNrZXROYW1lfS5gKVxuICAgICAgfVxuXG4gICAgICB0aHJvdyBlcnJcbiAgICB9XG4gIH1cblxuICBhc3luYyBwcmVzaWduZWRHZXRPYmplY3QoXG4gICAgYnVja2V0TmFtZTogc3RyaW5nLFxuICAgIG9iamVjdE5hbWU6IHN0cmluZyxcbiAgICBleHBpcmVzPzogbnVtYmVyLFxuICAgIHJlc3BIZWFkZXJzPzogUHJlU2lnblJlcXVlc3RQYXJhbXMgfCBEYXRlLFxuICAgIHJlcXVlc3REYXRlPzogRGF0ZSxcbiAgKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRPYmplY3ROYW1lRXJyb3IoYEludmFsaWQgb2JqZWN0IG5hbWU6ICR7b2JqZWN0TmFtZX1gKVxuICAgIH1cblxuICAgIGNvbnN0IHZhbGlkUmVzcEhlYWRlcnMgPSBbXG4gICAgICAncmVzcG9uc2UtY29udGVudC10eXBlJyxcbiAgICAgICdyZXNwb25zZS1jb250ZW50LWxhbmd1YWdlJyxcbiAgICAgICdyZXNwb25zZS1leHBpcmVzJyxcbiAgICAgICdyZXNwb25zZS1jYWNoZS1jb250cm9sJyxcbiAgICAgICdyZXNwb25zZS1jb250ZW50LWRpc3Bvc2l0aW9uJyxcbiAgICAgICdyZXNwb25zZS1jb250ZW50LWVuY29kaW5nJyxcbiAgICBdXG4gICAgdmFsaWRSZXNwSGVhZGVycy5mb3JFYWNoKChoZWFkZXIpID0+IHtcbiAgICAgIC8vIEB0cy1pZ25vcmVcbiAgICAgIGlmIChyZXNwSGVhZGVycyAhPT0gdW5kZWZpbmVkICYmIHJlc3BIZWFkZXJzW2hlYWRlcl0gIT09IHVuZGVmaW5lZCAmJiAhaXNTdHJpbmcocmVzcEhlYWRlcnNbaGVhZGVyXSkpIHtcbiAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihgcmVzcG9uc2UgaGVhZGVyICR7aGVhZGVyfSBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmluZ1wiYClcbiAgICAgIH1cbiAgICB9KVxuICAgIHJldHVybiB0aGlzLnByZXNpZ25lZFVybCgnR0VUJywgYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgZXhwaXJlcywgcmVzcEhlYWRlcnMsIHJlcXVlc3REYXRlKVxuICB9XG5cbiAgYXN5bmMgcHJlc2lnbmVkUHV0T2JqZWN0KGJ1Y2tldE5hbWU6IHN0cmluZywgb2JqZWN0TmFtZTogc3RyaW5nLCBleHBpcmVzPzogbnVtYmVyKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoYEludmFsaWQgYnVja2V0IG5hbWU6ICR7YnVja2V0TmFtZX1gKVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRPYmplY3ROYW1lKG9iamVjdE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRPYmplY3ROYW1lRXJyb3IoYEludmFsaWQgb2JqZWN0IG5hbWU6ICR7b2JqZWN0TmFtZX1gKVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLnByZXNpZ25lZFVybCgnUFVUJywgYnVja2V0TmFtZSwgb2JqZWN0TmFtZSwgZXhwaXJlcylcbiAgfVxuXG4gIG5ld1Bvc3RQb2xpY3koKTogUG9zdFBvbGljeSB7XG4gICAgcmV0dXJuIG5ldyBQb3N0UG9saWN5KClcbiAgfVxuXG4gIGFzeW5jIHByZXNpZ25lZFBvc3RQb2xpY3kocG9zdFBvbGljeTogUG9zdFBvbGljeSk6IFByb21pc2U8UG9zdFBvbGljeVJlc3VsdD4ge1xuICAgIGlmICh0aGlzLmFub255bW91cykge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5Bbm9ueW1vdXNSZXF1ZXN0RXJyb3IoJ1ByZXNpZ25lZCBQT1NUIHBvbGljeSBjYW5ub3QgYmUgZ2VuZXJhdGVkIGZvciBhbm9ueW1vdXMgcmVxdWVzdHMnKVxuICAgIH1cbiAgICBpZiAoIWlzT2JqZWN0KHBvc3RQb2xpY3kpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdwb3N0UG9saWN5IHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxuICAgIH1cbiAgICBjb25zdCBidWNrZXROYW1lID0gcG9zdFBvbGljeS5mb3JtRGF0YS5idWNrZXQgYXMgc3RyaW5nXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHJlZ2lvbiA9IGF3YWl0IHRoaXMuZ2V0QnVja2V0UmVnaW9uQXN5bmMoYnVja2V0TmFtZSlcblxuICAgICAgY29uc3QgZGF0ZSA9IG5ldyBEYXRlKClcbiAgICAgIGNvbnN0IGRhdGVTdHIgPSBtYWtlRGF0ZUxvbmcoZGF0ZSlcbiAgICAgIGF3YWl0IHRoaXMuY2hlY2tBbmRSZWZyZXNoQ3JlZHMoKVxuXG4gICAgICBpZiAoIXBvc3RQb2xpY3kucG9saWN5LmV4cGlyYXRpb24pIHtcbiAgICAgICAgLy8gJ2V4cGlyYXRpb24nIGlzIG1hbmRhdG9yeSBmaWVsZCBmb3IgUzMuXG4gICAgICAgIC8vIFNldCBkZWZhdWx0IGV4cGlyYXRpb24gZGF0ZSBvZiA3IGRheXMuXG4gICAgICAgIGNvbnN0IGV4cGlyZXMgPSBuZXcgRGF0ZSgpXG4gICAgICAgIGV4cGlyZXMuc2V0U2Vjb25kcyhQUkVTSUdOX0VYUElSWV9EQVlTX01BWClcbiAgICAgICAgcG9zdFBvbGljeS5zZXRFeHBpcmVzKGV4cGlyZXMpXG4gICAgICB9XG5cbiAgICAgIHBvc3RQb2xpY3kucG9saWN5LmNvbmRpdGlvbnMucHVzaChbJ2VxJywgJyR4LWFtei1kYXRlJywgZGF0ZVN0cl0pXG4gICAgICBwb3N0UG9saWN5LmZvcm1EYXRhWyd4LWFtei1kYXRlJ10gPSBkYXRlU3RyXG5cbiAgICAgIHBvc3RQb2xpY3kucG9saWN5LmNvbmRpdGlvbnMucHVzaChbJ2VxJywgJyR4LWFtei1hbGdvcml0aG0nLCAnQVdTNC1ITUFDLVNIQTI1NiddKVxuICAgICAgcG9zdFBvbGljeS5mb3JtRGF0YVsneC1hbXotYWxnb3JpdGhtJ10gPSAnQVdTNC1ITUFDLVNIQTI1NidcblxuICAgICAgcG9zdFBvbGljeS5wb2xpY3kuY29uZGl0aW9ucy5wdXNoKFsnZXEnLCAnJHgtYW16LWNyZWRlbnRpYWwnLCB0aGlzLmFjY2Vzc0tleSArICcvJyArIGdldFNjb3BlKHJlZ2lvbiwgZGF0ZSldKVxuICAgICAgcG9zdFBvbGljeS5mb3JtRGF0YVsneC1hbXotY3JlZGVudGlhbCddID0gdGhpcy5hY2Nlc3NLZXkgKyAnLycgKyBnZXRTY29wZShyZWdpb24sIGRhdGUpXG5cbiAgICAgIGlmICh0aGlzLnNlc3Npb25Ub2tlbikge1xuICAgICAgICBwb3N0UG9saWN5LnBvbGljeS5jb25kaXRpb25zLnB1c2goWydlcScsICckeC1hbXotc2VjdXJpdHktdG9rZW4nLCB0aGlzLnNlc3Npb25Ub2tlbl0pXG4gICAgICAgIHBvc3RQb2xpY3kuZm9ybURhdGFbJ3gtYW16LXNlY3VyaXR5LXRva2VuJ10gPSB0aGlzLnNlc3Npb25Ub2tlblxuICAgICAgfVxuXG4gICAgICBjb25zdCBwb2xpY3lCYXNlNjQgPSBCdWZmZXIuZnJvbShKU09OLnN0cmluZ2lmeShwb3N0UG9saWN5LnBvbGljeSkpLnRvU3RyaW5nKCdiYXNlNjQnKVxuXG4gICAgICBwb3N0UG9saWN5LmZvcm1EYXRhLnBvbGljeSA9IHBvbGljeUJhc2U2NFxuXG4gICAgICBwb3N0UG9saWN5LmZvcm1EYXRhWyd4LWFtei1zaWduYXR1cmUnXSA9IHBvc3RQcmVzaWduU2lnbmF0dXJlVjQocmVnaW9uLCBkYXRlLCB0aGlzLnNlY3JldEtleSwgcG9saWN5QmFzZTY0KVxuICAgICAgY29uc3Qgb3B0cyA9IHtcbiAgICAgICAgcmVnaW9uOiByZWdpb24sXG4gICAgICAgIGJ1Y2tldE5hbWU6IGJ1Y2tldE5hbWUsXG4gICAgICAgIG1ldGhvZDogJ1BPU1QnLFxuICAgICAgfVxuICAgICAgY29uc3QgcmVxT3B0aW9ucyA9IHRoaXMuZ2V0UmVxdWVzdE9wdGlvbnMob3B0cylcbiAgICAgIGNvbnN0IHBvcnRTdHIgPSB0aGlzLnBvcnQgPT0gODAgfHwgdGhpcy5wb3J0ID09PSA0NDMgPyAnJyA6IGA6JHt0aGlzLnBvcnQudG9TdHJpbmcoKX1gXG4gICAgICBjb25zdCB1cmxTdHIgPSBgJHtyZXFPcHRpb25zLnByb3RvY29sfS8vJHtyZXFPcHRpb25zLmhvc3R9JHtwb3J0U3RyfSR7cmVxT3B0aW9ucy5wYXRofWBcbiAgICAgIHJldHVybiB7IHBvc3RVUkw6IHVybFN0ciwgZm9ybURhdGE6IHBvc3RQb2xpY3kuZm9ybURhdGEgfVxuICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgaWYgKGVyciBpbnN0YW5jZW9mIGVycm9ycy5JbnZhbGlkQnVja2V0TmFtZUVycm9yKSB7XG4gICAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEFyZ3VtZW50RXJyb3IoYFVuYWJsZSB0byBnZXQgYnVja2V0IHJlZ2lvbiBmb3IgJHtidWNrZXROYW1lfS5gKVxuICAgICAgfVxuXG4gICAgICB0aHJvdyBlcnJcbiAgICB9XG4gIH1cbiAgLy8gbGlzdCBhIGJhdGNoIG9mIG9iamVjdHNcbiAgYXN5bmMgbGlzdE9iamVjdHNRdWVyeShidWNrZXROYW1lOiBzdHJpbmcsIHByZWZpeD86IHN0cmluZywgbWFya2VyPzogc3RyaW5nLCBsaXN0UXVlcnlPcHRzPzogTGlzdE9iamVjdFF1ZXJ5T3B0cykge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmICghaXNTdHJpbmcocHJlZml4KSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigncHJlZml4IHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCInKVxuICAgIH1cbiAgICBpZiAobWFya2VyICYmICFpc1N0cmluZyhtYXJrZXIpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdtYXJrZXIgc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXG4gICAgfVxuXG4gICAgaWYgKGxpc3RRdWVyeU9wdHMgJiYgIWlzT2JqZWN0KGxpc3RRdWVyeU9wdHMpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdsaXN0UXVlcnlPcHRzIHNob3VsZCBiZSBvZiB0eXBlIFwib2JqZWN0XCInKVxuICAgIH1cbiAgICBsZXQgeyBEZWxpbWl0ZXIsIE1heEtleXMsIEluY2x1ZGVWZXJzaW9uLCB2ZXJzaW9uSWRNYXJrZXIsIGtleU1hcmtlciB9ID0gbGlzdFF1ZXJ5T3B0cyBhcyBMaXN0T2JqZWN0UXVlcnlPcHRzXG5cbiAgICBpZiAoIWlzU3RyaW5nKERlbGltaXRlcikpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ0RlbGltaXRlciBzaG91bGQgYmUgb2YgdHlwZSBcInN0cmluZ1wiJylcbiAgICB9XG4gICAgaWYgKCFpc051bWJlcihNYXhLZXlzKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignTWF4S2V5cyBzaG91bGQgYmUgb2YgdHlwZSBcIm51bWJlclwiJylcbiAgICB9XG5cbiAgICBjb25zdCBxdWVyaWVzID0gW11cbiAgICAvLyBlc2NhcGUgZXZlcnkgdmFsdWUgaW4gcXVlcnkgc3RyaW5nLCBleGNlcHQgbWF4S2V5c1xuICAgIHF1ZXJpZXMucHVzaChgcHJlZml4PSR7dXJpRXNjYXBlKHByZWZpeCl9YClcbiAgICBxdWVyaWVzLnB1c2goYGRlbGltaXRlcj0ke3VyaUVzY2FwZShEZWxpbWl0ZXIpfWApXG4gICAgcXVlcmllcy5wdXNoKGBlbmNvZGluZy10eXBlPXVybGApXG5cbiAgICBpZiAoSW5jbHVkZVZlcnNpb24pIHtcbiAgICAgIHF1ZXJpZXMucHVzaChgdmVyc2lvbnNgKVxuICAgIH1cblxuICAgIGlmIChJbmNsdWRlVmVyc2lvbikge1xuICAgICAgLy8gdjEgdmVyc2lvbiBsaXN0aW5nLi5cbiAgICAgIGlmIChrZXlNYXJrZXIpIHtcbiAgICAgICAgcXVlcmllcy5wdXNoKGBrZXktbWFya2VyPSR7a2V5TWFya2VyfWApXG4gICAgICB9XG4gICAgICBpZiAodmVyc2lvbklkTWFya2VyKSB7XG4gICAgICAgIHF1ZXJpZXMucHVzaChgdmVyc2lvbi1pZC1tYXJrZXI9JHt2ZXJzaW9uSWRNYXJrZXJ9YClcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKG1hcmtlcikge1xuICAgICAgbWFya2VyID0gdXJpRXNjYXBlKG1hcmtlcilcbiAgICAgIHF1ZXJpZXMucHVzaChgbWFya2VyPSR7bWFya2VyfWApXG4gICAgfVxuXG4gICAgLy8gbm8gbmVlZCB0byBlc2NhcGUgbWF4S2V5c1xuICAgIGlmIChNYXhLZXlzKSB7XG4gICAgICBpZiAoTWF4S2V5cyA+PSAxMDAwKSB7XG4gICAgICAgIE1heEtleXMgPSAxMDAwXG4gICAgICB9XG4gICAgICBxdWVyaWVzLnB1c2goYG1heC1rZXlzPSR7TWF4S2V5c31gKVxuICAgIH1cbiAgICBxdWVyaWVzLnNvcnQoKVxuICAgIGxldCBxdWVyeSA9ICcnXG4gICAgaWYgKHF1ZXJpZXMubGVuZ3RoID4gMCkge1xuICAgICAgcXVlcnkgPSBgJHtxdWVyaWVzLmpvaW4oJyYnKX1gXG4gICAgfVxuXG4gICAgY29uc3QgbWV0aG9kID0gJ0dFVCdcbiAgICBjb25zdCByZXMgPSBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmMoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIHF1ZXJ5IH0pXG4gICAgY29uc3QgYm9keSA9IGF3YWl0IHJlYWRBc1N0cmluZyhyZXMpXG4gICAgY29uc3QgbGlzdFFyeUxpc3QgPSBwYXJzZUxpc3RPYmplY3RzKGJvZHkpXG4gICAgcmV0dXJuIGxpc3RRcnlMaXN0XG4gIH1cblxuICBsaXN0T2JqZWN0cyhcbiAgICBidWNrZXROYW1lOiBzdHJpbmcsXG4gICAgcHJlZml4Pzogc3RyaW5nLFxuICAgIHJlY3Vyc2l2ZT86IGJvb2xlYW4sXG4gICAgbGlzdE9wdHM/OiBMaXN0T2JqZWN0UXVlcnlPcHRzIHwgdW5kZWZpbmVkLFxuICApOiBCdWNrZXRTdHJlYW08T2JqZWN0SW5mbz4ge1xuICAgIGlmIChwcmVmaXggPT09IHVuZGVmaW5lZCkge1xuICAgICAgcHJlZml4ID0gJydcbiAgICB9XG4gICAgaWYgKHJlY3Vyc2l2ZSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICByZWN1cnNpdmUgPSBmYWxzZVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRQcmVmaXgocHJlZml4KSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkUHJlZml4RXJyb3IoYEludmFsaWQgcHJlZml4IDogJHtwcmVmaXh9YClcbiAgICB9XG4gICAgaWYgKCFpc1N0cmluZyhwcmVmaXgpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdwcmVmaXggc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXG4gICAgfVxuICAgIGlmICghaXNCb29sZWFuKHJlY3Vyc2l2ZSkpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3JlY3Vyc2l2ZSBzaG91bGQgYmUgb2YgdHlwZSBcImJvb2xlYW5cIicpXG4gICAgfVxuICAgIGlmIChsaXN0T3B0cyAmJiAhaXNPYmplY3QobGlzdE9wdHMpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdsaXN0T3B0cyBzaG91bGQgYmUgb2YgdHlwZSBcIm9iamVjdFwiJylcbiAgICB9XG4gICAgbGV0IG1hcmtlcjogc3RyaW5nIHwgdW5kZWZpbmVkID0gJydcbiAgICBsZXQga2V5TWFya2VyOiBzdHJpbmcgfCB1bmRlZmluZWQgPSAnJ1xuICAgIGxldCB2ZXJzaW9uSWRNYXJrZXI6IHN0cmluZyB8IHVuZGVmaW5lZCA9ICcnXG4gICAgbGV0IG9iamVjdHM6IE9iamVjdEluZm9bXSA9IFtdXG4gICAgbGV0IGVuZGVkID0gZmFsc2VcbiAgICBjb25zdCByZWFkU3RyZWFtOiBzdHJlYW0uUmVhZGFibGUgPSBuZXcgc3RyZWFtLlJlYWRhYmxlKHsgb2JqZWN0TW9kZTogdHJ1ZSB9KVxuICAgIHJlYWRTdHJlYW0uX3JlYWQgPSBhc3luYyAoKSA9PiB7XG4gICAgICAvLyBwdXNoIG9uZSBvYmplY3QgcGVyIF9yZWFkKClcbiAgICAgIGlmIChvYmplY3RzLmxlbmd0aCkge1xuICAgICAgICByZWFkU3RyZWFtLnB1c2gob2JqZWN0cy5zaGlmdCgpKVxuICAgICAgICByZXR1cm5cbiAgICAgIH1cbiAgICAgIGlmIChlbmRlZCkge1xuICAgICAgICByZXR1cm4gcmVhZFN0cmVhbS5wdXNoKG51bGwpXG4gICAgICB9XG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IGxpc3RRdWVyeU9wdHMgPSB7XG4gICAgICAgICAgRGVsaW1pdGVyOiByZWN1cnNpdmUgPyAnJyA6ICcvJywgLy8gaWYgcmVjdXJzaXZlIGlzIGZhbHNlIHNldCBkZWxpbWl0ZXIgdG8gJy8nXG4gICAgICAgICAgTWF4S2V5czogMTAwMCxcbiAgICAgICAgICBJbmNsdWRlVmVyc2lvbjogbGlzdE9wdHM/LkluY2x1ZGVWZXJzaW9uLFxuICAgICAgICAgIC8vIHZlcnNpb24gbGlzdGluZyBzcGVjaWZpYyBvcHRpb25zXG4gICAgICAgICAga2V5TWFya2VyOiBrZXlNYXJrZXIsXG4gICAgICAgICAgdmVyc2lvbklkTWFya2VyOiB2ZXJzaW9uSWRNYXJrZXIsXG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCByZXN1bHQ6IExpc3RPYmplY3RRdWVyeVJlcyA9IGF3YWl0IHRoaXMubGlzdE9iamVjdHNRdWVyeShidWNrZXROYW1lLCBwcmVmaXgsIG1hcmtlciwgbGlzdFF1ZXJ5T3B0cylcbiAgICAgICAgaWYgKHJlc3VsdC5pc1RydW5jYXRlZCkge1xuICAgICAgICAgIG1hcmtlciA9IHJlc3VsdC5uZXh0TWFya2VyIHx8IHVuZGVmaW5lZFxuICAgICAgICAgIGlmIChyZXN1bHQua2V5TWFya2VyKSB7XG4gICAgICAgICAgICBrZXlNYXJrZXIgPSByZXN1bHQua2V5TWFya2VyXG4gICAgICAgICAgfVxuICAgICAgICAgIGlmIChyZXN1bHQudmVyc2lvbklkTWFya2VyKSB7XG4gICAgICAgICAgICB2ZXJzaW9uSWRNYXJrZXIgPSByZXN1bHQudmVyc2lvbklkTWFya2VyXG4gICAgICAgICAgfVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGVuZGVkID0gdHJ1ZVxuICAgICAgICB9XG4gICAgICAgIGlmIChyZXN1bHQub2JqZWN0cykge1xuICAgICAgICAgIG9iamVjdHMgPSByZXN1bHQub2JqZWN0c1xuICAgICAgICB9XG4gICAgICAgIC8vIEB0cy1pZ25vcmVcbiAgICAgICAgcmVhZFN0cmVhbS5fcmVhZCgpXG4gICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgcmVhZFN0cmVhbS5lbWl0KCdlcnJvcicsIGVycilcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHJlYWRTdHJlYW1cbiAgfVxuXG4gIGFzeW5jIGxpc3RPYmplY3RzVjJRdWVyeShcbiAgICBidWNrZXROYW1lOiBzdHJpbmcsXG4gICAgcHJlZml4OiBzdHJpbmcsXG4gICAgY29udGludWF0aW9uVG9rZW46IHN0cmluZyxcbiAgICBkZWxpbWl0ZXI6IHN0cmluZyxcbiAgICBtYXhLZXlzOiBudW1iZXIsXG4gICAgc3RhcnRBZnRlcjogc3RyaW5nLFxuICApOiBQcm9taXNlPExpc3RPYmplY3RWMlJlcz4ge1xuICAgIGlmICghaXNWYWxpZEJ1Y2tldE5hbWUoYnVja2V0TmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZEJ1Y2tldE5hbWVFcnJvcignSW52YWxpZCBidWNrZXQgbmFtZTogJyArIGJ1Y2tldE5hbWUpXG4gICAgfVxuICAgIGlmICghaXNTdHJpbmcocHJlZml4KSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcigncHJlZml4IHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCInKVxuICAgIH1cbiAgICBpZiAoIWlzU3RyaW5nKGNvbnRpbnVhdGlvblRva2VuKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignY29udGludWF0aW9uVG9rZW4gc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXG4gICAgfVxuICAgIGlmICghaXNTdHJpbmcoZGVsaW1pdGVyKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignZGVsaW1pdGVyIHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCInKVxuICAgIH1cbiAgICBpZiAoIWlzTnVtYmVyKG1heEtleXMpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdtYXhLZXlzIHNob3VsZCBiZSBvZiB0eXBlIFwibnVtYmVyXCInKVxuICAgIH1cbiAgICBpZiAoIWlzU3RyaW5nKHN0YXJ0QWZ0ZXIpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdzdGFydEFmdGVyIHNob3VsZCBiZSBvZiB0eXBlIFwic3RyaW5nXCInKVxuICAgIH1cblxuICAgIGNvbnN0IHF1ZXJpZXMgPSBbXVxuICAgIHF1ZXJpZXMucHVzaChgbGlzdC10eXBlPTJgKVxuICAgIHF1ZXJpZXMucHVzaChgZW5jb2RpbmctdHlwZT11cmxgKVxuICAgIHF1ZXJpZXMucHVzaChgcHJlZml4PSR7dXJpRXNjYXBlKHByZWZpeCl9YClcbiAgICBxdWVyaWVzLnB1c2goYGRlbGltaXRlcj0ke3VyaUVzY2FwZShkZWxpbWl0ZXIpfWApXG5cbiAgICBpZiAoY29udGludWF0aW9uVG9rZW4pIHtcbiAgICAgIHF1ZXJpZXMucHVzaChgY29udGludWF0aW9uLXRva2VuPSR7dXJpRXNjYXBlKGNvbnRpbnVhdGlvblRva2VuKX1gKVxuICAgIH1cbiAgICBpZiAoc3RhcnRBZnRlcikge1xuICAgICAgcXVlcmllcy5wdXNoKGBzdGFydC1hZnRlcj0ke3VyaUVzY2FwZShzdGFydEFmdGVyKX1gKVxuICAgIH1cbiAgICBpZiAobWF4S2V5cykge1xuICAgICAgaWYgKG1heEtleXMgPj0gMTAwMCkge1xuICAgICAgICBtYXhLZXlzID0gMTAwMFxuICAgICAgfVxuICAgICAgcXVlcmllcy5wdXNoKGBtYXgta2V5cz0ke21heEtleXN9YClcbiAgICB9XG4gICAgcXVlcmllcy5zb3J0KClcbiAgICBsZXQgcXVlcnkgPSAnJ1xuICAgIGlmIChxdWVyaWVzLmxlbmd0aCA+IDApIHtcbiAgICAgIHF1ZXJ5ID0gYCR7cXVlcmllcy5qb2luKCcmJyl9YFxuICAgIH1cblxuICAgIGNvbnN0IG1ldGhvZCA9ICdHRVQnXG4gICAgY29uc3QgcmVzID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jKHsgbWV0aG9kLCBidWNrZXROYW1lLCBxdWVyeSB9KVxuICAgIGNvbnN0IGJvZHkgPSBhd2FpdCByZWFkQXNTdHJpbmcocmVzKVxuICAgIHJldHVybiBwYXJzZUxpc3RPYmplY3RzVjIoYm9keSlcbiAgfVxuXG4gIGxpc3RPYmplY3RzVjIoXG4gICAgYnVja2V0TmFtZTogc3RyaW5nLFxuICAgIHByZWZpeD86IHN0cmluZyxcbiAgICByZWN1cnNpdmU/OiBib29sZWFuLFxuICAgIHN0YXJ0QWZ0ZXI/OiBzdHJpbmcsXG4gICk6IEJ1Y2tldFN0cmVhbTxCdWNrZXRJdGVtPiB7XG4gICAgaWYgKHByZWZpeCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICBwcmVmaXggPSAnJ1xuICAgIH1cbiAgICBpZiAocmVjdXJzaXZlID09PSB1bmRlZmluZWQpIHtcbiAgICAgIHJlY3Vyc2l2ZSA9IGZhbHNlXG4gICAgfVxuICAgIGlmIChzdGFydEFmdGVyID09PSB1bmRlZmluZWQpIHtcbiAgICAgIHN0YXJ0QWZ0ZXIgPSAnJ1xuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzVmFsaWRQcmVmaXgocHJlZml4KSkge1xuICAgICAgdGhyb3cgbmV3IGVycm9ycy5JbnZhbGlkUHJlZml4RXJyb3IoYEludmFsaWQgcHJlZml4IDogJHtwcmVmaXh9YClcbiAgICB9XG4gICAgaWYgKCFpc1N0cmluZyhwcmVmaXgpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdwcmVmaXggc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXG4gICAgfVxuICAgIGlmICghaXNCb29sZWFuKHJlY3Vyc2l2ZSkpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3JlY3Vyc2l2ZSBzaG91bGQgYmUgb2YgdHlwZSBcImJvb2xlYW5cIicpXG4gICAgfVxuICAgIGlmICghaXNTdHJpbmcoc3RhcnRBZnRlcikpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3N0YXJ0QWZ0ZXIgc2hvdWxkIGJlIG9mIHR5cGUgXCJzdHJpbmdcIicpXG4gICAgfVxuXG4gICAgY29uc3QgZGVsaW1pdGVyID0gcmVjdXJzaXZlID8gJycgOiAnLydcbiAgICBjb25zdCBwcmVmaXhTdHIgPSBwcmVmaXhcbiAgICBjb25zdCBzdGFydEFmdGVyU3RyID0gc3RhcnRBZnRlclxuICAgIGxldCBjb250aW51YXRpb25Ub2tlbiA9ICcnXG4gICAgbGV0IG9iamVjdHM6IEJ1Y2tldEl0ZW1bXSA9IFtdXG4gICAgbGV0IGVuZGVkID0gZmFsc2VcbiAgICBjb25zdCByZWFkU3RyZWFtOiBzdHJlYW0uUmVhZGFibGUgPSBuZXcgc3RyZWFtLlJlYWRhYmxlKHsgb2JqZWN0TW9kZTogdHJ1ZSB9KVxuICAgIHJlYWRTdHJlYW0uX3JlYWQgPSBhc3luYyAoKSA9PiB7XG4gICAgICBpZiAob2JqZWN0cy5sZW5ndGgpIHtcbiAgICAgICAgcmVhZFN0cmVhbS5wdXNoKG9iamVjdHMuc2hpZnQoKSlcbiAgICAgICAgcmV0dXJuXG4gICAgICB9XG4gICAgICBpZiAoZW5kZWQpIHtcbiAgICAgICAgcmV0dXJuIHJlYWRTdHJlYW0ucHVzaChudWxsKVxuICAgICAgfVxuXG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLmxpc3RPYmplY3RzVjJRdWVyeShcbiAgICAgICAgICBidWNrZXROYW1lLFxuICAgICAgICAgIHByZWZpeFN0cixcbiAgICAgICAgICBjb250aW51YXRpb25Ub2tlbixcbiAgICAgICAgICBkZWxpbWl0ZXIsXG4gICAgICAgICAgMTAwMCxcbiAgICAgICAgICBzdGFydEFmdGVyU3RyLFxuICAgICAgICApXG4gICAgICAgIGlmIChyZXN1bHQuaXNUcnVuY2F0ZWQpIHtcbiAgICAgICAgICBjb250aW51YXRpb25Ub2tlbiA9IHJlc3VsdC5uZXh0Q29udGludWF0aW9uVG9rZW5cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBlbmRlZCA9IHRydWVcbiAgICAgICAgfVxuICAgICAgICBvYmplY3RzID0gcmVzdWx0Lm9iamVjdHNcbiAgICAgICAgLy8gQHRzLWlnbm9yZVxuICAgICAgICByZWFkU3RyZWFtLl9yZWFkKClcbiAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICByZWFkU3RyZWFtLmVtaXQoJ2Vycm9yJywgZXJyKVxuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gcmVhZFN0cmVhbVxuICB9XG5cbiAgYXN5bmMgc2V0QnVja2V0Tm90aWZpY2F0aW9uKGJ1Y2tldE5hbWU6IHN0cmluZywgY29uZmlnOiBOb3RpZmljYXRpb25Db25maWcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBpZiAoIWlzT2JqZWN0KGNvbmZpZykpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ25vdGlmaWNhdGlvbiBjb25maWcgc2hvdWxkIGJlIG9mIHR5cGUgXCJPYmplY3RcIicpXG4gICAgfVxuICAgIGNvbnN0IG1ldGhvZCA9ICdQVVQnXG4gICAgY29uc3QgcXVlcnkgPSAnbm90aWZpY2F0aW9uJ1xuICAgIGNvbnN0IGJ1aWxkZXIgPSBuZXcgeG1sMmpzLkJ1aWxkZXIoe1xuICAgICAgcm9vdE5hbWU6ICdOb3RpZmljYXRpb25Db25maWd1cmF0aW9uJyxcbiAgICAgIHJlbmRlck9wdHM6IHsgcHJldHR5OiBmYWxzZSB9LFxuICAgICAgaGVhZGxlc3M6IHRydWUsXG4gICAgfSlcbiAgICBjb25zdCBwYXlsb2FkID0gYnVpbGRlci5idWlsZE9iamVjdChjb25maWcpXG4gICAgYXdhaXQgdGhpcy5tYWtlUmVxdWVzdEFzeW5jT21pdCh7IG1ldGhvZCwgYnVja2V0TmFtZSwgcXVlcnkgfSwgcGF5bG9hZClcbiAgfVxuXG4gIGFzeW5jIHJlbW92ZUFsbEJ1Y2tldE5vdGlmaWNhdGlvbihidWNrZXROYW1lOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBhd2FpdCB0aGlzLnNldEJ1Y2tldE5vdGlmaWNhdGlvbihidWNrZXROYW1lLCBuZXcgTm90aWZpY2F0aW9uQ29uZmlnKCkpXG4gIH1cblxuICBhc3luYyBnZXRCdWNrZXROb3RpZmljYXRpb24oYnVja2V0TmFtZTogc3RyaW5nKTogUHJvbWlzZTxOb3RpZmljYXRpb25Db25maWdSZXN1bHQ+IHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoJ0ludmFsaWQgYnVja2V0IG5hbWU6ICcgKyBidWNrZXROYW1lKVxuICAgIH1cbiAgICBjb25zdCBtZXRob2QgPSAnR0VUJ1xuICAgIGNvbnN0IHF1ZXJ5ID0gJ25vdGlmaWNhdGlvbidcbiAgICBjb25zdCByZXMgPSBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0QXN5bmMoeyBtZXRob2QsIGJ1Y2tldE5hbWUsIHF1ZXJ5IH0pXG4gICAgY29uc3QgYm9keSA9IGF3YWl0IHJlYWRBc1N0cmluZyhyZXMpXG4gICAgcmV0dXJuIHBhcnNlQnVja2V0Tm90aWZpY2F0aW9uKGJvZHkpXG4gIH1cblxuICBsaXN0ZW5CdWNrZXROb3RpZmljYXRpb24oXG4gICAgYnVja2V0TmFtZTogc3RyaW5nLFxuICAgIHByZWZpeDogc3RyaW5nLFxuICAgIHN1ZmZpeDogc3RyaW5nLFxuICAgIGV2ZW50czogTm90aWZpY2F0aW9uRXZlbnRbXSxcbiAgKTogTm90aWZpY2F0aW9uUG9sbGVyIHtcbiAgICBpZiAoIWlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldE5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRCdWNrZXROYW1lRXJyb3IoYEludmFsaWQgYnVja2V0IG5hbWU6ICR7YnVja2V0TmFtZX1gKVxuICAgIH1cbiAgICBpZiAoIWlzU3RyaW5nKHByZWZpeCkpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3ByZWZpeCBtdXN0IGJlIG9mIHR5cGUgc3RyaW5nJylcbiAgICB9XG4gICAgaWYgKCFpc1N0cmluZyhzdWZmaXgpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdzdWZmaXggbXVzdCBiZSBvZiB0eXBlIHN0cmluZycpXG4gICAgfVxuICAgIGlmICghQXJyYXkuaXNBcnJheShldmVudHMpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdldmVudHMgbXVzdCBiZSBvZiB0eXBlIEFycmF5JylcbiAgICB9XG4gICAgY29uc3QgbGlzdGVuZXIgPSBuZXcgTm90aWZpY2F0aW9uUG9sbGVyKHRoaXMsIGJ1Y2tldE5hbWUsIHByZWZpeCwgc3VmZml4LCBldmVudHMpXG4gICAgbGlzdGVuZXIuc3RhcnQoKVxuICAgIHJldHVybiBsaXN0ZW5lclxuICB9XG59XG4iXSwibWFwcGluZ3MiOiJBQUFBLE9BQU8sS0FBS0EsTUFBTTtBQUNsQixPQUFPLEtBQUtDLEVBQUU7QUFFZCxPQUFPLEtBQUtDLElBQUk7QUFDaEIsT0FBTyxLQUFLQyxLQUFLO0FBQ2pCLE9BQU8sS0FBS0MsSUFBSTtBQUNoQixPQUFPLEtBQUtDLE1BQU07QUFFbEIsT0FBTyxLQUFLQyxLQUFLLE1BQU0sT0FBTztBQUM5QixPQUFPQyxZQUFZLE1BQU0sZUFBZTtBQUN4QyxTQUFTQyxTQUFTLFFBQVEsaUJBQWlCO0FBQzNDLE9BQU9DLENBQUMsTUFBTSxRQUFRO0FBQ3RCLE9BQU8sS0FBS0MsRUFBRSxNQUFNLGNBQWM7QUFDbEMsT0FBT0MsTUFBTSxNQUFNLFFBQVE7QUFFM0IsU0FBU0Msa0JBQWtCLFFBQVEsMkJBQTBCO0FBQzdELE9BQU8sS0FBS0MsTUFBTSxNQUFNLGVBQWM7QUFFdEMsU0FDRUMsc0JBQXNCLEVBQ3RCQyxpQkFBaUIsRUFDakJDLGNBQWMsRUFDZEMsaUJBQWlCLEVBQ2pCQyx1QkFBdUIsRUFDdkJDLGVBQWUsRUFDZkMsd0JBQXdCLFFBQ25CLGdCQUFlO0FBRXRCLFNBQVNDLGtCQUFrQixFQUFFQyxrQkFBa0IsUUFBUSxxQkFBb0I7QUFDM0UsU0FBU0Msc0JBQXNCLEVBQUVDLGtCQUFrQixFQUFFQyxNQUFNLFFBQVEsZ0JBQWU7QUFDbEYsU0FBU0MsR0FBRyxFQUFFQyxhQUFhLFFBQVEsYUFBWTtBQUMvQyxTQUFTQyxjQUFj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