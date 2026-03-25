"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.parseBucketEncryptionConfig = parseBucketEncryptionConfig;
exports.parseBucketNotification = parseBucketNotification;
exports.parseBucketRegion = parseBucketRegion;
exports.parseBucketVersioningConfig = parseBucketVersioningConfig;
exports.parseCompleteMultipart = parseCompleteMultipart;
exports.parseCopyObject = parseCopyObject;
exports.parseError = parseError;
exports.parseInitiateMultipart = parseInitiateMultipart;
exports.parseLifecycleConfig = parseLifecycleConfig;
exports.parseListBucket = parseListBucket;
exports.parseListMultipart = parseListMultipart;
exports.parseListObjects = parseListObjects;
exports.parseListObjectsV2 = parseListObjectsV2;
exports.parseListObjectsV2WithMetadata = parseListObjectsV2WithMetadata;
exports.parseListParts = parseListParts;
exports.parseObjectLegalHoldConfig = parseObjectLegalHoldConfig;
exports.parseObjectLockConfig = parseObjectLockConfig;
exports.parseObjectRetentionConfig = parseObjectRetentionConfig;
exports.parseReplicationConfig = parseReplicationConfig;
exports.parseResponseError = parseResponseError;
exports.parseSelectObjectContentResponse = parseSelectObjectContentResponse;
exports.parseTagging = parseTagging;
exports.removeObjectsParser = removeObjectsParser;
exports.uploadPartParser = uploadPartParser;
var _bufferCrc = require("buffer-crc32");
var _fastXmlParser = require("fast-xml-parser");
var errors = _interopRequireWildcard(require("../errors.js"), true);
var _helpers = require("../helpers.js");
var _helper = require("./helper.js");
var _response = require("./response.js");
var _type = require("./type.js");
function _interopRequireWildcard(e, t) { if ("function" == typeof WeakMap) var r = new WeakMap(), n = new WeakMap(); return (_interopRequireWildcard = function (e, t) { if (!t && e && e.__esModule) return e; var o, i, f = { __proto__: null, default: e }; if (null === e || "object" != typeof e && "function" != typeof e) return f; if (o = t ? n : r) { if (o.has(e)) return o.get(e); o.set(e, f); } for (const t in e) "default" !== t && {}.hasOwnProperty.call(e, t) && ((i = (o = Object.defineProperty) && Object.getOwnPropertyDescriptor(e, t)) && (i.get || i.set) ? o(f, t, i) : f[t] = e[t]); return f; })(e, t); }
// parse XML response for bucket region
function parseBucketRegion(xml) {
  // return region information
  return (0, _helper.parseXml)(xml).LocationConstraint;
}
const fxp = new _fastXmlParser.XMLParser();
const fxpWithoutNumParser = new _fastXmlParser.XMLParser({
  // @ts-ignore
  numberParseOptions: {
    skipLike: /./
  }
});

// Parse XML and return information as Javascript types
// parse error XML response
function parseError(xml, headerInfo) {
  let xmlErr = {};
  const xmlObj = fxp.parse(xml);
  if (xmlObj.Error) {
    xmlErr = xmlObj.Error;
  }
  const e = new errors.S3Error();
  Object.entries(xmlErr).forEach(([key, value]) => {
    e[key.toLowerCase()] = value;
  });
  Object.entries(headerInfo).forEach(([key, value]) => {
    e[key] = value;
  });
  return e;
}

// Generates an Error object depending on http statusCode and XML body
async function parseResponseError(response) {
  const statusCode = response.statusCode;
  let code = '',
    message = '';
  if (statusCode === 301) {
    code = 'MovedPermanently';
    message = 'Moved Permanently';
  } else if (statusCode === 307) {
    code = 'TemporaryRedirect';
    message = 'Are you using the correct endpoint URL?';
  } else if (statusCode === 403) {
    code = 'AccessDenied';
    message = 'Valid and authorized credentials required';
  } else if (statusCode === 404) {
    code = 'NotFound';
    message = 'Not Found';
  } else if (statusCode === 405) {
    code = 'MethodNotAllowed';
    message = 'Method Not Allowed';
  } else if (statusCode === 501) {
    code = 'MethodNotAllowed';
    message = 'Method Not Allowed';
  } else if (statusCode === 503) {
    code = 'SlowDown';
    message = 'Please reduce your request rate.';
  } else {
    const hErrCode = response.headers['x-minio-error-code'];
    const hErrDesc = response.headers['x-minio-error-desc'];
    if (hErrCode && hErrDesc) {
      code = hErrCode;
      message = hErrDesc;
    }
  }
  const headerInfo = {};
  // A value created by S3 compatible server that uniquely identifies the request.
  headerInfo.amzRequestid = response.headers['x-amz-request-id'];
  // A special token that helps troubleshoot API replies and issues.
  headerInfo.amzId2 = response.headers['x-amz-id-2'];

  // Region where the bucket is located. This header is returned only
  // in HEAD bucket and ListObjects response.
  headerInfo.amzBucketRegion = response.headers['x-amz-bucket-region'];
  const xmlString = await (0, _response.readAsString)(response);
  if (xmlString) {
    throw parseError(xmlString, headerInfo);
  }

  // Message should be instantiated for each S3Errors.
  const e = new errors.S3Error(message, {
    cause: headerInfo
  });
  // S3 Error code.
  e.code = code;
  Object.entries(headerInfo).forEach(([key, value]) => {
    // @ts-expect-error force set error properties
    e[key] = value;
  });
  throw e;
}

/**
 * parse XML response for list objects v2 with metadata in a bucket
 */
