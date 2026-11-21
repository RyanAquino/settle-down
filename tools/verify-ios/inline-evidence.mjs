import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const assetUrl = /^https:\/\/github\.com\/user-attachments\/assets\/[0-9a-f-]{36}$/;
const begin = '<!-- verify-ios-inline -->';
const end = '<!-- /verify-ios-inline -->';

async function readMedia(file, format) {
  const info = await lstat(file);
  if (!info.isFile() || !info.size || info.size >= 10_000_000)
    throw new Error('unsupported preview file');
  const data = await readFile(file);
  const valid = {
    png: data.subarray(0, 8).toString('hex') === '89504e470d0a1a0a',
    mp4: data.toString('ascii', 4, 8) === 'ftyp',
    gif: ['GIF89a', 'GIF87a'].includes(data.toString('ascii', 0, 6)),
  };
  if (!valid[format]) throw new Error('unexpected media format');
  return data;
}

export async function inlineEvidence({
  directory,
  scenarios,
  previous = '',
  token,
  repoId,
  repository,
  runId,
  attempt,
  publishImages,
  warn,
  fetchImpl = fetch,
}) {
  // A republished attempt keeps its uploads, including a manually backfilled
  // verdict. Reconstruct only known GitHub media syntax from this bot comment.
  const media = new Map();
  const prefix = `https://github.com/${repository}/blob/`;
  const folder = `/${runId}/${attempt}/`;
  const previousBlock = previous.split(begin)[1]?.split(end)[0] ?? '';
  for (const match of previousBlock.matchAll(
    /^\*\*([\w /-]{1,150})\*\*\n\n(?:!\[[^\n\]]*\]\(([^)\n]+)\)|(https:[^\n]+))$/gm,
  )) {
    const [, label, image, video] = match;
    const parts = image?.startsWith(prefix) && image.slice(prefix.length).split(folder);
    const savedImage =
      repository &&
      parts?.length === 2 &&
      /^[a-f0-9]{40}$/.test(parts[0]) &&
      /^[a-z][a-z0-9-]{0,39}\.[\w-]{1,80}\.(png|gif)\?raw=true$/.test(parts[1]);
    if (savedImage || assetUrl.test(image ?? video))
      media.set(label, { url: image ?? video, image: !!image });
  }
  let missing = false;
  const fallback = [];
  const ids = new Set(scenarios.map((s) => s.id));
  const entries = await readdir(directory, { withFileTypes: true }).catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const match = /^([a-z][a-z0-9-]{0,39})\.([\w-]{1,80})\.(png|mp4)$/.exec(entry.name);
    if (!match || !entry.isFile() || !ids.has(match[1])) continue;
    const [, id, stem, extension] = match;
    const image = extension === 'png';
    const label = (image ? id + ' / ' + stem : 'Replay clip / ' + id).replaceAll('-', ' ');
    if (media.has(label)) continue;
    const file = path.join(directory, entry.name);
    try {
      if (!token) throw new Error('no attachment token configured');
      const data = await readMedia(file, extension);
      const url = new URL('https://uploads.github.com/user-attachments/assets');
      url.search = new URLSearchParams({
        repository_id: String(repoId),
        name: entry.name,
        content_type: image ? 'image/png' : 'video/mp4',
      });
      const response = await fetchImpl(url, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/octet-stream',
          Accept: 'application/vnd.github+json',
          'User-Agent': 'settle-down-ios-verification',
        },
        body: data,
      });
      if (!response.ok) throw new Error('GitHub HTTP ' + response.status);
      const attachment = (await response.json()).url;
      if (!assetUrl.test(attachment)) throw new Error('unexpected attachment URL');
      media.set(label, { image, url: attachment });
    } catch (error) {
      warn('Native attachment unavailable for ' + entry.name + ': ' + error.message);
      try {
        const name = image ? entry.name : entry.name.replace(/\.mp4$/, '.gif');
        fallback.push({
          name,
          label,
          data: await readMedia(path.join(directory, name), image ? 'png' : 'gif'),
        });
      } catch (error) {
        missing = true;
        warn('Fallback preview unavailable for ' + entry.name + ': ' + error.message);
      }
    }
  }
  if (fallback.length) {
    try {
      const sha = await publishImages(fallback);
      for (const { label, name } of fallback)
        media.set(label, { image: true, url: prefix + sha + folder + name + '?raw=true' });
    } catch (error) {
      missing = true;
      warn('Could not publish fallback preview images: ' + error.message);
    }
  }
  const notice = missing
    ? 'Some inline previews could not be published. See the evidence archive below.'
    : '';
  if (!media.size) return notice;
  const lines = [begin, ''];
  for (const [label, { image, url }] of media)
    lines.push('**' + label + '**', '', image ? '![' + label + '](' + url + ')' : url, '');
  return [...lines, end, notice].join('\n').trimEnd();
}
