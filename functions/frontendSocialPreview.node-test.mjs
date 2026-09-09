import assert from 'node:assert/strict';
import test from 'node:test';

global.document = {
  readyState: 'loading',
  addEventListener() {}
};

global.window = {
  location: {
    pathname: '/app/c/kdag/',
    origin: 'https://qa.padelpush.co.za'
  }
};

const {
  escapeXml,
  getCourtIdFromPath,
  buildCourtUrl,
  buildShareText,
  buildCourtModel,
  buildDetailsModel
} = await import('../app/js/social-preview-runtime.mjs');

test('getCourtIdFromPath accepts court and c routes', () => {
  assert.equal(getCourtIdFromPath('/c/KDAG/'), 'kdag');
  assert.equal(getCourtIdFromPath('/app/c/KDAG'), 'kdag');
  assert.equal(getCourtIdFromPath('/app/court/my%20court'), 'my court');
  assert.equal(getCourtIdFromPath('/'), '');
});

test('buildCourtUrl creates exactly one canonical court URL', () => {
  assert.equal(buildCourtUrl('kdag', 'https://qa.padelpush.co.za/'), 'https://qa.padelpush.co.za/c/kdag');
  assert.equal(buildCourtUrl('', 'https://qa.padelpush.co.za'), 'https://qa.padelpush.co.za/app/');
});

test('buildShareText embeds the target URL in text', () => {
  const text = buildShareText({
    context: 'court',
    courtName: 'Court 1',
    courtId: 'kdag',
    teamA: 'Home',
    teamB: 'Away',
    score: 'Score: 105-124',
    url: 'https://qa.padelpush.co.za/c/kdag'
  });

  assert.match(text, /Home vs Away/);
  assert.match(text, /Score: 105-124/);
  assert.equal((text.match(/https:\/\/qa\.padelpush\.co\.za\/c\/kdag/g) || []).length, 1);
  assert.doesNotMatch(text, /\/app\/\n$/);
});

test('preview models normalise share data to strings', () => {
  const court = buildCourtModel({
    courtName: 'Court 1',
    courtId: 'kdag',
    teamA: 'Home',
    teamB: 'Away',
    pointsA: 105,
    pointsB: 124,
    gamesA: 2,
    gamesB: 3,
    setsA: 1,
    setsB: 1,
    mode: 'Games and sets'
  });

  assert.deepEqual(court, {
    type: 'court',
    courtName: 'Court 1',
    courtId: 'KDAG',
    teamA: 'Home',
    teamB: 'Away',
    pointsA: '105',
    pointsB: '124',
    gamesA: '2',
    gamesB: '3',
    setsA: '1',
    setsB: '1',
    mode: 'Games and sets'
  });

  const details = buildDetailsModel({
    courtName: 'Court 1',
    courtId: 'kdag',
    teamA: 'Home',
    teamB: 'Away',
    overallA: 2,
    overallB: 1,
    headers: ['Set 1', 'Set 2'],
    rowA: [6, 7],
    rowB: [4, 5],
    mode: 'Match details'
  });

  assert.deepEqual(details.headers, ['Set 1', 'Set 2']);
  assert.deepEqual(details.rowA, ['6', '7']);
  assert.deepEqual(details.rowB, ['4', '5']);
});

test('escapeXml protects text rendered into SVG', () => {
  assert.equal(escapeXml('<Home & Away>'), '&lt;Home &amp; Away&gt;');
});
