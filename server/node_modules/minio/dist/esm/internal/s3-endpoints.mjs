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

import { isString } from "./helper.mjs";

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
export function getS3Endpoint(region) {
  if (!isString(region)) {
    throw new TypeError(`Invalid region: ${region}`);
  }
  const endpoint = awsS3Endpoint[region];
  if (endpoint) {
    return endpoint;
  }
  return 's3.amazonaws.com';
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJpc1N0cmluZyIsImF3c1MzRW5kcG9pbnQiLCJnZXRTM0VuZHBvaW50IiwicmVnaW9uIiwiVHlwZUVycm9yIiwiZW5kcG9pbnQiXSwic291cmNlcyI6WyJzMy1lbmRwb2ludHMudHMiXSwic291cmNlc0NvbnRlbnQiOlsiLypcbiAqIE1pbklPIEphdmFzY3JpcHQgTGlicmFyeSBmb3IgQW1hem9uIFMzIENvbXBhdGlibGUgQ2xvdWQgU3RvcmFnZSwgKEMpIDIwMTUsIDIwMTYgTWluSU8sIEluYy5cbiAqXG4gKiBMaWNlbnNlZCB1bmRlciB0aGUgQXBhY2hlIExpY2Vuc2UsIFZlcnNpb24gMi4wICh0aGUgXCJMaWNlbnNlXCIpO1xuICogeW91IG1heSBub3QgdXNlIHRoaXMgZmlsZSBleGNlcHQgaW4gY29tcGxpYW5jZSB3aXRoIHRoZSBMaWNlbnNlLlxuICogWW91IG1heSBvYnRhaW4gYSBjb3B5IG9mIHRoZSBMaWNlbnNlIGF0XG4gKlxuICogICAgIGh0dHA6Ly93d3cuYXBhY2hlLm9yZy9saWNlbnNlcy9MSUNFTlNFLTIuMFxuICpcbiAqIFVubGVzcyByZXF1aXJlZCBieSBhcHBsaWNhYmxlIGxhdyBvciBhZ3JlZWQgdG8gaW4gd3JpdGluZywgc29mdHdhcmVcbiAqIGRpc3RyaWJ1dGVkIHVuZGVyIHRoZSBMaWNlbnNlIGlzIGRpc3RyaWJ1dGVkIG9uIGFuIFwiQVMgSVNcIiBCQVNJUyxcbiAqIFdJVEhPVVQgV0FSUkFOVElFUyBPUiBDT05ESVRJT05TIE9GIEFOWSBLSU5ELCBlaXRoZXIgZXhwcmVzcyBvciBpbXBsaWVkLlxuICogU2VlIHRoZSBMaWNlbnNlIGZvciB0aGUgc3BlY2lmaWMgbGFuZ3VhZ2UgZ292ZXJuaW5nIHBlcm1pc3Npb25zIGFuZFxuICogbGltaXRhdGlvbnMgdW5kZXIgdGhlIExpY2Vuc2UuXG4gKi9cblxuaW1wb3J0IHsgaXNTdHJpbmcgfSBmcm9tICcuL2hlbHBlci50cydcblxuLy8gTGlzdCBvZiBjdXJyZW50bHkgc3VwcG9ydGVkIGVuZHBvaW50cy5cbmNvbnN0IGF3c1MzRW5kcG9pbnQgPSB7XG4gICdhZi1zb3V0aC0xJzogJ3MzLmFmLXNvdXRoLTEuYW1hem9uYXdzLmNvbScsXG4gICdhcC1lYXN0LTEnOiAnczMuYXAtZWFzdC0xLmFtYXpvbmF3cy5jb20nLFxuICAnYXAtc291dGgtMSc6ICdzMy5hcC1zb3V0aC0xLmFtYXpvbmF3cy5jb20nLFxuICAnYXAtc291dGgtMic6ICdzMy5hcC1zb3V0aC0yLmFtYXpvbmF3cy5jb20nLFxuICAnYXAtc291dGhlYXN0LTEnOiAnczMuYXAtc291dGhlYXN0LTEuYW1hem9uYXdzLmNvbScsXG4gICdhcC1zb3V0aGVhc3QtMic6ICdzMy5hcC1zb3V0aGVhc3QtMi5hbWF6b25hd3MuY29tJyxcbiAgJ2FwLXNvdXRoZWFzdC0zJzogJ3MzLmFwLXNvdXRoZWFzdC0zLmFtYXpvbmF3cy5jb20nLFxuICAnYXAtc291dGhlYXN0LTQnOiAnczMuYXAtc291dGhlYXN0LTQuYW1hem9uYXdzLmNvbScsXG4gICdhcC1zb3V0aGVhc3QtNSc6ICdzMy5hcC1zb3V0aGVhc3QtNS5hbWF6b25hd3MuY29tJyxcbiAgJ2FwLW5vcnRoZWFzdC0xJzogJ3MzLmFwLW5vcnRoZWFzdC0xLmFtYXpvbmF3cy5jb20nLFxuICAnYXAtbm9ydGhlYXN0LTInOiAnczMuYXAtbm9ydGhlYXN0LTIuYW1hem9uYXdzLmNvbScsXG4gICdhcC1ub3J0aGVhc3QtMyc6ICdzMy5hcC1ub3J0aGVhc3QtMy5hbWF6b25hd3MuY29tJyxcbiAgJ2NhLWNlbnRyYWwtMSc6ICdzMy5jYS1jZW50cmFsLTEuYW1hem9uYXdzLmNvbScsXG4gICdjYS13ZXN0LTEnOiAnczMuY2Etd2VzdC0xLmFtYXpvbmF3cy5jb20nLFxuICAnY24tbm9ydGgtMSc6ICdzMy5jbi1ub3J0aC0xLmFtYXpvbmF3cy5jb20uY24nLFxuICAnZXUtY2VudHJhbC0xJzogJ3MzLmV1LWNlbnRyYWwtMS5hbWF6b25hd3MuY29tJyxcbiAgJ2V1LWNlbnRyYWwtMic6ICdzMy5ldS1jZW50cmFsLTIuYW1hem9uYXdzLmNvbScsXG4gICdldS1ub3J0aC0xJzogJ3MzLmV1LW5vcnRoLTEuYW1hem9uYXdzLmNvbScsXG4gICdldS1zb3V0aC0xJzogJ3MzLmV1LXNvdXRoLTEuYW1hem9uYXdzLmNvbScsXG4gICdldS1zb3V0aC0yJzogJ3MzLmV1LXNvdXRoLTIuYW1hem9uYXdzLmNvbScsXG4gICdldS13ZXN0LTEnOiAnczMuZXUtd2VzdC0xLmFtYXpvbmF3cy5jb20nLFxuICAnZXUtd2VzdC0yJzogJ3MzLmV1LXdlc3QtMi5hbWF6b25hd3MuY29tJyxcbiAgJ2V1LXdlc3QtMyc6ICdzMy5ldS13ZXN0LTMuYW1hem9uYXdzLmNvbScsXG4gICdpbC1jZW50cmFsLTEnOiAnczMuaWwtY2VudHJhbC0xLmFtYXpvbmF3cy5jb20nLFxuICAnbWUtY2VudHJhbC0xJzogJ3MzLm1lLWNlbnRyYWwtMS5hbWF6b25hd3MuY29tJyxcbiAgJ21lLXNvdXRoLTEnOiAnczMubWUtc291dGgtMS5hbWF6b25hd3MuY29tJyxcbiAgJ3NhLWVhc3QtMSc6ICdzMy5zYS1lYXN0LTEuYW1hem9uYXdzLmNvbScsXG4gICd1cy1lYXN0LTEnOiAnczMudXMtZWFzdC0xLmFtYXpvbmF3cy5jb20nLFxuICAndXMtZWFzdC0yJzogJ3MzLnVzLWVhc3QtMi5hbWF6b25hd3MuY29tJyxcbiAgJ3VzLXdlc3QtMSc6ICdzMy51cy13ZXN0LTEuYW1hem9uYXdzLmNvbScsXG4gICd1cy13ZXN0LTInOiAnczMudXMtd2VzdC0yLmFtYXpvbmF3cy5jb20nLFxuICAndXMtZ292LWVhc3QtMSc6ICdzMy51cy1nb3YtZWFzdC0xLmFtYXpvbmF3cy5jb20nLFxuICAndXMtZ292LXdlc3QtMSc6ICdzMy51cy1nb3Ytd2VzdC0xLmFtYXpvbmF3cy5jb20nLFxuICAvLyBBZGQgbmV3IGVuZHBvaW50cyBoZXJlLlxufVxuXG5leHBvcnQgdHlwZSBSZWdpb24gPSBrZXlvZiB0eXBlb2YgYXdzUzNFbmRwb2ludCB8IHN0cmluZ1xuXG4vLyBnZXRTM0VuZHBvaW50IGdldCByZWxldmFudCBlbmRwb2ludCBmb3IgdGhlIHJlZ2lvbi5cbmV4cG9ydCBmdW5jdGlvbiBnZXRTM0VuZHBvaW50KHJlZ2lvbjogUmVnaW9uKTogc3RyaW5nIHtcbiAgaWYgKCFpc1N0cmluZyhyZWdpb24pKSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcihgSW52YWxpZCByZWdpb246ICR7cmVnaW9ufWApXG4gIH1cblxuICBjb25zdCBlbmRwb2ludCA9IChhd3NTM0VuZHBvaW50IGFzIFJlY29yZDxzdHJpbmcsIHN0cmluZz4pW3JlZ2lvbl1cbiAgaWYgKGVuZHBvaW50KSB7XG4gICAgcmV0dXJuIGVuZHBvaW50XG4gIH1cbiAgcmV0dXJuICdzMy5hbWF6b25hd3MuY29tJ1xufVxuIl0sIm1hcHBpbmdzIjoiQUFBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUEsU0FBU0EsUUFBUSxRQUFRLGNBQWE7O0FBRXRDO0FBQ0EsTUFBTUMsYUFBYSxHQUFHO0VBQ3BCLFlBQVksRUFBRSw2QkFBNkI7RUFDM0MsV0FBVyxFQUFFLDRCQUE0QjtFQUN6QyxZQUFZLEVBQUUsNkJBQTZCO0VBQzNDLFlBQVksRUFBRSw2QkFBNkI7RUFDM0MsZ0JBQWdCLEVBQUUsaUNBQWlDO0VBQ25ELGdCQUFnQixFQUFFLGlDQUFpQztFQUNuRCxnQkFBZ0IsRUFBRSxpQ0FBaUM7RUFDbkQsZ0JBQWdCLEVBQUUsaUNBQWlDO0VBQ25ELGdCQUFnQixFQUFFLGlDQUFpQztFQUNuRCxnQkFBZ0IsRUFBRSxpQ0FBaUM7RUFDbkQsZ0JBQWdCLEVBQUUsaUNBQWlDO0VBQ25ELGdCQUFnQixFQUFFLGlDQUFpQztFQUNuRCxjQUFjLEVBQUUsK0JBQStCO0VBQy9DLFdBQVcsRUFBRSw0QkFBNEI7RUFDekMsWUFBWSxFQUFFLGdDQUFnQztFQUM5QyxjQUFjLEVBQUUsK0JBQStCO0VBQy9DLGNBQWMsRUFBRSwrQkFBK0I7RUFDL0MsWUFBWSxFQUFFLDZCQUE2QjtFQUMzQyxZQUFZLEVBQUUsNkJBQTZCO0VBQzNDLFlBQVksRUFBRSw2QkFBNkI7RUFDM0MsV0FBVyxFQUFFLDRCQUE0QjtFQUN6QyxXQUFXLEVBQUUsNEJBQTRCO0VBQ3pDLFdBQVcsRUFBRSw0QkFBNEI7RUFDekMsY0FBYyxFQUFFLCtCQUErQjtFQUMvQyxjQUFjLEVBQUUsK0JBQStCO0VBQy9DLFlBQVksRUFBRSw2QkFBNkI7RUFDM0MsV0FBVyxFQUFFLDRCQUE0QjtFQUN6QyxXQUFXLEVBQUUsNEJBQTRCO0VBQ3pDLFdBQVcsRUFBRSw0QkFBNEI7RUFDekMsV0FBVyxFQUFFLDRCQUE0QjtFQUN6QyxXQUFXLEVBQUUsNEJBQTRCO0VBQ3pDLGVBQWUsRUFBRSxnQ0FBZ0M7RUFDakQsZUFBZSxFQUFFO0VBQ2pCO0FBQ0YsQ0FBQzs7QUFJRDtBQUNBLE9BQU8sU0FBU0MsYUFBYUEsQ0FBQ0MsTUFBYyxFQUFVO0VBQ3BELElBQUksQ0FBQ0gsUUFBUSxDQUFDRyxNQUFNLENBQUMsRUFBRTtJQUNyQixNQUFNLElBQUlDLFNBQVMsQ0FBRSxtQkFBa0JELE1BQU8sRUFBQyxDQUFDO0VBQ2xEO0VBRUEsTUFBTUUsUUFBUSxHQUFJSixhQUFhLENBQTRCRSxNQUFNLENBQUM7RUFDbEUsSUFBSUUsUUFBUSxFQUFFO0lBQ1osT0FBT0EsUUFBUTtFQUNqQjtFQUNBLE9BQU8sa0JBQWtCO0FBQzNCIn0=