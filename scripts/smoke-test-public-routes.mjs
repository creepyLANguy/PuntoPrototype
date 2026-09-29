#!/usr/bin/env node

import assert from 'node:assert/strict';

const base = (process.argv[2] || '').replace(/\/$/, '');
const firebaseProjectId = process.argv[3] || '';

if (!base)
{
  throw new Error('Usage: node scripts/smoke-test-public-routes.mjs <public-origin> <firebase-project-id>');
}

if (!firebaseProjectId)
{
  throw new Error('A Firebase project ID is required so the smoke test can probe the real Johannesburg postEvent function.');
}

const deviceApiUrl = 'https://africa-south1-' + firebaseProjectId + '.cloudfunctions.net/postEvent';

async function request(path)
{
  const url = base + path;
  const response = await fetch(url, { redirect: 'follow', cache: 'no-store' });
  return {
    url,
    status: response.status,
    contentType: response.headers.get('content-type') || '',
    body: await response.text()
  };
}

function assertHtml(response, marker, label)
{
  assert.match(response.contentType, /text\/html/i, label + ': expected HTML but received ' + response.contentType + ' (HTTP ' + response.status + ')');
  assert.ok(response.body.includes(marker), label + ': expected marker in ' + response.url);
}

function assertJsonError(response, label)
{
  assert.match(response.contentType, /application\/json/i, label + ': expected JSON but received ' + response.contentType + ' (HTTP ' + response.status + ')');
  const payload = JSON.parse(response.body);
  assert.equal(payload.success, false, label + ': expected missing-court response to be unsuccessful');
  assert.ok(payload.error, label + ': expected a structured error payload');
}

function assertNotJson(response, label)
{
  assert.doesNotMatch(response.contentType, /application\/json/i, label + ': legacy route still exposes a JSON API');
}

async function main()
{
  const appMarker = 'Padel Push™ - Live Scoreboard';
  const overlayMarker = 'Padel Push™ — Score Overlay';
  const deviceHarnessMarker = 'Device Test Harness';

  for (const path of ['/score/zzzz', '/revision/zzzz', '/stats/zzzz', '/momentum/zzzz'])
  {
    assertJsonError(await request(path), path);
  }

  for (const path of ['/harness', '/app/harness', '/device-harness', '/device-harness/index.html'])
  {
    assertHtml(await request(path), deviceHarnessMarker, path);
  }

  for (const path of ['/admin', '/app/admin'])
  {
    assertHtml(await request(path), appMarker, path);
  }

  const expectedOrigin = new URL(base).origin;

  const deviceApiPreflight = await fetch(deviceApiUrl, {
    method: 'OPTIONS',
    headers: {
      Origin: expectedOrigin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type'
    }
  });

  assert.equal(deviceApiPreflight.status, 204, 'postEvent: expected CORS preflight to succeed');
  assert.equal(
    deviceApiPreflight.headers.get('access-control-allow-origin'),
    expectedOrigin,
    'postEvent: expected the deployment origin to be explicitly allowed by CORS'
  );

  const deviceApiResponse = await fetch(deviceApiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      deviceId: '__device_harness_route_probe__',
      eventType: '__INVALID_DEVICE_HARNESS_PROBE__'
    })
  });

  assert.equal(deviceApiResponse.status, 400, 'postEvent: expected invalid-event validation from the deployed function');
  const deviceApiPayload = await deviceApiResponse.json();
  assert.equal(deviceApiPayload.success, false, 'postEvent: expected structured backend error');
  assert.match(deviceApiPayload.error || '', /Invalid eventType/i, 'postEvent: expected the request to reach the deployed Johannesburg function');

  for (const path of ['/overlay', '/overlay/zzzz', '/broadcast', '/broadcast/zzzz'])
  {
    assertHtml(await request(path), overlayMarker, path);
  }

  for (const path of ['/c', '/c/zzzz', '/p', '/p/zzzz'])
  {
    assertHtml(await request(path), appMarker, path);
  }

  for (const path of ['/m', '/m/zzzz', '/a', '/a/zzzz', '/r', '/r/zzzz', '/s', '/s/zzzz'])
  {
    assertNotJson(await request(path), path);
  }

  for (const path of ['/b', '/b/zzzz', '/o', '/o/zzzz'])
  {
    const response = await request(path);
    assertNotJson(response, path);
    assert.doesNotMatch(response.body, /Padel Push™ — Score Overlay/, path + ': legacy route still resolves to overlay');
  }

  console.log('Public route smoke test passed for ' + base);
}

await main();