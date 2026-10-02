// State of the shareable score card. Match Details starts a capture for every
// fresh render (bumping the generation); sharing waits for the pending capture
// and attaches the finished image file when one is available.
export const shareCardState = {
  shareableScoreCardImage: null,
  shareableScoreCardPromise: null,
  shareableScoreCardGeneration: 0,
};
