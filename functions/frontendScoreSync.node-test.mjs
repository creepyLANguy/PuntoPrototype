import assert from "node:assert/strict";
import test from "node:test";

import { applyActiveScoreSnapshot } from "../app/js/scoreSync.mjs";

test("renders every consecutive score snapshot immediately", () =>
{
  const renderedScores = [];
  const renderScore = (score) => renderedScores.push(score);
  const listenerToken = 4;

  const firstScore = { A: { points: 1 }, B: { points: 0 } };
  const secondScore = { A: { points: 2 }, B: { points: 0 } };

  assert.equal(applyActiveScoreSnapshot(firstScore, listenerToken, listenerToken, renderScore), true);
  assert.equal(applyActiveScoreSnapshot(secondScore, listenerToken, listenerToken, renderScore), true);
  assert.deepEqual(renderedScores, [firstScore, secondScore]);
});

test("ignores snapshots from an inactive court listener", () =>
{
  let renderCount = 0;

  assert.equal(applyActiveScoreSnapshot({}, 3, 4, () => renderCount++), false);
  assert.equal(renderCount, 0);
});
