export function applyActiveScoreSnapshot(scoreData, listenerToken, activeListenerToken, renderScore)
{
  if (!scoreData || listenerToken !== activeListenerToken)
  {
    return false;
  }

  renderScore(scoreData);
  return true;
}
