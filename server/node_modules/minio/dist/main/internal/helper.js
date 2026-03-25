"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.calculateEvenSplits = calculateEvenSplits;
exports.extractMetadata = extractMetadata;
exports.getContentLength = getContentLength;
exports.getEncryptionHeaders = getEncryptionHeaders;
exports.getScope = getScope;
exports.getSourceVersionId = getSourceVersionId;
exports.getVersionId = getVersionId;
exports.hashBinary = hashBinary;
exports.insertContentType = insertContentType;
exports.isAmazonEndpoint = isAmazonEndpoint;
exports.isAmzHeader = isAmzHeader;
exports.isBoolean = isBoolean;
exports.isDefined = isDefined;
exports.isEmpty = isEmpty;
exports.isEmptyObject = isEmptyObject;
exports.isFunction = isFunction;
exports.isNumber = isNumber;
exports.isObject = isObject;
exports.isPlainObject = isPlainObject;
exports.isReadableStream = isReadableStream;
exports.isStorageClassHeader = isStorageClassHeader;
exports.isString = isString;
exports.isSupportedHeader = isSupportedHeader;
exports.isValidBucketName = isValidBucketName;
exports.isValidDate = isValidDate;
exports.isValidDomain = isValidDomain;
exports.isValidEndpoint = isValidEndpoint;
exports.isValidIP = isValidIP;
exports.isValidObjectName = isValidObjectName;
exports.isValidPort = isValidPort;
exports.isValidPrefix = isValidPrefix;
exports.isVirtualHostStyle = isVirtualHostStyle;
exports.makeDateLong = makeDateLong;
exports.makeDateShort = makeDateShort;
exports.parseXml = parseXml;
exports.partsRequired = partsRequired;
exports.pipesetup = pipesetup;
exports.prependXAMZMeta = prependXAMZMeta;
exports.probeContentType = probeContentType;
exports.readableStream = readableStream;
exports.sanitizeETag = sanitizeETag;
exports.sanitizeObjectKey = sanitizeObjectKey;
exports.sanitizeSize = sanitizeSize;
exports.toArray = toArray;
exports.toMd5 = toMd5;
exports.toSha256 = toSha256;
exports.uriEscape = uriEscape;
exports.uriResourceEscape = uriResourceEscape;
var crypto = _interopRequireWildcard(require("crypto"), true);
var stream = _interopRequireWildcard(require("stream"), true);
var _fastXmlParser = require("fast-xml-parser");
var _ipaddr = require("ipaddr.js");
var _lodash = require("lodash");
var mime = _interopRequireWildcard(require("mime-types"), true);
var _async = require("./async.js");
var _type = require("./type.js");
function _interopRequireWildcard(e, t) { if ("function" == typeof WeakMap) var r = new WeakMap(), n = new WeakMap(); return (_interopRequireWildcard = function (e, t) { if (!t && e && e.__esModule) return e; var o, i, f = { __proto__: null, default: e }; if (null === e || "object" != typeof e && "function" != typeof e) return f; if (o = t ? n : r) { if (o.has(e)) return o.get(e); o.set(e, f); } for (const t in e) "default" !== t && {}.hasOwnProperty.call(e, t) && ((i = (o = Object.defineProperty) && Object.getOwnPropertyDescriptor(e, t)) && (i.get || i.set) ? o(f, t, i) : f[t] = e[t]); return f; })(e, t); }
/*
 * MinIO Javascript Library for Amazon S3 Compatible Cloud Storage, (C) 2015 MinIO, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const MetaDataHeaderPrefix = 'x-amz-meta-';
function hashBinary(buf, enableSHA256) {
  let sha256sum = '';
  if (enableSHA256) {
    sha256sum = crypto.createHash('sha256').update(buf).digest('hex');
  }
  const md5sum = crypto.createHash('md5').update(buf).digest('base64');
  return {
    md5sum,
    sha256sum
  };
}

// S3 percent-encodes some extra non-standard characters in a URI . So comply with S3.
const encodeAsHex = c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`;
function uriEscape(uriStr) {
  return encodeURIComponent(uriStr).replace(/[!'()*]/g, encodeAsHex);
}
function uriResourceEscape(string) {
  return uriEscape(string).replace(/%2F/g, '/');
}
function getScope(region, date, serviceName = 's3') {
  return `${makeDateShort(date)}/${region}/${serviceName}/aws4_request`;
}

/**
 * isAmazonEndpoint - true if endpoint is 's3.amazonaws.com' or 's3.cn-north-1.amazonaws.com.cn'
 */
function isAmazonEndpoint(endpoint) {
  return endpoint === 's3.amazonaws.com' || endpoint === 's3.cn-north-1.amazonaws.com.cn';
}

/**
 * isVirtualHostStyle - verify if bucket name is support with virtual
 * hosts. bucketNames with periods should be always treated as path
 * style if the protocol is 'https:', this is due to SSL wildcard
 * limitation. For all other buckets and Amazon S3 endpoint we will
 * default to virtual host style.
 */
function isVirtualHostStyle(endpoint, protocol, bucket, pathStyle) {
  if (protocol === 'https:' && bucket.includes('.')) {
    return false;
  }
  return isAmazonEndpoint(endpoint) || !pathStyle;
}
function isValidIP(ip) {
  return _ipaddr.isValid(ip);
}

/**
 * @returns if endpoint is valid domain.
 */
function isValidEndpoint(endpoint) {
  return isValidDomain(endpoint) || isValidIP(endpoint);
}

/**
 * @returns if input host is a valid domain.
 */
function isValidDomain(host) {
  if (!isString(host)) {
    return false;
  }
  // See RFC 1035, RFC 3696.
  if (host.length === 0 || host.length > 255) {
    return false;
  }
  // Host cannot start or end with a '-'
  if (host[0] === '-' || host.slice(-1) === '-') {
    return false;
  }
  // Host cannot start or end with a '_'
  if (host[0] === '_' || host.slice(-1) === '_') {
    return false;
  }
  // Host cannot start with a '.'
  if (host[0] === '.') {
    return false;
  }
  const nonAlphaNumerics = '`~!@#$%^&*()+={}[]|\\"\';:><?/';
  // All non alphanumeric characters are invalid.
  for (const char of nonAlphaNumerics) {
    if (host.includes(char)) {
      return false;
    }
  }
  // No need to regexp match, since the list is non-exhaustive.
  // We let it be valid and fail later.
  return true;
}

/**
 * Probes contentType using file extensions.
 *
 * @example
 * ```
 * // return 'image/png'
 * probeContentType('file.png')
 * ```
 */
function probeContentType(path) {
  let contentType = mime.lookup(path);
  if (!contentType) {
    contentType = 'application/octet-stream';
  }
  return contentType;
}

/**
 * is input port valid.
 */
