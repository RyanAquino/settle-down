export const marker = (request) => `<!-- verify-ios:${JSON.stringify(request)} -->`;
export const parseMarker = (body) => {
  try {
    return JSON.parse(body.match(/<!-- verify-ios:(\{[^\n]*\}) -->/)?.[1]);
  } catch {
    return null;
  }
};
export const externalId = (r) => `verify-ios:${r.runId}:${r.attempt}:${r.commentId}`;
export const finalMarker = (request, attempt) =>
  `<!-- verify-ios-final:${request.runId}:${attempt} -->`;
