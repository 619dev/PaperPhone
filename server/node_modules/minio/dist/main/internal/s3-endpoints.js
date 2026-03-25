"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.getS3Endpoint = getS3Endpoint;
var _helper = require("./helper.js");
/*
 * MinIO Javascript Library for Amazon S3 Compatible Cloud Storage, (C) 2015, 2016 MinIO, Inc.
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

// List of currently supported endpoints.
const awsS3Endpoint = {
  'af-south-1': 's3.af-south-1.amazonaws.com',
  'ap-east-1': 's3.ap-east-1.amazonaws.com',
  'ap-south-1': 's3.ap-south-1.amazonaws.com',
  'ap-south-2': 's3.ap-south-2.amazonaws.com',
  'ap-southeast-1': 's3.ap-southeast-1.amazonaws.com',
  'ap-southeast-2': 's3.ap-southeast-2.amazonaws.com',
  'ap-southeast-3': 's3.ap-southeast-3.amazonaws.com',
  'ap-southeast-4': 's3.ap-southeast-4.amazonaws.com',
  'ap-southeast-5': 's3.ap-southeast-5.amazonaws.com',
  'ap-northeast-1': 's3.ap-northeast-1.amazonaws.com',
  'ap-northeast-2': 's3.ap-northeast-2.amazonaws.com',
  'ap-northeast-3': 's3.ap-northeast-3.amazonaws.com',
  'ca-central-1': 's3.ca-central-1.amazonaws.com',
  'ca-west-1': 's3.ca-west-1.amazonaws.com',
  'cn-north-1': 's3.cn-north-1.amazonaws.com.cn',
  'eu-central-1': 's3.eu-central-1.amazonaws.com',
  'eu-central-2': 's3.eu-central-2.amazonaws.com',
  'eu-north-1': 's3.eu-north-1.amazonaws.com',
  'eu-south-1': 's3.eu-south-1.amazonaws.com',
  'eu-south-2': 's3.eu-south-2.amazonaws.com',
  'eu-west-1': 's3.eu-west-1.amazonaws.com',
  'eu-west-2': 's3.eu-west-2.amazonaws.com',
  'eu-west-3': 's3.eu-west-3.amazonaws.com',
  'il-central-1': 's3.il-central-1.amazonaws.com',
  'me-central-1': 's3.me-central-1.amazonaws.com',
  'me-south-1': 's3.me-south-1.amazonaws.com',
  'sa-east-1': 's3.sa-east-1.amazonaws.com',
  'us-east-1': 's3.us-east-1.amazonaws.com',
  'us-east-2': 's3.us-east-2.amazonaws.com',
  'us-west-1': 's3.us-west-1.amazonaws.com',
  'us-west-2': 's3.us-west-2.amazonaws.com',
  'us-gov-east-1': 's3.us-gov-east-1.amazonaws.com',
  'us-gov-west-1': 's3.us-gov-west-1.amazonaws.com'
  // Add new endpoints here.
};

// getS3Endpoint get relevant endpoint for the region.
function getS3Endpoint(region) {
  if (!(0, _helper.isString)(region)) {
    throw new TypeError(`Invalid region: ${region}`);
  }
  const endpoint = awsS3Endpoint[region];
  if (endpoint) {
    return endpoint;
  }
  return 's3.amazonaws.com';
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJfaGVscGVyIiwicmVxdWlyZSIsImF3c1MzRW5kcG9pbnQiLCJnZXRTM0VuZHBvaW50IiwicmVnaW9uIiwiaXNTdHJpbmciLCJUeXBlRXJyb3IiLCJlbmRwb2ludCJdLCJzb3VyY2VzIjpbInMzLWVuZHBvaW50cy50cyJdLCJzb3VyY2VzQ29udGVudCI6WyIvKlxuICogTWluSU8gSmF2YXNjcmlwdCBMaWJyYXJ5IGZvciBBbWF6b24gUzMgQ29tcGF0aWJsZSBDbG91ZCBTdG9yYWdlLCAoQykgMjAxNSwgMjAxNiBNaW5JTywgSW5jLlxuICpcbiAqIExpY2Vuc2VkIHVuZGVyIHRoZSBBcGFjaGUgTGljZW5zZSwgVmVyc2lvbiAyLjAgKHRoZSBcIkxpY2Vuc2VcIik7XG4gKiB5b3UgbWF5IG5vdCB1c2UgdGhpcyBmaWxlIGV4Y2VwdCBpbiBjb21wbGlhbmNlIHdpdGggdGhlIExpY2Vuc2UuXG4gKiBZb3UgbWF5IG9idGFpbiBhIGNvcHkgb2YgdGhlIExpY2Vuc2UgYXRcbiAqXG4gKiAgICAgaHR0cDovL3d3dy5hcGFjaGUub3JnL2xpY2Vuc2VzL0xJQ0VOU0UtMi4wXG4gKlxuICogVW5sZXNzIHJlcXVpcmVkIGJ5IGFwcGxpY2FibGUgbGF3IG9yIGFncmVlZCB0byBpbiB3cml0aW5nLCBzb2Z0d2FyZVxuICogZGlzdHJpYnV0ZWQgdW5kZXIgdGhlIExpY2Vuc2UgaXMgZGlzdHJpYnV0ZWQgb24gYW4gXCJBUyBJU1wiIEJBU0lTLFxuICogV0lUSE9VVCBXQVJSQU5USUVTIE9SIENPTkRJVElPTlMgT0YgQU5ZIEtJTkQsIGVpdGhlciBleHByZXNzIG9yIGltcGxpZWQuXG4gKiBTZWUgdGhlIExpY2Vuc2UgZm9yIHRoZSBzcGVjaWZpYyBsYW5ndWFnZSBnb3Zlcm5pbmcgcGVybWlzc2lvbnMgYW5kXG4gKiBsaW1pdGF0aW9ucyB1bmRlciB0aGUgTGljZW5zZS5cbiAqL1xuXG5pbXBvcnQgeyBpc1N0cmluZyB9IGZyb20gJy4vaGVscGVyLnRzJ1xuXG4vLyBMaXN0IG9mIGN1cnJlbnRseSBzdXBwb3J0ZWQgZW5kcG9pbnRzLlxuY29uc3QgYXdzUzNFbmRwb2ludCA9IHtcbiAgJ2FmLXNvdXRoLTEnOiAnczMuYWYtc291dGgtMS5hbWF6b25hd3MuY29tJyxcbiAgJ2FwLWVhc3QtMSc6ICdzMy5hcC1lYXN0LTEuYW1hem9uYXdzLmNvbScsXG4gICdhcC1zb3V0aC0xJzogJ3MzLmFwLXNvdXRoLTEuYW1hem9uYXdzLmNvbScsXG4gICdhcC1zb3V0aC0yJzogJ3MzLmFwLXNvdXRoLTIuYW1hem9uYXdzLmNvbScsXG4gICdhcC1zb3V0aGVhc3QtMSc6ICdzMy5hcC1zb3V0aGVhc3QtMS5hbWF6b25hd3MuY29tJyxcbiAgJ2FwLXNvdXRoZWFzdC0yJzogJ3MzLmFwLXNvdXRoZWFzdC0yLmFtYXpvbmF3cy5jb20nLFxuICAnYXAtc291dGhlYXN0LTMnOiAnczMuYXAtc291dGhlYXN0LTMuYW1hem9uYXdzLmNvbScsXG4gICdhcC1zb3V0aGVhc3QtNCc6ICdzMy5hcC1zb3V0aGVhc3QtNC5hbWF6b25hd3MuY29tJyxcbiAgJ2FwLXNvdXRoZWFzdC01JzogJ3MzLmFwLXNvdXRoZWFzdC01LmFtYXpvbmF3cy5jb20nLFxuICAnYXAtbm9ydGhlYXN0LTEnOiAnczMuYXAtbm9ydGhlYXN0LTEuYW1hem9uYXdzLmNvbScsXG4gICdhcC1ub3J0aGVhc3QtMic6ICdzMy5hcC1ub3J0aGVhc3QtMi5hbWF6b25hd3MuY29tJyxcbiAgJ2FwLW5vcnRoZWFzdC0zJzogJ3MzLmFwLW5vcnRoZWFzdC0zLmFtYXpvbmF3cy5jb20nLFxuICAnY2EtY2VudHJhbC0xJzogJ3MzLmNhLWNlbnRyYWwtMS5hbWF6b25hd3MuY29tJyxcbiAgJ2NhLXdlc3QtMSc6ICdzMy5jYS13ZXN0LTEuYW1hem9uYXdzLmNvbScsXG4gICdjbi1ub3J0aC0xJzogJ3MzLmNuLW5vcnRoLTEuYW1hem9uYXdzLmNvbS5jbicsXG4gICdldS1jZW50cmFsLTEnOiAnczMuZXUtY2VudHJhbC0xLmFtYXpvbmF3cy5jb20nLFxuICAnZXUtY2VudHJhbC0yJzogJ3MzLmV1LWNlbnRyYWwtMi5hbWF6b25hd3MuY29tJyxcbiAgJ2V1LW5vcnRoLTEnOiAnczMuZXUtbm9ydGgtMS5hbWF6b25hd3MuY29tJyxcbiAgJ2V1LXNvdXRoLTEnOiAnczMuZXUtc291dGgtMS5hbWF6b25hd3MuY29tJyxcbiAgJ2V1LXNvdXRoLTInOiAnczMuZXUtc291dGgtMi5hbWF6b25hd3MuY29tJyxcbiAgJ2V1LXdlc3QtMSc6ICdzMy5ldS13ZXN0LTEuYW1hem9uYXdzLmNvbScsXG4gICdldS13ZXN0LTInOiAnczMuZXUtd2VzdC0yLmFtYXpvbmF3cy5jb20nLFxuICAnZXUtd2VzdC0zJzogJ3MzLmV1LXdlc3QtMy5hbWF6b25hd3MuY29tJyxcbiAgJ2lsLWNlbnRyYWwtMSc6ICdzMy5pbC1jZW50cmFsLTEuYW1hem9uYXdzLmNvbScsXG4gICdtZS1jZW50cmFsLTEnOiAnczMubWUtY2VudHJhbC0xLmFtYXpvbmF3cy5jb20nLFxuICAnbWUtc291dGgtMSc6ICdzMy5tZS1zb3V0aC0xLmFtYXpvbmF3cy5jb20nLFxuICAnc2EtZWFzdC0xJzogJ3MzLnNhLWVhc3QtMS5hbWF6b25hd3MuY29tJyxcbiAgJ3VzLWVhc3QtMSc6ICdzMy51cy1lYXN0LTEuYW1hem9uYXdzLmNvbScsXG4gICd1cy1lYXN0LTInOiAnczMudXMtZWFzdC0yLmFtYXpvbmF3cy5jb20nLFxuICAndXMtd2VzdC0xJzogJ3MzLnVzLXdlc3QtMS5hbWF6b25hd3MuY29tJyxcbiAgJ3VzLXdlc3QtMic6ICdzMy51cy13ZXN0LTIuYW1hem9uYXdzLmNvbScsXG4gICd1cy1nb3YtZWFzdC0xJzogJ3MzLnVzLWdvdi1lYXN0LTEuYW1hem9uYXdzLmNvbScsXG4gICd1cy1nb3Ytd2VzdC0xJzogJ3MzLnVzLWdvdi13ZXN0LTEuYW1hem9uYXdzLmNvbScsXG4gIC8vIEFkZCBuZXcgZW5kcG9pbnRzIGhlcmUuXG59XG5cbmV4cG9ydCB0eXBlIFJlZ2lvbiA9IGtleW9mIHR5cGVvZiBhd3NTM0VuZHBvaW50IHwgc3RyaW5nXG5cbi8vIGdldFMzRW5kcG9pbnQgZ2V0IHJlbGV2YW50IGVuZHBvaW50IGZvciB0aGUgcmVnaW9uLlxuZXhwb3J0IGZ1bmN0aW9uIGdldFMzRW5kcG9pbnQocmVnaW9uOiBSZWdpb24pOiBzdHJpbmcge1xuICBpZiAoIWlzU3RyaW5nKHJlZ2lvbikpIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKGBJbnZhbGlkIHJlZ2lvbjogJHtyZWdpb259YClcbiAgfVxuXG4gIGNvbnN0IGVuZHBvaW50ID0gKGF3c1MzRW5kcG9pbnQgYXMgUmVjb3JkPHN0cmluZywgc3RyaW5nPilbcmVnaW9uXVxuICBpZiAoZW5kcG9pbnQpIHtcbiAgICByZXR1cm4gZW5kcG9pbnRcbiAgfVxuICByZXR1cm4gJ3MzLmFtYXpvbmF3cy5jb20nXG59XG4iXSwibWFwcGluZ3MiOiI7Ozs7OztBQWdCQSxJQUFBQSxPQUFBLEdBQUFDLE9BQUE7QUFoQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUlBO0FBQ0EsTUFBTUMsYUFBYSxHQUFHO0VBQ3BCLFlBQVksRUFBRSw2QkFBNkI7RUFDM0MsV0FBVyxFQUFFLDRCQUE0QjtFQUN6QyxZQUFZLEVBQUUsNkJBQTZCO0VBQzNDLFlBQVksRUFBRSw2QkFBNkI7RUFDM0MsZ0JBQWdCLEVBQUUsaUNBQWlDO0VBQ25ELGdCQUFnQixFQUFFLGlDQUFpQztFQUNuRCxnQkFBZ0IsRUFBRSxpQ0FBaUM7RUFDbkQsZ0JBQWdCLEVBQUUsaUNBQWlDO0VBQ25ELGdCQUFnQixFQUFFLGlDQUFpQztFQUNuRCxnQkFBZ0IsRUFBRSxpQ0FBaUM7RUFDbkQsZ0JBQWdCLEVBQUUsaUNBQWlDO0VBQ25ELGdCQUFnQixFQUFFLGlDQUFpQztFQUNuRCxjQUFjLEVBQUUsK0JBQStCO0VBQy9DLFdBQVcsRUFBRSw0QkFBNEI7RUFDekMsWUFBWSxFQUFFLGdDQUFnQztFQUM5QyxjQUFjLEVBQUUsK0JBQStCO0VBQy9DLGNBQWMsRUFBRSwrQkFBK0I7RUFDL0MsWUFBWSxFQUFFLDZCQUE2QjtFQUMzQyxZQUFZLEVBQUUsNkJBQTZCO0VBQzNDLFlBQVksRUFBRSw2QkFBNkI7RUFDM0MsV0FBVyxFQUFFLDRCQUE0QjtFQUN6QyxXQUFXLEVBQUUsNEJBQTRCO0VBQ3pDLFdBQVcsRUFBRSw0QkFBNEI7RUFDekMsY0FBYyxFQUFFLCtCQUErQjtFQUMvQyxjQUFjLEVBQUUsK0JBQStCO0VBQy9DLFlBQVksRUFBRSw2QkFBNkI7RUFDM0MsV0FBVyxFQUFFLDRCQUE0QjtFQUN6QyxXQUFXLEVBQUUsNEJBQTRCO0VBQ3pDLFdBQVcsRUFBRSw0QkFBNEI7RUFDekMsV0FBVyxFQUFFLDRCQUE0QjtFQUN6QyxXQUFXLEVBQUUsNEJBQTRCO0VBQ3pDLGVBQWUsRUFBRSxnQ0FBZ0M7RUFDakQsZUFBZSxFQUFFO0VBQ2pCO0FBQ0YsQ0FBQzs7QUFJRDtBQUNPLFNBQVNDLGFBQWFBLENBQUNDLE1BQWMsRUFBVTtFQUNwRCxJQUFJLENBQUMsSUFBQUMsZ0JBQVEsRUFBQ0QsTUFBTSxDQUFDLEVBQUU7SUFDckIsTUFBTSxJQUFJRSxTQUFTLENBQUUsbUJBQWtCRixNQUFPLEVBQUMsQ0FBQztFQUNsRDtFQUVBLE1BQU1HLFFBQVEsR0FBSUwsYUFBYSxDQUE0QkUsTUFBTSxDQUFDO0VBQ2xFLElBQUlHLFFBQVEsRUFBRTtJQUNaLE9BQU9BLFFBQVE7RUFDakI7RUFDQSxPQUFPLGtCQUFrQjtBQUMzQiJ9