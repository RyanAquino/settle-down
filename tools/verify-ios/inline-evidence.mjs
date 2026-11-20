import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const assetUrl = /^https:\/\/github\.com\/user-attachments\/assets\/[0-9a-f-]{36}$/;
const begin = '<!-- verify-ios-inline -->';
const end = '<!-- /verify-ios-inline -->';

export async function inlineEvidence({
  directory,
  scenarios,
  previous = '',
  token,
  repoId,
  warn,
  fetchImpl = fetch,
}) {
  // A republished attempt keeps its uploads, including a manually backfilled
  // verdict. Reconstruct only known GitHub media syntax from this bot comment.
  const media = new Map();
  const previousBlock = previous.split(begin)[1]?.split(end)[0] ?? '';
  for (const match of previousBlock.matchAll(
    /^\*\*([\w /-]{1,150})\*\*\n\n(?:!\[[^\n\]]*\]\(([^)\n]+)\)|(https:[^\n]+))$/gm,
  )) {
    const [, label, image, video] = match;
    if (assetUrl.test(image ?? video)) media.set(label, { url: image ?? video, image: !!image });
  }
  let missing = false;
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
    if (!token) {
      missing = true;
      warn('Inline evidence requires the IOS_EVIDENCE_UPLOAD_TOKEN repository secret.');
      break;
    }
    try {
      const file = path.join(directory, entry.name);
      const { size } = await lstat(file);
      if (!size || size >= 10_000_000) throw new Error('unsupported attachment size');
      const data = await readFile(file);
      if (
        image
          ? data.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
          : data.toString('ascii', 4, 8) !== 'ftyp'
      )
        throw new Error('unexpected media format');
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
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/octet-stream' },
        body: data,
      });
      if (!response.ok) throw new Error('GitHub HTTP ' + response.status);
      const attachment = (await response.json()).url;
      if (!assetUrl.test(attachment)) throw new Error('unexpected attachment URL');
      media.set(label, { image, url: attachment });
    } catch (error) {
      missing = true;
      warn('Inline upload failed for ' + entry.name + ': ' + error.message);
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