function isValidPort(port) {
  // Convert string port to number if needed
  const portNum = typeof port === 'string' ? parseInt(port, 10) : port;

  // verify if port is a valid number
  if (!isNumber(portNum) || isNaN(portNum)) {
    return false;
  }

  // port `0` is valid and special case
  return 0 <= portNum && portNum <= 65535;
}
function isValidBucketName(bucket) {
  if (!isString(bucket)) {
    return false;
  }

  // bucket length should be less than and no more than 63
  // characters long.
  if (bucket.length < 3 || bucket.length > 63) {
    return false;
  }
  // bucket with successive periods is invalid.
  if (bucket.includes('..')) {
    return false;
  }
  // bucket cannot have ip address style.
  if (/[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+/.test(bucket)) {
    return false;
  }
  // bucket should begin with alphabet/number and end with alphabet/number,
  // with alphabet/number/.- in the middle.
  if (/^[a-z0-9][a-z0-9.-]+[a-z0-9]$/.test(bucket)) {
    return true;
  }
  return false;
}

/**
 * check if objectName is a valid object name
 */
function isValidObjectName(objectName) {
  if (!isValidPrefix(objectName)) {
    return false;
  }
  return objectName.length !== 0;
}

/**
 * check if prefix is valid
 */
function isValidPrefix(prefix) {
  if (!isString(prefix)) {
    return false;
  }
  if (prefix.length > 1024) {
    return false;
  }
  return true;
}

/**
 * check if typeof arg number
 */
function isNumber(arg) {
  return typeof arg === 'number';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any

/**
 * check if typeof arg function
 */
function isFunction(arg) {
  return typeof arg === 'function';
}

/**
 * check if typeof arg string
 */
function isString(arg) {
  return typeof arg === 'string';
}

/**
 * check if typeof arg object
 */
function isObject(arg) {
  return typeof arg === 'object' && arg !== null;
}
/**
 * check if typeof arg is plain object
 */
function isPlainObject(arg) {
  return Object.prototype.toString.call(arg) === '[object Object]';
}
/**
 * check if object is readable stream
 */
function isReadableStream(arg) {
  // eslint-disable-next-line @typescript-eslint/unbound-method
  return isObject(arg) && isFunction(arg._read);
}

/**
 * check if arg is boolean
 */
function isBoolean(arg) {
  return typeof arg === 'boolean';
}
function isEmpty(o) {
  return _lodash.isEmpty(o);
}
function isEmptyObject(o) {
  return Object.values(o).filter(x => x !== undefined).length !== 0;
}
function isDefined(o) {
  return o !== null && o !== undefined;
}

/**
 * check if arg is a valid date
 */
function isValidDate(arg) {
  // @ts-expect-error checknew Date(Math.NaN)
  return arg instanceof Date && !isNaN(arg);
}

/**
 * Create a Date string with format: 'YYYYMMDDTHHmmss' + Z
 */
function makeDateLong(date) {
  date = date || new Date();

  // Gives format like: '2017-08-07T16:28:59.889Z'
  const s = date.toISOString();
  return s.slice(0, 4) + s.slice(5, 7) + s.slice(8, 13) + s.slice(14, 16) + s.slice(17, 19) + 'Z';
}

/**
 * Create a Date string with format: 'YYYYMMDD'
 */
function makeDateShort(date) {
  date = date || new Date();

  // Gives format like: '2017-08-07T16:28:59.889Z'
  const s = date.toISOString();
  return s.slice(0, 4) + s.slice(5, 7) + s.slice(8, 10);
}

/**
 * pipesetup sets up pipe() from left to right os streams array
 * pipesetup will also make sure that error emitted at any of the upstream Stream
 * will be emitted at the last stream. This makes error handling simple
 */
function pipesetup(...streams) {
  // @ts-expect-error ts can't narrow this
  return streams.reduce((src, dst) => {
    src.on('error', err => dst.emit('error', err));
    return src.pipe(dst);
  });
}

/**
 * return a Readable stream that emits data
 */
function readableStream(data) {
  const s = new stream.Readable();
  s._read = () => {};
  s.push(data);
  s.push(null);
  return s;
}

/**
 * Process metadata to insert appropriate value to `content-type` attribute
 */
function insertContentType(metaData, filePath) {
  // check if content-type attribute present in metaData
  for (const key in metaData) {
    if (key.toLowerCase() === 'content-type') {
      return metaData;
    }
  }

  // if `content-type` attribute is not present in metadata, then infer it from the extension in filePath
  return {
    ...metaData,
    'content-type': probeContentType(filePath)
  };
}

/**
 * Function prepends metadata with the appropriate prefix if it is not already on
 */
function prependXAMZMeta(metaData) {
  if (!metaData) {
    return {};
  }
  return _lodash.mapKeys(metaData, (value, key) => {
    if (isAmzHeader(key) || isSupportedHeader(key) || isStorageClassHeader(key)) {
      return key;
    }
    return MetaDataHeaderPrefix + key;
  });
}

/**
 * Checks if it is a valid header according to the AmazonS3 API
 */
function isAmzHeader(key) {
  const temp = key.toLowerCase();
  return temp.startsWith(MetaDataHeaderPrefix) || temp === 'x-amz-acl' || temp.startsWith('x-amz-server-side-encryption-') || temp === 'x-amz-server-side-encryption';
}

/**
 * Checks if it is a supported Header
 */
function isSupportedHeader(key) {
  const supported_headers = ['content-type', 'cache-control', 'content-encoding', 'content-disposition', 'content-language', 'x-amz-website-redirect-location', 'if-none-match', 'if-match'];
  return supported_headers.includes(key.toLowerCase());
}

/**
 * Checks if it is a storage header
 */
function isStorageClassHeader(key) {
  return key.toLowerCase() === 'x-amz-storage-class';
}
function extractMetadata(headers) {
  return _lodash.mapKeys(_lodash.pickBy(headers, (value, key) => isSupportedHeader(key) || isStorageClassHeader(key) || isAmzHeader(key)), (value, key) => {
    const lower = key.toLowerCase();
    if (lower.startsWith(MetaDataHeaderPrefix)) {
      return lower.slice(MetaDataHeaderPrefix.length);
    }
    return key;
  });
}
function getVersionId(headers = {}) {
  return headers['x-amz-version-id'] || null;
}
function getSourceVersionId(headers = {}) {
  return headers['x-amz-copy-source-version-id'] || null;
}
function sanitizeETag(etag = '') {
  const replaceChars = {
    '"': '',
    '&quot;': '',
    '&#34;': '',
    '&QUOT;': '',
    '&#x00022': ''
  };
  return etag.replace(/^("|&quot;|&#34;)|("|&quot;|&#34;)$/g, m => replaceChars[m]);
}
function toMd5(payload) {
  // use string from browser and buffer from nodejs
  // browser support is tested only against minio server
  return crypto.createHash('md5').update(Buffer.from(payload)).digest().toString('base64');
}
function toSha256(payload) {
  return crypto.createHash('sha256').update(payload).digest('hex');
}

/**
 * toArray returns a single element array with param being the element,
 * if param is just a string, and returns 'param' back if it is an array
 * So, it makes sure param is always an array
 */
function toArray(param) {
  if (!Array.isArray(param)) {
    return [param];
  }
  return param;
}
function sanitizeObjectKey(objectName) {
  // + symbol characters are not decoded as spaces in JS. so replace them first and decode to get the correct result.
  const asStrName = (objectName ? objectName.toString() : '').replace(/\+/g, ' ');
  return decodeURIComponent(asStrName);
}
function sanitizeSize(size) {
  return size ? Number.parseInt(size) : undefined;
}
const PART_CONSTRAINTS = {
  // absMinPartSize - absolute minimum part size (5 MiB)
  ABS_MIN_PART_SIZE: 1024 * 1024 * 5,
  // MIN_PART_SIZE - minimum part size 16MiB per object after which
  MIN_PART_SIZE: 1024 * 1024 * 16,
  // MAX_PARTS_COUNT - maximum number of parts for a single multipart session.
  MAX_PARTS_COUNT: 10000,
  // MAX_PART_SIZE - maximum part size 5GiB for a single multipart upload
  // operation.
  MAX_PART_SIZE: 1024 * 1024 * 1024 * 5,
  // MAX_SINGLE_PUT_OBJECT_SIZE - maximum size 5GiB of object per PUT
  // operation.
  MAX_SINGLE_PUT_OBJECT_SIZE: 1024 * 1024 * 1024 * 5,
  // MAX_MULTIPART_PUT_OBJECT_SIZE - maximum size 5TiB of object for
  // Multipart operation.
  MAX_MULTIPART_PUT_OBJECT_SIZE: 1024 * 1024 * 1024 * 1024 * 5
};
exports.PART_CONSTRAINTS = PART_CONSTRAINTS;
const GENERIC_SSE_HEADER = 'X-Amz-Server-Side-Encryption';
const ENCRYPTION_HEADERS = {
  // sseGenericHeader is the AWS SSE header used for SSE-S3 and SSE-KMS.
  sseGenericHeader: GENERIC_SSE_HEADER,
  // sseKmsKeyID is the AWS SSE-KMS key id.
  sseKmsKeyID: GENERIC_SSE_HEADER + '-Aws-Kms-Key-Id'
};

/**
 * Return Encryption headers
 * @param encConfig
 * @returns an object with key value pairs that can be used in headers.
 */
function getEncryptionHeaders(encConfig) {
  const encType = encConfig.type;
  if (!isEmpty(encType)) {
    if (encType === _type.ENCRYPTION_TYPES.SSEC) {
      return {
        [ENCRYPTION_HEADERS.sseGenericHeader]: 'AES256'
      };
    } else if (encType === _type.ENCRYPTION_TYPES.KMS) {
      return {
        [ENCRYPTION_HEADERS.sseGenericHeader]: encConfig.SSEAlgorithm,
        [ENCRYPTION_HEADERS.sseKmsKeyID]: encConfig.KMSMasterKeyID
      };
    }
  }
  return {};
}
function partsRequired(size) {
  const maxPartSize = PART_CONSTRAINTS.MAX_MULTIPART_PUT_OBJECT_SIZE / (PART_CONSTRAINTS.MAX_PARTS_COUNT - 1);
  let requiredPartSize = size / maxPartSize;
  if (size % maxPartSize > 0) {
    requiredPartSize++;
  }
  requiredPartSize = Math.trunc(requiredPartSize);
  return requiredPartSize;
}

/**
 * calculateEvenSplits - computes splits for a source and returns
 * start and end index slices. Splits happen evenly to be sure that no
 * part is less than 5MiB, as that could fail the multipart request if
 * it is not the last part.
 */
function calculateEvenSplits(size, objInfo) {
  if (size === 0) {
    return null;
  }
  const reqParts = partsRequired(size);
  const startIndexParts = [];
  const endIndexParts = [];
  let start = objInfo.Start;
  if (isEmpty(start) || start === -1) {
    start = 0;
  }
  const divisorValue = Math.trunc(size / reqParts);
  const reminderValue = size % reqParts;
  let nextStart = start;
  for (let i = 0; i < reqParts; i++) {
    let curPartSize = divisorValue;
    if (i < reminderValue) {
      curPartSize++;
    }
    const currentStart = nextStart;
    const currentEnd = currentStart + curPartSize - 1;
    nextStart = currentEnd + 1;
    startIndexParts.push(currentStart);
    endIndexParts.push(currentEnd);
  }
  return {
    startIndex: startIndexParts,
    endIndex: endIndexParts,
    objInfo: objInfo
  };
}
const fxp = new _fastXmlParser.XMLParser({
  numberParseOptions: {
    eNotation: false,
    hex: true,
    leadingZeros: true
  }
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseXml(xml) {
  const result = fxp.parse(xml);
  if (result.Error) {
    throw result.Error;
  }
  return result;
}

/**
 * get content size of object content to upload
 */
async function getContentLength(s) {
  // use length property of string | Buffer
  if (typeof s === 'string' || Buffer.isBuffer(s)) {
    return s.length;
  }

  // property of `fs.ReadStream`
  const filePath = s.path;
  if (filePath && typeof filePath === 'string') {
    const stat = await _async.fsp.lstat(filePath);
    return stat.size;
  }

  // property of `fs.ReadStream`
  const fd = s.fd;
  if (fd && typeof fd === 'number') {
    const stat = await (0, _async.fstat)(fd);
    return stat.size;
  }
  return null;
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJjcnlwdG8iLCJfaW50ZXJvcFJlcXVpcmVXaWxkY2FyZCIsInJlcXVpcmUiLCJzdHJlYW0iLCJfZmFzdFhtbFBhcnNlciIsIl9pcGFkZHIiLCJfbG9kYXNoIiwibWltZSIsIl9hc3luYyIsIl90eXBlIiwiZSIsInQiLCJXZWFrTWFwIiwiciIsIm4iLCJfX2VzTW9kdWxlIiwibyIsImkiLCJmIiwiX19wcm90b19fIiwiZGVmYXVsdCIsImhhcyIsImdldCIsInNldCIsImhhc093blByb3BlcnR5IiwiY2FsbCIsIk9iamVjdCIsImRlZmluZVByb3BlcnR5IiwiZ2V0T3duUHJvcGVydHlEZXNjcmlwdG9yIiwiTWV0YURhdGFIZWFkZXJQcmVmaXgiLCJoYXNoQmluYXJ5IiwiYnVmIiwiZW5hYmxlU0hBMjU2Iiwic2hhMjU2c3VtIiwiY3JlYXRlSGFzaCIsInVwZGF0ZSIsImRpZ2VzdCIsIm1kNXN1bSIsImVuY29kZUFzSGV4IiwiYyIsImNoYXJDb2RlQXQiLCJ0b1N0cmluZyIsInRvVXBwZXJDYXNlIiwidXJpRXNjYXBlIiwidXJpU3RyIiwiZW5jb2RlVVJJQ29tcG9uZW50IiwicmVwbGFjZSIsInVyaVJlc291cmNlRXNjYXBlIiwic3RyaW5nIiwiZ2V0U2NvcGUiLCJyZWdpb24iLCJkYXRlIiwic2VydmljZU5hbWUiLCJtYWtlRGF0ZVNob3J0IiwiaXNBbWF6b25FbmRwb2ludCIsImVuZHBvaW50IiwiaXNWaXJ0dWFsSG9zdFN0eWxlIiwicHJvdG9jb2wiLCJidWNrZXQiLCJwYXRoU3R5bGUiLCJpbmNsdWRlcyIsImlzVmFsaWRJUCIsImlwIiwiaXBhZGRyIiwiaXNWYWxpZCIsImlzVmFsaWRFbmRwb2ludCIsImlzVmFsaWREb21haW4iLCJob3N0IiwiaXNTdHJpbmciLCJsZW5ndGgiLCJzbGljZSIsIm5vbkFscGhhTnVtZXJpY3MiLCJjaGFyIiwicHJvYmVDb250ZW50VHlwZSIsInBhdGgiLCJjb250ZW50VHlwZSIsImxvb2t1cCIsImlzVmFsaWRQb3J0IiwicG9ydCIsInBvcnROdW0iLCJwYXJzZUludCIsImlzTnVtYmVyIiwiaXNOYU4iLCJpc1ZhbGlkQnVja2V0TmFtZSIsInRlc3QiLCJpc1ZhbGlkT2JqZWN0TmFtZSIsIm9iamVjdE5hbWUiLCJpc1ZhbGlkUHJlZml4IiwicHJlZml4IiwiYXJnIiwiaXNGdW5jdGlvbiIsImlzT2JqZWN0IiwiaXNQbGFpbk9iamVjdCIsInByb3RvdHlwZSIsImlzUmVhZGFibGVTdHJlYW0iLCJfcmVhZCIsImlzQm9vbGVhbiIsImlzRW1wdHkiLCJfIiwiaXNFbXB0eU9iamVjdCIsInZhbHVlcyIsImZpbHRlciIsIngiLCJ1bmRlZmluZWQiLCJpc0RlZmluZWQiLCJpc1ZhbGlkRGF0ZSIsIkRhdGUiLCJtYWtlRGF0ZUxvbmciLCJzIiwidG9JU09TdHJpbmciLCJwaXBlc2V0dXAiLCJzdHJlYW1zIiwicmVkdWNlIiwic3JjIiwiZHN0Iiwib24iLCJlcnIiLCJlbWl0IiwicGlwZSIsInJlYWRhYmxlU3RyZWFtIiwiZGF0YSIsIlJlYWRhYmxlIiwicHVzaCIsImluc2VydENvbnRlbnRUeXBlIiwibWV0YURhdGEiLCJmaWxlUGF0aCIsImtleSIsInRvTG93ZXJDYXNlIiwicHJlcGVuZFhBTVpNZXRhIiwibWFwS2V5cyIsInZhbHVlIiwiaXNBbXpIZWFkZXIiLCJpc1N1cHBvcnRlZEhlYWRlciIsImlzU3RvcmFnZUNsYXNzSGVhZGVyIiwidGVtcCIsInN0YXJ0c1dpdGgiLCJzdXBwb3J0ZWRfaGVhZGVycyIsImV4dHJhY3RNZXRhZGF0YSIsImhlYWRlcnMiLCJwaWNrQnkiLCJsb3dlciIsImdldFZlcnNpb25JZCIsImdldFNvdXJjZVZlcnNpb25JZCIsInNhbml0aXplRVRhZyIsImV0YWciLCJyZXBsYWNlQ2hhcnMiLCJtIiwidG9NZDUiLCJwYXlsb2FkIiwiQnVmZmVyIiwiZnJvbSIsInRvU2hhMjU2IiwidG9BcnJheSIsInBhcmFtIiwiQXJyYXkiLCJpc0FycmF5Iiwic2FuaXRpemVPYmplY3RLZXkiLCJhc1N0ck5hbWUiLCJkZWNvZGVVUklDb21wb25lbnQiLCJzYW5pdGl6ZVNpemUiLCJzaXplIiwiTnVtYmVyIiwiUEFSVF9DT05TVFJBSU5UUyIsIkFCU19NSU5fUEFSVF9TSVpFIiwiTUlOX1BBUlRfU0laRSIsIk1BWF9QQVJUU19DT1VOVCIsIk1BWF9QQVJUX1NJWkUiLCJNQVhfU0lOR0xFX1BVVF9PQkpFQ1RfU0laRSIsIk1BWF9NVUxUSVBBUlRfUFVUX09CSkVDVF9TSVpFIiwiZXhwb3J0cyIsIkdFTkVSSUNfU1NFX0hFQURFUiIsIkVOQ1JZUFRJT05fSEVBREVSUyIsInNzZUdlbmVyaWNIZWFkZXIiLCJzc2VLbXNLZXlJRCIsImdldEVuY3J5cHRpb25IZWFkZXJzIiwiZW5jQ29uZmlnIiwiZW5jVHlwZSIsInR5cGUiLCJFTkNSWVBUSU9OX1RZUEVTIiwiU1NFQyIsIktNUyIsIlNTRUFsZ29yaXRobSIsIktNU01hc3RlcktleUlEIiwicGFydHNSZXF1aXJlZCIsIm1heFBhcnRTaXplIiwicmVxdWlyZWRQYXJ0U2l6ZSIsIk1hdGgiLCJ0cnVuYyIsImNhbGN1bGF0ZUV2ZW5TcGxpdHMiLCJvYmpJbmZvIiwicmVxUGFydHMiLCJzdGFydEluZGV4UGFydHMiLCJlbmRJbmRleFBhcnRzIiwic3RhcnQiLCJTdGFydCIsImRpdmlzb3JWYWx1ZSIsInJlbWluZGVyVmFsdWUiLCJuZXh0U3RhcnQiLCJjdXJQYXJ0U2l6ZSIsImN1cnJlbnRTdGFydCIsImN1cnJlbnRFbmQiLCJzdGFydEluZGV4IiwiZW5kSW5kZXgiLCJmeHAiLCJYTUxQYXJzZXIiLCJudW1iZXJQYXJzZU9wdGlvbnMiLCJlTm90YXRpb24iLCJoZXgiLCJsZWFkaW5nWmVyb3MiLCJwYXJzZVhtbCIsInhtbCIsInJlc3VsdCIsInBhcnNlIiwiRXJyb3IiLCJnZXRDb250ZW50TGVuZ3RoIiwiaXNCdWZmZXIiLCJzdGF0IiwiZnNwIiwibHN0YXQiLCJmZCIsImZzdGF0Il0sInNvdXJjZXMiOlsiaGVscGVyLnRzIl0sInNvdXJjZXNDb250ZW50IjpbIi8qXG4gKiBNaW5JTyBKYXZhc2NyaXB0IExpYnJhcnkgZm9yIEFtYXpvbiBTMyBDb21wYXRpYmxlIENsb3VkIFN0b3JhZ2UsIChDKSAyMDE1IE1pbklPLCBJbmMuXG4gKlxuICogTGljZW5zZWQgdW5kZXIgdGhlIEFwYWNoZSBMaWNlbnNlLCBWZXJzaW9uIDIuMCAodGhlIFwiTGljZW5zZVwiKTtcbiAqIHlvdSBtYXkgbm90IHVzZSB0aGlzIGZpbGUgZXhjZXB0IGluIGNvbXBsaWFuY2Ugd2l0aCB0aGUgTGljZW5zZS5cbiAqIFlvdSBtYXkgb2J0YWluIGEgY29weSBvZiB0aGUgTGljZW5zZSBhdFxuICpcbiAqICAgICBodHRwOi8vd3d3LmFwYWNoZS5vcmcvbGljZW5zZXMvTElDRU5TRS0yLjBcbiAqXG4gKiBVbmxlc3MgcmVxdWlyZWQgYnkgYXBwbGljYWJsZSBsYXcgb3IgYWdyZWVkIHRvIGluIHdyaXRpbmcsIHNvZnR3YXJlXG4gKiBkaXN0cmlidXRlZCB1bmRlciB0aGUgTGljZW5zZSBpcyBkaXN0cmlidXRlZCBvbiBhbiBcIkFTIElTXCIgQkFTSVMsXG4gKiBXSVRIT1VUIFdBUlJBTlRJRVMgT1IgQ09ORElUSU9OUyBPRiBBTlkgS0lORCwgZWl0aGVyIGV4cHJlc3Mgb3IgaW1wbGllZC5cbiAqIFNlZSB0aGUgTGljZW5zZSBmb3IgdGhlIHNwZWNpZmljIGxhbmd1YWdlIGdvdmVybmluZyBwZXJtaXNzaW9ucyBhbmRcbiAqIGxpbWl0YXRpb25zIHVuZGVyIHRoZSBMaWNlbnNlLlxuICovXG5cbmltcG9ydCAqIGFzIGNyeXB0byBmcm9tICdub2RlOmNyeXB0bydcbmltcG9ydCAqIGFzIHN0cmVhbSBmcm9tICdub2RlOnN0cmVhbSdcblxuaW1wb3J0IHsgWE1MUGFyc2VyIH0gZnJvbSAnZmFzdC14bWwtcGFyc2VyJ1xuaW1wb3J0IGlwYWRkciBmcm9tICdpcGFkZHIuanMnXG5pbXBvcnQgXyBmcm9tICdsb2Rhc2gnXG5pbXBvcnQgKiBhcyBtaW1lIGZyb20gJ21pbWUtdHlwZXMnXG5cbmltcG9ydCB7IGZzcCwgZnN0YXQgfSBmcm9tICcuL2FzeW5jLnRzJ1xuaW1wb3J0IHR5cGUgeyBCaW5hcnksIEVuY3J5cHRpb24sIE9iamVjdE1ldGFEYXRhLCBSZXF1ZXN0SGVhZGVycywgUmVzcG9uc2VIZWFkZXIgfSBmcm9tICcuL3R5cGUudHMnXG5pbXBvcnQgeyBFTkNSWVBUSU9OX1RZUEVTIH0gZnJvbSAnLi90eXBlLnRzJ1xuXG5jb25zdCBNZXRhRGF0YUhlYWRlclByZWZpeCA9ICd4LWFtei1tZXRhLSdcblxuZXhwb3J0IGZ1bmN0aW9uIGhhc2hCaW5hcnkoYnVmOiBCdWZmZXIsIGVuYWJsZVNIQTI1NjogYm9vbGVhbikge1xuICBsZXQgc2hhMjU2c3VtID0gJydcbiAgaWYgKGVuYWJsZVNIQTI1Nikge1xuICAgIHNoYTI1NnN1bSA9IGNyeXB0by5jcmVhdGVIYXNoKCdzaGEyNTYnKS51cGRhdGUoYnVmKS5kaWdlc3QoJ2hleCcpXG4gIH1cbiAgY29uc3QgbWQ1c3VtID0gY3J5cHRvLmNyZWF0ZUhhc2goJ21kNScpLnVwZGF0ZShidWYpLmRpZ2VzdCgnYmFzZTY0JylcblxuICByZXR1cm4geyBtZDVzdW0sIHNoYTI1NnN1bSB9XG59XG5cbi8vIFMzIHBlcmNlbnQtZW5jb2RlcyBzb21lIGV4dHJhIG5vbi1zdGFuZGFyZCBjaGFyYWN0ZXJzIGluIGEgVVJJIC4gU28gY29tcGx5IHdpdGggUzMuXG5jb25zdCBlbmNvZGVBc0hleCA9IChjOiBzdHJpbmcpID0+IGAlJHtjLmNoYXJDb2RlQXQoMCkudG9TdHJpbmcoMTYpLnRvVXBwZXJDYXNlKCl9YFxuZXhwb3J0IGZ1bmN0aW9uIHVyaUVzY2FwZSh1cmlTdHI6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBlbmNvZGVVUklDb21wb25lbnQodXJpU3RyKS5yZXBsYWNlKC9bIScoKSpdL2csIGVuY29kZUFzSGV4KVxufVxuXG5leHBvcnQgZnVuY3Rpb24gdXJpUmVzb3VyY2VFc2NhcGUoc3RyaW5nOiBzdHJpbmcpIHtcbiAgcmV0dXJuIHVyaUVzY2FwZShzdHJpbmcpLnJlcGxhY2UoLyUyRi9nLCAnLycpXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBnZXRTY29wZShyZWdpb246IHN0cmluZywgZGF0ZTogRGF0ZSwgc2VydmljZU5hbWUgPSAnczMnKSB7XG4gIHJldHVybiBgJHttYWtlRGF0ZVNob3J0KGRhdGUpfS8ke3JlZ2lvbn0vJHtzZXJ2aWNlTmFtZX0vYXdzNF9yZXF1ZXN0YFxufVxuXG4vKipcbiAqIGlzQW1hem9uRW5kcG9pbnQgLSB0cnVlIGlmIGVuZHBvaW50IGlzICdzMy5hbWF6b25hd3MuY29tJyBvciAnczMuY24tbm9ydGgtMS5hbWF6b25hd3MuY29tLmNuJ1xuICovXG5leHBvcnQgZnVuY3Rpb24gaXNBbWF6b25FbmRwb2ludChlbmRwb2ludDogc3RyaW5nKSB7XG4gIHJldHVybiBlbmRwb2ludCA9PT0gJ3MzLmFtYXpvbmF3cy5jb20nIHx8IGVuZHBvaW50ID09PSAnczMuY24tbm9ydGgtMS5hbWF6b25hd3MuY29tLmNuJ1xufVxuXG4vKipcbiAqIGlzVmlydHVhbEhvc3RTdHlsZSAtIHZlcmlmeSBpZiBidWNrZXQgbmFtZSBpcyBzdXBwb3J0IHdpdGggdmlydHVhbFxuICogaG9zdHMuIGJ1Y2tldE5hbWVzIHdpdGggcGVyaW9kcyBzaG91bGQgYmUgYWx3YXlzIHRyZWF0ZWQgYXMgcGF0aFxuICogc3R5bGUgaWYgdGhlIHByb3RvY29sIGlzICdodHRwczonLCB0aGlzIGlzIGR1ZSB0byBTU0wgd2lsZGNhcmRcbiAqIGxpbWl0YXRpb24uIEZvciBhbGwgb3RoZXIgYnVja2V0cyBhbmQgQW1hem9uIFMzIGVuZHBvaW50IHdlIHdpbGxcbiAqIGRlZmF1bHQgdG8gdmlydHVhbCBob3N0IHN0eWxlLlxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNWaXJ0dWFsSG9zdFN0eWxlKGVuZHBvaW50OiBzdHJpbmcsIHByb3RvY29sOiBzdHJpbmcsIGJ1Y2tldDogc3RyaW5nLCBwYXRoU3R5bGU6IGJvb2xlYW4pIHtcbiAgaWYgKHByb3RvY29sID09PSAnaHR0cHM6JyAmJiBidWNrZXQuaW5jbHVkZXMoJy4nKSkge1xuICAgIHJldHVybiBmYWxzZVxuICB9XG4gIHJldHVybiBpc0FtYXpvbkVuZHBvaW50KGVuZHBvaW50KSB8fCAhcGF0aFN0eWxlXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBpc1ZhbGlkSVAoaXA6IHN0cmluZykge1xuICByZXR1cm4gaXBhZGRyLmlzVmFsaWQoaXApXG59XG5cbi8qKlxuICogQHJldHVybnMgaWYgZW5kcG9pbnQgaXMgdmFsaWQgZG9tYWluLlxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNWYWxpZEVuZHBvaW50KGVuZHBvaW50OiBzdHJpbmcpIHtcbiAgcmV0dXJuIGlzVmFsaWREb21haW4oZW5kcG9pbnQpIHx8IGlzVmFsaWRJUChlbmRwb2ludClcbn1cblxuLyoqXG4gKiBAcmV0dXJucyBpZiBpbnB1dCBob3N0IGlzIGEgdmFsaWQgZG9tYWluLlxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNWYWxpZERvbWFpbihob3N0OiBzdHJpbmcpIHtcbiAgaWYgKCFpc1N0cmluZyhob3N0KSkge1xuICAgIHJldHVybiBmYWxzZVxuICB9XG4gIC8vIFNlZSBSRkMgMTAzNSwgUkZDIDM2OTYuXG4gIGlmIChob3N0Lmxlbmd0aCA9PT0gMCB8fCBob3N0Lmxlbmd0aCA+IDI1NSkge1xuICAgIHJldHVybiBmYWxzZVxuICB9XG4gIC8vIEhvc3QgY2Fubm90IHN0YXJ0IG9yIGVuZCB3aXRoIGEgJy0nXG4gIGlmIChob3N0WzBdID09PSAnLScgfHwgaG9zdC5zbGljZSgtMSkgPT09ICctJykge1xuICAgIHJldHVybiBmYWxzZVxuICB9XG4gIC8vIEhvc3QgY2Fubm90IHN0YXJ0IG9yIGVuZCB3aXRoIGEgJ18nXG4gIGlmIChob3N0WzBdID09PSAnXycgfHwgaG9zdC5zbGljZSgtMSkgPT09ICdfJykge1xuICAgIHJldHVybiBmYWxzZVxuICB9XG4gIC8vIEhvc3QgY2Fubm90IHN0YXJ0IHdpdGggYSAnLidcbiAgaWYgKGhvc3RbMF0gPT09ICcuJykge1xuICAgIHJldHVybiBmYWxzZVxuICB9XG5cbiAgY29uc3Qgbm9uQWxwaGFOdW1lcmljcyA9ICdgfiFAIyQlXiYqKCkrPXt9W118XFxcXFwiXFwnOzo+PD8vJ1xuICAvLyBBbGwgbm9uIGFscGhhbnVtZXJpYyBjaGFyYWN0ZXJzIGFyZSBpbnZhbGlkLlxuICBmb3IgKGNvbnN0IGNoYXIgb2Ygbm9uQWxwaGFOdW1lcmljcykge1xuICAgIGlmIChob3N0LmluY2x1ZGVzKGNoYXIpKSB7XG4gICAgICByZXR1cm4gZmFsc2VcbiAgICB9XG4gIH1cbiAgLy8gTm8gbmVlZCB0byByZWdleHAgbWF0Y2gsIHNpbmNlIHRoZSBsaXN0IGlzIG5vbi1leGhhdXN0aXZlLlxuICAvLyBXZSBsZXQgaXQgYmUgdmFsaWQgYW5kIGZhaWwgbGF0ZXIuXG4gIHJldHVybiB0cnVlXG59XG5cbi8qKlxuICogUHJvYmVzIGNvbnRlbnRUeXBlIHVzaW5nIGZpbGUgZXh0ZW5zaW9ucy5cbiAqXG4gKiBAZXhhbXBsZVxuICogYGBgXG4gKiAvLyByZXR1cm4gJ2ltYWdlL3BuZydcbiAqIHByb2JlQ29udGVudFR5cGUoJ2ZpbGUucG5nJylcbiAqIGBgYFxuICovXG5leHBvcnQgZnVuY3Rpb24gcHJvYmVDb250ZW50VHlwZShwYXRoOiBzdHJpbmcpIHtcbiAgbGV0IGNvbnRlbnRUeXBlID0gbWltZS5sb29rdXAocGF0aClcbiAgaWYgKCFjb250ZW50VHlwZSkge1xuICAgIGNvbnRlbnRUeXBlID0gJ2FwcGxpY2F0aW9uL29jdGV0LXN0cmVhbSdcbiAgfVxuICByZXR1cm4gY29udGVudFR5cGVcbn1cblxuLyoqXG4gKiBpcyBpbnB1dCBwb3J0IHZhbGlkLlxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNWYWxpZFBvcnQocG9ydDogdW5rbm93bik6IHBvcnQgaXMgbnVtYmVyIHtcbiAgLy8gQ29udmVydCBzdHJpbmcgcG9ydCB0byBudW1iZXIgaWYgbmVlZGVkXG4gIGNvbnN0IHBvcnROdW0gPSB0eXBlb2YgcG9ydCA9PT0gJ3N0cmluZycgPyBwYXJzZUludChwb3J0LCAxMCkgOiBwb3J0XG5cbiAgLy8gdmVyaWZ5IGlmIHBvcnQgaXMgYSB2YWxpZCBudW1iZXJcbiAgaWYgKCFpc051bWJlcihwb3J0TnVtKSB8fCBpc05hTihwb3J0TnVtKSkge1xuICAgIHJldHVybiBmYWxzZVxuICB9XG5cbiAgLy8gcG9ydCBgMGAgaXMgdmFsaWQgYW5kIHNwZWNpYWwgY2FzZVxuICByZXR1cm4gMCA8PSBwb3J0TnVtICYmIHBvcnROdW0gPD0gNjU1MzVcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGlzVmFsaWRCdWNrZXROYW1lKGJ1Y2tldDogdW5rbm93bikge1xuICBpZiAoIWlzU3RyaW5nKGJ1Y2tldCkpIHtcbiAgICByZXR1cm4gZmFsc2VcbiAgfVxuXG4gIC8vIGJ1Y2tldCBsZW5ndGggc2hvdWxkIGJlIGxlc3MgdGhhbiBhbmQgbm8gbW9yZSB0aGFuIDYzXG4gIC8vIGNoYXJhY3RlcnMgbG9uZy5cbiAgaWYgKGJ1Y2tldC5sZW5ndGggPCAzIHx8IGJ1Y2tldC5sZW5ndGggPiA2Mykge1xuICAgIHJldHVybiBmYWxzZVxuICB9XG4gIC8vIGJ1Y2tldCB3aXRoIHN1Y2Nlc3NpdmUgcGVyaW9kcyBpcyBpbnZhbGlkLlxuICBpZiAoYnVja2V0LmluY2x1ZGVzKCcuLicpKSB7XG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cbiAgLy8gYnVja2V0IGNhbm5vdCBoYXZlIGlwIGFkZHJlc3Mgc3R5bGUuXG4gIGlmICgvWzAtOV0rXFwuWzAtOV0rXFwuWzAtOV0rXFwuWzAtOV0rLy50ZXN0KGJ1Y2tldCkpIHtcbiAgICByZXR1cm4gZmFsc2VcbiAgfVxuICAvLyBidWNrZXQgc2hvdWxkIGJlZ2luIHdpdGggYWxwaGFiZXQvbnVtYmVyIGFuZCBlbmQgd2l0aCBhbHBoYWJldC9udW1iZXIsXG4gIC8vIHdpdGggYWxwaGFiZXQvbnVtYmVyLy4tIGluIHRoZSBtaWRkbGUuXG4gIGlmICgvXlthLXowLTldW2EtejAtOS4tXStbYS16MC05XSQvLnRlc3QoYnVja2V0KSkge1xuICAgIHJldHVybiB0cnVlXG4gIH1cbiAgcmV0dXJuIGZhbHNlXG59XG5cbi8qKlxuICogY2hlY2sgaWYgb2JqZWN0TmFtZSBpcyBhIHZhbGlkIG9iamVjdCBuYW1lXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc1ZhbGlkT2JqZWN0TmFtZShvYmplY3ROYW1lOiB1bmtub3duKSB7XG4gIGlmICghaXNWYWxpZFByZWZpeChvYmplY3ROYW1lKSkge1xuICAgIHJldHVybiBmYWxzZVxuICB9XG5cbiAgcmV0dXJuIG9iamVjdE5hbWUubGVuZ3RoICE9PSAwXG59XG5cbi8qKlxuICogY2hlY2sgaWYgcHJlZml4IGlzIHZhbGlkXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc1ZhbGlkUHJlZml4KHByZWZpeDogdW5rbm93bik6IHByZWZpeCBpcyBzdHJpbmcge1xuICBpZiAoIWlzU3RyaW5nKHByZWZpeCkpIHtcbiAgICByZXR1cm4gZmFsc2VcbiAgfVxuICBpZiAocHJlZml4Lmxlbmd0aCA+IDEwMjQpIHtcbiAgICByZXR1cm4gZmFsc2VcbiAgfVxuICByZXR1cm4gdHJ1ZVxufVxuXG4vKipcbiAqIGNoZWNrIGlmIHR5cGVvZiBhcmcgbnVtYmVyXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc051bWJlcihhcmc6IHVua25vd24pOiBhcmcgaXMgbnVtYmVyIHtcbiAgcmV0dXJuIHR5cGVvZiBhcmcgPT09ICdudW1iZXInXG59XG5cbi8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBAdHlwZXNjcmlwdC1lc2xpbnQvbm8tZXhwbGljaXQtYW55XG5leHBvcnQgdHlwZSBBbnlGdW5jdGlvbiA9ICguLi5hcmdzOiBhbnlbXSkgPT4gYW55XG5cbi8qKlxuICogY2hlY2sgaWYgdHlwZW9mIGFyZyBmdW5jdGlvblxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNGdW5jdGlvbihhcmc6IHVua25vd24pOiBhcmcgaXMgQW55RnVuY3Rpb24ge1xuICByZXR1cm4gdHlwZW9mIGFyZyA9PT0gJ2Z1bmN0aW9uJ1xufVxuXG4vKipcbiAqIGNoZWNrIGlmIHR5cGVvZiBhcmcgc3RyaW5nXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc1N0cmluZyhhcmc6IHVua25vd24pOiBhcmcgaXMgc3RyaW5nIHtcbiAgcmV0dXJuIHR5cGVvZiBhcmcgPT09ICdzdHJpbmcnXG59XG5cbi8qKlxuICogY2hlY2sgaWYgdHlwZW9mIGFyZyBvYmplY3RcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzT2JqZWN0KGFyZzogdW5rbm93bik6IGFyZyBpcyBvYmplY3Qge1xuICByZXR1cm4gdHlwZW9mIGFyZyA9PT0gJ29iamVjdCcgJiYgYXJnICE9PSBudWxsXG59XG4vKipcbiAqIGNoZWNrIGlmIHR5cGVvZiBhcmcgaXMgcGxhaW4gb2JqZWN0XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc1BsYWluT2JqZWN0KGFyZzogdW5rbm93bik6IGFyZyBpcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB7XG4gIHJldHVybiBPYmplY3QucHJvdG90eXBlLnRvU3RyaW5nLmNhbGwoYXJnKSA9PT0gJ1tvYmplY3QgT2JqZWN0XSdcbn1cbi8qKlxuICogY2hlY2sgaWYgb2JqZWN0IGlzIHJlYWRhYmxlIHN0cmVhbVxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNSZWFkYWJsZVN0cmVhbShhcmc6IHVua25vd24pOiBhcmcgaXMgc3RyZWFtLlJlYWRhYmxlIHtcbiAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIEB0eXBlc2NyaXB0LWVzbGludC91bmJvdW5kLW1ldGhvZFxuICByZXR1cm4gaXNPYmplY3QoYXJnKSAmJiBpc0Z1bmN0aW9uKChhcmcgYXMgc3RyZWFtLlJlYWRhYmxlKS5fcmVhZClcbn1cblxuLyoqXG4gKiBjaGVjayBpZiBhcmcgaXMgYm9vbGVhblxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNCb29sZWFuKGFyZzogdW5rbm93bik6IGFyZyBpcyBib29sZWFuIHtcbiAgcmV0dXJuIHR5cGVvZiBhcmcgPT09ICdib29sZWFuJ1xufVxuXG5leHBvcnQgZnVuY3Rpb24gaXNFbXB0eShvOiB1bmtub3duKTogbyBpcyBudWxsIHwgdW5kZWZpbmVkIHtcbiAgcmV0dXJuIF8uaXNFbXB0eShvKVxufVxuXG5leHBvcnQgZnVuY3Rpb24gaXNFbXB0eU9iamVjdChvOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPik6IGJvb2xlYW4ge1xuICByZXR1cm4gT2JqZWN0LnZhbHVlcyhvKS5maWx0ZXIoKHgpID0+IHggIT09IHVuZGVmaW5lZCkubGVuZ3RoICE9PSAwXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBpc0RlZmluZWQ8VD4obzogVCk6IG8gaXMgRXhjbHVkZTxULCBudWxsIHwgdW5kZWZpbmVkPiB7XG4gIHJldHVybiBvICE9PSBudWxsICYmIG8gIT09IHVuZGVmaW5lZFxufVxuXG4vKipcbiAqIGNoZWNrIGlmIGFyZyBpcyBhIHZhbGlkIGRhdGVcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzVmFsaWREYXRlKGFyZzogdW5rbm93bik6IGFyZyBpcyBEYXRlIHtcbiAgLy8gQHRzLWV4cGVjdC1lcnJvciBjaGVja25ldyBEYXRlKE1hdGguTmFOKVxuICByZXR1cm4gYXJnIGluc3RhbmNlb2YgRGF0ZSAmJiAhaXNOYU4oYXJnKVxufVxuXG4vKipcbiAqIENyZWF0ZSBhIERhdGUgc3RyaW5nIHdpdGggZm9ybWF0OiAnWVlZWU1NRERUSEhtbXNzJyArIFpcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG1ha2VEYXRlTG9uZyhkYXRlPzogRGF0ZSk6IHN0cmluZyB7XG4gIGRhdGUgPSBkYXRlIHx8IG5ldyBEYXRlKClcblxuICAvLyBHaXZlcyBmb3JtYXQgbGlrZTogJzIwMTctMDgtMDdUMTY6Mjg6NTkuODg5WidcbiAgY29uc3QgcyA9IGRhdGUudG9JU09TdHJpbmcoKVxuXG4gIHJldHVybiBzLnNsaWNlKDAsIDQpICsgcy5zbGljZSg1LCA3KSArIHMuc2xpY2UoOCwgMTMpICsgcy5zbGljZSgxNCwgMTYpICsgcy5zbGljZSgxNywgMTkpICsgJ1onXG59XG5cbi8qKlxuICogQ3JlYXRlIGEgRGF0ZSBzdHJpbmcgd2l0aCBmb3JtYXQ6ICdZWVlZTU1ERCdcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG1ha2VEYXRlU2hvcnQoZGF0ZT86IERhdGUpIHtcbiAgZGF0ZSA9IGRhdGUgfHwgbmV3IERhdGUoKVxuXG4gIC8vIEdpdmVzIGZvcm1hdCBsaWtlOiAnMjAxNy0wOC0wN1QxNjoyODo1OS44ODlaJ1xuICBjb25zdCBzID0gZGF0ZS50b0lTT1N0cmluZygpXG5cbiAgcmV0dXJuIHMuc2xpY2UoMCwgNCkgKyBzLnNsaWNlKDUsIDcpICsgcy5zbGljZSg4LCAxMClcbn1cblxuLyoqXG4gKiBwaXBlc2V0dXAgc2V0cyB1cCBwaXBlKCkgZnJvbSBsZWZ0IHRvIHJpZ2h0IG9zIHN0cmVhbXMgYXJyYXlcbiAqIHBpcGVzZXR1cCB3aWxsIGFsc28gbWFrZSBzdXJlIHRoYXQgZXJyb3IgZW1pdHRlZCBhdCBhbnkgb2YgdGhlIHVwc3RyZWFtIFN0cmVhbVxuICogd2lsbCBiZSBlbWl0dGVkIGF0IHRoZSBsYXN0IHN0cmVhbS4gVGhpcyBtYWtlcyBlcnJvciBoYW5kbGluZyBzaW1wbGVcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBpcGVzZXR1cCguLi5zdHJlYW1zOiBbc3RyZWFtLlJlYWRhYmxlLCAuLi5zdHJlYW0uRHVwbGV4W10sIHN0cmVhbS5Xcml0YWJsZV0pIHtcbiAgLy8gQHRzLWV4cGVjdC1lcnJvciB0cyBjYW4ndCBuYXJyb3cgdGhpc1xuICByZXR1cm4gc3RyZWFtcy5yZWR1Y2UoKHNyYzogc3RyZWFtLlJlYWRhYmxlLCBkc3Q6IHN0cmVhbS5Xcml0YWJsZSkgPT4ge1xuICAgIHNyYy5vbignZXJyb3InLCAoZXJyKSA9PiBkc3QuZW1pdCgnZXJyb3InLCBlcnIpKVxuICAgIHJldHVybiBzcmMucGlwZShkc3QpXG4gIH0pXG59XG5cbi8qKlxuICogcmV0dXJuIGEgUmVhZGFibGUgc3RyZWFtIHRoYXQgZW1pdHMgZGF0YVxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVhZGFibGVTdHJlYW0oZGF0YTogdW5rbm93bik6IHN0cmVhbS5SZWFkYWJsZSB7XG4gIGNvbnN0IHMgPSBuZXcgc3RyZWFtLlJlYWRhYmxlKClcbiAgcy5fcmVhZCA9ICgpID0+IHt9XG4gIHMucHVzaChkYXRhKVxuICBzLnB1c2gobnVsbClcbiAgcmV0dXJuIHNcbn1cblxuLyoqXG4gKiBQcm9jZXNzIG1ldGFkYXRhIHRvIGluc2VydCBhcHByb3ByaWF0ZSB2YWx1ZSB0byBgY29udGVudC10eXBlYCBhdHRyaWJ1dGVcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGluc2VydENvbnRlbnRUeXBlKG1ldGFEYXRhOiBPYmplY3RNZXRhRGF0YSwgZmlsZVBhdGg6IHN0cmluZyk6IE9iamVjdE1ldGFEYXRhIHtcbiAgLy8gY2hlY2sgaWYgY29udGVudC10eXBlIGF0dHJpYnV0ZSBwcmVzZW50IGluIG1ldGFEYXRhXG4gIGZvciAoY29uc3Qga2V5IGluIG1ldGFEYXRhKSB7XG4gICAgaWYgKGtleS50b0xvd2VyQ2FzZSgpID09PSAnY29udGVudC10eXBlJykge1xuICAgICAgcmV0dXJuIG1ldGFEYXRhXG4gICAgfVxuICB9XG5cbiAgLy8gaWYgYGNvbnRlbnQtdHlwZWAgYXR0cmlidXRlIGlzIG5vdCBwcmVzZW50IGluIG1ldGFkYXRhLCB0aGVuIGluZmVyIGl0IGZyb20gdGhlIGV4dGVuc2lvbiBpbiBmaWxlUGF0aFxuICByZXR1cm4ge1xuICAgIC4uLm1ldGFEYXRhLFxuICAgICdjb250ZW50LXR5cGUnOiBwcm9iZUNvbnRlbnRUeXBlKGZpbGVQYXRoKSxcbiAgfVxufVxuXG4vKipcbiAqIEZ1bmN0aW9uIHByZXBlbmRzIG1ldGFkYXRhIHdpdGggdGhlIGFwcHJvcHJpYXRlIHByZWZpeCBpZiBpdCBpcyBub3QgYWxyZWFkeSBvblxuICovXG5leHBvcnQgZnVuY3Rpb24gcHJlcGVuZFhBTVpNZXRhKG1ldGFEYXRhPzogT2JqZWN0TWV0YURhdGEpOiBSZXF1ZXN0SGVhZGVycyB7XG4gIGlmICghbWV0YURhdGEpIHtcbiAgICByZXR1cm4ge31cbiAgfVxuXG4gIHJldHVybiBfLm1hcEtleXMobWV0YURhdGEsICh2YWx1ZSwga2V5KSA9PiB7XG4gICAgaWYgKGlzQW16SGVhZGVyKGtleSkgfHwgaXNTdXBwb3J0ZWRIZWFkZXIoa2V5KSB8fCBpc1N0b3JhZ2VDbGFzc0hlYWRlcihrZXkpKSB7XG4gICAgICByZXR1cm4ga2V5XG4gICAgfVxuXG4gICAgcmV0dXJuIE1ldGFEYXRhSGVhZGVyUHJlZml4ICsga2V5XG4gIH0pXG59XG5cbi8qKlxuICogQ2hlY2tzIGlmIGl0IGlzIGEgdmFsaWQgaGVhZGVyIGFjY29yZGluZyB0byB0aGUgQW1hem9uUzMgQVBJXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc0FtekhlYWRlcihrZXk6IHN0cmluZykge1xuICBjb25zdCB0ZW1wID0ga2V5LnRvTG93ZXJDYXNlKClcbiAgcmV0dXJuIChcbiAgICB0ZW1wLnN0YXJ0c1dpdGgoTWV0YURhdGFIZWFkZXJQcmVmaXgpIHx8XG4gICAgdGVtcCA9PT0gJ3gtYW16LWFjbCcgfHxcbiAgICB0ZW1wLnN0YXJ0c1dpdGgoJ3gtYW16LXNlcnZlci1zaWRlLWVuY3J5cHRpb24tJykgfHxcbiAgICB0ZW1wID09PSAneC1hbXotc2VydmVyLXNpZGUtZW5jcnlwdGlvbidcbiAgKVxufVxuXG4vKipcbiAqIENoZWNrcyBpZiBpdCBpcyBhIHN1cHBvcnRlZCBIZWFkZXJcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzU3VwcG9ydGVkSGVhZGVyKGtleTogc3RyaW5nKSB7XG4gIGNvbnN0IHN1cHBvcnRlZF9oZWFkZXJzID0gW1xuICAgICdjb250ZW50LXR5cGUnLFxuICAgICdjYWNoZS1jb250cm9sJyxcbiAgICAnY29udGVudC1lbmNvZGluZycsXG4gICAgJ2NvbnRlbnQtZGlzcG9zaXRpb24nLFxuICAgICdjb250ZW50LWxhbmd1YWdlJyxcbiAgICAneC1hbXotd2Vic2l0ZS1yZWRpcmVjdC1sb2NhdGlvbicsXG4gICAgJ2lmLW5vbmUtbWF0Y2gnLFxuICAgICdpZi1tYXRjaCcsXG4gIF1cbiAgcmV0dXJuIHN1cHBvcnRlZF9oZWFkZXJzLmluY2x1ZGVzKGtleS50b0xvd2VyQ2FzZSgpKVxufVxuXG4vKipcbiAqIENoZWNrcyBpZiBpdCBpcyBhIHN0b3JhZ2UgaGVhZGVyXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc1N0b3JhZ2VDbGFzc0hlYWRlcihrZXk6IHN0cmluZykge1xuICByZXR1cm4ga2V5LnRvTG93ZXJDYXNlKCkgPT09ICd4LWFtei1zdG9yYWdlLWNsYXNzJ1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZXh0cmFjdE1ldGFkYXRhKGhlYWRlcnM6IFJlc3BvbnNlSGVhZGVyKSB7XG4gIHJldHVybiBfLm1hcEtleXMoXG4gICAgXy5waWNrQnkoaGVhZGVycywgKHZhbHVlLCBrZXkpID0+IGlzU3VwcG9ydGVkSGVhZGVyKGtleSkgfHwgaXNTdG9yYWdlQ2xhc3NIZWFkZXIoa2V5KSB8fCBpc0FtekhlYWRlcihrZXkpKSxcbiAgICAodmFsdWUsIGtleSkgPT4ge1xuICAgICAgY29uc3QgbG93ZXIgPSBrZXkudG9Mb3dlckNhc2UoKVxuICAgICAgaWYgKGxvd2VyLnN0YXJ0c1dpdGgoTWV0YURhdGFIZWFkZXJQcmVmaXgpKSB7XG4gICAgICAgIHJldHVybiBsb3dlci5zbGljZShNZXRhRGF0YUhlYWRlclByZWZpeC5sZW5ndGgpXG4gICAgICB9XG5cbiAgICAgIHJldHVybiBrZXlcbiAgICB9LFxuICApXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBnZXRWZXJzaW9uSWQoaGVhZGVyczogUmVzcG9uc2VIZWFkZXIgPSB7fSkge1xuICByZXR1cm4gaGVhZGVyc1sneC1hbXotdmVyc2lvbi1pZCddIHx8IG51bGxcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGdldFNvdXJjZVZlcnNpb25JZChoZWFkZXJzOiBSZXNwb25zZUhlYWRlciA9IHt9KSB7XG4gIHJldHVybiBoZWFkZXJzWyd4LWFtei1jb3B5LXNvdXJjZS12ZXJzaW9uLWlkJ10gfHwgbnVsbFxufVxuXG5leHBvcnQgZnVuY3Rpb24gc2FuaXRpemVFVGFnKGV0YWcgPSAnJyk6IHN0cmluZyB7XG4gIGNvbnN0IHJlcGxhY2VDaGFyczogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHtcbiAgICAnXCInOiAnJyxcbiAgICAnJnF1b3Q7JzogJycsXG4gICAgJyYjMzQ7JzogJycsXG4gICAgJyZRVU9UOyc6ICcnLFxuICAgICcmI3gwMDAyMic6ICcnLFxuICB9XG4gIHJldHVybiBldGFnLnJlcGxhY2UoL14oXCJ8JnF1b3Q7fCYjMzQ7KXwoXCJ8JnF1b3Q7fCYjMzQ7KSQvZywgKG0pID0+IHJlcGxhY2VDaGFyc1ttXSBhcyBzdHJpbmcpXG59XG5cbmV4cG9ydCBmdW5jdGlvbiB0b01kNShwYXlsb2FkOiBCaW5hcnkpOiBzdHJpbmcge1xuICAvLyB1c2Ugc3RyaW5nIGZyb20gYnJvd3NlciBhbmQgYnVmZmVyIGZyb20gbm9kZWpzXG4gIC8vIGJyb3dzZXIgc3VwcG9ydCBpcyB0ZXN0ZWQgb25seSBhZ2FpbnN0IG1pbmlvIHNlcnZlclxuICByZXR1cm4gY3J5cHRvLmNyZWF0ZUhhc2goJ21kNScpLnVwZGF0ZShCdWZmZXIuZnJvbShwYXlsb2FkKSkuZGlnZXN0KCkudG9TdHJpbmcoJ2Jhc2U2NCcpXG59XG5cbmV4cG9ydCBmdW5jdGlvbiB0b1NoYTI1NihwYXlsb2FkOiBCaW5hcnkpOiBzdHJpbmcge1xuICByZXR1cm4gY3J5cHRvLmNyZWF0ZUhhc2goJ3NoYTI1NicpLnVwZGF0ZShwYXlsb2FkKS5kaWdlc3QoJ2hleCcpXG59XG5cbi8qKlxuICogdG9BcnJheSByZXR1cm5zIGEgc2luZ2xlIGVsZW1lbnQgYXJyYXkgd2l0aCBwYXJhbSBiZWluZyB0aGUgZWxlbWVudCxcbiAqIGlmIHBhcmFtIGlzIGp1c3QgYSBzdHJpbmcsIGFuZCByZXR1cm5zICdwYXJhbScgYmFjayBpZiBpdCBpcyBhbiBhcnJheVxuICogU28sIGl0IG1ha2VzIHN1cmUgcGFyYW0gaXMgYWx3YXlzIGFuIGFycmF5XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiB0b0FycmF5PFQgPSB1bmtub3duPihwYXJhbTogVCB8IFRbXSk6IEFycmF5PFQ+IHtcbiAgaWYgKCFBcnJheS5pc0FycmF5KHBhcmFtKSkge1xuICAgIHJldHVybiBbcGFyYW1dIGFzIFRbXVxuICB9XG4gIHJldHVybiBwYXJhbVxufVxuXG5leHBvcnQgZnVuY3Rpb24gc2FuaXRpemVPYmplY3RLZXkob2JqZWN0TmFtZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgLy8gKyBzeW1ib2wgY2hhcmFjdGVycyBhcmUgbm90IGRlY29kZWQgYXMgc3BhY2VzIGluIEpTLiBzbyByZXBsYWNlIHRoZW0gZmlyc3QgYW5kIGRlY29kZSB0byBnZXQgdGhlIGNvcnJlY3QgcmVzdWx0LlxuICBjb25zdCBhc1N0ck5hbWUgPSAob2JqZWN0TmFtZSA/IG9iamVjdE5hbWUudG9TdHJpbmcoKSA6ICcnKS5yZXBsYWNlKC9cXCsvZywgJyAnKVxuICByZXR1cm4gZGVjb2RlVVJJQ29tcG9uZW50KGFzU3RyTmFtZSlcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHNhbml0aXplU2l6ZShzaXplPzogc3RyaW5nKTogbnVtYmVyIHwgdW5kZWZpbmVkIHtcbiAgcmV0dXJuIHNpemUgPyBOdW1iZXIucGFyc2VJbnQoc2l6ZSkgOiB1bmRlZmluZWRcbn1cblxuZXhwb3J0IGNvbnN0IFBBUlRfQ09OU1RSQUlOVFMgPSB7XG4gIC8vIGFic01pblBhcnRTaXplIC0gYWJzb2x1dGUgbWluaW11bSBwYXJ0IHNpemUgKDUgTWlCKVxuICBBQlNfTUlOX1BBUlRfU0laRTogMTAyNCAqIDEwMjQgKiA1LFxuICAvLyBNSU5fUEFSVF9TSVpFIC0gbWluaW11bSBwYXJ0IHNpemUgMTZNaUIgcGVyIG9iamVjdCBhZnRlciB3aGljaFxuICBNSU5fUEFSVF9TSVpFOiAxMDI0ICogMTAyNCAqIDE2LFxuICAvLyBNQVhfUEFSVFNfQ09VTlQgLSBtYXhpbXVtIG51bWJlciBvZiBwYXJ0cyBmb3IgYSBzaW5nbGUgbXVsdGlwYXJ0IHNlc3Npb24uXG4gIE1BWF9QQVJUU19DT1VOVDogMTAwMDAsXG4gIC8vIE1BWF9QQVJUX1NJWkUgLSBtYXhpbXVtIHBhcnQgc2l6ZSA1R2lCIGZvciBhIHNpbmdsZSBtdWx0aXBhcnQgdXBsb2FkXG4gIC8vIG9wZXJhdGlvbi5cbiAgTUFYX1BBUlRfU0laRTogMTAyNCAqIDEwMjQgKiAxMDI0ICogNSxcbiAgLy8gTUFYX1NJTkdMRV9QVVRfT0JKRUNUX1NJWkUgLSBtYXhpbXVtIHNpemUgNUdpQiBvZiBvYmplY3QgcGVyIFBVVFxuICAvLyBvcGVyYXRpb24uXG4gIE1BWF9TSU5HTEVfUFVUX09CSkVDVF9TSVpFOiAxMDI0ICogMTAyNCAqIDEwMjQgKiA1LFxuICAvLyBNQVhfTVVMVElQQVJUX1BVVF9PQkpFQ1RfU0laRSAtIG1heGltdW0gc2l6ZSA1VGlCIG9mIG9iamVjdCBmb3JcbiAgLy8gTXVsdGlwYXJ0IG9wZXJhdGlvbi5cbiAgTUFYX01VTFRJUEFSVF9QVVRfT0JKRUNUX1NJWkU6IDEwMjQgKiAxMDI0ICogMTAyNCAqIDEwMjQgKiA1LFxufVxuXG5jb25zdCBHRU5FUklDX1NTRV9IRUFERVIgPSAnWC1BbXotU2VydmVyLVNpZGUtRW5jcnlwdGlvbidcblxuY29uc3QgRU5DUllQVElPTl9IRUFERVJTID0ge1xuICAvLyBzc2VHZW5lcmljSGVhZGVyIGlzIHRoZSBBV1MgU1NFIGhlYWRlciB1c2VkIGZvciBTU0UtUzMgYW5kIFNTRS1LTVMuXG4gIHNzZUdlbmVyaWNIZWFkZXI6IEdFTkVSSUNfU1NFX0hFQURFUixcbiAgLy8gc3NlS21zS2V5SUQgaXMgdGhlIEFXUyBTU0UtS01TIGtleSBpZC5cbiAgc3NlS21zS2V5SUQ6IEdFTkVSSUNfU1NFX0hFQURFUiArICctQXdzLUttcy1LZXktSWQnLFxufSBhcyBjb25zdFxuXG4vKipcbiAqIFJldHVybiBFbmNyeXB0aW9uIGhlYWRlcnNcbiAqIEBwYXJhbSBlbmNDb25maWdcbiAqIEByZXR1cm5zIGFuIG9iamVjdCB3aXRoIGtleSB2YWx1ZSBwYWlycyB0aGF0IGNhbiBiZSB1c2VkIGluIGhlYWRlcnMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBnZXRFbmNyeXB0aW9uSGVhZGVycyhlbmNDb25maWc6IEVuY3J5cHRpb24pOiBSZXF1ZXN0SGVhZGVycyB7XG4gIGNvbnN0IGVuY1R5cGUgPSBlbmNDb25maWcudHlwZVxuXG4gIGlmICghaXNFbXB0eShlbmNUeXBlKSkge1xuICAgIGlmIChlbmNUeXBlID09PSBFTkNSWVBUSU9OX1RZUEVTLlNTRUMpIHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIFtFTkNSWVBUSU9OX0hFQURFUlMuc3NlR2VuZXJpY0hlYWRlcl06ICdBRVMyNTYnLFxuICAgICAgfVxuICAgIH0gZWxzZSBpZiAoZW5jVHlwZSA9PT0gRU5DUllQVElPTl9UWVBFUy5LTVMpIHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIFtFTkNSWVBUSU9OX0hFQURFUlMuc3NlR2VuZXJpY0hlYWRlcl06IGVuY0NvbmZpZy5TU0VBbGdvcml0aG0sXG4gICAgICAgIFtFTkNSWVBUSU9OX0hFQURFUlMuc3NlS21zS2V5SURdOiBlbmNDb25maWcuS01TTWFzdGVyS2V5SUQsXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHt9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBwYXJ0c1JlcXVpcmVkKHNpemU6IG51bWJlcik6IG51bWJlciB7XG4gIGNvbnN0IG1heFBhcnRTaXplID0gUEFSVF9DT05TVFJBSU5UUy5NQVhfTVVMVElQQVJUX1BVVF9PQkpFQ1RfU0laRSAvIChQQVJUX0NPTlNUUkFJTlRTLk1BWF9QQVJUU19DT1VOVCAtIDEpXG4gIGxldCByZXF1aXJlZFBhcnRTaXplID0gc2l6ZSAvIG1heFBhcnRTaXplXG4gIGlmIChzaXplICUgbWF4UGFydFNpemUgPiAwKSB7XG4gICAgcmVxdWlyZWRQYXJ0U2l6ZSsrXG4gIH1cbiAgcmVxdWlyZWRQYXJ0U2l6ZSA9IE1hdGgudHJ1bmMocmVxdWlyZWRQYXJ0U2l6ZSlcbiAgcmV0dXJuIHJlcXVpcmVkUGFydFNpemVcbn1cblxuLyoqXG4gKiBjYWxjdWxhdGVFdmVuU3BsaXRzIC0gY29tcHV0ZXMgc3BsaXRzIGZvciBhIHNvdXJjZSBhbmQgcmV0dXJuc1xuICogc3RhcnQgYW5kIGVuZCBpbmRleCBzbGljZXMuIFNwbGl0cyBoYXBwZW4gZXZlbmx5IHRvIGJlIHN1cmUgdGhhdCBub1xuICogcGFydCBpcyBsZXNzIHRoYW4gNU1pQiwgYXMgdGhhdCBjb3VsZCBmYWlsIHRoZSBtdWx0aXBhcnQgcmVxdWVzdCBpZlxuICogaXQgaXMgbm90IHRoZSBsYXN0IHBhcnQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjYWxjdWxhdGVFdmVuU3BsaXRzPFQgZXh0ZW5kcyB7IFN0YXJ0PzogbnVtYmVyIH0+KFxuICBzaXplOiBudW1iZXIsXG4gIG9iakluZm86IFQsXG4pOiB7XG4gIHN0YXJ0SW5kZXg6IG51bWJlcltdXG4gIG9iakluZm86IFRcbiAgZW5kSW5kZXg6IG51bWJlcltdXG59IHwgbnVsbCB7XG4gIGlmIChzaXplID09PSAwKSB7XG4gICAgcmV0dXJuIG51bGxcbiAgfVxuICBjb25zdCByZXFQYXJ0cyA9IHBhcnRzUmVxdWlyZWQoc2l6ZSlcbiAgY29uc3Qgc3RhcnRJbmRleFBhcnRzOiBudW1iZXJbXSA9IFtdXG4gIGNvbnN0IGVuZEluZGV4UGFydHM6IG51bWJlcltdID0gW11cblxuICBsZXQgc3RhcnQgPSBvYmpJbmZvLlN0YXJ0XG4gIGlmIChpc0VtcHR5KHN0YXJ0KSB8fCBzdGFydCA9PT0gLTEpIHtcbiAgICBzdGFydCA9IDBcbiAgfVxuICBjb25zdCBkaXZpc29yVmFsdWUgPSBNYXRoLnRydW5jKHNpemUgLyByZXFQYXJ0cylcblxuICBjb25zdCByZW1pbmRlclZhbHVlID0gc2l6ZSAlIHJlcVBhcnRzXG5cbiAgbGV0IG5leHRTdGFydCA9IHN0YXJ0XG5cbiAgZm9yIChsZXQgaSA9IDA7IGkgPCByZXFQYXJ0czsgaSsrKSB7XG4gICAgbGV0IGN1clBhcnRTaXplID0gZGl2aXNvclZhbHVlXG4gICAgaWYgKGkgPCByZW1pbmRlclZhbHVlKSB7XG4gICAgICBjdXJQYXJ0U2l6ZSsrXG4gICAgfVxuXG4gICAgY29uc3QgY3VycmVudFN0YXJ0ID0gbmV4dFN0YXJ0XG4gICAgY29uc3QgY3VycmVudEVuZCA9IGN1cnJlbnRTdGFydCArIGN1clBhcnRTaXplIC0gMVxuICAgIG5leHRTdGFydCA9IGN1cnJlbnRFbmQgKyAxXG5cbiAgICBzdGFydEluZGV4UGFydHMucHVzaChjdXJyZW50U3RhcnQpXG4gICAgZW5kSW5kZXhQYXJ0cy5wdXNoKGN1cnJlbnRFbmQpXG4gIH1cblxuICByZXR1cm4geyBzdGFydEluZGV4OiBzdGFydEluZGV4UGFydHMsIGVuZEluZGV4OiBlbmRJbmRleFBhcnRzLCBvYmpJbmZvOiBvYmpJbmZvIH1cbn1cbmNvbnN0IGZ4cCA9IG5ldyBYTUxQYXJzZXIoeyBudW1iZXJQYXJzZU9wdGlvbnM6IHsgZU5vdGF0aW9uOiBmYWxzZSwgaGV4OiB0cnVlLCBsZWFkaW5nWmVyb3M6IHRydWUgfSB9KVxuXG4vLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgQHR5cGVzY3JpcHQtZXNsaW50L25vLWV4cGxpY2l0LWFueVxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlWG1sKHhtbDogc3RyaW5nKTogYW55IHtcbiAgY29uc3QgcmVzdWx0ID0gZnhwLnBhcnNlKHhtbClcbiAgaWYgKHJlc3VsdC5FcnJvcikge1xuICAgIHRocm93IHJlc3VsdC5FcnJvclxuICB9XG5cbiAgcmV0dXJuIHJlc3VsdFxufVxuXG4vKipcbiAqIGdldCBjb250ZW50IHNpemUgb2Ygb2JqZWN0IGNvbnRlbnQgdG8gdXBsb2FkXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBnZXRDb250ZW50TGVuZ3RoKHM6IHN0cmVhbS5SZWFkYWJsZSB8IEJ1ZmZlciB8IHN0cmluZyk6IFByb21pc2U8bnVtYmVyIHwgbnVsbD4ge1xuICAvLyB1c2UgbGVuZ3RoIHByb3BlcnR5IG9mIHN0cmluZyB8IEJ1ZmZlclxuICBpZiAodHlwZW9mIHMgPT09ICdzdHJpbmcnIHx8IEJ1ZmZlci5pc0J1ZmZlcihzKSkge1xuICAgIHJldHVybiBzLmxlbmd0aFxuICB9XG5cbiAgLy8gcHJvcGVydHkgb2YgYGZzLlJlYWRTdHJlYW1gXG4gIGNvbnN0IGZpbGVQYXRoID0gKHMgYXMgdW5rbm93biBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPikucGF0aCBhcyBzdHJpbmcgfCB1bmRlZmluZWRcbiAgaWYgKGZpbGVQYXRoICYmIHR5cGVvZiBmaWxlUGF0aCA9PT0gJ3N0cmluZycpIHtcbiAgICBjb25zdCBzdGF0ID0gYXdhaXQgZnNwLmxzdGF0KGZpbGVQYXRoKVxuICAgIHJldHVybiBzdGF0LnNpemVcbiAgfVxuXG4gIC8vIHByb3BlcnR5IG9mIGBmcy5SZWFkU3RyZWFtYFxuICBjb25zdCBmZCA9IChzIGFzIHVua25vd24gYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4pLmZkIGFzIG51bWJlciB8IG51bGwgfCB1bmRlZmluZWRcbiAgaWYgKGZkICYmIHR5cGVvZiBmZCA9PT0gJ251bWJlcicpIHtcbiAgICBjb25zdCBzdGF0ID0gYXdhaXQgZnN0YXQoZmQpXG4gICAgcmV0dXJuIHN0YXQuc2l6ZVxuICB9XG5cbiAgcmV0dXJuIG51bGxcbn1cbiJdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFnQkEsSUFBQUEsTUFBQSxHQUFBQyx1QkFBQSxDQUFBQyxPQUFBO0FBQ0EsSUFBQUMsTUFBQSxHQUFBRix1QkFBQSxDQUFBQyxPQUFBO0FBRUEsSUFBQUUsY0FBQSxHQUFBRixPQUFBO0FBQ0EsSUFBQUcsT0FBQSxHQUFBSCxPQUFBO0FBQ0EsSUFBQUksT0FBQSxHQUFBSixPQUFBO0FBQ0EsSUFBQUssSUFBQSxHQUFBTix1QkFBQSxDQUFBQyxPQUFBO0FBRUEsSUFBQU0sTUFBQSxHQUFBTixPQUFBO0FBRUEsSUFBQU8sS0FBQSxHQUFBUCxPQUFBO0FBQTRDLFNBQUFELHdCQUFBUyxDQUFBLEVBQUFDLENBQUEsNkJBQUFDLE9BQUEsTUFBQUMsQ0FBQSxPQUFBRCxPQUFBLElBQUFFLENBQUEsT0FB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