function parseListObjectsV2WithMetadata(xml) {
  const result = {
    objects: [],
    isTruncated: false,
    nextContinuationToken: ''
  };
  let xmlobj = (0, _helper.parseXml)(xml);
  if (!xmlobj.ListBucketResult) {
    throw new errors.InvalidXMLError('Missing tag: "ListBucketResult"');
  }
  xmlobj = xmlobj.ListBucketResult;
  if (xmlobj.IsTruncated) {
    result.isTruncated = xmlobj.IsTruncated;
  }
  if (xmlobj.NextContinuationToken) {
    result.nextContinuationToken = xmlobj.NextContinuationToken;
  }
  if (xmlobj.Contents) {
    (0, _helper.toArray)(xmlobj.Contents).forEach(content => {
      const name = (0, _helper.sanitizeObjectKey)(content.Key);
      const lastModified = new Date(content.LastModified);
      const etag = (0, _helper.sanitizeETag)(content.ETag);
      const size = content.Size;
      let tags = {};
      if (content.UserTags != null) {
        (0, _helper.toArray)(content.UserTags.split('&')).forEach(tag => {
          const [key, value] = tag.split('=');
          tags[key] = value;
        });
      } else {
        tags = {};
      }
      let metadata;
      if (content.UserMetadata != null) {
        metadata = (0, _helper.toArray)(content.UserMetadata)[0];
      } else {
        metadata = null;
      }
      result.objects.push({
        name,
        lastModified,
        etag,
        size,
        metadata,
        tags
      });
    });
  }
  if (xmlobj.CommonPrefixes) {
    (0, _helper.toArray)(xmlobj.CommonPrefixes).forEach(commonPrefix => {
      result.objects.push({
        prefix: (0, _helper.sanitizeObjectKey)((0, _helper.toArray)(commonPrefix.Prefix)[0]),
        size: 0
      });
    });
  }
  return result;
}
function parseListObjectsV2(xml) {
  const result = {
    objects: [],
    isTruncated: false,
    nextContinuationToken: ''
  };
  let xmlobj = (0, _helper.parseXml)(xml);
  if (!xmlobj.ListBucketResult) {
    throw new errors.InvalidXMLError('Missing tag: "ListBucketResult"');
  }
  xmlobj = xmlobj.ListBucketResult;
  if (xmlobj.IsTruncated) {
    result.isTruncated = xmlobj.IsTruncated;
  }
  if (xmlobj.NextContinuationToken) {
    result.nextContinuationToken = xmlobj.NextContinuationToken;
  }
  if (xmlobj.Contents) {
    (0, _helper.toArray)(xmlobj.Contents).forEach(content => {
      const name = (0, _helper.sanitizeObjectKey)((0, _helper.toArray)(content.Key)[0]);
      const lastModified = new Date(content.LastModified);
      const etag = (0, _helper.sanitizeETag)(content.ETag);
      const size = content.Size;
      result.objects.push({
        name,
        lastModified,
        etag,
        size
      });
    });
  }
  if (xmlobj.CommonPrefixes) {
    (0, _helper.toArray)(xmlobj.CommonPrefixes).forEach(commonPrefix => {
      result.objects.push({
        prefix: (0, _helper.sanitizeObjectKey)((0, _helper.toArray)(commonPrefix.Prefix)[0]),
        size: 0
      });
    });
  }
  return result;
}
function parseBucketNotification(xml) {
  const result = {
    TopicConfiguration: [],
    QueueConfiguration: [],
    CloudFunctionConfiguration: []
  };
  const genEvents = events => {
    if (!events) {
      return [];
    }
    return (0, _helper.toArray)(events);
  };
  const genFilterRules = filters => {
    var _filterArr$;
    const rules = [];
    if (!filters) {
      return rules;
    }
    const filterArr = (0, _helper.toArray)(filters);
    if ((_filterArr$ = filterArr[0]) !== null && _filterArr$ !== void 0 && _filterArr$.S3Key) {
      var _s3KeyArr$;
      const s3KeyArr = (0, _helper.toArray)(filterArr[0].S3Key);
      if ((_s3KeyArr$ = s3KeyArr[0]) !== null && _s3KeyArr$ !== void 0 && _s3KeyArr$.FilterRule) {
        (0, _helper.toArray)(s3KeyArr[0].FilterRule).forEach(rule => {
          const r = rule;
          const Name = (0, _helper.toArray)(r.Name)[0];
          const Value = (0, _helper.toArray)(r.Value)[0];
          rules.push({
            Name,
            Value
          });
        });
      }
    }
    return rules;
  };
  let xmlobj = (0, _helper.parseXml)(xml);
  xmlobj = xmlobj.NotificationConfiguration;
  if (xmlobj.TopicConfiguration) {
    (0, _helper.toArray)(xmlobj.TopicConfiguration).forEach(config => {
      const Id = (0, _helper.toArray)(config.Id)[0];
      const Topic = (0, _helper.toArray)(config.Topic)[0];
      const Event = genEvents(config.Event);
      const Filter = genFilterRules(config.Filter);
      result.TopicConfiguration.push({
        Id,
        Topic,
        Event,
        Filter
      });
    });
  }
  if (xmlobj.QueueConfiguration) {
    (0, _helper.toArray)(xmlobj.QueueConfiguration).forEach(config => {
      const Id = (0, _helper.toArray)(config.Id)[0];
      const Queue = (0, _helper.toArray)(config.Queue)[0];
      const Event = genEvents(config.Event);
      const Filter = genFilterRules(config.Filter);
      result.QueueConfiguration.push({
        Id,
        Queue,
        Event,
        Filter
      });
    });
  }
  if (xmlobj.CloudFunctionConfiguration) {
    (0, _helper.toArray)(xmlobj.CloudFunctionConfiguration).forEach(config => {
      const Id = (0, _helper.toArray)(config.Id)[0];
      const CloudFunction = (0, _helper.toArray)(config.CloudFunction)[0];
      const Event = genEvents(config.Event);
      const Filter = genFilterRules(config.Filter);
      result.CloudFunctionConfiguration.push({
        Id,
        CloudFunction,
        Event,
        Filter
      });
    });
  }
  return result;
}
// parse XML response for list parts of an in progress multipart upload
function parseListParts(xml) {
  let xmlobj = (0, _helper.parseXml)(xml);
  const result = {
    isTruncated: false,
    parts: [],
    marker: 0
  };
  if (!xmlobj.ListPartsResult) {
    throw new errors.InvalidXMLError('Missing tag: "ListPartsResult"');
  }
  xmlobj = xmlobj.ListPartsResult;
  if (xmlobj.IsTruncated) {
    result.isTruncated = xmlobj.IsTruncated;
  }
  if (xmlobj.NextPartNumberMarker) {
    result.marker = (0, _helper.toArray)(xmlobj.NextPartNumberMarker)[0] || '';
  }
  if (xmlobj.Part) {
    (0, _helper.toArray)(xmlobj.Part).forEach(p => {
      const part = parseInt((0, _helper.toArray)(p.PartNumber)[0], 10);
      const lastModified = new Date(p.LastModified);
      const etag = p.ETag.replace(/^"/g, '').replace(/"$/g, '').replace(/^&quot;/g, '').replace(/&quot;$/g, '').replace(/^&#34;/g, '').replace(/&#34;$/g, '');
      result.parts.push({
        part,
        lastModified,
        etag,
        size: parseInt(p.Size, 10)
      });
    });
  }
  return result;
}
function parseListBucket(xml) {
  let result = [];
  const listBucketResultParser = new _fastXmlParser.XMLParser({
    parseTagValue: true,
    // Enable parsing of values
    numberParseOptions: {
      leadingZeros: false,
      // Disable number parsing for values with leading zeros
      hex: false,
      // Disable hex number parsing - Invalid bucket name
      skipLike: /^[0-9]+$/ // Skip number parsing if the value consists entirely of digits
    },

    tagValueProcessor: (tagName, tagValue = '') => {
      // Ensure that the Name tag is always treated as a string
      if (tagName === 'Name') {
        return tagValue.toString();
      }
      return tagValue;
    },
    ignoreAttributes: false // Ensure that all attributes are parsed
  });

  const parsedXmlRes = listBucketResultParser.parse(xml);
  if (!parsedXmlRes.ListAllMyBucketsResult) {
    throw new errors.InvalidXMLError('Missing tag: "ListAllMyBucketsResult"');
  }
  const {
    ListAllMyBucketsResult: {
      Buckets = {}
    } = {}
  } = parsedXmlRes;
  if (Buckets.Bucket) {
    result = (0, _helper.toArray)(Buckets.Bucket).map((bucket = {}) => {
      const {
        Name: bucketName,
        CreationDate
      } = bucket;
      const creationDate = new Date(CreationDate);
      return {
        name: bucketName,
        creationDate
      };
    });
  }
  return result;
}
function parseInitiateMultipart(xml) {
  let xmlobj = (0, _helper.parseXml)(xml);
  if (!xmlobj.InitiateMultipartUploadResult) {
    throw new errors.InvalidXMLError('Missing tag: "InitiateMultipartUploadResult"');
  }
  xmlobj = xmlobj.InitiateMultipartUploadResult;
  if (xmlobj.UploadId) {
    return xmlobj.UploadId;
  }
  throw new errors.InvalidXMLError('Missing tag: "UploadId"');
}
function parseReplicationConfig(xml) {
  const xmlObj = (0, _helper.parseXml)(xml);
  const {
    Role,
    Rule
  } = xmlObj.ReplicationConfiguration;
  return {
    ReplicationConfiguration: {
      role: Role,
      rules: (0, _helper.toArray)(Rule)
    }
  };
}
function parseObjectLegalHoldConfig(xml) {
  const xmlObj = (0, _helper.parseXml)(xml);
  return xmlObj.LegalHold;
}
function parseTagging(xml) {
  const xmlObj = (0, _helper.parseXml)(xml);
  let result = [];
  if (xmlObj.Tagging && xmlObj.Tagging.TagSet && xmlObj.Tagging.TagSet.Tag) {
    const tagResult = xmlObj.Tagging.TagSet.Tag;
    // if it is a single tag convert into an array so that the return value is always an array.
    if (Array.isArray(tagResult)) {
      result = [...tagResult];
    } else {
      result.push(tagResult);
    }
  }
  return result;
}

// parse XML response when a multipart upload is completed
function parseCompleteMultipart(xml) {
  const xmlobj = (0, _helper.parseXml)(xml).CompleteMultipartUploadResult;
  if (xmlobj.Location) {
    const location = (0, _helper.toArray)(xmlobj.Location)[0];
    const bucket = (0, _helper.toArray)(xmlobj.Bucket)[0];
    const key = xmlobj.Key;
    const etag = xmlobj.ETag.replace(/^"/g, '').replace(/"$/g, '').replace(/^&quot;/g, '').replace(/&quot;$/g, '').replace(/^&#34;/g, '').replace(/&#34;$/g, '');
    return {
      location,
      bucket,
      key,
      etag
    };
  }
  // Complete Multipart can return XML Error after a 200 OK response
  if (xmlobj.Code && xmlobj.Message) {
    const errCode = (0, _helper.toArray)(xmlobj.Code)[0];
    const errMessage = (0, _helper.toArray)(xmlobj.Message)[0];
    return {
      errCode,
      errMessage
    };
  }
}
// parse XML response for listing in-progress multipart uploads
function parseListMultipart(xml) {
  const result = {
    prefixes: [],
    uploads: [],
    isTruncated: false,
    nextKeyMarker: '',
    nextUploadIdMarker: ''
  };
  let xmlobj = (0, _helper.parseXml)(xml);
  if (!xmlobj.ListMultipartUploadsResult) {
    throw new errors.InvalidXMLError('Missing tag: "ListMultipartUploadsResult"');
  }
  xmlobj = xmlobj.ListMultipartUploadsResult;
  if (xmlobj.IsTruncated) {
    result.isTruncated = xmlobj.IsTruncated;
  }
  if (xmlobj.NextKeyMarker) {
    result.nextKeyMarker = xmlobj.NextKeyMarker;
  }
  if (xmlobj.NextUploadIdMarker) {
    result.nextUploadIdMarker = xmlobj.nextUploadIdMarker || '';
  }
  if (xmlobj.CommonPrefixes) {
    (0, _helper.toArray)(xmlobj.CommonPrefixes).forEach(prefix => {
      // @ts-expect-error index check
      result.prefixes.push({
        prefix: (0, _helper.sanitizeObjectKey)((0, _helper.toArray)(prefix.Prefix)[0])
      });
    });
  }
  if (xmlobj.Upload) {
    (0, _helper.toArray)(xmlobj.Upload).forEach(upload => {
      const uploadItem = {
        key: upload.Key,
        uploadId: upload.UploadId,
        storageClass: upload.StorageClass,
        initiated: new Date(upload.Initiated)
      };
      if (upload.Initiator) {
        uploadItem.initiator = {
          id: upload.Initiator.ID,
          displayName: upload.Initiator.DisplayName
        };
      }
      if (upload.Owner) {
        uploadItem.owner = {
          id: upload.Owner.ID,
          displayName: upload.Owner.DisplayName
        };
      }
      result.uploads.push(uploadItem);
    });
  }
  return result;
}
function parseObjectLockConfig(xml) {
  const xmlObj = (0, _helper.parseXml)(xml);
  let lockConfigResult = {};
  if (xmlObj.ObjectLockConfiguration) {
    lockConfigResult = {
      objectLockEnabled: xmlObj.ObjectLockConfiguration.ObjectLockEnabled
    };
    let retentionResp;
    if (xmlObj.ObjectLockConfiguration && xmlObj.ObjectLockConfiguration.Rule && xmlObj.ObjectLockConfiguration.Rule.DefaultRetention) {
      retentionResp = xmlObj.ObjectLockConfiguration.Rule.DefaultRetention || {};
      lockConfigResult.mode = retentionResp.Mode;
    }
    if (retentionResp) {
      const isUnitYears = retentionResp.Years;
      if (isUnitYears) {
        lockConfigResult.validity = isUnitYears;
        lockConfigResult.unit = _type.RETENTION_VALIDITY_UNITS.YEARS;
      } else {
        lockConfigResult.validity = retentionResp.Days;
        lockConfigResult.unit = _type.RETENTION_VALIDITY_UNITS.DAYS;
      }
    }
  }
  return lockConfigResult;
}
function parseBucketVersioningConfig(xml) {
  const xmlObj = (0, _helper.parseXml)(xml);
  return xmlObj.VersioningConfiguration;
}

// Used only in selectObjectContent API.
// extractHeaderType extracts the first half of the header message, the header type.
function extractHeaderType(stream) {
  const headerNameLen = Buffer.from(stream.read(1)).readUInt8();
  const headerNameWithSeparator = Buffer.from(stream.read(headerNameLen)).toString();
  const splitBySeparator = (headerNameWithSeparator || '').split(':');
  return splitBySeparator.length >= 1 ? splitBySeparator[1] : '';
}
function extractHeaderValue(stream) {
  const bodyLen = Buffer.from(stream.read(2)).readUInt16BE();
  return Buffer.from(stream.read(bodyLen)).toString();
}
function parseSelectObjectContentResponse(res) {
  const selectResults = new _helpers.SelectResults({}); // will be returned

  const responseStream = (0, _helper.readableStream)(res); // convert byte array to a readable responseStream
  // @ts-ignore
  while (responseStream._readableState.length) {
    // Top level responseStream read tracker.
    let msgCrcAccumulator; // accumulate from start of the message till the message crc start.

    const totalByteLengthBuffer = Buffer.from(responseStream.read(4));
    msgCrcAccumulator = _bufferCrc(totalByteLengthBuffer);
    const headerBytesBuffer = Buffer.from(responseStream.read(4));
    msgCrcAccumulator = _bufferCrc(headerBytesBuffer, msgCrcAccumulator);
    const calculatedPreludeCrc = msgCrcAccumulator.readInt32BE(); // use it to check if any CRC mismatch in header itself.

    const preludeCrcBuffer = Buffer.from(responseStream.read(4)); // read 4 bytes    i.e 4+4 =8 + 4 = 12 ( prelude + prelude crc)
    msgCrcAccumulator = _bufferCrc(preludeCrcBuffer, msgCrcAccumulator);
    const totalMsgLength = totalByteLengthBuffer.readInt32BE();
    const headerLength = headerBytesBuffer.readInt32BE();
    const preludeCrcByteValue = preludeCrcBuffer.readInt32BE();
    if (preludeCrcByteValue !== calculatedPreludeCrc) {
      // Handle Header CRC mismatch Error
      throw new Error(`Header Checksum Mismatch, Prelude CRC of ${preludeCrcByteValue} does not equal expected CRC of ${calculatedPreludeCrc}`);
    }
    const headers = {};
    if (headerLength > 0) {
      const headerBytes = Buffer.from(responseStream.read(headerLength));
      msgCrcAccumulator = _bufferCrc(headerBytes, msgCrcAccumulator);
      const headerReaderStream = (0, _helper.readableStream)(headerBytes);
      // @ts-ignore
      while (headerReaderStream._readableState.length) {
        const headerTypeName = extractHeaderType(headerReaderStream);
        headerReaderStream.read(1); // just read and ignore it.
        if (headerTypeName) {
          headers[headerTypeName] = extractHeaderValue(headerReaderStream);
        }
      }
    }
    let payloadStream;
    const payLoadLength = totalMsgLength - headerLength - 16;
    if (payLoadLength > 0) {
      const payLoadBuffer = Buffer.from(responseStream.read(payLoadLength));
      msgCrcAccumulator = _bufferCrc(payLoadBuffer, msgCrcAccumulator);
      // read the checksum early and detect any mismatch so we can avoid unnecessary further processing.
      const messageCrcByteValue = Buffer.from(responseStream.read(4)).readInt32BE();
      const calculatedCrc = msgCrcAccumulator.readInt32BE();
      // Handle message CRC Error
      if (messageCrcByteValue !== calculatedCrc) {
        throw new Error(`Message Checksum Mismatch, Message CRC of ${messageCrcByteValue} does not equal expected CRC of ${calculatedCrc}`);
      }
      payloadStream = (0, _helper.readableStream)(payLoadBuffer);
    }
    const messageType = headers['message-type'];
    switch (messageType) {
      case 'error':
        {
          const errorMessage = headers['error-code'] + ':"' + headers['error-message'] + '"';
          throw new Error(errorMessage);
        }
      case 'event':
        {
          const contentType = headers['content-type'];
          const eventType = headers['event-type'];
          switch (eventType) {
            case 'End':
              {
                selectResults.setResponse(res);
                return selectResults;
              }
            case 'Records':
              {
                var _payloadStream;
                const readData = (_payloadStream = payloadStream) === null || _payloadStream === void 0 ? void 0 : _payloadStream.read(payLoadLength);
                selectResults.setRecords(readData);
                break;
              }
            case 'Progress':
              {
                switch (contentType) {
                  case 'text/xml':
                    {
                      var _payloadStream2;
                      const progressData = (_payloadStream2 = payloadStream) === null || _payloadStream2 === void 0 ? void 0 : _payloadStream2.read(payLoadLength);
                      selectResults.setProgress(progressData.toString());
                      break;
                    }
                  default:
                    {
                      const errorMessage = `Unexpected content-type ${contentType} sent for event-type Progress`;
                      throw new Error(errorMessage);
                    }
                }
              }
              break;
            case 'Stats':
              {
                switch (contentType) {
                  case 'text/xml':
                    {
                      var _payloadStream3;
                      const statsData = (_payloadStream3 = payloadStream) === null || _payloadStream3 === void 0 ? void 0 : _payloadStream3.read(payLoadLength);
                      selectResults.setStats(statsData.toString());
                      break;
                    }
                  default:
                    {
                      const errorMessage = `Unexpected content-type ${contentType} sent for event-type Stats`;
                      throw new Error(errorMessage);
                    }
                }
              }
              break;
            default:
              {
                // Continuation message: Not sure if it is supported. did not find a reference or any message in response.
                // It does not have a payload.
                const warningMessage = `Un implemented event detected  ${messageType}.`;
                // eslint-disable-next-line no-console
                console.warn(warningMessage);
              }
          }
        }
    }
  }
}
function parseLifecycleConfig(xml) {
  const xmlObj = (0, _helper.parseXml)(xml);
  return xmlObj.LifecycleConfiguration;
}
function parseBucketEncryptionConfig(xml) {
  return (0, _helper.parseXml)(xml);
}
function parseObjectRetentionConfig(xml) {
  const xmlObj = (0, _helper.parseXml)(xml);
  const retentionConfig = xmlObj.Retention;
  return {
    mode: retentionConfig.Mode,
    retainUntilDate: retentionConfig.RetainUntilDate
  };
}
function removeObjectsParser(xml) {
  const xmlObj = (0, _helper.parseXml)(xml);
  if (xmlObj.DeleteResult && xmlObj.DeleteResult.Error) {
    // return errors as array always. as the response is object in case of single object passed in removeObjects
    return (0, _helper.toArray)(xmlObj.DeleteResult.Error);
  }
  return [];
}

// parse XML response for copy object
function parseCopyObject(xml) {
  const result = {
    etag: '',
    lastModified: ''
  };
  let xmlobj = (0, _helper.parseXml)(xml);
  if (!xmlobj.CopyObjectResult) {
    throw new errors.InvalidXMLError('Missing tag: "CopyObjectResult"');
  }
  xmlobj = xmlobj.CopyObjectResult;
  if (xmlobj.ETag) {
    result.etag = xmlobj.ETag.replace(/^"/g, '').replace(/"$/g, '').replace(/^&quot;/g, '').replace(/&quot;$/g, '').replace(/^&#34;/g, '').replace(/&#34;$/g, '');
  }
  if (xmlobj.LastModified) {
    result.lastModified = new Date(xmlobj.LastModified);
  }
  return result;
}
const formatObjInfo = (content, opts = {}) => {
  const {
    Key,
    LastModified,
    ETag,
    Size,
    VersionId,
    IsLatest
  } = content;
  if (!(0, _helper.isObject)(opts)) {
    opts = {};
  }
  const name = (0, _helper.sanitizeObjectKey)((0, _helper.toArray)(Key)[0] || '');
  const lastModified = LastModified ? new Date((0, _helper.toArray)(LastModified)[0] || '') : undefined;
  const etag = (0, _helper.sanitizeETag)((0, _helper.toArray)(ETag)[0] || '');
  const size = (0, _helper.sanitizeSize)(Size || '');
  return {
    name,
    lastModified,
    etag,
    size,
    versionId: VersionId,
    isLatest: IsLatest,
    isDeleteMarker: opts.IsDeleteMarker ? opts.IsDeleteMarker : false
  };
};

// parse XML response for list objects in a bucket
function parseListObjects(xml) {
  const result = {
    objects: [],
    isTruncated: false,
    nextMarker: undefined,
    versionIdMarker: undefined,
    keyMarker: undefined
  };
  let isTruncated = false;
  let nextMarker;
  const xmlobj = fxpWithoutNumParser.parse(xml);
  const parseCommonPrefixesEntity = commonPrefixEntry => {
    if (commonPrefixEntry) {
      (0, _helper.toArray)(commonPrefixEntry).forEach(commonPrefix => {
        result.objects.push({
          prefix: (0, _helper.sanitizeObjectKey)((0, _helper.toArray)(commonPrefix.Prefix)[0] || ''),
          size: 0
        });
      });
    }
  };
  const listBucketResult = xmlobj.ListBucketResult;
  const listVersionsResult = xmlobj.ListVersionsResult;
  if (listBucketResult) {
    if (listBucketResult.IsTruncated) {
      isTruncated = listBucketResult.IsTruncated;
    }
    if (listBucketResult.Contents) {
      (0, _helper.toArray)(listBucketResult.Contents).forEach(content => {
        const name = (0, _helper.sanitizeObjectKey)((0, _helper.toArray)(content.Key)[0] || '');
        const lastModified = new Date((0, _helper.toArray)(content.LastModified)[0] || '');
        const etag = (0, _helper.sanitizeETag)((0, _helper.toArray)(content.ETag)[0] || '');
        const size = (0, _helper.sanitizeSize)(content.Size || '');
        result.objects.push({
          name,
          lastModified,
          etag,
          size
        });
      });
    }
    if (listBucketResult.Marker) {
      nextMarker = listBucketResult.Marker;
    }
    if (listBucketResult.NextMarker) {
      nextMarker = listBucketResult.NextMarker;
    } else if (isTruncated && result.objects.length > 0) {
      var _result$objects;
      nextMarker = (_result$objects = result.objects[result.objects.length - 1]) === null || _result$objects === void 0 ? void 0 : _result$objects.name;
    }
    if (listBucketResult.CommonPrefixes) {
      parseCommonPrefixesEntity(listBucketResult.CommonPrefixes);
    }
  }
  if (listVersionsResult) {
    if (listVersionsResult.IsTruncated) {
      isTruncated = listVersionsResult.IsTruncated;
    }
    if (listVersionsResult.Version) {
      (0, _helper.toArray)(listVersionsResult.Version).forEach(content => {
        result.objects.push(formatObjInfo(content));
      });
    }
    if (listVersionsResult.DeleteMarker) {
      (0, _helper.toArray)(listVersionsResult.DeleteMarker).forEach(content => {
        result.objects.push(formatObjInfo(content, {
          IsDeleteMarker: true
        }));
      });
    }
    if (listVersionsResult.NextKeyMarker) {
      result.keyMarker = listVersionsResult.NextKeyMarker;
    }
    if (listVersionsResult.NextVersionIdMarker) {
      result.versionIdMarker = listVersionsResult.NextVersionIdMarker;
    }
    if (listVersionsResult.CommonPrefixes) {
      parseCommonPrefixesEntity(listVersionsResult.CommonPrefixes);
    }
  }
  result.isTruncated = isTruncated;
  if (isTruncated) {
    result.nextMarker = nextMarker;
  }
  return result;
}
function uploadPartParser(xml) {
  const xmlObj = (0, _helper.parseXml)(xml);
  const respEl = xmlObj.CopyPartResult;
  return respEl;
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJfYnVmZmVyQ3JjIiwicmVxdWlyZSIsIl9mYXN0WG1sUGFyc2VyIiwiZXJyb3JzIiwiX2ludGVyb3BSZXF1aXJlV2lsZGNhcmQiLCJfaGVscGVycyIsIl9oZWxwZXIiLCJfcmVzcG9uc2UiLCJfdHlwZSIsImUiLCJ0IiwiV2Vha01hcCIsInIiLCJuIiwiX19lc01vZHVsZSIsIm8iLCJpIiwiZiIsIl9fcHJvdG9fXyIsImRlZmF1bHQiLCJoYXMiLCJnZXQiLCJzZXQiLCJoYXNPd25Qcm9wZXJ0eSIsImNhbGwiLCJPYmplY3QiLCJkZWZpbmVQcm9wZXJ0eSIsImdldE93blByb3BlcnR5RGVzY3JpcHRvciIsInBhcnNlQnVja2V0UmVnaW9uIiwieG1sIiwicGFyc2VYbWwiLCJMb2NhdGlvbkNvbnN0cmFpbnQiLCJmeHAiLCJYTUxQYXJzZXIiLCJmeHBXaXRob3V0TnVtUGFyc2VyIiwibnVtYmVyUGFyc2VPcHRpb25zIiwic2tpcExpa2UiLCJwYXJzZUVycm9yIiwiaGVhZGVySW5mbyIsInhtbEVyciIsInhtbE9iaiIsInBhcnNlIiwiRXJyb3IiLCJTM0Vycm9yIiwiZW50cmllcyIsImZvckVhY2giLCJrZXkiLCJ2YWx1ZSIsInRvTG93ZXJDYXNlIiwicGFyc2VSZXNwb25zZUVycm9yIiwicmVzcG9uc2UiLCJzdGF0dXNDb2RlIiwiY29kZSIsIm1lc3NhZ2UiLCJoRXJyQ29kZSIsImhlYWRlcnMiLCJoRXJyRGVzYyIsImFtelJlcXVlc3RpZCIsImFteklkMiIsImFtekJ1Y2tldFJlZ2lvbiIsInhtbFN0cmluZyIsInJlYWRBc1N0cmluZyIsImNhdXNlIiwicGFyc2VMaXN0T2JqZWN0c1YyV2l0aE1ldGFkYXRhIiwicmVzdWx0Iiwib2JqZWN0cyIsImlzVHJ1bmNhdGVkIiwibmV4dENvbnRpbnVhdGlvblRva2VuIiwieG1sb2JqIiwiTGlzdEJ1Y2tldFJlc3VsdCIsIkludmFsaWRYTUxFcnJvciIsIklzVHJ1bmNhdGVkIiwiTmV4dENvbnRpbnVhdGlvblRva2VuIiwiQ29udGVudHMiLCJ0b0FycmF5IiwiY29udGVudCIsIm5hbWUiLCJzYW5pdGl6ZU9iamVjdEtleSIsIktleSIsImxhc3RNb2RpZmllZCIsIkRhdGUiLCJMYXN0TW9kaWZpZWQiLCJldGFnIiwic2FuaXRpemVFVGFnIiwiRVRhZyIsInNpemUiLCJTaXplIiwidGFncyIsIlVzZXJUYWdzIiwic3BsaXQiLCJ0YWciLCJtZXRhZGF0YSIsIlVzZXJNZXRhZGF0YSIsInB1c2giLCJDb21tb25QcmVmaXhlcyIsImNvbW1vblByZWZpeCIsInByZWZpeCIsIlByZWZpeCIsInBhcnNlTGlzdE9iamVjdHNWMiIsInBhcnNlQnVja2V0Tm90aWZpY2F0aW9uIiwiVG9waWNDb25maWd1cmF0aW9uIiwiUXVldWVDb25maWd1cmF0aW9uIiwiQ2xvdWRGdW5jdGlvbkNvbmZpZ3VyYXRpb24iLCJnZW5FdmVudHMiLCJldmVudHMiLCJnZW5GaWx0ZXJSdWxlcyIsImZpbHRlcnMiLCJfZmlsdGVyQXJyJCIsInJ1bGVzIiwiZmlsdGVyQXJyIiwiUzNLZXkiLCJfczNLZXlBcnIkIiwiczNLZXlBcnIiLCJGaWx0ZXJSdWxlIiwicnVsZSIsIk5hbWUiLCJWYWx1ZSIsIk5vdGlmaWNhdGlvbkNvbmZpZ3VyYXRpb24iLCJjb25maWciLCJJZCIsIlRvcGljIiwiRXZlbnQiLCJGaWx0ZXIiLCJRdWV1ZSIsIkNsb3VkRnVuY3Rpb24iLCJwYXJzZUxpc3RQYXJ0cyIsInBhcnRzIiwibWFya2VyIiwiTGlzdFBhcnRzUmVzdWx0IiwiTmV4dFBhcnROdW1iZXJNYXJrZXIiLCJQYXJ0IiwicCIsInBhcnQiLCJwYXJzZUludCIsIlBhcnROdW1iZXIiLCJyZXBsYWNlIiwicGFyc2VMaXN0QnVja2V0IiwibGlzdEJ1Y2tldFJlc3VsdFBhcnNlciIsInBhcnNlVGFnVmFsdWUiLCJsZWFkaW5nWmVyb3MiLCJoZXgiLCJ0YWdWYWx1ZVByb2Nlc3NvciIsInRhZ05hbWUiLCJ0YWdWYWx1ZSIsInRvU3RyaW5nIiwiaWdub3JlQXR0cmlidXRlcyIsInBhcnNlZFhtbFJlcyIsIkxpc3RBbGxNeUJ1Y2tldHNSZXN1bHQiLCJCdWNrZXRzIiwiQnVja2V0IiwibWFwIiwiYnVja2V0IiwiYnVja2V0TmFtZSIsIkNyZWF0aW9uRGF0ZSIsImNyZWF0aW9uRGF0ZSIsInBhcnNlSW5pdGlhdGVNdWx0aXBhcnQiLCJJbml0aWF0ZU11bHRpcGFydFVwbG9hZFJlc3VsdCIsIlVwbG9hZElkIiwicGFyc2VSZXBsaWNhdGlvbkNvbmZpZyIsIlJvbGUiLCJSdWxlIiwiUmVwbGljYXRpb25Db25maWd1cmF0aW9uIiwicm9sZSIsInBhcnNlT2JqZWN0TGVnYWxIb2xkQ29uZmlnIiwiTGVnYWxIb2xkIiwicGFyc2VUYWdnaW5nIiwiVGFnZ2luZyIsIlRhZ1NldCIsIlRhZyIsInRhZ1Jlc3VsdCIsIkFycmF5IiwiaXNBcnJheSIsInBhcnNlQ29tcGxldGVNdWx0aXBhcnQiLCJDb21wbGV0ZU11bHRpcGFydFVwbG9hZFJlc3VsdCIsIkxvY2F0aW9uIiwibG9jYXRpb24iLCJDb2RlIiwiTWVzc2FnZSIsImVyckNvZGUiLCJlcnJNZXNzYWdlIiwicGFyc2VMaXN0TXVsdGlwYXJ0IiwicHJlZml4ZXMiLCJ1cGxvYWRzIiwibmV4dEtleU1hcmtlciIsIm5leHRVcGxvYWRJZE1hcmtlciIsIkxpc3RNdWx0aXBhcnRVcGxvYWRzUmVzdWx0IiwiTmV4dEtleU1hcmtlciIsIk5leHRVcGxvYWRJZE1hcmtlciIsIlVwbG9hZCIsInVwbG9hZCIsInVwbG9hZEl0ZW0iLCJ1cGxvYWRJZCIsInN0b3JhZ2VDbGFzcyIsIlN0b3JhZ2VDbGFzcyIsImluaXRpYXRlZCIsIkluaXRpYXRlZCIsIkluaXRpYXRvciIsImluaXRpYXRvciIsImlkIiwiSUQiLCJkaXNwbGF5TmFtZSIsIkRpc3BsYXlOYW1lIiwiT3duZXIiLCJvd25lciIsInBhcnNlT2JqZWN0TG9ja0NvbmZpZyIsImxvY2tDb25maWdSZXN1bHQiLCJPYmplY3RMb2NrQ29uZmlndXJhdGlvbiIsIm9iamVjdExvY2tFbmFibGVkIiwiT2JqZWN0TG9ja0VuYWJsZWQiLCJyZXRlbnRpb25SZXNwIiwiRGVmYXVsdFJldGVudGlvbiIsIm1vZGUiLCJNb2RlIiwiaXNVbml0WWVhcnMiLCJZZWFycyIsInZhbGlkaXR5IiwidW5pdCIsIlJFVEVOVElPTl9WQUxJRElUWV9VTklUUyIsIllFQVJTIiwiRGF5cyIsIkRBWVMiLCJwYXJzZUJ1Y2tldFZlcnNpb25pbmdDb25maWciLCJWZXJzaW9uaW5nQ29uZmlndXJhdGlvbiIsImV4dHJhY3RIZWFkZXJUeXBlIiwic3RyZWFtIiwiaGVhZGVyTmFtZUxlbiIsIkJ1ZmZlciIsImZyb20iLCJyZWFkIiwicmVhZFVJbnQ4IiwiaGVhZGVyTmFtZVdpdGhTZXBhcmF0b3IiLCJzcGxpdEJ5U2VwYXJhdG9yIiwibGVuZ3RoIiwiZXh0cmFjdEhlYWRlclZhbHVlIiwiYm9keUxlbiIsInJlYWRVSW50MTZCRSIsInBhcnNlU2VsZWN0T2JqZWN0Q29udGVudFJlc3BvbnNlIiwicmVzIiwic2VsZWN0UmVzdWx0cyIsIlNlbGVjdFJlc3VsdHMiLCJyZXNwb25zZVN0cmVhbSIsInJlYWRhYmxlU3RyZWFtIiwiX3JlYWRhYmxlU3RhdGUiLCJtc2dDcmNBY2N1bXVsYXRvciIsInRvdGFsQnl0ZUxlbmd0aEJ1ZmZlciIsImNyYzMyIiwiaGVhZGVyQnl0ZXNCdWZmZXIiLCJjYWxjdWxhdGVkUHJlbHVkZUNyYyIsInJlYWRJbnQzMkJFIiwicHJlbHVkZUNyY0J1ZmZlciIsInRvdGFsTXNnTGVuZ3RoIiwiaGVhZGVyTGVuZ3RoIiwicHJlbHVkZUNyY0J5dGVWYWx1ZSIsImhlYWRlckJ5dGVzIiwiaGVhZGVyUmVhZGVyU3RyZWFtIiwiaGVhZGVyVHlwZU5hbWUiLCJwYXlsb2FkU3RyZWFtIiwicGF5TG9hZExlbmd0aCIsInBheUxvYWRCdWZmZXIiLCJtZXNzYWdlQ3JjQnl0ZVZhbHVlIiwiY2FsY3VsYXRlZENyYyIsIm1lc3NhZ2VUeXBlIiwiZXJyb3JNZXNzYWdlIiwiY29udGVudFR5cGUiLCJldmVudFR5cGUiLCJzZXRSZXNwb25zZSIsIl9wYXlsb2FkU3RyZWFtIiwicmVhZERhdGEiLCJzZXRSZWNvcmRzIiwiX3BheWxvYWRTdHJlYW0yIiwicHJvZ3Jlc3NEYXRhIiwic2V0UHJvZ3Jlc3MiLCJfcGF5bG9hZFN0cmVhbTMiLCJzdGF0c0RhdGEiLCJzZXRTdGF0cyIsIndhcm5pbmdNZXNzYWdlIiwiY29uc29sZSIsIndhcm4iLCJwYXJzZUxpZmVjeWNsZUNvbmZpZyIsIkxpZmVjeWNsZUNvbmZpZ3VyYXRpb24iLCJwYXJzZUJ1Y2tldEVuY3J5cHRpb25Db25maWciLCJwYXJzZU9iamVjdFJldGVudGlvbkNvbmZpZyIsInJldGVudGlvbkNvbmZpZyIsIlJldGVudGlvbiIsInJldGFpblVudGlsRGF0ZSIsIlJldGFpblVudGlsRGF0ZSIsInJlbW92ZU9iamVjdHNQYXJzZXIiLCJEZWxldGVSZXN1bHQiLCJwYXJzZUNvcHlPYmplY3QiLCJDb3B5T2JqZWN0UmVzdWx0IiwiZm9ybWF0T2JqSW5mbyIsIm9wdHMiLCJWZXJzaW9uSWQiLCJJc0xhdGVzdCIsImlzT2JqZWN0IiwidW5kZWZpbmVkIiwic2FuaXRpemVTaXplIiwidmVyc2lvbklkIiwiaXNMYXRlc3QiLCJpc0RlbGV0ZU1hcmtlciIsIklzRGVsZXRlTWFya2VyIiwicGFyc2VMaXN0T2JqZWN0cyIsIm5leHRNYXJrZXIiLCJ2ZXJzaW9uSWRNYXJrZXIiLCJrZXlNYXJrZXIiLCJwYXJzZUNvbW1vblByZWZpeGVzRW50aXR5IiwiY29tbW9uUHJlZml4RW50cnkiLCJsaXN0QnVja2V0UmVzdWx0IiwibGlzdFZlcnNpb25zUmVzdWx0IiwiTGlzdFZlcnNpb25zUmVzdWx0IiwiTWFya2VyIiwiTmV4dE1hcmtlciIsIl9yZXN1bHQkb2JqZWN0cyIsIlZlcnNpb24iLCJEZWxldGVNYXJrZXIiLCJOZXh0VmVyc2lvbklkTWFya2VyIiwidXBsb2FkUGFydFBhcnNlciIsInJlc3BFbCIsIkNvcHlQYXJ0UmVzdWx0Il0sInNvdXJjZXMiOlsieG1sLXBhcnNlci50cyJdLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgdHlwZSAqIGFzIGh0dHAgZnJvbSAnbm9kZTpodHRwJ1xuaW1wb3J0IHR5cGUgc3RyZWFtIGZyb20gJ25vZGU6c3RyZWFtJ1xuXG5pbXBvcnQgY3JjMzIgZnJvbSAnYnVmZmVyLWNyYzMyJ1xuaW1wb3J0IHsgWE1MUGFyc2VyIH0gZnJvbSAnZmFzdC14bWwtcGFyc2VyJ1xuXG5pbXBvcnQgKiBhcyBlcnJvcnMgZnJvbSAnLi4vZXJyb3JzLnRzJ1xuaW1wb3J0IHsgU2VsZWN0UmVzdWx0cyB9IGZyb20gJy4uL2hlbHBlcnMudHMnXG5pbXBvcnQgeyBpc09iamVjdCwgcGFyc2VYbWwsIHJlYWRhYmxlU3RyZWFtLCBzYW5pdGl6ZUVUYWcsIHNhbml0aXplT2JqZWN0S2V5LCBzYW5pdGl6ZVNpemUsIHRvQXJyYXkgfSBmcm9tICcuL2hlbHBlci50cydcbmltcG9ydCB7IHJlYWRBc1N0cmluZyB9IGZyb20gJy4vcmVzcG9uc2UudHMnXG5pbXBvcnQgdHlwZSB7XG4gIEJ1Y2tldEl0ZW1Gcm9tTGlzdCxcbiAgQnVja2V0SXRlbVdpdGhNZXRhZGF0YSxcbiAgQ2xvdWRGdW5jdGlvbkNvbmZpZ0VudHJ5LFxuICBDb21tb25QcmVmaXgsXG4gIENvcHlPYmplY3RSZXN1bHRWMSxcbiAgTGlzdEJ1Y2tldFJlc3VsdFYxLFxuICBMaXN0T2JqZWN0VjJSZXMsXG4gIE5vdGlmaWNhdGlvbkNvbmZpZ1Jlc3VsdCxcbiAgT2JqZWN0SW5mbyxcbiAgT2JqZWN0TG9ja0luZm8sXG4gIE9iamVjdFJvd0VudHJ5LFxuICBRdWV1ZUNvbmZpZ0VudHJ5LFxuICBSZXBsaWNhdGlvbkNvbmZpZyxcbiAgVGFnLFxuICBUYWdzLFxuICBUb3BpY0NvbmZpZ0VudHJ5LFxufSBmcm9tICcuL3R5cGUudHMnXG5pbXBvcnQgeyBSRVRFTlRJT05fVkFMSURJVFlfVU5JVFMgfSBmcm9tICcuL3R5cGUudHMnXG5cbi8vIHBhcnNlIFhNTCByZXNwb25zZSBmb3IgYnVja2V0IHJlZ2lvblxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlQnVja2V0UmVnaW9uKHhtbDogc3RyaW5nKTogc3RyaW5nIHtcbiAgLy8gcmV0dXJuIHJlZ2lvbiBpbmZvcm1hdGlvblxuICByZXR1cm4gcGFyc2VYbWwoeG1sKS5Mb2NhdGlvbkNvbnN0cmFpbnRcbn1cblxuY29uc3QgZnhwID0gbmV3IFhNTFBhcnNlcigpXG5cbmNvbnN0IGZ4cFdpdGhvdXROdW1QYXJzZXIgPSBuZXcgWE1MUGFyc2VyKHtcbiAgLy8gQHRzLWlnbm9yZVxuICBudW1iZXJQYXJzZU9wdGlvbnM6IHtcbiAgICBza2lwTGlrZTogLy4vLFxuICB9LFxufSlcblxuLy8gUGFyc2UgWE1MIGFuZCByZXR1cm4gaW5mb3JtYXRpb24gYXMgSmF2YXNjcmlwdCB0eXBlc1xuLy8gcGFyc2UgZXJyb3IgWE1MIHJlc3BvbnNlXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VFcnJvcih4bWw6IHN0cmluZywgaGVhZGVySW5mbzogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pIHtcbiAgbGV0IHhtbEVyciA9IHt9XG4gIGNvbnN0IHhtbE9iaiA9IGZ4cC5wYXJzZSh4bWwpXG4gIGlmICh4bWxPYmouRXJyb3IpIHtcbiAgICB4bWxFcnIgPSB4bWxPYmouRXJyb3JcbiAgfVxuICBjb25zdCBlID0gbmV3IGVycm9ycy5TM0Vycm9yKCkgYXMgdW5rbm93biBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPlxuICBPYmplY3QuZW50cmllcyh4bWxFcnIpLmZvckVhY2goKFtrZXksIHZhbHVlXSkgPT4ge1xuICAgIGVba2V5LnRvTG93ZXJDYXNlKCldID0gdmFsdWVcbiAgfSlcbiAgT2JqZWN0LmVudHJpZXMoaGVhZGVySW5mbykuZm9yRWFjaCgoW2tleSwgdmFsdWVdKSA9PiB7XG4gICAgZVtrZXldID0gdmFsdWVcbiAgfSlcbiAgcmV0dXJuIGVcbn1cblxuLy8gR2VuZXJhdGVzIGFuIEVycm9yIG9iamVjdCBkZXBlbmRpbmcgb24gaHR0cCBzdGF0dXNDb2RlIGFuZCBYTUwgYm9keVxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHBhcnNlUmVzcG9uc2VFcnJvcihyZXNwb25zZTogaHR0cC5JbmNvbWluZ01lc3NhZ2UpOiBQcm9taXNlPFJlY29yZDxzdHJpbmcsIHN0cmluZz4+IHtcbiAgY29uc3Qgc3RhdHVzQ29kZSA9IHJlc3BvbnNlLnN0YXR1c0NvZGVcbiAgbGV0IGNvZGUgPSAnJyxcbiAgICBtZXNzYWdlID0gJydcbiAgaWYgKHN0YXR1c0NvZGUgPT09IDMwMSkge1xuICAgIGNvZGUgPSAnTW92ZWRQZXJtYW5lbnRseSdcbiAgICBtZXNzYWdlID0gJ01vdmVkIFBlcm1hbmVudGx5J1xuICB9IGVsc2UgaWYgKHN0YXR1c0NvZGUgPT09IDMwNykge1xuICAgIGNvZGUgPSAnVGVtcG9yYXJ5UmVkaXJlY3QnXG4gICAgbWVzc2FnZSA9ICdBcmUgeW91IHVzaW5nIHRoZSBjb3JyZWN0IGVuZHBvaW50IFVSTD8nXG4gIH0gZWxzZSBpZiAoc3RhdHVzQ29kZSA9PT0gNDAzKSB7XG4gICAgY29kZSA9ICdBY2Nlc3NEZW5pZWQnXG4gICAgbWVzc2FnZSA9ICdWYWxpZCBhbmQgYXV0aG9yaXplZCBjcmVkZW50aWFscyByZXF1aXJlZCdcbiAgfSBlbHNlIGlmIChzdGF0dXNDb2RlID09PSA0MDQpIHtcbiAgICBjb2RlID0gJ05vdEZvdW5kJ1xuICAgIG1lc3NhZ2UgPSAnTm90IEZvdW5kJ1xuICB9IGVsc2UgaWYgKHN0YXR1c0NvZGUgPT09IDQwNSkge1xuICAgIGNvZGUgPSAnTWV0aG9kTm90QWxsb3dlZCdcbiAgICBtZXNzYWdlID0gJ01ldGhvZCBOb3QgQWxsb3dlZCdcbiAgfSBlbHNlIGlmIChzdGF0dXNDb2RlID09PSA1MDEpIHtcbiAgICBjb2RlID0gJ01ldGhvZE5vdEFsbG93ZWQnXG4gICAgbWVzc2FnZSA9ICdNZXRob2QgTm90IEFsbG93ZWQnXG4gIH0gZWxzZSBpZiAoc3RhdHVzQ29kZSA9PT0gNTAzKSB7XG4gICAgY29kZSA9ICdTbG93RG93bidcbiAgICBtZXNzYWdlID0gJ1BsZWFzZSByZWR1Y2UgeW91ciByZXF1ZXN0IHJhdGUuJ1xuICB9IGVsc2Uge1xuICAgIGNvbnN0IGhFcnJDb2RlID0gcmVzcG9uc2UuaGVhZGVyc1sneC1taW5pby1lcnJvci1jb2RlJ10gYXMgc3RyaW5nXG4gICAgY29uc3QgaEVyckRlc2MgPSByZXNwb25zZS5oZWFkZXJzWyd4LW1pbmlvLWVycm9yLWRlc2MnXSBhcyBzdHJpbmdcblxuICAgIGlmIChoRXJyQ29kZSAmJiBoRXJyRGVzYykge1xuICAgICAgY29kZSA9IGhFcnJDb2RlXG4gICAgICBtZXNzYWdlID0gaEVyckRlc2NcbiAgICB9XG4gIH1cbiAgY29uc3QgaGVhZGVySW5mbzogUmVjb3JkPHN0cmluZywgc3RyaW5nIHwgdW5kZWZpbmVkIHwgbnVsbD4gPSB7fVxuICAvLyBBIHZhbHVlIGNyZWF0ZWQgYnkgUzMgY29tcGF0aWJsZSBzZXJ2ZXIgdGhhdCB1bmlxdWVseSBpZGVudGlmaWVzIHRoZSByZXF1ZXN0LlxuICBoZWFkZXJJbmZvLmFtelJlcXVlc3RpZCA9IHJlc3BvbnNlLmhlYWRlcnNbJ3gtYW16LXJlcXVlc3QtaWQnXSBhcyBzdHJpbmcgfCB1bmRlZmluZWRcbiAgLy8gQSBzcGVjaWFsIHRva2VuIHRoYXQgaGVscHMgdHJvdWJsZXNob290IEFQSSByZXBsaWVzIGFuZCBpc3N1ZXMuXG4gIGhlYWRlckluZm8uYW16SWQyID0gcmVzcG9uc2UuaGVhZGVyc1sneC1hbXotaWQtMiddIGFzIHN0cmluZyB8IHVuZGVmaW5lZFxuXG4gIC8vIFJlZ2lvbiB3aGVyZSB0aGUgYnVja2V0IGlzIGxvY2F0ZWQuIFRoaXMgaGVhZGVyIGlzIHJldHVybmVkIG9ubHlcbiAgLy8gaW4gSEVBRCBidWNrZXQgYW5kIExpc3RPYmplY3RzIHJlc3BvbnNlLlxuICBoZWFkZXJJbmZvLmFtekJ1Y2tldFJlZ2lvbiA9IHJlc3BvbnNlLmhlYWRlcnNbJ3gtYW16LWJ1Y2tldC1yZWdpb24nXSBhcyBzdHJpbmcgfCB1bmRlZmluZWRcblxuICBjb25zdCB4bWxTdHJpbmcgPSBhd2FpdCByZWFkQXNTdHJpbmcocmVzcG9uc2UpXG5cbiAgaWYgKHhtbFN0cmluZykge1xuICAgIHRocm93IHBhcnNlRXJyb3IoeG1sU3RyaW5nLCBoZWFkZXJJbmZvKVxuICB9XG5cbiAgLy8gTWVzc2FnZSBzaG91bGQgYmUgaW5zdGFudGlhdGVkIGZvciBlYWNoIFMzRXJyb3JzLlxuICBjb25zdCBlID0gbmV3IGVycm9ycy5TM0Vycm9yKG1lc3NhZ2UsIHsgY2F1c2U6IGhlYWRlckluZm8gfSlcbiAgLy8gUzMgRXJyb3IgY29kZS5cbiAgZS5jb2RlID0gY29kZVxuICBPYmplY3QuZW50cmllcyhoZWFkZXJJbmZvKS5mb3JFYWNoKChba2V5LCB2YWx1ZV0pID0+IHtcbiAgICAvLyBAdHMtZXhwZWN0LWVycm9yIGZvcmNlIHNldCBlcnJvciBwcm9wZXJ0aWVzXG4gICAgZVtrZXldID0gdmFsdWVcbiAgfSlcblxuICB0aHJvdyBlXG59XG5cbi8qKlxuICogcGFyc2UgWE1MIHJlc3BvbnNlIGZvciBsaXN0IG9iamVjdHMgdjIgd2l0aCBtZXRhZGF0YSBpbiBhIGJ1Y2tldFxuICovXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VMaXN0T2JqZWN0c1YyV2l0aE1ldGFkYXRhKHhtbDogc3RyaW5nKSB7XG4gIGNvbnN0IHJlc3VsdDoge1xuICAgIG9iamVjdHM6IEFycmF5PEJ1Y2tldEl0ZW1XaXRoTWV0YWRhdGE+XG4gICAgaXNUcnVuY2F0ZWQ6IGJvb2xlYW5cbiAgICBuZXh0Q29udGludWF0aW9uVG9rZW46IHN0cmluZ1xuICB9ID0ge1xuICAgIG9iamVjdHM6IFtdLFxuICAgIGlzVHJ1bmNhdGVkOiBmYWxzZSxcbiAgICBuZXh0Q29udGludWF0aW9uVG9rZW46ICcnLFxuICB9XG5cbiAgbGV0IHhtbG9iaiA9IHBhcnNlWG1sKHhtbClcbiAgaWYgKCF4bWxvYmouTGlzdEJ1Y2tldFJlc3VsdCkge1xuICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZFhNTEVycm9yKCdNaXNzaW5nIHRhZzogXCJMaXN0QnVja2V0UmVzdWx0XCInKVxuICB9XG4gIHhtbG9iaiA9IHhtbG9iai5MaXN0QnVja2V0UmVzdWx0XG4gIGlmICh4bWxvYmouSXNUcnVuY2F0ZWQpIHtcbiAgICByZXN1bHQuaXNUcnVuY2F0ZWQgPSB4bWxvYmouSXNUcnVuY2F0ZWRcbiAgfVxuICBpZiAoeG1sb2JqLk5leHRDb250aW51YXRpb25Ub2tlbikge1xuICAgIHJlc3VsdC5uZXh0Q29udGludWF0aW9uVG9rZW4gPSB4bWxvYmouTmV4dENvbnRpbnVhdGlvblRva2VuXG4gIH1cblxuICBpZiAoeG1sb2JqLkNvbnRlbnRzKSB7XG4gICAgdG9BcnJheSh4bWxvYmouQ29udGVudHMpLmZvckVhY2goKGNvbnRlbnQpID0+IHtcbiAgICAgIGNvbnN0IG5hbWUgPSBzYW5pdGl6ZU9iamVjdEtleShjb250ZW50LktleSlcbiAgICAgIGNvbnN0IGxhc3RNb2RpZmllZCA9IG5ldyBEYXRlKGNvbnRlbnQuTGFzdE1vZGlmaWVkKVxuICAgICAgY29uc3QgZXRhZyA9IHNhbml0aXplRVRhZyhjb250ZW50LkVUYWcpXG4gICAgICBjb25zdCBzaXplID0gY29udGVudC5TaXplXG5cbiAgICAgIGxldCB0YWdzOiBUYWdzID0ge31cbiAgICAgIGlmIChjb250ZW50LlVzZXJUYWdzICE9IG51bGwpIHtcbiAgICAgICAgdG9BcnJheShjb250ZW50LlVzZXJUYWdzLnNwbGl0KCcmJykpLmZvckVhY2goKHRhZykgPT4ge1xuICAgICAgICAgIGNvbnN0IFtrZXksIHZhbHVlXSA9IHRhZy5zcGxpdCgnPScpXG4gICAgICAgICAgdGFnc1trZXldID0gdmFsdWVcbiAgICAgICAgfSlcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRhZ3MgPSB7fVxuICAgICAgfVxuXG4gICAgICBsZXQgbWV0YWRhdGFcbiAgICAgIGlmIChjb250ZW50LlVzZXJNZXRhZGF0YSAhPSBudWxsKSB7XG4gICAgICAgIG1ldGFkYXRhID0gdG9BcnJheShjb250ZW50LlVzZXJNZXRhZGF0YSlbMF1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIG1ldGFkYXRhID0gbnVsbFxuICAgICAgfVxuICAgICAgcmVzdWx0Lm9iamVjdHMucHVzaCh7IG5hbWUsIGxhc3RNb2RpZmllZCwgZXRhZywgc2l6ZSwgbWV0YWRhdGEsIHRhZ3MgfSlcbiAgICB9KVxuICB9XG5cbiAgaWYgKHhtbG9iai5Db21tb25QcmVmaXhlcykge1xuICAgIHRvQXJyYXkoeG1sb2JqLkNvbW1vblByZWZpeGVzKS5mb3JFYWNoKChjb21tb25QcmVmaXgpID0+IHtcbiAgICAgIHJlc3VsdC5vYmplY3RzLnB1c2goeyBwcmVmaXg6IHNhbml0aXplT2JqZWN0S2V5KHRvQXJyYXkoY29tbW9uUHJlZml4LlByZWZpeClbMF0pLCBzaXplOiAwIH0pXG4gICAgfSlcbiAgfVxuICByZXR1cm4gcmVzdWx0XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZUxpc3RPYmplY3RzVjIoeG1sOiBzdHJpbmcpOiBMaXN0T2JqZWN0VjJSZXMge1xuICBjb25zdCByZXN1bHQ6IExpc3RPYmplY3RWMlJlcyA9IHtcbiAgICBvYmplY3RzOiBbXSxcbiAgICBpc1RydW5jYXRlZDogZmFsc2UsXG4gICAgbmV4dENvbnRpbnVhdGlvblRva2VuOiAnJyxcbiAgfVxuXG4gIGxldCB4bWxvYmogPSBwYXJzZVhtbCh4bWwpXG4gIGlmICgheG1sb2JqLkxpc3RCdWNrZXRSZXN1bHQpIHtcbiAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRYTUxFcnJvcignTWlzc2luZyB0YWc6IFwiTGlzdEJ1Y2tldFJlc3VsdFwiJylcbiAgfVxuICB4bWxvYmogPSB4bWxvYmouTGlzdEJ1Y2tldFJlc3VsdFxuICBpZiAoeG1sb2JqLklzVHJ1bmNhdGVkKSB7XG4gICAgcmVzdWx0LmlzVHJ1bmNhdGVkID0geG1sb2JqLklzVHJ1bmNhdGVkXG4gIH1cbiAgaWYgKHhtbG9iai5OZXh0Q29udGludWF0aW9uVG9rZW4pIHtcbiAgICByZXN1bHQubmV4dENvbnRpbnVhdGlvblRva2VuID0geG1sb2JqLk5leHRDb250aW51YXRpb25Ub2tlblxuICB9XG4gIGlmICh4bWxvYmouQ29udGVudHMpIHtcbiAgICB0b0FycmF5KHhtbG9iai5Db250ZW50cykuZm9yRWFjaCgoY29udGVudCkgPT4ge1xuICAgICAgY29uc3QgbmFtZSA9IHNhbml0aXplT2JqZWN0S2V5KHRvQXJyYXkoY29udGVudC5LZXkpWzBdKVxuICAgICAgY29uc3QgbGFzdE1vZGlmaWVkID0gbmV3IERhdGUoY29udGVudC5MYXN0TW9kaWZpZWQpXG4gICAgICBjb25zdCBldGFnID0gc2FuaXRpemVFVGFnKGNvbnRlbnQuRVRhZylcbiAgICAgIGNvbnN0IHNpemUgPSBjb250ZW50LlNpemVcbiAgICAgIHJlc3VsdC5vYmplY3RzLnB1c2goeyBuYW1lLCBsYXN0TW9kaWZpZWQsIGV0YWcsIHNpemUgfSlcbiAgICB9KVxuICB9XG4gIGlmICh4bWxvYmouQ29tbW9uUHJlZml4ZXMpIHtcbiAgICB0b0FycmF5KHhtbG9iai5Db21tb25QcmVmaXhlcykuZm9yRWFjaCgoY29tbW9uUHJlZml4KSA9PiB7XG4gICAgICByZXN1bHQub2JqZWN0cy5wdXNoKHsgcHJlZml4OiBzYW5pdGl6ZU9iamVjdEtleSh0b0FycmF5KGNvbW1vblByZWZpeC5QcmVmaXgpWzBdKSwgc2l6ZTogMCB9KVxuICAgIH0pXG4gIH1cbiAgcmV0dXJuIHJlc3VsdFxufVxuXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VCdWNrZXROb3RpZmljYXRpb24oeG1sOiBzdHJpbmcpOiBOb3RpZmljYXRpb25Db25maWdSZXN1bHQge1xuICBjb25zdCByZXN1bHQ6IE5vdGlmaWNhdGlvbkNvbmZpZ1Jlc3VsdCA9IHtcbiAgICBUb3BpY0NvbmZpZ3VyYXRpb246IFtdLFxuICAgIFF1ZXVlQ29uZmlndXJhdGlvbjogW10sXG4gICAgQ2xvdWRGdW5jdGlvbkNvbmZpZ3VyYXRpb246IFtdLFxuICB9XG5cbiAgY29uc3QgZ2VuRXZlbnRzID0gKGV2ZW50czogdW5rbm93bik6IHN0cmluZ1tdID0+IHtcbiAgICBpZiAoIWV2ZW50cykge1xuICAgICAgcmV0dXJuIFtdXG4gICAgfVxuICAgIHJldHVybiB0b0FycmF5KGV2ZW50cykgYXMgc3RyaW5nW11cbiAgfVxuXG4gIGNvbnN0IGdlbkZpbHRlclJ1bGVzID0gKGZpbHRlcnM6IHVua25vd24pOiB7IE5hbWU6IHN0cmluZzsgVmFsdWU6IHN0cmluZyB9W10gPT4ge1xuICAgIGNvbnN0IHJ1bGVzOiB7IE5hbWU6IHN0cmluZzsgVmFsdWU6IHN0cmluZyB9W10gPSBbXVxuICAgIGlmICghZmlsdGVycykge1xuICAgICAgcmV0dXJuIHJ1bGVzXG4gICAgfVxuICAgIGNvbnN0IGZpbHRlckFyciA9IHRvQXJyYXkoZmlsdGVycykgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj5bXVxuICAgIGlmIChmaWx0ZXJBcnJbMF0/LlMzS2V5KSB7XG4gICAgICBjb25zdCBzM0tleUFyciA9IHRvQXJyYXkoKGZpbHRlckFyclswXSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPikuUzNLZXkpIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+W11cbiAgICAgIGlmIChzM0tleUFyclswXT8uRmlsdGVyUnVsZSkge1xuICAgICAgICB0b0FycmF5KHMzS2V5QXJyWzBdLkZpbHRlclJ1bGUpLmZvckVhY2goKHJ1bGU6IHVua25vd24pID0+IHtcbiAgICAgICAgICBjb25zdCByID0gcnVsZSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPlxuICAgICAgICAgIGNvbnN0IE5hbWUgPSB0b0FycmF5KHIuTmFtZSlbMF0gYXMgc3RyaW5nXG4gICAgICAgICAgY29uc3QgVmFsdWUgPSB0b0FycmF5KHIuVmFsdWUpWzBdIGFzIHN0cmluZ1xuICAgICAgICAgIHJ1bGVzLnB1c2goeyBOYW1lLCBWYWx1ZSB9KVxuICAgICAgICB9KVxuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gcnVsZXNcbiAgfVxuXG4gIGxldCB4bWxvYmogPSBwYXJzZVhtbCh4bWwpXG4gIHhtbG9iaiA9IHhtbG9iai5Ob3RpZmljYXRpb25Db25maWd1cmF0aW9uXG5cbiAgaWYgKHhtbG9iai5Ub3BpY0NvbmZpZ3VyYXRpb24pIHtcbiAgICB0b0FycmF5KHhtbG9iai5Ub3BpY0NvbmZpZ3VyYXRpb24pLmZvckVhY2goKGNvbmZpZzogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pID0+IHtcbiAgICAgIGNvbnN0IElkID0gdG9BcnJheShjb25maWcuSWQpWzBdIGFzIHN0cmluZ1xuICAgICAgY29uc3QgVG9waWMgPSB0b0FycmF5KGNvbmZpZy5Ub3BpYylbMF0gYXMgc3RyaW5nXG4gICAgICBjb25zdCBFdmVudCA9IGdlbkV2ZW50cyhjb25maWcuRXZlbnQpXG4gICAgICBjb25zdCBGaWx0ZXIgPSBnZW5GaWx0ZXJSdWxlcyhjb25maWcuRmlsdGVyKVxuICAgICAgcmVzdWx0LlRvcGljQ29uZmlndXJhdGlvbi5wdXNoKHsgSWQsIFRvcGljLCBFdmVudCwgRmlsdGVyIH0gYXMgVG9waWNDb25maWdFbnRyeSlcbiAgICB9KVxuICB9XG4gIGlmICh4bWxvYmouUXVldWVDb25maWd1cmF0aW9uKSB7XG4gICAgdG9BcnJheSh4bWxvYmouUXVldWVDb25maWd1cmF0aW9uKS5mb3JFYWNoKChjb25maWc6IFJlY29yZDxzdHJpbmcsIHVua25vd24+KSA9PiB7XG4gICAgICBjb25zdCBJZCA9IHRvQXJyYXkoY29uZmlnLklkKVswXSBhcyBzdHJpbmdcbiAgICAgIGNvbnN0IFF1ZXVlID0gdG9BcnJheShjb25maWcuUXVldWUpWzBdIGFzIHN0cmluZ1xuICAgICAgY29uc3QgRXZlbnQgPSBnZW5FdmVudHMoY29uZmlnLkV2ZW50KVxuICAgICAgY29uc3QgRmlsdGVyID0gZ2VuRmlsdGVyUnVsZXMoY29uZmlnLkZpbHRlcilcbiAgICAgIHJlc3VsdC5RdWV1ZUNvbmZpZ3VyYXRpb24ucHVzaCh7IElkLCBRdWV1ZSwgRXZlbnQsIEZpbHRlciB9IGFzIFF1ZXVlQ29uZmlnRW50cnkpXG4gICAgfSlcbiAgfVxuICBpZiAoeG1sb2JqLkNsb3VkRnVuY3Rpb25Db25maWd1cmF0aW9uKSB7XG4gICAgdG9BcnJheSh4bWxvYmouQ2xvdWRGdW5jdGlvbkNvbmZpZ3VyYXRpb24pLmZvckVhY2goKGNvbmZpZzogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pID0+IHtcbiAgICAgIGNvbnN0IElkID0gdG9BcnJheShjb25maWcuSWQpWzBdIGFzIHN0cmluZ1xuICAgICAgY29uc3QgQ2xvdWRGdW5jdGlvbiA9IHRvQXJyYXkoY29uZmlnLkNsb3VkRnVuY3Rpb24pWzBdIGFzIHN0cmluZ1xuICAgICAgY29uc3QgRXZlbnQgPSBnZW5FdmVudHMoY29uZmlnLkV2ZW50KVxuICAgICAgY29uc3QgRmlsdGVyID0gZ2VuRmlsdGVyUnVsZXMoY29uZmlnLkZpbHRlcilcbiAgICAgIHJlc3VsdC5DbG91ZEZ1bmN0aW9uQ29uZmlndXJhdGlvbi5wdXNoKHsgSWQsIENsb3VkRnVuY3Rpb24sIEV2ZW50LCBGaWx0ZXIgfSBhcyBDbG91ZEZ1bmN0aW9uQ29uZmlnRW50cnkpXG4gICAgfSlcbiAgfVxuXG4gIHJldHVybiByZXN1bHRcbn1cblxuZXhwb3J0IHR5cGUgVXBsb2FkZWRQYXJ0ID0ge1xuICBwYXJ0OiBudW1iZXJcbiAgbGFzdE1vZGlmaWVkPzogRGF0ZVxuICBldGFnOiBzdHJpbmdcbiAgc2l6ZTogbnVtYmVyXG59XG5cbi8vIHBhcnNlIFhNTCByZXNwb25zZSBmb3IgbGlzdCBwYXJ0cyBvZiBhbiBpbiBwcm9ncmVzcyBtdWx0aXBhcnQgdXBsb2FkXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VMaXN0UGFydHMoeG1sOiBzdHJpbmcpOiB7XG4gIGlzVHJ1bmNhdGVkOiBib29sZWFuXG4gIG1hcmtlcjogbnVtYmVyXG4gIHBhcnRzOiBVcGxvYWRlZFBhcnRbXVxufSB7XG4gIGxldCB4bWxvYmogPSBwYXJzZVhtbCh4bWwpXG4gIGNvbnN0IHJlc3VsdDoge1xuICAgIGlzVHJ1bmNhdGVkOiBib29sZWFuXG4gICAgbWFya2VyOiBudW1iZXJcbiAgICBwYXJ0czogVXBsb2FkZWRQYXJ0W11cbiAgfSA9IHtcbiAgICBpc1RydW5jYXRlZDogZmFsc2UsXG4gICAgcGFydHM6IFtdLFxuICAgIG1hcmtlcjogMCxcbiAgfVxuICBpZiAoIXhtbG9iai5MaXN0UGFydHNSZXN1bHQpIHtcbiAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRYTUxFcnJvcignTWlzc2luZyB0YWc6IFwiTGlzdFBhcnRzUmVzdWx0XCInKVxuICB9XG4gIHhtbG9iaiA9IHhtbG9iai5MaXN0UGFydHNSZXN1bHRcbiAgaWYgKHhtbG9iai5Jc1RydW5jYXRlZCkge1xuICAgIHJlc3VsdC5pc1RydW5jYXRlZCA9IHhtbG9iai5Jc1RydW5jYXRlZFxuICB9XG4gIGlmICh4bWxvYmouTmV4dFBhcnROdW1iZXJNYXJrZXIpIHtcbiAgICByZXN1bHQubWFya2VyID0gdG9BcnJheSh4bWxvYmouTmV4dFBhcnROdW1iZXJNYXJrZXIpWzBdIHx8ICcnXG4gIH1cbiAgaWYgKHhtbG9iai5QYXJ0KSB7XG4gICAgdG9BcnJheSh4bWxvYmouUGFydCkuZm9yRWFjaCgocCkgPT4ge1xuICAgICAgY29uc3QgcGFydCA9IHBhcnNlSW50KHRvQXJyYXkocC5QYXJ0TnVtYmVyKVswXSwgMTApXG4gICAgICBjb25zdCBsYXN0TW9kaWZpZWQgPSBuZXcgRGF0ZShwLkxhc3RNb2RpZmllZClcbiAgICAgIGNvbnN0IGV0YWcgPSBwLkVUYWcucmVwbGFjZSgvXlwiL2csICcnKVxuICAgICAgICAucmVwbGFjZSgvXCIkL2csICcnKVxuICAgICAgICAucmVwbGFjZSgvXiZxdW90Oy9nLCAnJylcbiAgICAgICAgLnJlcGxhY2UoLyZxdW90OyQvZywgJycpXG4gICAgICAgIC5yZXBsYWNlKC9eJiMzNDsvZywgJycpXG4gICAgICAgIC5yZXBsYWNlKC8mIzM0OyQvZywgJycpXG4gICAgICByZXN1bHQucGFydHMucHVzaCh7IHBhcnQsIGxhc3RNb2RpZmllZCwgZXRhZywgc2l6ZTogcGFyc2VJbnQocC5TaXplLCAxMCkgfSlcbiAgICB9KVxuICB9XG4gIHJldHVybiByZXN1bHRcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlTGlzdEJ1Y2tldCh4bWw6IHN0cmluZyk6IEJ1Y2tldEl0ZW1Gcm9tTGlzdFtdIHtcbiAgbGV0IHJlc3VsdDogQnVja2V0SXRlbUZyb21MaXN0W10gPSBbXVxuICBjb25zdCBsaXN0QnVja2V0UmVzdWx0UGFyc2VyID0gbmV3IFhNTFBhcnNlcih7XG4gICAgcGFyc2VUYWdWYWx1ZTogdHJ1ZSwgLy8gRW5hYmxlIHBhcnNpbmcgb2YgdmFsdWVzXG4gICAgbnVtYmVyUGFyc2VPcHRpb25zOiB7XG4gICAgICBsZWFkaW5nWmVyb3M6IGZhbHNlLCAvLyBEaXNhYmxlIG51bWJlciBwYXJzaW5nIGZvciB2YWx1ZXMgd2l0aCBsZWFkaW5nIHplcm9zXG4gICAgICBoZXg6IGZhbHNlLCAvLyBEaXNhYmxlIGhleCBudW1iZXIgcGFyc2luZyAtIEludmFsaWQgYnVja2V0IG5hbWVcbiAgICAgIHNraXBMaWtlOiAvXlswLTldKyQvLCAvLyBTa2lwIG51bWJlciBwYXJzaW5nIGlmIHRoZSB2YWx1ZSBjb25zaXN0cyBlbnRpcmVseSBvZiBkaWdpdHNcbiAgICB9LFxuICAgIHRhZ1ZhbHVlUHJvY2Vzc29yOiAodGFnTmFtZSwgdGFnVmFsdWUgPSAnJykgPT4ge1xuICAgICAgLy8gRW5zdXJlIHRoYXQgdGhlIE5hbWUgdGFnIGlzIGFsd2F5cyB0cmVhdGVkIGFzIGEgc3RyaW5nXG4gICAgICBpZiAodGFnTmFtZSA9PT0gJ05hbWUnKSB7XG4gICAgICAgIHJldHVybiB0YWdWYWx1ZS50b1N0cmluZygpXG4gICAgICB9XG4gICAgICByZXR1cm4gdGFnVmFsdWVcbiAgICB9LFxuICAgIGlnbm9yZUF0dHJpYnV0ZXM6IGZhbHNlLCAvLyBFbnN1cmUgdGhhdCBhbGwgYXR0cmlidXRlcyBhcmUgcGFyc2VkXG4gIH0pXG5cbiAgY29uc3QgcGFyc2VkWG1sUmVzID0gbGlzdEJ1Y2tldFJlc3VsdFBhcnNlci5wYXJzZSh4bWwpXG5cbiAgaWYgKCFwYXJzZWRYbWxSZXMuTGlzdEFsbE15QnVja2V0c1Jlc3VsdCkge1xuICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZFhNTEVycm9yKCdNaXNzaW5nIHRhZzogXCJMaXN0QWxsTXlCdWNrZXRzUmVzdWx0XCInKVxuICB9XG5cbiAgY29uc3QgeyBMaXN0QWxsTXlCdWNrZXRzUmVzdWx0OiB7IEJ1Y2tldHMgPSB7fSB9ID0ge30gfSA9IHBhcnNlZFhtbFJlc1xuXG4gIGlmIChCdWNrZXRzLkJ1Y2tldCkge1xuICAgIHJlc3VsdCA9IHRvQXJyYXkoQnVja2V0cy5CdWNrZXQpLm1hcCgoYnVja2V0ID0ge30pID0+IHtcbiAgICAgIGNvbnN0IHsgTmFtZTogYnVja2V0TmFtZSwgQ3JlYXRpb25EYXRlIH0gPSBidWNrZXRcbiAgICAgIGNvbnN0IGNyZWF0aW9uRGF0ZSA9IG5ldyBEYXRlKENyZWF0aW9uRGF0ZSlcblxuICAgICAgcmV0dXJuIHsgbmFtZTogYnVja2V0TmFtZSwgY3JlYXRpb25EYXRlIH1cbiAgICB9KVxuICB9XG5cbiAgcmV0dXJuIHJlc3VsdFxufVxuXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VJbml0aWF0ZU11bHRpcGFydCh4bWw6IHN0cmluZyk6IHN0cmluZyB7XG4gIGxldCB4bWxvYmogPSBwYXJzZVhtbCh4bWwpXG5cbiAgaWYgKCF4bWxvYmouSW5pdGlhdGVNdWx0aXBhcnRVcGxvYWRSZXN1bHQpIHtcbiAgICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRYTUxFcnJvcignTWlzc2luZyB0YWc6IFwiSW5pdGlhdGVNdWx0aXBhcnRVcGxvYWRSZXN1bHRcIicpXG4gIH1cbiAgeG1sb2JqID0geG1sb2JqLkluaXRpYXRlTXVsdGlwYXJ0VXBsb2FkUmVzdWx0XG5cbiAgaWYgKHhtbG9iai5VcGxvYWRJZCkge1xuICAgIHJldHVybiB4bWxvYmouVXBsb2FkSWRcbiAgfVxuICB0aHJvdyBuZXcgZXJyb3JzLkludmFsaWRYTUxFcnJvcignTWlzc2luZyB0YWc6IFwiVXBsb2FkSWRcIicpXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZVJlcGxpY2F0aW9uQ29uZmlnKHhtbDogc3RyaW5nKTogUmVwbGljYXRpb25Db25maWcge1xuICBjb25zdCB4bWxPYmogPSBwYXJzZVhtbCh4bWwpXG4gIGNvbnN0IHsgUm9sZSwgUnVsZSB9ID0geG1sT2JqLlJlcGxpY2F0aW9uQ29uZmlndXJhdGlvblxuICByZXR1cm4ge1xuICAgIFJlcGxpY2F0aW9uQ29uZmlndXJhdGlvbjoge1xuICAgICAgcm9sZTogUm9sZSxcbiAgICAgIHJ1bGVzOiB0b0FycmF5KFJ1bGUpLFxuICAgIH0sXG4gIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlT2JqZWN0TGVnYWxIb2xkQ29uZmlnKHhtbDogc3RyaW5nKSB7XG4gIGNvbnN0IHhtbE9iaiA9IHBhcnNlWG1sKHhtbClcbiAgcmV0dXJuIHhtbE9iai5MZWdhbEhvbGRcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlVGFnZ2luZyh4bWw6IHN0cmluZykge1xuICBjb25zdCB4bWxPYmogPSBwYXJzZVhtbCh4bWwpXG4gIGxldCByZXN1bHQ6IFRhZ1tdID0gW11cbiAgaWYgKHhtbE9iai5UYWdnaW5nICYmIHhtbE9iai5UYWdnaW5nLlRhZ1NldCAmJiB4bWxPYmouVGFnZ2luZy5UYWdTZXQuVGFnKSB7XG4gICAgY29uc3QgdGFnUmVzdWx0OiBUYWcgPSB4bWxPYmouVGFnZ2luZy5UYWdTZXQuVGFnXG4gICAgLy8gaWYgaXQgaXMgYSBzaW5nbGUgdGFnIGNvbnZlcnQgaW50byBhbiBhcnJheSBzbyB0aGF0IHRoZSByZXR1cm4gdmFsdWUgaXMgYWx3YXlzIGFuIGFycmF5LlxuICAgIGlmIChBcnJheS5pc0FycmF5KHRhZ1Jlc3VsdCkpIHtcbiAgICAgIHJlc3VsdCA9IFsuLi50YWdSZXN1bHRdXG4gICAgfSBlbHNlIHtcbiAgICAgIHJlc3VsdC5wdXNoKHRhZ1Jlc3VsdClcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHJlc3VsdFxufVxuXG4vLyBwYXJzZSBYTUwgcmVzcG9uc2Ugd2hlbiBhIG11bHRpcGFydCB1cGxvYWQgaXMgY29tcGxldGVkXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VDb21wbGV0ZU11bHRpcGFydCh4bWw6IHN0cmluZykge1xuICBjb25zdCB4bWxvYmogPSBwYXJzZVhtbCh4bWwpLkNvbXBsZXRlTXVsdGlwYXJ0VXBsb2FkUmVzdWx0XG4gIGlmICh4bWxvYmouTG9jYXRpb24pIHtcbiAgICBjb25zdCBsb2NhdGlvbiA9IHRvQXJyYXkoeG1sb2JqLkxvY2F0aW9uKVswXVxuICAgIGNvbnN0IGJ1Y2tldCA9IHRvQXJyYXkoeG1sb2JqLkJ1Y2tldClbMF1cbiAgICBjb25zdCBrZXkgPSB4bWxvYmouS2V5XG4gICAgY29uc3QgZXRhZyA9IHhtbG9iai5FVGFnLnJlcGxhY2UoL15cIi9nLCAnJylcbiAgICAgIC5yZXBsYWNlKC9cIiQvZywgJycpXG4gICAgICAucmVwbGFjZSgvXiZxdW90Oy9nLCAnJylcbiAgICAgIC5yZXBsYWNlKC8mcXVvdDskL2csICcnKVxuICAgICAgLnJlcGxhY2UoL14mIzM0Oy9nLCAnJylcbiAgICAgIC5yZXBsYWNlKC8mIzM0OyQvZywgJycpXG5cbiAgICByZXR1cm4geyBsb2NhdGlvbiwgYnVja2V0LCBrZXksIGV0YWcgfVxuICB9XG4gIC8vIENvbXBsZXRlIE11bHRpcGFydCBjYW4gcmV0dXJuIFhNTCBFcnJvciBhZnRlciBhIDIwMCBPSyByZXNwb25zZVxuICBpZiAoeG1sb2JqLkNvZGUgJiYgeG1sb2JqLk1lc3NhZ2UpIHtcbiAgICBjb25zdCBlcnJDb2RlID0gdG9BcnJheSh4bWxvYmouQ29kZSlbMF1cbiAgICBjb25zdCBlcnJNZXNzYWdlID0gdG9BcnJheSh4bWxvYmouTWVzc2FnZSlbMF1cbiAgICByZXR1cm4geyBlcnJDb2RlLCBlcnJNZXNzYWdlIH1cbiAgfVxufVxuXG50eXBlIFVwbG9hZElEID0gc3RyaW5nXG5cbmV4cG9ydCB0eXBlIExpc3RNdWx0aXBhcnRSZXN1bHQgPSB7XG4gIHVwbG9hZHM6IHtcbiAgICBrZXk6IHN0cmluZ1xuICAgIHVwbG9hZElkOiBVcGxvYWRJRFxuICAgIGluaXRpYXRvcj86IHsgaWQ6IHN0cmluZzsgZGlzcGxheU5hbWU6IHN0cmluZyB9XG4gICAgb3duZXI/OiB7IGlkOiBzdHJpbmc7IGRpc3BsYXlOYW1lOiBzdHJpbmcgfVxuICAgIHN0b3JhZ2VDbGFzczogdW5rbm93blxuICAgIGluaXRpYXRlZDogRGF0ZVxuICB9W11cbiAgcHJlZml4ZXM6IHtcbiAgICBwcmVmaXg6IHN0cmluZ1xuICB9W11cbiAgaXNUcnVuY2F0ZWQ6IGJvb2xlYW5cbiAgbmV4dEtleU1hcmtlcjogc3RyaW5nXG4gIG5leHRVcGxvYWRJZE1hcmtlcjogc3RyaW5nXG59XG5cbi8vIHBhcnNlIFhNTCByZXNwb25zZSBmb3IgbGlzdGluZyBpbi1wcm9ncmVzcyBtdWx0aXBhcnQgdXBsb2Fkc1xuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlTGlzdE11bHRpcGFydCh4bWw6IHN0cmluZyk6IExpc3RNdWx0aXBhcnRSZXN1bHQge1xuICBjb25zdCByZXN1bHQ6IExpc3RNdWx0aXBhcnRSZXN1bHQgPSB7XG4gICAgcHJlZml4ZXM6IFtdLFxuICAgIHVwbG9hZHM6IFtdLFxuICAgIGlzVHJ1bmNhdGVkOiBmYWxzZSxcbiAgICBuZXh0S2V5TWFya2VyOiAnJyxcbiAgICBuZXh0VXBsb2FkSWRNYXJrZXI6ICcnLFxuICB9XG5cbiAgbGV0IHhtbG9iaiA9IHBhcnNlWG1sKHhtbClcblxuICBpZiAoIXhtbG9iai5MaXN0TXVsdGlwYXJ0VXBsb2Fkc1Jlc3VsdCkge1xuICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZFhNTEVycm9yKCdNaXNzaW5nIHRhZzogXCJMaXN0TXVsdGlwYXJ0VXBsb2Fkc1Jlc3VsdFwiJylcbiAgfVxuICB4bWxvYmogPSB4bWxvYmouTGlzdE11bHRpcGFydFVwbG9hZHNSZXN1bHRcbiAgaWYgKHhtbG9iai5Jc1RydW5jYXRlZCkge1xuICAgIHJlc3VsdC5pc1RydW5jYXRlZCA9IHhtbG9iai5Jc1RydW5jYXRlZFxuICB9XG4gIGlmICh4bWxvYmouTmV4dEtleU1hcmtlcikge1xuICAgIHJlc3VsdC5uZXh0S2V5TWFya2VyID0geG1sb2JqLk5leHRLZXlNYXJrZXJcbiAgfVxuICBpZiAoeG1sb2JqLk5leHRVcGxvYWRJZE1hcmtlcikge1xuICAgIHJlc3VsdC5uZXh0VXBsb2FkSWRNYXJrZXIgPSB4bWxvYmoubmV4dFVwbG9hZElkTWFya2VyIHx8ICcnXG4gIH1cblxuICBpZiAoeG1sb2JqLkNvbW1vblByZWZpeGVzKSB7XG4gICAgdG9BcnJheSh4bWxvYmouQ29tbW9uUHJlZml4ZXMpLmZvckVhY2goKHByZWZpeCkgPT4ge1xuICAgICAgLy8gQHRzLWV4cGVjdC1lcnJvciBpbmRleCBjaGVja1xuICAgICAgcmVzdWx0LnByZWZpeGVzLnB1c2goeyBwcmVmaXg6IHNhbml0aXplT2JqZWN0S2V5KHRvQXJyYXk8c3RyaW5nPihwcmVmaXguUHJlZml4KVswXSkgfSlcbiAgICB9KVxuICB9XG5cbiAgaWYgKHhtbG9iai5VcGxvYWQpIHtcbiAgICB0b0FycmF5KHhtbG9iai5VcGxvYWQpLmZvckVhY2goKHVwbG9hZCkgPT4ge1xuICAgICAgY29uc3QgdXBsb2FkSXRlbTogTGlzdE11bHRpcGFydFJlc3VsdFsndXBsb2FkcyddW251bWJlcl0gPSB7XG4gICAgICAgIGtleTogdXBsb2FkLktleSxcbiAgICAgICAgdXBsb2FkSWQ6IHVwbG9hZC5VcGxvYWRJZCxcbiAgICAgICAgc3RvcmFnZUNsYXNzOiB1cGxvYWQuU3RvcmFnZUNsYXNzLFxuICAgICAgICBpbml0aWF0ZWQ6IG5ldyBEYXRlKHVwbG9hZC5Jbml0aWF0ZWQpLFxuICAgICAgfVxuICAgICAgaWYgKHVwbG9hZC5Jbml0aWF0b3IpIHtcbiAgICAgICAgdXBsb2FkSXRlbS5pbml0aWF0b3IgPSB7IGlkOiB1cGxvYWQuSW5pdGlhdG9yLklELCBkaXNwbGF5TmFtZTogdXBsb2FkLkluaXRpYXRvci5EaXNwbGF5TmFtZSB9XG4gICAgICB9XG4gICAgICBpZiAodXBsb2FkLk93bmVyKSB7XG4gICAgICAgIHVwbG9hZEl0ZW0ub3duZXIgPSB7IGlkOiB1cGxvYWQuT3duZXIuSUQsIGRpc3BsYXlOYW1lOiB1cGxvYWQuT3duZXIuRGlzcGxheU5hbWUgfVxuICAgICAgfVxuICAgICAgcmVzdWx0LnVwbG9hZHMucHVzaCh1cGxvYWRJdGVtKVxuICAgIH0pXG4gIH1cbiAgcmV0dXJuIHJlc3VsdFxufVxuXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VPYmplY3RMb2NrQ29uZmlnKHhtbDogc3RyaW5nKTogT2JqZWN0TG9ja0luZm8ge1xuICBjb25zdCB4bWxPYmogPSBwYXJzZVhtbCh4bWwpXG4gIGxldCBsb2NrQ29uZmlnUmVzdWx0ID0ge30gYXMgT2JqZWN0TG9ja0luZm9cbiAgaWYgKHhtbE9iai5PYmplY3RMb2NrQ29uZmlndXJhdGlvbikge1xuICAgIGxvY2tDb25maWdSZXN1bHQgPSB7XG4gICAgICBvYmplY3RMb2NrRW5hYmxlZDogeG1sT2JqLk9iamVjdExvY2tDb25maWd1cmF0aW9uLk9iamVjdExvY2tFbmFibGVkLFxuICAgIH0gYXMgT2JqZWN0TG9ja0luZm9cbiAgICBsZXQgcmV0ZW50aW9uUmVzcFxuICAgIGlmIChcbiAgICAgIHhtbE9iai5PYmplY3RMb2NrQ29uZmlndXJhdGlvbiAmJlxuICAgICAgeG1sT2JqLk9iamVjdExvY2tDb25maWd1cmF0aW9uLlJ1bGUgJiZcbiAgICAgIHhtbE9iai5PYmplY3RMb2NrQ29uZmlndXJhdGlvbi5SdWxlLkRlZmF1bHRSZXRlbnRpb25cbiAgICApIHtcbiAgICAgIHJldGVudGlvblJlc3AgPSB4bWxPYmouT2JqZWN0TG9ja0NvbmZpZ3VyYXRpb24uUnVsZS5EZWZhdWx0UmV0ZW50aW9uIHx8IHt9XG4gICAgICBsb2NrQ29uZmlnUmVzdWx0Lm1vZGUgPSByZXRlbnRpb25SZXNwLk1vZGVcbiAgICB9XG4gICAgaWYgKHJldGVudGlvblJlc3ApIHtcbiAgICAgIGNvbnN0IGlzVW5pdFllYXJzID0gcmV0ZW50aW9uUmVzcC5ZZWFyc1xuICAgICAgaWYgKGlzVW5pdFllYXJzKSB7XG4gICAgICAgIGxvY2tDb25maWdSZXN1bHQudmFsaWRpdHkgPSBpc1VuaXRZZWFyc1xuICAgICAgICBsb2NrQ29uZmlnUmVzdWx0LnVuaXQgPSBSRVRFTlRJT05fVkFMSURJVFlfVU5JVFMuWUVBUlNcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGxvY2tDb25maWdSZXN1bHQudmFsaWRpdHkgPSByZXRlbnRpb25SZXNwLkRheXNcbiAgICAgICAgbG9ja0NvbmZpZ1Jlc3VsdC51bml0ID0gUkVURU5USU9OX1ZBTElESVRZX1VOSVRTLkRBWVNcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICByZXR1cm4gbG9ja0NvbmZpZ1Jlc3VsdFxufVxuXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VCdWNrZXRWZXJzaW9uaW5nQ29uZmlnKHhtbDogc3RyaW5nKSB7XG4gIGNvbnN0IHhtbE9iaiA9IHBhcnNlWG1sKHhtbClcbiAgcmV0dXJuIHhtbE9iai5WZXJzaW9uaW5nQ29uZmlndXJhdGlvblxufVxuXG4vLyBVc2VkIG9ubHkgaW4gc2VsZWN0T2JqZWN0Q29udGVudCBBUEkuXG4vLyBleHRyYWN0SGVhZGVyVHlwZSBleHRyYWN0cyB0aGUgZmlyc3QgaGFsZiBvZiB0aGUgaGVhZGVyIG1lc3NhZ2UsIHRoZSBoZWFkZXIgdHlwZS5cbmZ1bmN0aW9uIGV4dHJhY3RIZWFkZXJUeXBlKHN0cmVhbTogc3RyZWFtLlJlYWRhYmxlKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgY29uc3QgaGVhZGVyTmFtZUxlbiA9IEJ1ZmZlci5mcm9tKHN0cmVhbS5yZWFkKDEpKS5yZWFkVUludDgoKVxuICBjb25zdCBoZWFkZXJOYW1lV2l0aFNlcGFyYXRvciA9IEJ1ZmZlci5mcm9tKHN0cmVhbS5yZWFkKGhlYWRlck5hbWVMZW4pKS50b1N0cmluZygpXG4gIGNvbnN0IHNwbGl0QnlTZXBhcmF0b3IgPSAoaGVhZGVyTmFtZVdpdGhTZXBhcmF0b3IgfHwgJycpLnNwbGl0KCc6JylcbiAgcmV0dXJuIHNwbGl0QnlTZXBhcmF0b3IubGVuZ3RoID49IDEgPyBzcGxpdEJ5U2VwYXJhdG9yWzFdIDogJydcbn1cblxuZnVuY3Rpb24gZXh0cmFjdEhlYWRlclZhbHVlKHN0cmVhbTogc3RyZWFtLlJlYWRhYmxlKSB7XG4gIGNvbnN0IGJvZHlMZW4gPSBCdWZmZXIuZnJvbShzdHJlYW0ucmVhZCgyKSkucmVhZFVJbnQxNkJFKClcbiAgcmV0dXJuIEJ1ZmZlci5mcm9tKHN0cmVhbS5yZWFkKGJvZHlMZW4pKS50b1N0cmluZygpXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZVNlbGVjdE9iamVjdENvbnRlbnRSZXNwb25zZShyZXM6IEJ1ZmZlcikge1xuICBjb25zdCBzZWxlY3RSZXN1bHRzID0gbmV3IFNlbGVjdFJlc3VsdHMoe30pIC8vIHdpbGwgYmUgcmV0dXJuZWRcblxuICBjb25zdCByZXNwb25zZVN0cmVhbSA9IHJlYWRhYmxlU3RyZWFtKHJlcykgLy8gY29udmVydCBieXRlIGFycmF5IHRvIGEgcmVhZGFibGUgcmVzcG9uc2VTdHJlYW1cbiAgLy8gQHRzLWlnbm9yZVxuICB3aGlsZSAocmVzcG9uc2VTdHJlYW0uX3JlYWRhYmxlU3RhdGUubGVuZ3RoKSB7XG4gICAgLy8gVG9wIGxldmVsIHJlc3BvbnNlU3RyZWFtIHJlYWQgdHJhY2tlci5cbiAgICBsZXQgbXNnQ3JjQWNjdW11bGF0b3IgLy8gYWNjdW11bGF0ZSBmcm9tIHN0YXJ0IG9mIHRoZSBtZXNzYWdlIHRpbGwgdGhlIG1lc3NhZ2UgY3JjIHN0YXJ0LlxuXG4gICAgY29uc3QgdG90YWxCeXRlTGVuZ3RoQnVmZmVyID0gQnVmZmVyLmZyb20ocmVzcG9uc2VTdHJlYW0ucmVhZCg0KSlcbiAgICBtc2dDcmNBY2N1bXVsYXRvciA9IGNyYzMyKHRvdGFsQnl0ZUxlbmd0aEJ1ZmZlcilcblxuICAgIGNvbnN0IGhlYWRlckJ5dGVzQnVmZmVyID0gQnVmZmVyLmZyb20ocmVzcG9uc2VTdHJlYW0ucmVhZCg0KSlcbiAgICBtc2dDcmNBY2N1bXVsYXRvciA9IGNyYzMyKGhlYWRlckJ5dGVzQnVmZmVyLCBtc2dDcmNBY2N1bXVsYXRvcilcblxuICAgIGNvbnN0IGNhbGN1bGF0ZWRQcmVsdWRlQ3JjID0gbXNnQ3JjQWNjdW11bGF0b3IucmVhZEludDMyQkUoKSAvLyB1c2UgaXQgdG8gY2hlY2sgaWYgYW55IENSQyBtaXNtYXRjaCBpbiBoZWFkZXIgaXRzZWxmLlxuXG4gICAgY29uc3QgcHJlbHVkZUNyY0J1ZmZlciA9IEJ1ZmZlci5mcm9tKHJlc3BvbnNlU3RyZWFtLnJlYWQoNCkpIC8vIHJlYWQgNCBieXRlcyAgICBpLmUgNCs0ID04ICsgNCA9IDEyICggcHJlbHVkZSArIHByZWx1ZGUgY3JjKVxuICAgIG1zZ0NyY0FjY3VtdWxhdG9yID0gY3JjMzIocHJlbHVkZUNyY0J1ZmZlciwgbXNnQ3JjQWNjdW11bGF0b3IpXG5cbiAgICBjb25zdCB0b3RhbE1zZ0xlbmd0aCA9IHRvdGFsQnl0ZUxlbmd0aEJ1ZmZlci5yZWFkSW50MzJCRSgpXG4gICAgY29uc3QgaGVhZGVyTGVuZ3RoID0gaGVhZGVyQnl0ZXNCdWZmZXIucmVhZEludDMyQkUoKVxuICAgIGNvbnN0IHByZWx1ZGVDcmNCeXRlVmFsdWUgPSBwcmVsdWRlQ3JjQnVmZmVyLnJlYWRJbnQzMkJFKClcblxuICAgIGlmIChwcmVsdWRlQ3JjQnl0ZVZhbHVlICE9PSBjYWxjdWxhdGVkUHJlbHVkZUNyYykge1xuICAgICAgLy8gSGFuZGxlIEhlYWRlciBDUkMgbWlzbWF0Y2ggRXJyb3JcbiAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgYEhlYWRlciBDaGVja3N1bSBNaXNtYXRjaCwgUHJlbHVkZSBDUkMgb2YgJHtwcmVsdWRlQ3JjQnl0ZVZhbHVlfSBkb2VzIG5vdCBlcXVhbCBleHBlY3RlZCBDUkMgb2YgJHtjYWxjdWxhdGVkUHJlbHVkZUNyY31gLFxuICAgICAgKVxuICAgIH1cblxuICAgIGNvbnN0IGhlYWRlcnM6IFJlY29yZDxzdHJpbmcsIHVua25vd24+ID0ge31cbiAgICBpZiAoaGVhZGVyTGVuZ3RoID4gMCkge1xuICAgICAgY29uc3QgaGVhZGVyQnl0ZXMgPSBCdWZmZXIuZnJvbShyZXNwb25zZVN0cmVhbS5yZWFkKGhlYWRlckxlbmd0aCkpXG4gICAgICBtc2dDcmNBY2N1bXVsYXRvciA9IGNyYzMyKGhlYWRlckJ5dGVzLCBtc2dDcmNBY2N1bXVsYXRvcilcbiAgICAgIGNvbnN0IGhlYWRlclJlYWRlclN0cmVhbSA9IHJlYWRhYmxlU3RyZWFtKGhlYWRlckJ5dGVzKVxuICAgICAgLy8gQHRzLWlnbm9yZVxuICAgICAgd2hpbGUgKGhlYWRlclJlYWRlclN0cmVhbS5fcmVhZGFibGVTdGF0ZS5sZW5ndGgpIHtcbiAgICAgICAgY29uc3QgaGVhZGVyVHlwZU5hbWUgPSBleHRyYWN0SGVhZGVyVHlwZShoZWFkZXJSZWFkZXJTdHJlYW0pXG4gICAgICAgIGhlYWRlclJlYWRlclN0cmVhbS5yZWFkKDEpIC8vIGp1c3QgcmVhZCBhbmQgaWdub3JlIGl0LlxuICAgICAgICBpZiAoaGVhZGVyVHlwZU5hbWUpIHtcbiAgICAgICAgICBoZWFkZXJzW2hlYWRlclR5cGVOYW1lXSA9IGV4dHJhY3RIZWFkZXJWYWx1ZShoZWFkZXJSZWFkZXJTdHJlYW0pXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBsZXQgcGF5bG9hZFN0cmVhbVxuICAgIGNvbnN0IHBheUxvYWRMZW5ndGggPSB0b3RhbE1zZ0xlbmd0aCAtIGhlYWRlckxlbmd0aCAtIDE2XG4gICAgaWYgKHBheUxvYWRMZW5ndGggPiAwKSB7XG4gICAgICBjb25zdCBwYXlMb2FkQnVmZmVyID0gQnVmZmVyLmZyb20ocmVzcG9uc2VTdHJlYW0ucmVhZChwYXlMb2FkTGVuZ3RoKSlcbiAgICAgIG1zZ0NyY0FjY3VtdWxhdG9yID0gY3JjMzIocGF5TG9hZEJ1ZmZlciwgbXNnQ3JjQWNjdW11bGF0b3IpXG4gICAgICAvLyByZWFkIHRoZSBjaGVja3N1bSBlYXJseSBhbmQgZGV0ZWN0IGFueSBtaXNtYXRjaCBzbyB3ZSBjYW4gYXZvaWQgdW5uZWNlc3NhcnkgZnVydGhlciBwcm9jZXNzaW5nLlxuICAgICAgY29uc3QgbWVzc2FnZUNyY0J5dGVWYWx1ZSA9IEJ1ZmZlci5mcm9tKHJlc3BvbnNlU3RyZWFtLnJlYWQoNCkpLnJlYWRJbnQzMkJFKClcbiAgICAgIGNvbnN0IGNhbGN1bGF0ZWRDcmMgPSBtc2dDcmNBY2N1bXVsYXRvci5yZWFkSW50MzJCRSgpXG4gICAgICAvLyBIYW5kbGUgbWVzc2FnZSBDUkMgRXJyb3JcbiAgICAgIGlmIChtZXNzYWdlQ3JjQnl0ZVZhbHVlICE9PSBjYWxjdWxhdGVkQ3JjKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgICBgTWVzc2FnZSBDaGVja3N1bSBNaXNtYXRjaCwgTWVzc2FnZSBDUkMgb2YgJHttZXNzYWdlQ3JjQnl0ZVZhbHVlfSBkb2VzIG5vdCBlcXVhbCBleHBlY3RlZCBDUkMgb2YgJHtjYWxjdWxhdGVkQ3JjfWAsXG4gICAgICAgIClcbiAgICAgIH1cbiAgICAgIHBheWxvYWRTdHJlYW0gPSByZWFkYWJsZVN0cmVhbShwYXlMb2FkQnVmZmVyKVxuICAgIH1cbiAgICBjb25zdCBtZXNzYWdlVHlwZSA9IGhlYWRlcnNbJ21lc3NhZ2UtdHlwZSddXG5cbiAgICBzd2l0Y2ggKG1lc3NhZ2VUeXBlKSB7XG4gICAgICBjYXNlICdlcnJvcic6IHtcbiAgICAgICAgY29uc3QgZXJyb3JNZXNzYWdlID0gaGVhZGVyc1snZXJyb3ItY29kZSddICsgJzpcIicgKyBoZWFkZXJzWydlcnJvci1tZXNzYWdlJ10gKyAnXCInXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihlcnJvck1lc3NhZ2UpXG4gICAgICB9XG4gICAgICBjYXNlICdldmVudCc6IHtcbiAgICAgICAgY29uc3QgY29udGVudFR5cGUgPSBoZWFkZXJzWydjb250ZW50LXR5cGUnXVxuICAgICAgICBjb25zdCBldmVudFR5cGUgPSBoZWFkZXJzWydldmVudC10eXBlJ11cblxuICAgICAgICBzd2l0Y2ggKGV2ZW50VHlwZSkge1xuICAgICAgICAgIGNhc2UgJ0VuZCc6IHtcbiAgICAgICAgICAgIHNlbGVjdFJlc3VsdHMuc2V0UmVzcG9uc2UocmVzKVxuICAgICAgICAgICAgcmV0dXJuIHNlbGVjdFJlc3VsdHNcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBjYXNlICdSZWNvcmRzJzoge1xuICAgICAgICAgICAgY29uc3QgcmVhZERhdGEgPSBwYXlsb2FkU3RyZWFtPy5yZWFkKHBheUxvYWRMZW5ndGgpXG4gICAgICAgICAgICBzZWxlY3RSZXN1bHRzLnNldFJlY29yZHMocmVhZERhdGEpXG4gICAgICAgICAgICBicmVha1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGNhc2UgJ1Byb2dyZXNzJzpcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgc3dpdGNoIChjb250ZW50VHlwZSkge1xuICAgICAgICAgICAgICAgIGNhc2UgJ3RleHQveG1sJzoge1xuICAgICAgICAgICAgICAgICAgY29uc3QgcHJvZ3Jlc3NEYXRhID0gcGF5bG9hZFN0cmVhbT8ucmVhZChwYXlMb2FkTGVuZ3RoKVxuICAgICAgICAgICAgICAgICAgc2VsZWN0UmVzdWx0cy5zZXRQcm9ncmVzcyhwcm9ncmVzc0RhdGEudG9TdHJpbmcoKSlcbiAgICAgICAgICAgICAgICAgIGJyZWFrXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGRlZmF1bHQ6IHtcbiAgICAgICAgICAgICAgICAgIGNvbnN0IGVycm9yTWVzc2FnZSA9IGBVbmV4cGVjdGVkIGNvbnRlbnQtdHlwZSAke2NvbnRlbnRUeXBlfSBzZW50IGZvciBldmVudC10eXBlIFByb2dyZXNzYFxuICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGVycm9yTWVzc2FnZSlcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGJyZWFrXG4gICAgICAgICAgY2FzZSAnU3RhdHMnOlxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBzd2l0Y2ggKGNvbnRlbnRUeXBlKSB7XG4gICAgICAgICAgICAgICAgY2FzZSAndGV4dC94bWwnOiB7XG4gICAgICAgICAgICAgICAgICBjb25zdCBzdGF0c0RhdGEgPSBwYXlsb2FkU3RyZWFtPy5yZWFkKHBheUxvYWRMZW5ndGgpXG4gICAgICAgICAgICAgICAgICBzZWxlY3RSZXN1bHRzLnNldFN0YXRzKHN0YXRzRGF0YS50b1N0cmluZygpKVxuICAgICAgICAgICAgICAgICAgYnJlYWtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgZGVmYXVsdDoge1xuICAgICAgICAgICAgICAgICAgY29uc3QgZXJyb3JNZXNzYWdlID0gYFVuZXhwZWN0ZWQgY29udGVudC10eXBlICR7Y29udGVudFR5cGV9IHNlbnQgZm9yIGV2ZW50LXR5cGUgU3RhdHNgXG4gICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoZXJyb3JNZXNzYWdlKVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgYnJlYWtcbiAgICAgICAgICBkZWZhdWx0OiB7XG4gICAgICAgICAgICAvLyBDb250aW51YXRpb24gbWVzc2FnZTogTm90IHN1cmUgaWYgaXQgaXMgc3VwcG9ydGVkLiBkaWQgbm90IGZpbmQgYSByZWZlcmVuY2Ugb3IgYW55IG1lc3NhZ2UgaW4gcmVzcG9uc2UuXG4gICAgICAgICAgICAvLyBJdCBkb2VzIG5vdCBoYXZlIGEgcGF5bG9hZC5cbiAgICAgICAgICAgIGNvbnN0IHdhcm5pbmdNZXNzYWdlID0gYFVuIGltcGxlbWVudGVkIGV2ZW50IGRldGVjdGVkICAke21lc3NhZ2VUeXBlfS5gXG4gICAgICAgICAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgbm8tY29uc29sZVxuICAgICAgICAgICAgY29uc29sZS53YXJuKHdhcm5pbmdNZXNzYWdlKVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VMaWZlY3ljbGVDb25maWcoeG1sOiBzdHJpbmcpIHtcbiAgY29uc3QgeG1sT2JqID0gcGFyc2VYbWwoeG1sKVxuICByZXR1cm4geG1sT2JqLkxpZmVjeWNsZUNvbmZpZ3VyYXRpb25cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlQnVja2V0RW5jcnlwdGlvbkNvbmZpZyh4bWw6IHN0cmluZykge1xuICByZXR1cm4gcGFyc2VYbWwoeG1sKVxufVxuXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VPYmplY3RSZXRlbnRpb25Db25maWcoeG1sOiBzdHJpbmcpIHtcbiAgY29uc3QgeG1sT2JqID0gcGFyc2VYbWwoeG1sKVxuICBjb25zdCByZXRlbnRpb25Db25maWcgPSB4bWxPYmouUmV0ZW50aW9uXG4gIHJldHVybiB7XG4gICAgbW9kZTogcmV0ZW50aW9uQ29uZmlnLk1vZGUsXG4gICAgcmV0YWluVW50aWxEYXRlOiByZXRlbnRpb25Db25maWcuUmV0YWluVW50aWxEYXRlLFxuICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiByZW1vdmVPYmplY3RzUGFyc2VyKHhtbDogc3RyaW5nKSB7XG4gIGNvbnN0IHhtbE9iaiA9IHBhcnNlWG1sKHhtbClcbiAgaWYgKHhtbE9iai5EZWxldGVSZXN1bHQgJiYgeG1sT2JqLkRlbGV0ZVJlc3VsdC5FcnJvcikge1xuICAgIC8vIHJldHVybiBlcnJvcnMgYXMgYXJyYXkgYWx3YXlzLiBhcyB0aGUgcmVzcG9uc2UgaXMgb2JqZWN0IGluIGNhc2Ugb2Ygc2luZ2xlIG9iamVjdCBwYXNzZWQgaW4gcmVtb3ZlT2JqZWN0c1xuICAgIHJldHVybiB0b0FycmF5KHhtbE9iai5EZWxldGVSZXN1bHQuRXJyb3IpXG4gIH1cbiAgcmV0dXJuIFtdXG59XG5cbi8vIHBhcnNlIFhNTCByZXNwb25zZSBmb3IgY29weSBvYmplY3RcbmV4cG9ydCBmdW5jdGlvbiBwYXJzZUNvcHlPYmplY3QoeG1sOiBzdHJpbmcpOiBDb3B5T2JqZWN0UmVzdWx0VjEge1xuICBjb25zdCByZXN1bHQ6IENvcHlPYmplY3RSZXN1bHRWMSA9IHtcbiAgICBldGFnOiAnJyxcbiAgICBsYXN0TW9kaWZpZWQ6ICcnLFxuICB9XG5cbiAgbGV0IHhtbG9iaiA9IHBhcnNlWG1sKHhtbClcbiAgaWYgKCF4bWxvYmouQ29weU9iamVjdFJlc3VsdCkge1xuICAgIHRocm93IG5ldyBlcnJvcnMuSW52YWxpZFhNTEVycm9yKCdNaXNzaW5nIHRhZzogXCJDb3B5T2JqZWN0UmVzdWx0XCInKVxuICB9XG4gIHhtbG9iaiA9IHhtbG9iai5Db3B5T2JqZWN0UmVzdWx0XG4gIGlmICh4bWxvYmouRVRhZykge1xuICAgIHJlc3VsdC5ldGFnID0geG1sb2JqLkVUYWcucmVwbGFjZSgvXlwiL2csICcnKVxuICAgICAgLnJlcGxhY2UoL1wiJC9nLCAnJylcbiAgICAgIC5yZXBsYWNlKC9eJnF1b3Q7L2csICcnKVxuICAgICAgLnJlcGxhY2UoLyZxdW90OyQvZywgJycpXG4gICAgICAucmVwbGFjZSgvXiYjMzQ7L2csICcnKVxuICAgICAgLnJlcGxhY2UoLyYjMzQ7JC9nLCAnJylcbiAgfVxuICBpZiAoeG1sb2JqLkxhc3RNb2RpZmllZCkge1xuICAgIHJlc3VsdC5sYXN0TW9kaWZpZWQgPSBuZXcgRGF0ZSh4bWxvYmouTGFzdE1vZGlmaWVkKVxuICB9XG5cbiAgcmV0dXJuIHJlc3VsdFxufVxuXG5jb25zdCBmb3JtYXRPYmpJbmZvID0gKGNvbnRlbnQ6IE9iamVjdFJvd0VudHJ5LCBvcHRzOiB7IElzRGVsZXRlTWFya2VyPzogYm9vbGVhbiB9ID0ge30pID0+IHtcbiAgY29uc3QgeyBLZXksIExhc3RNb2RpZmllZCwgRVRhZywgU2l6ZSwgVmVyc2lvbklkLCBJc0xhdGVzdCB9ID0gY29udGVudFxuXG4gIGlmICghaXNPYmplY3Qob3B0cykpIHtcbiAgICBvcHRzID0ge31cbiAgfVxuXG4gIGNvbnN0IG5hbWUgPSBzYW5pdGl6ZU9iamVjdEtleSh0b0FycmF5KEtleSlbMF0gfHwgJycpXG4gIGNvbnN0IGxhc3RNb2RpZmllZCA9IExhc3RNb2RpZmllZCA/IG5ldyBEYXRlKHRvQXJyYXkoTGFzdE1vZGlmaWVkKVswXSB8fCAnJykgOiB1bmRlZmluZWRcbiAgY29uc3QgZXRhZyA9IHNhbml0aXplRVRhZyh0b0FycmF5KEVUYWcpWzBdIHx8ICcnKVxuICBjb25zdCBzaXplID0gc2FuaXRpemVTaXplKFNpemUgfHwgJycpXG5cbiAgcmV0dXJuIHtcbiAgICBuYW1lLFxuICAgIGxhc3RNb2RpZmllZCxcbiAgICBldGFnLFxuICAgIHNpemUsXG4gICAgdmVyc2lvbklkOiBWZXJzaW9uSWQsXG4gICAgaXNMYXRlc3Q6IElzTGF0ZXN0LFxuICAgIGlzRGVsZXRlTWFya2VyOiBvcHRzLklzRGVsZXRlTWFya2VyID8gb3B0cy5Jc0RlbGV0ZU1hcmtlciA6IGZhbHNlLFxuICB9XG59XG5cbi8vIHBhcnNlIFhNTCByZXNwb25zZSBmb3IgbGlzdCBvYmplY3RzIGluIGEgYnVja2V0XG5leHBvcnQgZnVuY3Rpb24gcGFyc2VMaXN0T2JqZWN0cyh4bWw6IHN0cmluZykge1xuICBjb25zdCByZXN1bHQ6IHtcbiAgICBvYmplY3RzOiBPYmplY3RJbmZvW11cbiAgICBpc1RydW5jYXRlZD86IGJvb2xlYW5cbiAgICBuZXh0TWFya2VyPzogc3RyaW5nXG4gICAgdmVyc2lvbklkTWFya2VyPzogc3RyaW5nXG4gICAga2V5TWFya2VyPzogc3RyaW5nXG4gIH0gPSB7XG4gICAgb2JqZWN0czogW10sXG4gICAgaXNUcnVuY2F0ZWQ6IGZhbHNlLFxuICAgIG5leHRNYXJrZXI6IHVuZGVmaW5lZCxcbiAgICB2ZXJzaW9uSWRNYXJrZXI6IHVuZGVmaW5lZCxcbiAgICBrZXlNYXJrZXI6IHVuZGVmaW5lZCxcbiAgfVxuICBsZXQgaXNUcnVuY2F0ZWQgPSBmYWxzZVxuICBsZXQgbmV4dE1hcmtlclxuICBjb25zdCB4bWxvYmogPSBmeHBXaXRob3V0TnVtUGFyc2VyLnBhcnNlKHhtbClcblxuICBjb25zdCBwYXJzZUNvbW1vblByZWZpeGVzRW50aXR5ID0gKGNvbW1vblByZWZpeEVudHJ5OiBDb21tb25QcmVmaXhbXSkgPT4ge1xuICAgIGlmIChjb21tb25QcmVmaXhFbnRyeSkge1xuICAgICAgdG9BcnJheShjb21tb25QcmVmaXhFbnRyeSkuZm9yRWFjaCgoY29tbW9uUHJlZml4KSA9PiB7XG4gICAgICAgIHJlc3VsdC5vYmplY3RzLnB1c2goeyBwcmVmaXg6IHNhbml0aXplT2JqZWN0S2V5KHRvQXJyYXkoY29tbW9uUHJlZml4LlByZWZpeClbMF0gfHwgJycpLCBzaXplOiAwIH0pXG4gICAgICB9KVxuICAgIH1cbiAgfVxuXG4gIGNvbnN0IGxpc3RCdWNrZXRSZXN1bHQ6IExpc3RCdWNrZXRSZXN1bHRWMSA9IHhtbG9iai5MaXN0QnVja2V0UmVzdWx0XG4gIGNvbnN0IGxpc3RWZXJzaW9uc1Jlc3VsdDogTGlzdEJ1Y2tldFJlc3VsdFYxID0geG1sb2JqLkxpc3RWZXJzaW9uc1Jlc3VsdFxuXG4gIGlmIChsaXN0QnVja2V0UmVzdWx0KSB7XG4gICAgaWYgKGxpc3RCdWNrZXRSZXN1bHQuSXNUcnVuY2F0ZWQpIHtcbiAgICAgIGlzVHJ1bmNhdGVkID0gbGlzdEJ1Y2tldFJlc3VsdC5Jc1RydW5jYXRlZFxuICAgIH1cbiAgICBpZiAobGlzdEJ1Y2tldFJlc3VsdC5Db250ZW50cykge1xuICAgICAgdG9BcnJheShsaXN0QnVja2V0UmVzdWx0LkNvbnRlbnRzKS5mb3JFYWNoKChjb250ZW50KSA9PiB7XG4gICAgICAgIGNvbnN0IG5hbWUgPSBzYW5pdGl6ZU9iamVjdEtleSh0b0FycmF5KGNvbnRlbnQuS2V5KVswXSB8fCAnJylcbiAgICAgICAgY29uc3QgbGFzdE1vZGlmaWVkID0gbmV3IERhdGUodG9BcnJheShjb250ZW50Lkxhc3RNb2RpZmllZClbMF0gfHwgJycpXG4gICAgICAgIGNvbnN0IGV0YWcgPSBzYW5pdGl6ZUVUYWcodG9BcnJheShjb250ZW50LkVUYWcpWzBdIHx8ICcnKVxuICAgICAgICBjb25zdCBzaXplID0gc2FuaXRpemVTaXplKGNvbnRlbnQuU2l6ZSB8fCAnJylcbiAgICAgICAgcmVzdWx0Lm9iamVjdHMucHVzaCh7IG5hbWUsIGxhc3RNb2RpZmllZCwgZXRhZywgc2l6ZSB9KVxuICAgICAgfSlcbiAgICB9XG5cbiAgICBpZiAobGlzdEJ1Y2tldFJlc3VsdC5NYXJrZXIpIHtcbiAgICAgIG5leHRNYXJrZXIgPSBsaXN0QnVja2V0UmVzdWx0Lk1hcmtlclxuICAgIH1cbiAgICBpZiAobGlzdEJ1Y2tldFJlc3VsdC5OZXh0TWFya2VyKSB7XG4gICAgICBuZXh0TWFya2VyID0gbGlzdEJ1Y2tldFJlc3VsdC5OZXh0TWFya2VyXG4gICAgfSBlbHNlIGlmIChpc1RydW5jYXRlZCAmJiByZXN1bHQub2JqZWN0cy5sZW5ndGggPiAwKSB7XG4gICAgICBuZXh0TWFya2VyID0gcmVzdWx0Lm9iamVjdHNbcmVzdWx0Lm9iamVjdHMubGVuZ3RoIC0gMV0/Lm5hbWVcbiAgICB9XG4gICAgaWYgKGxpc3RCdWNrZXRSZXN1bHQuQ29tbW9uUHJlZml4ZXMpIHtcbiAgICAgIHBhcnNlQ29tbW9uUHJlZml4ZXNFbnRpdHkobGlzdEJ1Y2tldFJlc3VsdC5Db21tb25QcmVmaXhlcylcbiAgICB9XG4gIH1cblxuICBpZiAobGlzdFZlcnNpb25zUmVzdWx0KSB7XG4gICAgaWYgKGxpc3RWZXJzaW9uc1Jlc3VsdC5Jc1RydW5jYXRlZCkge1xuICAgICAgaXNUcnVuY2F0ZWQgPSBsaXN0VmVyc2lvbnNSZXN1bHQuSXNUcnVuY2F0ZWRcbiAgICB9XG5cbiAgICBpZiAobGlzdFZlcnNpb25zUmVzdWx0LlZlcnNpb24pIHtcbiAgICAgIHRvQXJyYXkobGlzdFZlcnNpb25zUmVzdWx0LlZlcnNpb24pLmZvckVhY2goKGNvbnRlbnQpID0+IHtcbiAgICAgICAgcmVzdWx0Lm9iamVjdHMucHVzaChmb3JtYXRPYmpJbmZvKGNvbnRlbnQpKVxuICAgICAgfSlcbiAgICB9XG4gICAgaWYgKGxpc3RWZXJzaW9uc1Jlc3VsdC5EZWxldGVNYXJrZXIpIHtcbiAgICAgIHRvQXJyYXkobGlzdFZlcnNpb25zUmVzdWx0LkRlbGV0ZU1hcmtlcikuZm9yRWFjaCgoY29udGVudCkgPT4ge1xuICAgICAgICByZXN1bHQub2JqZWN0cy5wdXNoKGZvcm1hdE9iakluZm8oY29udGVudCwgeyBJc0RlbGV0ZU1hcmtlcjogdHJ1ZSB9KSlcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgaWYgKGxpc3RWZXJzaW9uc1Jlc3VsdC5OZXh0S2V5TWFya2VyKSB7XG4gICAgICByZXN1bHQua2V5TWFya2VyID0gbGlzdFZlcnNpb25zUmVzdWx0Lk5leHRLZXlNYXJrZXJcbiAgICB9XG4gICAgaWYgKGxpc3RWZXJzaW9uc1Jlc3VsdC5OZXh0VmVyc2lvbklkTWFya2VyKSB7XG4gICAgICByZXN1bHQudmVyc2lvbklkTWFya2VyID0gbGlzdFZlcnNpb25zUmVzdWx0Lk5leHRWZXJzaW9uSWRNYXJrZXJcbiAgICB9XG4gICAgaWYgKGxpc3RWZXJzaW9uc1Jlc3VsdC5Db21tb25QcmVmaXhlcykge1xuICAgICAgcGFyc2VDb21tb25QcmVmaXhlc0VudGl0eShsaXN0VmVyc2lvbnNSZXN1bHQuQ29tbW9uUHJlZml4ZXMpXG4gICAgfVxuICB9XG5cbiAgcmVzdWx0LmlzVHJ1bmNhdGVkID0gaXNUcnVuY2F0ZWRcbiAgaWYgKGlzVHJ1bmNhdGVkKSB7XG4gICAgcmVzdWx0Lm5leHRNYXJrZXIgPSBuZXh0TWFya2VyXG4gIH1cbiAgcmV0dXJuIHJlc3VsdFxufVxuXG5leHBvcnQgZnVuY3Rpb24gdXBsb2FkUGFydFBhcnNlcih4bWw6IHN0cmluZykge1xuICBjb25zdCB4bWxPYmogPSBwYXJzZVhtbCh4bWwpXG4gIGNvbnN0IHJlc3BFbCA9IHhtbE9iai5Db3B5UGFydFJlc3VsdFxuICByZXR1cm4gcmVzcEVsXG59XG4iXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBR0EsSUFBQUEsVUFBQSxHQUFBQyxPQUFBO0FBQ0EsSUFBQUMsY0FBQSxHQUFBRCxPQUFBO0FBRUEsSUFBQUUsTUFBQSxHQUFBQyx1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